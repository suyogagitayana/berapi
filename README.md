# BerAPI

A friendly local mock API workspace for frontend developers. Create endpoints, edit their responses, copy their URLs, and keep building.

## Run locally

Requires Node.js 20+. No dependency installation required.

```sh
git clone https://github.com/suyogagitayana/berapi.git
cd berapi
npm start
```

Open **http://localhost:3000**. Documentation is at **http://localhost:3000/docs/**.

For another port in PowerShell:

```powershell
$env:PORT=4000
npm start
```

On macOS/Linux: `PORT=4000 npm start`.

## What’s included

- Endpoint creation, editing, disabling, deletion, and search
- Simple mode for quick JSON responses
- Advanced mode with headers, status codes, JSON/text/HTML, and response delays
- Slow-connection and error presets, random latency, failure percentages, and per-endpoint rate limits (429 + Retry-After)
- Copy URL, real request testing, and incoming request activity
- Automatic CORS and OPTIONS for frontend development
- Persistent local workspace in `data/endpoints.json`
- Workspace JSON import/export
- Standalone documentation in `docs/`

Responses are static: request bodies and path parameters do not change stored results. POST/PUT/PATCH/DELETE do not mutate other endpoints. Parameter segments such as `/api/users/:id` match a single path segment. Query strings are ignored for route matching. The first matching endpoint in workspace order wins. Root, `/assets/`, `/docs`, and `/__berapi/` are reserved for the app. The server binds to `127.0.0.1` for local use. CORS allows origins without cookies; management routes remain same-origin. Request logs are in memory, capped at 100, and reset on restart. Up to 500 endpoints / 2 MB per workspace upload.

The UI uses system fonts and makes no external requests. All app functionality runs locally.

## GitHub Pages documentation

The workflow in [`.github/workflows/docs-pages.yml`](.github/workflows/docs-pages.yml) publishes **only `docs/`**. It does not build, start, or publish the mock API application or upload local workspace data.

One-time setup:

1. Commit and push this repository, including `docs/` and the workflow, to `main` on GitHub.
2. Open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Open **Actions → Deploy documentation to GitHub Pages → Run workflow**, select `main`, and run it.
4. Once the deployment succeeds, open **https://suyogagitayana.github.io/berapi/**.

Future pushes to `main` that change `docs/` or the workflow deploy automatically. Manual runs also work from the Actions tab on `main`. No npm install, build command, or custom secrets are needed. If your default branch has another name, update both `branches` and the job's `if` condition in the workflow.

The documentation uses relative asset links, so it works under the `/berapi/` project path. Its installation examples point to a separately running local API server. The mock API and management interface remain available only when a user runs `npm start` on their own machine.

## Verify

```sh
npm test
```

Tests exercise real HTTP requests, CORS, persistence, advanced responses, invalid changes, and route matching using a temporary workspace.
