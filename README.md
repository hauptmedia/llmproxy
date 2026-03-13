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
- Overview page with health status and live active connections, plus dedicated subpages for chat debugging and backend management
- Built-in chat debugger with model selection, live token metrics, sampler parameters, and raw request/response views
- Aggregated `/v1/models`
- Connector-aware health checks and model discovery for OpenAI-compatible backends and native Ollama backends

## Supported Routes

- `GET /v1/models`
- `POST /v1/chat/completions`

Other OpenAI-style routes such as `POST /v1/completions`, `POST /v1/responses`, `POST /v1/embeddings`, audio routes, or image routes are currently not implemented and return `501`.

## Start

```bash
npm install
cp llmproxy.config.json.dist llmproxy.config.json
npm start
```

After that:

- Proxy API: `http://localhost:4100/v1/...`
- Overview dashboard: `http://localhost:4100/dashboard`
- Chat: `http://localhost:4100/dashboard/chat`
- Backends: `http://localhost:4100/dashboard/backends`

The backend serves the built Vue dashboard app directly on the `/dashboard` routes, so frontend and backend stay separated while deployment still stays simple.

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

- Overview dashboard: `http://localhost:4100/dashboard`
- Chat: `http://localhost:4100/dashboard/chat`
- Backends: `http://localhost:4100/dashboard/backends`

In dev mode, those routes load the dashboard code from the Vite dev server automatically, so UI changes show up immediately without rebuilding manually.

## Configuration

Your real local config lives in `llmproxy.config.json`, which is ignored by Git. The repository ships `llmproxy.config.json.dist` as the tracked example.

Create your local config once before the first start:

```bash
cp llmproxy.config.json.dist llmproxy.config.json
```

Or in PowerShell:

```powershell
Copy-Item llmproxy.config.json.dist llmproxy.config.json
```

By default, `llmproxy.config.json` is loaded from the project directory. Alternatively, set `LLMPROXY_CONFIG`.

The example configuration includes:

- one local `llama.cpp` backend at `http://127.0.0.1:8080`
- `maxConcurrency: 1`, which is a sensible default for most local single-model setups

Important configuration fields:

- `recentRequestLimit`: maximum number of recent request log entries to retain in memory and show in the dashboard, default `1000`
- `baseUrl`: target URL of the OpenAI-compatible backend
- `connector`: backend adapter to use, currently `openai` or `ollama`
- `maxConcurrency`: concurrent requests allowed for that backend
- `models`: optional model list or patterns such as `["llama-*"]` or `["*"]`
- `healthPath`: optional backend health endpoint, for `openai` usually `/v1/models`, for `ollama` usually `/api/tags`
- `apiKey` or `apiKeyEnv`: optional upstream authentication

Dashboard changes to `enabled` and `maxConcurrency` are written back to your local `llmproxy.config.json`.

## Notes

- Requests are buffered so routing can take the requested `model` into account.
- Clients may send `model: "auto"`, `model: "*"`, or omit `model` entirely. In those cases, `llmproxy` currently picks the first free backend that has a concrete discovered/configured model and forwards the request with that resolved model name upstream.
- Chat completion requests always use upstream streaming so the proxy can collect live metrics such as `tok/s`, TTFB, and in-flight token counts.
- If the client does not request streaming, the proxy buffers the upstream stream internally and returns a normal JSON response at the end.
- `connector: "ollama"` keeps the external client contract OpenAI-compatible while translating upstream traffic to native Ollama endpoints such as `/api/chat` and `/api/tags`.
- The proxy is intentionally limited to the completion routes listed above; other `/v1/*` routes return `501`.
- The `Active Connections` dashboard section shows live `chat.completions` requests in real time, including queue state, streaming mode, token counts, and `tok/s`.
- The `Chat` page lets you send debug requests to `/v1/chat/completions`, inspect the conversation, and jump straight into the stored request debugger for the last request.
