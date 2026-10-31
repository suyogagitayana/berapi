import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';

test('local workspace serves persistent mocks and validates management updates', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'berapi-test-'));
  let server = await createServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const put = (entries) =>
    fetch(`${base}/__berapi/endpoints`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries),
    });
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await rm(dataDir, { recursive: true, force: true });
  });
  assert.equal((await fetch(base)).status, 200);
  assert.match(await (await fetch(`${base}/docs/`)).text(), /GitHub Pages/);
  const state = await (await fetch(`${base}/__berapi/state`)).json();
  assert.equal(state.endpoints.length, 4);
  const response = await fetch(`${base}/api/users`, {
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal((await response.json()).users.length, 2);
  const preflight = await fetch(`${base}/api/users`, {
    method: 'OPTIONS',
    headers: { 'Access-Control-Request-Headers': 'X-Test, Content-Type' },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-Test/);
  const custom = {
    ...state.endpoints[0],
    path: '/api/items/:id',
    status: 418,
    delay: 35,
    format: 'text',
    body: 'A custom response',
    mode: 'advanced',
    headers: { 'X-Mock': 'yes' },
  };
  assert.equal((await put([custom])).status, 200);
  const start = Date.now();
  const advanced = await fetch(`${base}/api/items/42?test=true`);
  assert.equal(advanced.status, 418);
  assert.equal(await advanced.text(), 'A custom response');
  assert.equal(advanced.headers.get('x-mock'), 'yes');
  assert.ok(Date.now() - start >= 30);
  assert.equal(
    (await fetch(`${base}/api/items/42`, { method: 'POST' })).status,
    404,
  );
  assert.equal(
    (await put([{ ...custom, format: 'json', body: '{broken' }])).status,
    400,
  );
  assert.equal(
    (await put([custom, { ...custom, id: 'duplicate' }])).status,
    400,
  );
  assert.equal(
    (await put([{ ...custom, headers: { 'X-Test': 'bad\r\nvalue' } }])).status,
    400,
  );
  assert.equal(
    (await put([{ ...custom, path: '/assets/conflict' }])).status,
    400,
  );
  assert.equal((await put([{ ...custom, id: { invalid: true } }])).status, 400);
  assert.equal(
    (
      await fetch(`${base}/__berapi/endpoints`, {
        method: 'PUT',
        headers: {
          Origin: 'http://other.example',
          'Content-Type': 'application/json',
        },
        body: '[]',
      })
    ).status,
    403,
  );
  assert.equal((await put([{ ...custom, enabled: false }])).status, 200);
  assert.equal((await fetch(`${base}/api/items/42`)).status, 404);
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
  server = await createServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const restored = await (await fetch(`${base}/__berapi/state`)).json();
  assert.equal(restored.endpoints[0].body, 'A custom response');
  assert.equal(restored.endpoints[0].enabled, false);
  assert.equal(restored.logs.length, 0);
});

test('simulates latency, intermittent errors, and a shared fixed-window rate limit', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'berapi-simulation-'));
  let time = 1000;
  const server = await createServer({
    dataDir,
    now: () => time,
    random: () => 0.5,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = await (await fetch(`${base}/__berapi/state`)).json();
  const endpoint = {
    ...state.endpoints[0],
    delay: 20,
    headers: { 'content-type': 'text/plain' },
    simulation: {
      jitter: 40,
      errorRate: 100,
      errorStatus: 503,
      errorBody: '{"error":"Try again"}',
      rateLimit: 0,
      rateWindow: 2,
    },
  };
  const put = (e) =>
    fetch(`${base}/__berapi/endpoints`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([e]),
    });
  assert.equal((await put(endpoint)).status, 200);
  const started = Date.now();
  const failed = await fetch(`${base}/api/users`);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'Try again' });
  assert.equal(failed.headers.get('content-type'), 'application/json');
  assert.ok(
    Date.now() - started >= 35,
    'base delay and deterministic jitter both apply',
  );
  endpoint.delay = 0;
  endpoint.simulation.jitter = 0;
  endpoint.simulation.errorRate = 30;
  await put(endpoint);
  assert.equal(
    (await fetch(`${base}/api/users`)).status,
    200,
    'random value above error frequency succeeds',
  );
  endpoint.simulation.errorRate = 60;
  await put(endpoint);
  assert.equal(
    (await fetch(`${base}/api/users`)).status,
    503,
    'random value below error frequency fails',
  );
  endpoint.simulation.errorRate = 0;
  endpoint.simulation.rateLimit = 2;
  await put(endpoint);
  const preflight = await fetch(`${base}/api/users`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  const burst = await Promise.all(
    Array.from({ length: 4 }, () => fetch(`${base}/api/users`)),
  );
  assert.deepEqual(burst.map((r) => r.status).sort(), [200, 200, 429, 429]);
  const limited = burst.find((r) => r.status === 429);
  assert.equal(limited.headers.get('retry-after'), '2');
  assert.equal(limited.headers.get('access-control-allow-origin'), '*');
  assert.equal(
    limited.headers.get('access-control-expose-headers'),
    'Retry-After',
  );
  assert.equal((await limited.json()).error, 'Too many requests');
  await put(endpoint);
  assert.equal(
    (await fetch(`${base}/api/users`)).status,
    429,
    'unrelated saves do not reset allowance',
  );
  time += 2000;
  assert.equal(
    (await fetch(`${base}/api/users`)).status,
    200,
    'allowance resets after the window',
  );
  for (const invalid of [
    { errorRate: 101 },
    { jitter: -1 },
    { rateLimit: -1 },
    { rateWindow: 0 },
    { errorStatus: 200 },
    { errorBody: 'invalid JSON' },
  ]) {
    assert.equal(
      (
        await put({
          ...endpoint,
          simulation: { ...endpoint.simulation, ...invalid },
        })
      ).status,
      400,
    );
  }
  const saved = await (await fetch(`${base}/__berapi/state`)).json();
  assert.equal(saved.endpoints[0].simulation.rateLimit, 2);
  assert.ok(saved.logs.some((l) => l.status === 429));
  assert.ok(saved.logs.some((l) => l.status === 503));
  endpoint.simulation.rateLimit = 0;
  await put(endpoint);
  assert.equal((await fetch(`${base}/api/users`)).status, 200);
});
