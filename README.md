# llmproxy

A small TypeScript proxy with an OpenAI-compatible `/v1/*` interface, health checks, queueing, and a live dashboard for local `llama.cpp` instances or other OpenAI-compatible backends.

Prerequisite: Node.js 18+ should be available on your system `PATH` or configured as the project interpreter in WebStorm.

## Features

- OpenAI-compatible forwarding for arbitrary `/v1/*` routes
- Load balancing across multiple backends with configurable `maxConcurrency`
- Queueing when local backends are fully utilized
- Vue-based single page dashboard served by the backend under `/dashboard`, refactored into Vue single-file components and built with Vite plus Tailwind CSS
- Overview page with health status and live active connections, plus dedicated subpages for chat debugging and backend management
- Built-in chat debugger with model selection, live token metrics, sampler parameters, and raw request/response views
- Aggregated `/v1/models`
- Health checks for OpenAI-compatible backends via `/v1/models`

## Start

```bash
npm install
cp llmproxy.config.json.dist llmproxy.config.json
npm start
```

After that:

- Proxy API: `http://localhost:4100/v1/...`
- Overview dashboard: `http://localhost:4100/dashboard`
- Chat Debugger: `http://localhost:4100/dashboard/chat`
- Backends: `http://localhost:4100/dashboard/backends`

The backend serves the built Vue dashboard app directly on the `/dashboard` routes, so frontend and backend stay separated while deployment still stays simple.

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

Important backend fields:

- `baseUrl`: target URL of the OpenAI-compatible backend
- `maxConcurrency`: concurrent requests allowed for that backend
- `models`: optional model list or patterns such as `["llama-*"]` or `["*"]`
- `healthPath`: optional backend health endpoint, for OpenAI-compatible backends usually `/v1/models`
- `apiKey` or `apiKeyEnv`: optional upstream authentication

Dashboard changes to `enabled` and `maxConcurrency` are written back to your local `llmproxy.config.json`.

## Notes

- Requests are buffered so routing can take the requested `model` into account.
- Chat and completion requests always use upstream streaming so the proxy can collect live metrics such as `tok/s`, TTFB, and in-flight token counts.
- If the client does not request streaming, the proxy buffers the upstream stream internally and returns a normal JSON response at the end.
- `multipart/form-data` and unknown formats are routed without model-based selection to a matching free backend.
- The `Live Connections` dashboard section shows all currently active connections in real time, including queue state, streaming mode, token counts, and `tok/s`.
- The `Chat Debugger` lets you send debug requests to `/v1/chat/completions` and inspect transcript, parameters, routing, and raw responses.
