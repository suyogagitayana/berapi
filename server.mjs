import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const createExampleEndpoints = () =>
  [
    {
      id: randomUUID(),
      name: 'All users',
      method: 'GET',
      path: '/api/users',
      body: JSON.stringify(
        {
          users: [
            {
              id: 1,
              name: 'Alex Morgan',
              email: 'alex@example.com',
              role: 'Designer',
            },
            {
              id: 2,
              name: 'Jamie Chen',
              email: 'jamie@example.com',
              role: 'Developer',
            },
          ],
          total: 2,
        },
        null,
        2,
      ),
    },
    {
      id: randomUUID(),
      name: 'Create a user',
      method: 'POST',
      path: '/api/users',
      status: 201,
      body: JSON.stringify(
        { id: 3, name: 'Taylor Kim', message: 'User created successfully' },
        null,
        2,
      ),
    },
    {
      id: randomUUID(),
      name: 'Product catalog',
      method: 'GET',
      path: '/api/products',
      body: JSON.stringify(
        {
          products: [
            { id: 1, name: 'Everyday backpack', price: 79, inStock: true },
          ],
          total: 1,
        },
        null,
        2,
      ),
    },
    {
      id: randomUUID(),
      name: 'Current session',
      method: 'GET',
      path: '/api/session',
      body: JSON.stringify({ authenticated: true, userId: 1 }, null, 2),
    },
  ].map((e) => ({
    status: 200,
    delay: 0,
    format: 'json',
    headers: {},
    enabled: true,
    mode: 'simple',
    ...e,
  }));

export function validateEndpoint(e) {
  if (!e || typeof e.name !== 'string' || !e.name.trim() || e.name.length > 80)
    throw Error('Give this endpoint a name (up to 80 characters).');
  if (!methods.includes(e.method))
    throw Error('Choose a supported HTTP method.');
  if (
    typeof e.path !== 'string' ||
    !/^\/[A-Za-z0-9/_:.-]*$/.test(e.path) ||
    e.path.startsWith('/__berapi') ||
    e.path === '/' ||
    e.path.startsWith('/docs') ||
    e.path.startsWith('/assets/')
  )
    throw Error(
      'Use a path like /api/users. Root, /assets, /docs and /__berapi are reserved.',
    );
  if (
    e.id !== undefined &&
    (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(e.id))
  )
    throw Error(
      'Endpoint IDs must be short strings containing letters, numbers, underscores or hyphens.',
    );
  if (!Number.isInteger(e.status) || e.status < 200 || e.status > 599)
    throw Error('Status must be between 200 and 599.');
  if (!Number.isInteger(e.delay) || e.delay < 0 || e.delay > 30000)
    throw Error('Delay must be between 0 and 30000 ms.');
  const simulation = {
    jitter: 0,
    errorRate: 0,
    errorStatus: 500,
    errorBody: '{"error":"Internal server error"}',
    rateLimit: 0,
    rateWindow: 60,
    ...e.simulation,
  };
  for (const [key, min, max] of [
    ['jitter', 0, 30000],
    ['errorRate', 0, 100],
    ['errorStatus', 400, 599],
    ['rateLimit', 0, 10000],
    ['rateWindow', 1, 3600],
  ]) {
    if (
      !Number.isInteger(simulation[key]) ||
      simulation[key] < min ||
      simulation[key] > max
    )
      throw Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  if (typeof simulation.errorBody !== 'string')
    throw Error('The simulated error body must be JSON text.');
  try {
    JSON.parse(simulation.errorBody);
  } catch {
    throw Error('The simulated error body must contain valid JSON.');
  }
  if (
    !['json', 'text', 'html'].includes(e.format) ||
    typeof e.body !== 'string'
  )
    throw Error('Choose a valid response format and body.');
  if (e.format === 'json') {
    try {
      JSON.parse(e.body);
    } catch {
      throw Error('Response body must contain valid JSON.');
    }
  }
  if (!e.headers || typeof e.headers !== 'object' || Array.isArray(e.headers))
    throw Error('Headers must be a JSON object.');
  for (const [key, value] of Object.entries(e.headers)) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
      typeof value !== 'string' ||
      /[\r\n]/.test(value)
    )
      throw Error('Headers need valid names and single-line string values.');
    if (
      [
        'content-length',
        'transfer-encoding',
        'connection',
        'access-control-allow-origin',
        'content-encoding',
      ].includes(key.toLowerCase())
    )
      throw Error(`${key} is managed by berAPI.`);
  }
  return {
    id: e.id || randomUUID(),
    name: e.name.trim(),
    method: e.method,
    path: e.path,
    status: e.status,
    delay: e.delay,
    simulation,
    format: e.format,
    body: e.body,
    headers: e.headers,
    enabled: e.enabled !== false,
    mode: e.mode === 'advanced' ? 'advanced' : 'simple',
  };
}

// Match literal path segments and single-segment parameters such as :id.
function matchesEndpoint(endpoint, method, pathname) {
  if (!endpoint.enabled || endpoint.method !== method) return false;

  const expectedSegments = endpoint.path.split('/');
  const actualSegments = pathname.split('/');
  return (
    expectedSegments.length === actualSegments.length &&
    expectedSegments.every(
      (segment, index) =>
        segment.startsWith(':') || segment === actualSegments[index],
    )
  );
}

// A return value of zero means this request consumed an available slot.
function getRetryAfter(endpoint, rateBuckets, now) {
  const { rateLimit, rateWindow } = endpoint.simulation;
  if (rateLimit === 0) return 0;

  const time = now();
  let bucket = rateBuckets.get(endpoint.id);
  if (!bucket || time >= bucket.resetAt) {
    bucket = { count: 0, resetAt: time + rateWindow * 1000 };
    rateBuckets.set(endpoint.id, bucket);
  }
  if (bucket.count >= rateLimit) {
    return Math.max(1, Math.ceil((bucket.resetAt - time) / 1000));
  }

  bucket.count++;
  return 0;
}

async function sendMockResponse(endpoint, response, random) {
  const simulation = endpoint.simulation;
  const extraDelay = Math.floor(random() * (simulation.jitter + 1));
  await new Promise((resolve) =>
    setTimeout(resolve, endpoint.delay + extraDelay),
  );

  const simulateError =
    simulation.errorRate > 0 && random() * 100 < simulation.errorRate;
  const status = simulateError ? simulation.errorStatus : endpoint.status;
  const contentTypes = {
    json: 'application/json',
    text: 'text/plain',
    html: 'text/html',
  };
  const headers = {
    'Content-Type': contentTypes[endpoint.format],
    ...endpoint.headers,
  };

  // Simulated errors always use JSON, regardless of the regular response format.
  if (simulateError) {
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'content-type') delete headers[name];
    }
    headers['Content-Type'] = 'application/json';
  }

  const body = simulateError ? simulation.errorBody : endpoint.body;
  const hasNoBody = [204, 205, 304].includes(status);
  response.writeHead(status, headers);
  response.end(hasNoBody ? undefined : body);
  return status;
}

function getStaticAssetPath(pathname) {
  if (pathname.startsWith('/docs')) {
    const documentPath = pathname.replace(/^\/docs\/?/, '') || 'index.html';
    return `docs/${documentPath}`;
  }
  if (pathname === '/') return 'public/index.html';
  return `public/${pathname.slice(1)}`;
}

export async function createServer({
  dataDir = path.join(root, 'data'),
  now = Date.now,
  random = Math.random,
} = {}) {
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'endpoints.json');
  let endpoints;
  try {
    endpoints = JSON.parse(await readFile(file, 'utf8')).map(validateEndpoint);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    endpoints = createExampleEndpoints().map(validateEndpoint);
    await writeFile(file, JSON.stringify(endpoints, null, 2));
  }
  let queue = Promise.resolve();
  const logs = [];
  const rateBuckets = new Map();
  const sendJson = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/__berapi/')) {
        // Management stays same-origin; only mock endpoints expose CORS.
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}`
        )
          return sendJson(res, 403, {
            error: 'Management requests must come from this workspace.',
          });
        if (req.method === 'GET' && url.pathname === '/__berapi/state')
          return sendJson(res, 200, { endpoints, logs });
        if (req.method === 'PUT' && url.pathname === '/__berapi/endpoints') {
          if (!req.headers['content-type']?.startsWith('application/json'))
            return sendJson(res, 415, { error: 'Send application/json.' });
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 2_000_000)
              return sendJson(res, 413, { error: 'Workspace exceeds 2 MB.' });
          }
          const raw = JSON.parse(body);
          if (!Array.isArray(raw) || raw.length > 500)
            throw Error('A workspace supports up to 500 endpoints.');
          const next = raw.map(validateEndpoint);
          if (
            new Set(next.map((e) => `${e.method} ${e.path}`)).size !==
            next.length
          )
            throw Error('An endpoint already uses this method and path.');
          if (new Set(next.map((e) => e.id)).size !== next.length)
            throw Error('Endpoint IDs must be unique.');
          queue = queue
            .catch(() => {})
            .then(async () => {
              await writeFile(file, JSON.stringify(next, null, 2));
              for (const previous of endpoints) {
                const updated = next.find((e) => e.id === previous.id);
                if (
                  !updated ||
                  updated.path !== previous.path ||
                  updated.method !== previous.method ||
                  updated.enabled !== previous.enabled ||
                  updated.simulation.rateLimit !==
                    previous.simulation.rateLimit ||
                  updated.simulation.rateWindow !==
                    previous.simulation.rateWindow
                )
                  rateBuckets.delete(previous.id);
              }
              endpoints = next;
            });
          await queue;
          return sendJson(res, 200, { endpoints });
        }
        return sendJson(res, 404, { error: 'Management route not found.' });
      }
      if (
        req.method === 'GET' &&
        (url.pathname === '/' ||
          url.pathname.startsWith('/assets/') ||
          url.pathname === '/docs' ||
          url.pathname.startsWith('/docs/'))
      ) {
        const relative = getStaticAssetPath(url.pathname);
        const target = path.resolve(root, relative);
        if (!target.startsWith(root + path.sep))
          return sendJson(res, 403, { error: 'Forbidden' });
        try {
          const contents = await readFile(target);
          res.writeHead(200, {
            'Content-Type':
              {
                '.html': 'text/html; charset=utf-8',
                '.css': 'text/css',
                '.js': 'text/javascript',
                '.svg': 'image/svg+xml',
              }[path.extname(target)] || 'application/octet-stream',
          });
          return res.end(contents);
        } catch {
          return sendJson(res, 404, { error: 'File not found.' });
        }
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Methods',
        methods.join(', ') + ', OPTIONS',
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] ||
          'Content-Type, Authorization',
      );
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      const endpoint = endpoints.find((endpoint) =>
        matchesEndpoint(endpoint, req.method, url.pathname),
      );
      const start = Date.now();
      let status = 404;

      if (!endpoint) {
        sendJson(res, status, {
          error: 'No matching endpoint. Create or enable it in berAPI.',
        });
      } else {
        const retryAfter = getRetryAfter(endpoint, rateBuckets, now);
        if (retryAfter > 0) {
          status = 429;
          res.setHeader('Retry-After', retryAfter);
          res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
          sendJson(res, status, {
            error: 'Too many requests',
            message: `Limit of ${endpoint.simulation.rateLimit} requests per ${endpoint.simulation.rateWindow} seconds exceeded.`,
          });
        } else {
          status = await sendMockResponse(endpoint, res, random);
        }
      }

      logs.unshift({
        method: req.method,
        path: url.pathname,
        status,
        duration: Date.now() - start,
        time: new Date().toISOString(),
      });
      logs.splice(100);
    } catch (error) {
      if (!res.headersSent) sendJson(res, 400, { error: error.message });
      else res.end();
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 3000);
  const server = await createServer();
  server.listen(port, '127.0.0.1', () =>
    console.log(`Berapi is ready at http://localhost:${port}`),
  );
}
