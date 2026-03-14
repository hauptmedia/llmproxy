# llmproxy

![llmproxy logo](frontend/src/assets/llmproxy-logo.svg)

A small TypeScript proxy with an OpenAI-compatible chat completions interface, health checks, queueing, and a live dashboard for local `llama.cpp`, Ollama, or other compatible backends.

Prerequisite: Node.js 18+ should be available on your system `PATH` or configured as the project interpreter in WebStorm.

## Features

- OpenAI-compatible forwarding for `POST /v1/chat/completions`
- Backend connector abstraction with built-in `openai` and `ollama` connectors
- Load balancing across multiple backends with configurable `maxConcurrency`
- Queueing when local backends are fully utilized
- Vue-based single page dashboard served by the backend under `/dashboard`, refactored into Vue single-file components and built with Vite plus Tailwind CSS
- Dashboard page with health status and live active connections, plus dedicated subpages for chat debugging, request inspection, diagnostics, and configuration management
- Built-in chat debugger with model selection, live token metrics, sampler parameters, and direct jump-to-request debugging
- Built-in diagnostics area with MCP-compatible tools/prompts for request troubleshooting
- Aggregated `/v1/models`
- Connector-aware health checks and model discovery for OpenAI-compatible backends and native Ollama backends

## Supported Routes

- `GET /v1/models`
- `POST /v1/chat/completions`

Other OpenAI-style routes such as `POST /v1/completions`, `POST /v1/responses`, `POST /v1/embeddings`, audio routes, or image routes are currently not implemented and return `501`.

## Start

```bash
npm install
npm start
```

After that:

- Proxy API: `http://localhost:4100/v1/...`
- Dashboard: `http://localhost:4100/dashboard`
- Requests: `http://localhost:4100/dashboard/logs`
- Chat: `http://localhost:4100/dashboard/chat`
- Diagnostics: `http://localhost:4100/dashboard/diagnostics`
- Config: `http://localhost:4100/dashboard/config`
- Every completed or rejected request is also emitted as one NDJSON line on `stdout`, using the same stored request-detail JSON shape that powers the dashboard diagnostics and MCP tools.

The backend serves the built Vue dashboard app directly on the `/dashboard` routes, so frontend and backend stay separated while deployment still stays simple.

## Docker

Build the image:

```bash
docker build -t llmproxy .
```

Run it with a persistent config volume:

```bash
docker run --rm -p 4100:4100 -v llmproxy-data:/data llmproxy
```

Inside the container, `LLMPROXY_CONFIG` defaults to `/data/llmproxy.config.json`. On the first container start, `llmproxy` creates that file automatically with the standard default settings if it does not exist yet.

## Development

Use the dev mode when you want to see frontend changes immediately:

```bash
npm run dev
```

That mode does three things for you:

- starts a Vite dev server with Vue HMR for the dashboard
- watches and recompiles the TypeScript backend
- restarts the backend automatically when compiled server files change

You still open the dashboard through the backend URL:

- Dashboard: `http://localhost:4100/dashboard`
- Requests: `http://localhost:4100/dashboard/logs`
- Chat: `http://localhost:4100/dashboard/chat`
- Diagnostics: `http://localhost:4100/dashboard/diagnostics`
- Config: `http://localhost:4100/dashboard/config`

In dev mode, those routes load the dashboard code from the Vite dev server automatically, so UI changes show up immediately without rebuilding manually.

## Configuration

By default, `llmproxy.config.json` is loaded from the project directory. Alternatively, set `LLMPROXY_CONFIG`.
If the config file does not exist yet, `llmproxy` creates a standard `llmproxy.config.json` automatically on first start. The generated file contains the default server settings and starts with no backends configured.

After the first start, add your backends either through the `Config` page in the dashboard or by editing `llmproxy.config.json` directly.

Important configuration fields:

- `recentRequestLimit`: maximum number of recent request log entries to retain in memory and show in the dashboard, default `1000`
- `mcpServerEnabled`: enables or disables the built-in MCP endpoint and the MCP tools exposed to the dashboard chat, default `true`
- `baseUrl`: target URL of the OpenAI-compatible backend
- `connector`: backend adapter to use, currently `openai` or `ollama`
- `maxConcurrency`: concurrent requests allowed for that backend
- `allowedModels`: optional model allowlist or patterns such as `["llama-*"]` or `["*"]`
- `healthPath`: optional backend health endpoint, for `openai` usually `/v1/models`, for `ollama` usually `/api/tags`
- `apiKey` or `apiKeyEnv`: optional upstream authentication

The `Config` page opens in a read-only view by default. Use the pencil button in the `Config` panel to edit the main `llmproxy` server config, or the backend actions on the page to edit backend entries and write changes back to your local `llmproxy.config.json`.
Backend changes become active immediately after saving. For the main server config, `requestTimeoutMs`, `queueTimeoutMs`, `healthCheckIntervalMs`, `recentRequestLimit`, and `mcpServerEnabled` apply immediately; `host` and `port` are saved right away but require an `llmproxy` restart to take effect.

The dashboard is always served under `/dashboard`.
Existing `models` entries are still accepted for backwards compatibility, but `allowedModels` is the preferred config key going forward.
If `allowedModels` is omitted entirely, llmproxy treats that backend like `["*"]`, meaning all models are allowed.

For a short architecture overview of connectors, routing, retention, and config behavior, see [`docs/architecture.md`](docs/architecture.md).

## Notes

- Requests are buffered so routing can take the requested `model` into account.
- Clients may send `model: "auto"`, `model: "*"`, or omit `model` entirely. In those cases, `llmproxy` currently picks the first free backend that has a concrete discovered/configured model and forwards the request with that resolved model name upstream.
- Chat completion requests always use upstream streaming so the proxy can collect live metrics such as `tok/s`, TTFB, and in-flight token counts.
- If the client does not request streaming, the proxy buffers the upstream stream internally and returns a normal JSON response at the end.
- `connector: "ollama"` keeps the external client contract OpenAI-compatible while translating upstream traffic to native Ollama endpoints such as `/api/chat` and `/api/tags`.
- The proxy is intentionally limited to the completion routes listed above; other `/v1/*` routes return `501`.
- The `Active Connections` dashboard section shows live `chat.completions` requests in real time, including queue state, streaming mode, token counts, and `tok/s`.
- The `Chat` page lets you send debug requests to `/v1/chat/completions`, inspect the conversation, and jump straight into the stored request debugger for the last request.
- The built-in MCP server exposes JSON-RPC tools and prompts under `POST /mcp` so LLMs can inspect retained requests, fetch stored request details, and run built-in diagnosis heuristics.
- The MCP endpoint also exposes tools for listing models and running chat completions through the same JSON-RPC `tools/call` flow.
- If `mcpServerEnabled` is turned off, the MCP endpoint returns `503`, the dashboard chat stops attaching MCP tools, and MCP prompt previews are disabled until the server is enabled again.
- Built-in diagnostics currently include signals such as `finish_reason=length`, effective completion-token-limit hits, endless repetition patterns, rejected requests before backend assignment, and upstream/backend failures.
- `GET /api/diagnostics/requests/:id` returns a precomputed diagnostics report plus the stored request detail for one retained request.
