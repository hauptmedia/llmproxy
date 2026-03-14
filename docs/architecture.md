# llmproxy Architecture

This document summarizes the main runtime boundaries in `llmproxy` so the connector, routing, and dashboard behavior are easier to understand before a release.

## Public API Surface

`llmproxy` intentionally exposes a small OpenAI-compatible surface:

- `GET /v1/models`
- `POST /v1/chat/completions`

Other `/v1/*` routes are currently out of scope and return `501 Not Implemented`.

## Backend Connectors

Backends are configured through a connector abstraction.

Current connectors:

- `openai`: forwards to an OpenAI-compatible upstream
- `ollama`: keeps the external client contract OpenAI-compatible, but translates upstream traffic to native Ollama routes such as `/api/chat` and `/api/tags`

The connector layer is responsible for:

- default health path selection
- upstream request body mapping
- streaming protocol conversion
- connector-specific model discovery

## Model Routing

Routing always starts from the client-facing `model` field.

Rules:

- If the client sends a concrete model name, `llmproxy` tries to find a healthy backend that is both allowed to serve it and actually reports that model through discovery when discovery is available.
- `allowedModels` acts as an allowlist/filter.
- If `allowedModels` is omitted, the backend behaves like `["*"]`.
- If the client sends `model: "auto"`, `model: "*"`, or omits `model` entirely, `llmproxy` currently chooses the first free backend that can resolve to a concrete model.

The selected concrete model is then applied to the upstream request body before forwarding.

## Discovery And Health

Connector-aware health checks and discovery are used:

- OpenAI-compatible backends usually use `/v1/models`
- Ollama backends usually use `/api/tags`

Discovered models are used for:

- `/v1/models` aggregation
- routing validation
- effective model metadata such as aliases and token limits when available

## Streaming Strategy

`llmproxy` always prefers upstream streaming for chat completions so it can:

- compute live metrics such as TTFB and `tok/s`
- keep the request debugger in sync
- expose live connection state in the dashboard

If the downstream client requested `stream: false`, the proxy still streams upstream internally and synthesizes the final JSON response at the end.

## Request Retention

The dashboard keeps a rolling in-memory request window controlled by `server.recentRequestLimit`.

That retained window is used for:

- the `Requests` page
- request debugger history
- dashboard summary cards that refer to recent history
- backend runtime aggregates that are intentionally scoped to the retained request window

## Config Editing

`llmproxy` writes config edits back to `llmproxy.config.json`.

Two classes of settings exist:

- immediately applied runtime settings
- persisted settings that still require an `llmproxy` restart

At the moment:

- backend edits apply immediately after saving
- some main server fields such as `host`, `port`, and `dashboardPath` are saved immediately but still require restart

## Diagnostics And MCP

`llmproxy` also exposes a diagnostics layer for retained requests.

Two entry points exist:

- `GET /api/diagnostics/requests/:id` for a ready-made heuristics report plus the stored request/response payloads
- `POST /api/diagnostics/mcp` for MCP-style JSON-RPC calls such as `initialize`, `tools/list`, `tools/call`, `prompts/list`, and `prompts/get`

The built-in diagnostics engine currently looks for signals such as:

- `finish_reason=length` or effective completion-token-limit exhaustion
- endless repetition / degenerate looping in the assistant output
- rejected requests that never reached a backend
- backend/upstream failures after routing

The diagnostics page in the dashboard uses the same retained request data and exposes ready-made prompt playbooks so an external LLM can produce a higher-level diagnosis on top of the structured heuristics output.
