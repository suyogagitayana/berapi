const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );
// Saved workspace data and the endpoint currently being edited.
let endpoints = [];
let logs = [];
let selected;
let draft;
let dirty = false;
let tab = 'response';
let view = 'endpoints';
let result = null;
let toastTimer;
function showToast(message, error = false) {
  $('#toast').textContent = message;
  $('#toast').className = `visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').className = ''), 4000);
}
async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Something went wrong.');
  return data;
}
function setDirty() {
  dirty = true;
  const state = $('#save-state');
  if (state) state.textContent = '● Unsaved changes';
}
async function confirmDiscardChanges() {
  if (!dirty) return true;
  const dialog = $('#confirm-dialog');
  dialog.showModal();
  return new Promise((resolve) => {
    $('#keep-editing').onclick = () => {
      dialog.close();
      resolve(false);
    };
    $('#discard-changes').onclick = () => {
      dialog.close();
      resolve(true);
    };
    dialog.oncancel = () => resolve(false);
  });
}
function selectEndpoint(id) {
  selected = id;
  draft = structuredClone(endpoints.find((e) => e.id === id));
  dirty = false;
  tab = 'response';
  result = null;
  renderWorkspace();
}
// Endpoint list and editor rendering.
function renderEndpointList() {
  const query = $('#search').value.toLowerCase();
  const filtered = endpoints.filter((e) =>
    `${e.name} ${e.method} ${e.path}`.toLowerCase().includes(query),
  );
  $('#endpoint-list').innerHTML = filtered.length
    ? filtered
        .map(
          (e) =>
            /* HTML */ `<button
              class="endpoint-item ${selected === e.id ? 'selected' : ''}"
              data-id="${escapeHtml(e.id)}"
            >
              <span class="endpoint-name"
                >${escapeHtml(e.name)}<span
                  class="live-dot ${e.enabled ? '' : 'disabled-dot'}"
                ></span></span
              ><span class="endpoint-route"
                ><span class="method ${e.method}">${e.method}</span
                >${escapeHtml(e.path)}</span
              >
            </button>`,
        )
        .join('')
    : /* HTML */ `<div class="empty-state">No endpoints found.</div>`;
  $('#nav-count').textContent = endpoints.length;
  $('#endpoint-count').textContent =
    `${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'}`;
  $('#enabled-count').textContent =
    `${endpoints.filter((e) => e.enabled).length} active`;
  document.querySelectorAll('[data-id]').forEach(
    (button) =>
      (button.onclick = async () => {
        if (await confirmDiscardChanges()) selectEndpoint(button.dataset.id);
      }),
  );
}
function renderWorkspace() {
  renderEndpointList();
  if (!draft) {
    $('#editor').innerHTML = /* HTML */ `<div class="empty-state">
      <h2>No endpoints yet</h2>
      <p>Add an endpoint to start serving a mock response.</p>
      <button class="button primary" id="empty-add">+ New endpoint</button>
    </div>`;
    $('#empty-add').onclick = addEndpoint;
    return;
  }
  draft.simulation ||= simulationDefaults();
  const advanced = draft.mode === 'advanced';
  $('#editor').innerHTML = renderEditorMarkup(advanced);
  bindCodeEditor();
  bindEndpointControls();
  bindSettingsControls();
  renderResult();
}

function renderEditorMarkup(advanced) {
  return /* HTML */ `<div class="editor-heading">
      <div>
        <h2>${escapeHtml(draft.name)}</h2>
        <p>Configure the response for this endpoint.</p>
      </div>
      <button
        class="icon-button"
        id="delete-endpoint"
        title="Delete endpoint"
        aria-label="Delete endpoint"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
        >
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
        </svg>
      </button>
    </div>
    <div class="mode-switch" aria-label="API mode">
      <button data-mode="simple" class="${advanced ? '' : 'selected'}">
        Simple API</button
      ><button data-mode="advanced" class="${advanced ? 'selected' : ''}">
        Advanced API
      </button>
    </div>
    <div class="url-bar">
      <select id="method" aria-label="HTTP method">
        ${['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
          .map(
            (m) =>
              /* HTML */ `<option ${draft.method === m ? 'selected' : ''}>
                ${m}
              </option>`,
          )
          .join('')}
      </select>
      <div class="url-input">
        <span>${escapeHtml(location.origin)}</span
        ><input
          id="endpoint-path"
          aria-label="Endpoint path"
          value="${escapeHtml(draft.path)}"
          spellcheck="false"
        />
      </div>
      <button class="copy-button" id="copy-url" title="Copy endpoint URL">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
        >
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M15 8V4H4v11h4" /></svg
        ><span>Copy URL</span>
      </button>
    </div>
    <div class="editor-tabs" role="tablist">
      <button
        role="tab"
        data-tab="response"
        aria-selected="${tab === 'response'}"
        class="${tab === 'response' ? 'selected' : ''}"
      >
        Response body</button
      >${advanced
        ? /* HTML */ `<button
            role="tab"
            data-tab="headers"
            aria-selected="${tab === 'headers'}"
            class="${tab === 'headers' ? 'selected' : ''}"
          >
            Headers <span>${Object.keys(draft.headers).length || ''}</span>
          </button>`
        : ''}<button
        role="tab"
        data-tab="settings"
        aria-selected="${tab === 'settings'}"
        class="${tab === 'settings' ? 'selected' : ''}"
      >
        Settings</button
      ><span class="tab-meta">${escapeHtml(draft.format.toUpperCase())}</span>
    </div>
    <div id="tab-content">
      ${tab === 'settings'
        ? renderSettings(advanced)
        : /* HTML */ `<div class="body-toolbar">
              <span
                >${tab === 'headers'
                  ? 'CUSTOM RESPONSE HEADERS'
                  : 'RESPONSE BODY'}</span
              ><button id="format-body">Format JSON</button>
            </div>
            <div class="code-editor">
              <div class="line-numbers" aria-hidden="true"></div>
              <textarea
                id="code"
                spellcheck="false"
                aria-label="${tab === 'headers'
                  ? 'Custom response headers as JSON'
                  : 'Response body'}"
              ></textarea>
            </div>
            <p class="editor-hint">
              <span>ⓘ</span>${tab === 'headers'
                ? 'A JSON object of header names and string values. CORS is handled for you.'
                : 'Returned as the response body when this endpoint is called.'}
            </p>`}
    </div>
    <div class="editor-bottom">
      <span class="save-state" id="save-state"
        >${dirty ? '● Unsaved changes' : 'All changes saved'}</span
      >
      <div class="editor-actions">
        <button class="button" id="test-endpoint">Test request</button
        ><button class="button primary" id="save-endpoint">
          Save endpoint
        </button>
      </div>
    </div>
    <div id="result-slot"></div>`;
}

function bindCodeEditor() {
  if ($('#code')) {
    $('#code').value =
      tab === 'headers'
        ? (draft.headerText ?? JSON.stringify(draft.headers, null, 2))
        : draft.body;
    updateLineNumbers();
    $('#code').oninput = () => {
      if (tab === 'headers') draft.headerText = $('#code').value;
      else draft.body = $('#code').value;
      setDirty();
      updateLineNumbers();
    };
    $('#code').onscroll = () =>
      ($('.line-numbers').scrollTop = $('#code').scrollTop);
    $('#code').onkeydown = (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const el = e.target,
          start = el.selectionStart,
          end = el.selectionEnd;
        el.setRangeText('  ', start, end, 'end');
        el.dispatchEvent(new Event('input'));
      }
    };
    $('#format-body').onclick = () => {
      try {
        $('#code').value = JSON.stringify(
          JSON.parse($('#code').value),
          null,
          2,
        );
        $('#code').dispatchEvent(new Event('input'));
      } catch {
        showToast('This content is not valid JSON yet.', true);
      }
    };
  }
}

function bindEndpointControls() {
  $('#method').onchange = (e) => {
    draft.method = e.target.value;
    setDirty();
  };
  $('#endpoint-path').oninput = (e) => {
    draft.path = e.target.value;
    setDirty();
  };
  $('#copy-url').onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.origin + draft.path);
      showToast(
        dirty
          ? 'URL copied. Save changes before using it.'
          : 'API URL copied to clipboard.',
      );
    } catch {
      showToast('Clipboard unavailable. Select and copy the path above.', true);
    }
  };
  document.querySelectorAll('[data-tab]').forEach(
    (button) =>
      (button.onclick = () => {
        tab = button.dataset.tab;
        renderWorkspace();
      }),
  );
  document.querySelectorAll('[data-mode]').forEach(
    (button) =>
      (button.onclick = () => {
        draft.mode = button.dataset.mode;
        if (draft.mode === 'simple') tab = 'response';
        setDirty();
        renderWorkspace();
      }),
  );
  $('#save-endpoint').onclick = () => saveEndpoint();
  $('#test-endpoint').onclick = testEndpoint;
  $('#delete-endpoint').onclick = deleteEndpoint;
}

function bindSettingsControls() {
  if ($('#name')) {
    $('#name').oninput = (e) => {
      draft.name = e.target.value;
      setDirty();
    };
    $('#enabled').onchange = (e) => {
      draft.enabled = e.target.checked;
      setDirty();
    };
  }
  if ($('#status')) {
    for (const key of ['status', 'delay', 'format'])
      $(`#${key}`).onchange = (e) => {
        draft[key] = key === 'format' ? e.target.value : Number(e.target.value);
        setDirty();
      };
  }
  if ($('#simulation-preset')) {
    $('#simulation-preset').onchange = (e) =>
      applySimulationPreset(e.target.value);
    document.querySelectorAll('[data-simulation]').forEach(
      (input) =>
        (input.oninput = (e) => {
          draft.simulation[input.dataset.simulation] =
            input.dataset.simulation === 'errorBody'
              ? e.target.value
              : Number(e.target.value);
          setDirty();
        }),
    );
  }
}

// Advanced response settings and simulation presets.
function simulationDefaults() {
  return {
    jitter: 0,
    errorRate: 0,
    errorStatus: 500,
    errorBody: JSON.stringify({ error: 'Internal server error' }, null, 2),
    rateLimit: 0,
    rateWindow: 60,
  };
}
function renderSettings(advanced) {
  const sim = draft.simulation;
  return /* HTML */ `<div class="form-grid">
      <label class="field" style="grid-column:1/-1"
        >Endpoint name<input
          id="name"
          maxlength="80"
          value="${escapeHtml(draft.name)}"
        /><small>A friendly name to find it later.</small></label
      >${advanced
        ? /* HTML */ `<label class="field"
              >Success status code<input
                id="status"
                type="number"
                min="200"
                max="599"
                value="${draft.status}" /></label
            ><label class="field"
              >Response format<select id="format">
                ${['json', 'text', 'html']
                  .map(
                    (f) =>
                      /* HTML */ `<option
                        value="${f}"
                        ${draft.format === f ? 'selected' : ''}
                      >
                        ${f.toUpperCase()}
                      </option>`,
                  )
                  .join('')}
              </select></label
            >`
        : ''}<label class="field switch-field"
        ><input
          id="enabled"
          type="checkbox"
          ${draft.enabled ? 'checked' : ''}
        />
        Endpoint enabled <small>Accept incoming requests</small></label
      >
    </div>
    ${advanced
      ? /* HTML */ `<section class="simulation-section">
          <div class="simulation-heading">
            <h3>Network &amp; errors</h3>
            <label class="preset-label"
              >Apply preset<select id="simulation-preset">
                <option value="">Choose a preset…</option>
                <option value="normal">Normal response</option>
                <option value="slow">Slow connection (2–3 s)</option>
                <option value="unreliable">Unreliable (30% errors)</option>
                <option value="limited">Rate limited (5 / minute)</option>
                <option value="401">Unauthorized (401)</option>
                <option value="404">Not found (404)</option>
                <option value="500">Server error (500)</option>
                <option value="503">Unavailable (503)</option>
              </select></label
            >
          </div>
          <p class="simulation-intro">
            Simulate loading, retries, and failure states without changing your
            saved response body.
          </p>
          <div class="form-grid simulation-grid">
            <label class="field"
              >Response delay (ms)<input
                id="delay"
                type="number"
                min="0"
                max="30000"
                value="${draft.delay}"
              /><small>Wait before sending a response.</small></label
            >
            <label class="field"
              >Random extra delay (ms)<input
                data-simulation="jitter"
                type="number"
                min="0"
                max="30000"
                value="${sim.jitter}"
              /><small>Adds a random amount up to this value.</small></label
            >
            <label class="field"
              >Error frequency (%)<input
                data-simulation="errorRate"
                type="number"
                min="0"
                max="100"
                value="${sim.errorRate}"
              /><small
                >0 = no simulated errors. 100 = always fail.</small
              ></label
            >
            <label class="field"
              >Error status code<input
                data-simulation="errorStatus"
                type="number"
                min="400"
                max="599"
                value="${sim.errorStatus}"
              /><small>Used when a simulated error occurs.</small></label
            >
            <label class="field simulation-wide"
              >Error response body (JSON)<textarea
                data-simulation="errorBody"
                rows="3"
                spellcheck="false"
              >
${escapeHtml(sim.errorBody)}</textarea
              ><small
                >Errors return this JSON instead of the regular body.</small
              ></label
            >
          </div>
          <div class="rate-limit-heading">
            <h4>Request rate limit</h4>
            <p>
              Shared across all clients calling this endpoint. Extra requests
              return 429 with a Retry-After header.
            </p>
          </div>
          <div class="form-grid simulation-grid">
            <label class="field"
              >Allowed requests<input
                data-simulation="rateLimit"
                type="number"
                min="0"
                max="10000"
                value="${sim.rateLimit}"
              /><small>Set to 0 for unlimited requests.</small></label
            >
            <label class="field"
              >Window (seconds)<input
                data-simulation="rateWindow"
                type="number"
                min="1"
                max="3600"
                value="${sim.rateWindow}"
              /><small>The allowance resets after this interval.</small></label
            >
          </div>
          <p class="simulation-note">
            Save to apply. Settings still apply when you switch to Simple API.
            Choose Normal response to clear delays, errors, and rate limits.
          </p>
        </section>`
      : ''}`;
}
function applySimulationPreset(preset) {
  if (!preset) return;
  draft.simulation = simulationDefaults();
  draft.delay = 0;
  if (preset === 'slow') {
    draft.delay = 2000;
    draft.simulation.jitter = 1000;
  }
  if (preset === 'unreliable') {
    draft.delay = 500;
    draft.simulation.jitter = 1500;
    draft.simulation.errorRate = 30;
  }
  if (preset === 'limited') draft.simulation.rateLimit = 5;
  if (/^\d{3}$/.test(preset)) {
    const messages = {
      401: 'Unauthorized',
      404: 'Not found',
      500: 'Internal server error',
      503: 'Service unavailable',
    };
    draft.simulation.errorRate = 100;
    draft.simulation.errorStatus = Number(preset);
    draft.simulation.errorBody = JSON.stringify(
      { error: messages[preset] },
      null,
      2,
    );
  }
  setDirty();
  renderWorkspace();
}
function updateLineNumbers() {
  $('.line-numbers').textContent = Array.from(
    { length: $('#code').value.split('\n').length },
    (_, i) => i + 1,
  ).join('\n');
}
// Persist edits and make real HTTP requests to saved endpoints.
async function persistEndpoints(next) {
  const data = await requestJson('/__berapi/endpoints', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  endpoints = data.endpoints;
}
async function saveEndpoint(silent = false) {
  $('#save-endpoint').disabled = true;
  try {
    const clean = { ...draft };
    if (clean.headerText !== undefined) {
      try {
        clean.headers = JSON.parse(clean.headerText);
      } catch {
        throw Error('Headers must be a valid JSON object.');
      }
      delete clean.headerText;
    }
    const next = endpoints.some((e) => e.id === clean.id)
      ? endpoints.map((e) => (e.id === clean.id ? clean : e))
      : [...endpoints, clean];
    await persistEndpoints(next);
    draft = structuredClone(endpoints.find((e) => e.id === clean.id));
    dirty = false;
    renderWorkspace();
    if (!silent) showToast('Endpoint saved.');
    return true;
  } catch (e) {
    showToast(e.message, true);
    $('#save-endpoint').disabled = false;
    return false;
  }
}
async function addEndpoint() {
  if (!(await confirmDiscardChanges())) return;
  let n = endpoints.length + 1;
  while (endpoints.some((e) => e.path === `/api/endpoint-${n}`)) n++;
  draft = {
    id: crypto.randomUUID(),
    name: 'Untitled endpoint',
    method: 'GET',
    path: `/api/endpoint-${n}`,
    status: 200,
    delay: 0,
    format: 'json',
    headers: {},
    enabled: true,
    mode: 'simple',
    body: '{\n  "message": "Hello, frontend!"\n}',
  };
  selected = draft.id;
  dirty = true;
  tab = 'settings';
  result = null;
  setView('endpoints');
  renderWorkspace();
  $('#name').focus();
  $('#name').select();
}
async function deleteEndpoint() {
  if (!confirm(`Delete “${draft.name}”? This removes its saved response.`))
    return;
  try {
    await persistEndpoints(endpoints.filter((e) => e.id !== selected));
    selectEndpoint(endpoints[0]?.id);
    showToast('Endpoint deleted.');
  } catch (e) {
    showToast(e.message, true);
  }
}
async function testEndpoint() {
  if (dirty && !(await saveEndpoint(true))) return;
  if (!draft.enabled)
    return showToast('Enable this endpoint in Settings before testing.', true);
  if (draft.path.includes(':'))
    return showToast(
      'Copy the URL and replace path parameters (such as :id) with a value.',
      true,
    );
  $('#test-endpoint').disabled = true;
  const started = performance.now();
  try {
    const response = await fetch(draft.path, { method: draft.method });
    const body = await response.text();
    let formatted = body;
    try {
      formatted = JSON.stringify(JSON.parse(body), null, 2);
    } catch {}
    result = {
      status: response.status,
      duration: Math.round(performance.now() - started),
      body: formatted || '(Empty response body)',
      headers: [...response.headers].map(([k, v]) => `${k}: ${v}`).join('\n'),
    };
    renderResult();
    await refreshActivity();
  } catch (e) {
    showToast(`Request failed: ${e.message}`, true);
  } finally {
    $('#test-endpoint').disabled = false;
  }
}
function renderResult() {
  if (!result) return;
  $('#result-slot').innerHTML = /* HTML */ `<section class="test-result">
    <div class="result-heading">
      <strong class="${result.status >= 400 ? 'status-error' : 'status-good'}"
        >Response · ${result.status}</strong
      ><span
        >${result.duration} ms
        <button
          class="text-button"
          id="close-result"
          aria-label="Close response"
        >
          ×
        </button></span
      >
    </div>
    <pre>${escapeHtml(result.body)}</pre>
    <details>
      <summary
        style="padding:10px 12px;font-size:10px;color:#6b805c;cursor:pointer"
      >
        Response headers
      </summary>
      <pre>${escapeHtml(result.headers)}</pre>
    </details>
  </section>`;
  $('#close-result').onclick = () => {
    result = null;
    $('#result-slot').innerHTML = '';
  };
}
function setView(next) {
  view = next;
  $('#endpoint-view').hidden = view !== 'endpoints';
  $('#activity-view').hidden = view !== 'activity';
  document
    .querySelectorAll('[data-view]')
    .forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#breadcrumb').textContent =
    view === 'endpoints' ? 'Endpoints' : 'Request activity';
  $('#page-title').innerHTML =
    view === 'endpoints' ? 'Endpoints' : 'Request activity';
  $('#page-description').textContent =
    view === 'endpoints'
      ? 'Manage the mock responses your frontend needs.'
      : 'Recent requests to your local mock endpoints.';
  if (view === 'activity') renderLogs();
}
function renderLogs() {
  $('#activity-list').innerHTML = logs.length
    ? logs
        .map(
          (l) =>
            /* HTML */ `<div class="log-row">
              <span class="method ${escapeHtml(l.method)}"
                >${escapeHtml(l.method)}</span
              ><span>${escapeHtml(l.path)}</span
              ><span class="${l.status < 400 ? 'status-good' : 'status-error'}"
                >${l.status}</span
              ><span>${l.duration} ms</span
              ><time>${new Date(l.time).toLocaleTimeString()}</time>
            </div>`,
        )
        .join('')
    : /* HTML */ `<div class="empty-state">
        <h2>No requests yet</h2>
        Test an endpoint or call it from your frontend.<br />Your requests will
        appear here.
      </div>`;
}
async function refreshActivity() {
  try {
    const data = await requestJson('/__berapi/state');
    logs = data.logs;
    if (view === 'activity') renderLogs();
    $('.local-card strong').textContent = 'Server running';
  } catch {
    $('.local-card strong').textContent = 'Server disconnected';
  }
}
// Bind controls that remain mounted when the editor is re-rendered.
$('#server-origin').textContent = location.host;
$('#search').oninput = renderEndpointList;
$('#new-endpoint').onclick = addEndpoint;
$('#add-endpoint').onclick = addEndpoint;
document
  .querySelectorAll('[data-view]')
  .forEach((button) => (button.onclick = () => setView(button.dataset.view)));
$('#export-workspace').onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(endpoints, null, 2)], {
      type: 'application/json',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'berapi-workspace.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Saved workspace exported.');
};
$('#import-workspace').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000)
      throw Error('Choose a JSON file smaller than 2 MB.');
    const next = JSON.parse(await file.text());
    if (!Array.isArray(next)) throw Error('Choose a berAPI workspace export.');
    if (
      !confirm(
        'Replace your saved workspace with this file? Export first if you need a backup.',
      )
    )
      return;
    if (!(await confirmDiscardChanges())) return;
    await persistEndpoints(next);
    selectEndpoint(endpoints[0]?.id);
    showToast('Workspace imported.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    e.target.value = '';
  }
};
document.addEventListener('keydown', (e) => {
  if (
    e.key === '/' &&
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
  ) {
    e.preventDefault();
    $('#search').focus();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (draft) saveEndpoint();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
try {
  const data = await requestJson('/__berapi/state');
  endpoints = data.endpoints;
  logs = data.logs;
  selectEndpoint(endpoints[0]?.id);
} catch (e) {
  $('#editor').innerHTML = /* HTML */ `<div class="empty-state">
    <h2>Couldn’t reach your workspace.</h2>
    ${escapeHtml(e.message)}
    <p>Check that the local server is running and refresh.</p>
  </div>`;
}
setInterval(refreshActivity, 4000);
