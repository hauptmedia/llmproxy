import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ConfigStore, BackendPatch } from "./config-store";
import {
  buildBackendRequestPlan,
  convertOllamaChunkToOpenAiChunk,
  isOllamaNdjson,
  splitJsonLines,
} from "./backend-connectors";
import { renderDashboardHtml } from "./dashboard";
import { buildDiagnosticReport } from "./diagnostics";
import { LoadBalancer } from "./load-balancer";
import {
  RESTART_REQUIRED_SERVER_FIELDS,
  buildRuntimeAppliedConfig,
  findChangedServerFields,
  parseBackendSavePayload,
  parseServerConfigSavePayload,
} from "./server-config-payloads";
import {
  FIXED_DASHBOARD_PATH,
  assetContentType,
  matchDashboardRoute,
  normalizeDashboardPath,
  normalizeDashboardSubPath,
  resolveDashboardLandingPage,
  resolveDashboardAssetPath,
} from "./server-dashboard-paths";
import {
  applySelectedModel,
  canSendBody,
  copyResponseHeaders,
  extractApiRequestId,
  isEventStream,
  proxyError,
  readRequestedProxyRequestId,
  resolveEffectiveCompletionTokenLimit,
  resolveModelCompletionLimit,
  resolveRequestedCompletionLimit,
  selectProxyStatus,
} from "./server-request-utils";
import {
  buildMcpManifest,
  handleMcpRequest,
  isMcpEndpointPath,
  isMcpManifestPath,
  MCP_DISABLED_MESSAGE,
} from "./server-mcp";
import {
  ActiveConnectionKind,
  ActiveConnectionPhase,
  ActiveConnectionSnapshot,
  BackendSavePayload,
  BackendLease,
  JsonValue,
  KnownModel,
  LeaseReleaseResult,
  ProxyRouteRequest,
  ProxySnapshot,
  RequestLogDetail,
  ServerConfig,
} from "./types";
import {
  StreamingAccumulator,
  StreamingAccumulatorUpdate,
  buildStreamingRequestBody,
  detectStreamingKind,
  extractSseDataPayload,
  splitSseBlocks,
} from "./streaming";
import { shouldForwardUpstreamHeader } from "./proxy-headers";
import { extractClientIp, isPositiveInteger, joinUrl, readRequestBody, sendJson, toErrorMessage, tryParseJsonBuffer } from "./utils";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

interface ActiveConnectionRuntime {
  id: string;
  kind: ActiveConnectionKind;
  method: string;
  path: string;
  clientIp?: string;
  model?: string;
  clientStream: boolean;
  upstreamStream: boolean;
  phase: ActiveConnectionPhase;
  receivedAt: number;
  lastUpdatedAt: number;
  queueMs: number;
  backendId?: string;
  backendName?: string;
  statusCode?: number;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contentTokens: number;
  reasoningTokens: number;
  textTokens: number;
  promptMs?: number;
  generationMs?: number;
  promptTokensPerSecond?: number;
  completionTokensPerSecond?: number;
  requestedCompletionTokenLimit?: number;
  firstTokenAt?: number;
  finishReason?: string;
  metricsExact: boolean;
  requestBody?: JsonValue;
  responseBody?: JsonValue;
  cancelSource?: "client_disconnect" | "dashboard" | "timeout";
  cancel?: (message?: string) => void;
}

export function isSupportedProxyRoute(method: string, pathname: string): boolean {
  if (method !== "POST") {
    return false;
  }

  return pathname === "/v1/chat/completions";
}

export class LlmProxyServer {
  private server?: Server;
  private readonly sseClients = new Set<ServerResponse>();
  private readonly activeConnections = new Map<string, ActiveConnectionRuntime>();
  private heartbeat?: NodeJS.Timeout;
  private liveSnapshotTicker?: NodeJS.Timeout;
  private snapshotTimer?: NodeJS.Timeout;

  public constructor(
    private readonly configStore: ConfigStore,
    private readonly loadBalancer: LoadBalancer,
  ) {}

  public async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    this.server.on("clientError", (_error, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    });

    this.loadBalancer.on("snapshot", this.handleLoadBalancerSnapshot);
    this.heartbeat = setInterval(() => {
      for (const client of this.sseClients) {
        client.write(": ping\n\n");
      }
    }, 15_000);
    this.liveSnapshotTicker = setInterval(() => {
      if (this.activeConnections.size === 0 || this.sseClients.size === 0) {
        return;
      }

      this.broadcastCurrentSnapshot();
    }, 1_000);

    const { host, port } = this.loadBalancer.getServerConfig();

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(port, host, () => {
        this.server?.off("error", reject);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    this.loadBalancer.off("snapshot", this.handleLoadBalancerSnapshot);

    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }

    if (this.liveSnapshotTicker) {
      clearInterval(this.liveSnapshotTicker);
      this.liveSnapshotTicker = undefined;
    }

    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }

    for (const client of this.sseClients) {
      client.end();
    }

    this.sseClients.clear();

    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!request.url) {
      sendJson(response, 400, proxyError("Missing request URL."));
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    const dashboardPath = normalizeDashboardPath(FIXED_DASHBOARD_PATH);
    const method = request.method?.toUpperCase() ?? "GET";

    if (method === "GET" && url.pathname === "/") {
      response.statusCode = 302;
      response.setHeader("location", dashboardPath);
      response.end();
      return;
    }

    if (method === "GET" && normalizeDashboardSubPath(url.pathname) === `${dashboardPath}/backends`) {
      response.statusCode = 302;
      response.setHeader("location", `${dashboardPath}/config`);
      response.end();
      return;
    }

    const dashboardAssetPath = method === "GET" ? resolveDashboardAssetPath(url.pathname, dashboardPath) : undefined;
    if (dashboardAssetPath) {
      await this.handleDashboardAsset(response, dashboardAssetPath);
      return;
    }

    const dashboardSnapshot = method === "GET" ? this.getSnapshot() : undefined;
    const dashboardRoute = method === "GET"
      ? matchDashboardRoute(
        url.pathname,
        dashboardPath,
        resolveDashboardLandingPage(dashboardSnapshot ?? this.getSnapshot()),
      )
      : undefined;

    if (dashboardRoute) {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.end(
        renderDashboardHtml(dashboardSnapshot ?? this.getSnapshot(), {
          dashboardPath,
          page: dashboardRoute.page,
        }),
      );
      return;
    }

    if (method === "GET" && url.pathname === "/api/state") {
      sendJson(response, 200, this.getSnapshot());
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/diagnostics/requests/")) {
      this.handleDiagnosticsReport(response, url.pathname);
      return;
    }

    if (method === "GET" && isMcpManifestPath(url.pathname)) {
      if (!this.loadBalancer.getServerConfig().mcpServerEnabled) {
        sendJson(response, 503, proxyError(MCP_DISABLED_MESSAGE));
        return;
      }

      sendJson(response, 200, buildMcpManifest({
        snapshot: this.getSnapshot(),
        getRequestDetail: (requestId) => this.getRequestDetail(requestId),
        listModelsPayload: () => this.buildModelsPayload(this.loadBalancer.listKnownModels()),
        runChatCompletion: (payload) => this.runMcpChatCompletion(payload),
      }));
      return;
    }

    if (method === "POST" && isMcpEndpointPath(url.pathname)) {
      if (!this.loadBalancer.getServerConfig().mcpServerEnabled) {
        sendJson(response, 503, proxyError(MCP_DISABLED_MESSAGE));
        return;
      }

      await this.handleMcp(request, response);
      return;
    }

    if (method === "GET" && url.pathname === "/api/backends") {
      await this.handleBackendList(response);
      return;
    }

    if (method === "PUT" && url.pathname === "/api/config/server") {
      await this.handleServerConfigUpdate(request, response);
      return;
    }

    if (method === "POST" && url.pathname.startsWith("/api/requests/") && url.pathname.endsWith("/cancel")) {
      this.handleRequestCancel(response, url.pathname);
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/requests/")) {
      this.handleRequestDetail(response, url.pathname);
      return;
    }

    if (method === "GET" && url.pathname === "/api/events") {
      this.handleSse(request, response);
      return;
    }

    if (method === "GET" && url.pathname === "/healthz") {
      const snapshot = this.loadBalancer.getSnapshot();
      const healthyCount = snapshot.backends.filter((backend) => backend.healthy && backend.enabled).length;
      sendJson(response, 200, {
        status: healthyCount > 0 ? "ok" : "degraded",
        queueDepth: snapshot.queueDepth,
        backends: snapshot.backends.length,
        healthyBackends: healthyCount,
      });
      return;
    }

    if (method === "GET" && url.pathname === "/v1/models") {
      this.handleModels(response, this.loadBalancer.listKnownModels());
      return;
    }

    if (method === "PATCH" && url.pathname.startsWith("/api/backends/")) {
      await this.handleBackendPatch(request, response, url.pathname);
      return;
    }

    if (method === "POST" && url.pathname === "/api/backends") {
      await this.handleBackendCreate(request, response);
      return;
    }

    if (method === "PUT" && url.pathname.startsWith("/api/backends/")) {
      await this.handleBackendReplace(request, response, url.pathname);
      return;
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/backends/")) {
      await this.handleBackendDelete(response, url.pathname);
      return;
    }

    if (url.pathname.startsWith("/v1/")) {
      if (!isSupportedProxyRoute(method, url.pathname)) {
        sendJson(
          response,
          501,
          proxyError(`Route "${method} ${url.pathname}" is not implemented. Supported routes: GET /v1/models, POST /v1/chat/completions.`),
        );
        return;
      }

      await this.handleProxy(request, response, url);
      return;
    }

    sendJson(response, 404, proxyError(`Route "${method} ${url.pathname}" was not found.`));
  }

  private handleSse(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    response.write(`event: snapshot\ndata: ${JSON.stringify(this.getSnapshot())}\n\n`);
    this.sseClients.add(response);

    request.on("close", () => {
      this.sseClients.delete(response);
    });
  }

  private handleRequestDetail(response: ServerResponse, pathname: string): void {
    const requestId = extractApiRequestId(pathname);
    if (!requestId) {
      sendJson(response, 404, proxyError("Request details were not found."));
      return;
    }

    const detail = this.getRequestDetail(requestId);

    if (!detail) {
      sendJson(response, 404, proxyError(`Recent request "${requestId}" was not found.`));
      return;
    }

    sendJson(response, 200, detail);
  }

  private handleRequestCancel(response: ServerResponse, pathname: string): void {
    const requestId = extractApiRequestId(pathname, "/cancel");
    if (!requestId) {
      sendJson(response, 404, proxyError("Live request was not found."));
      return;
    }

    const connection = this.activeConnections.get(requestId);
    if (!connection?.cancel) {
      sendJson(response, 404, proxyError(`Live request "${requestId}" is no longer active.`));
      return;
    }

    connection.cancel("Request cancelled from dashboard.");
    sendJson(response, 202, { ok: true, requestId });
  }

  private handleDiagnosticsReport(response: ServerResponse, pathname: string): void {
    const prefix = "/api/diagnostics/requests/";
    if (!pathname.startsWith(prefix)) {
      sendJson(response, 404, proxyError("Diagnostics request was not found."));
      return;
    }

    const requestId = decodeURIComponent(pathname.slice(prefix.length));
    if (!requestId) {
      sendJson(response, 404, proxyError("Diagnostics request was not found."));
      return;
    }

    const detail = this.getRequestDetail(requestId);
    if (!detail) {
      sendJson(response, 404, proxyError(`Recent request "${requestId}" was not found.`));
      return;
    }

    sendJson(response, 200, {
      detail,
      report: buildDiagnosticReport(detail, this.getSnapshot()),
    });
  }

  private async handleMcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readRequestBody(request);
    const parsed = tryParseJsonBuffer(body, request.headers["content-type"]);

    if (!parsed) {
      sendJson(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Expected a JSON-RPC 2.0 JSON body.",
        },
      });
      return;
    }

    sendJson(
      response,
      200,
      await handleMcpRequest(parsed, {
        snapshot: this.getSnapshot(),
        getRequestDetail: (requestId) => this.getRequestDetail(requestId),
        listModelsPayload: () => this.buildModelsPayload(this.loadBalancer.listKnownModels()),
        runChatCompletion: (payload) => this.runMcpChatCompletion(payload),
      }),
    );
  }

  private async handleDashboardAsset(response: ServerResponse, assetPath: string): Promise<void> {
    try {
      const payload = await readFile(assetPath);
      response.statusCode = 200;
      response.setHeader("content-type", assetContentType(assetPath));
      response.setHeader("cache-control", "no-store");
      response.end(payload);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "ENOENT") {
        sendJson(response, 404, proxyError(`Dashboard asset "${assetPath}" was not found.`));
        return;
      }

      sendJson(response, 500, proxyError(`Failed to load dashboard asset "${assetPath}".`));
    }
  }

  private handleModels(response: ServerResponse, models: KnownModel[]): void {
    sendJson(response, 200, this.buildModelsPayload(models));
  }

  private buildModelsPayload(models: KnownModel[]): Record<string, unknown> {
    return {
      object: "list",
      data: models.map((model) => ({
        id: model.id,
        object: "model",
        created: 0,
        owned_by: "",
      })),
    };
  }

  private async handleBackendList(response: ServerResponse): Promise<void> {
    try {
      const config = await this.configStore.loadEditableConfig();
      sendJson(response, 200, {
        server: config.server,
        data: config.backends,
      });
    } catch (error) {
      sendJson(response, 500, proxyError(toErrorMessage(error)));
    }
  }

  private async handleServerConfigUpdate(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readRequestBody(request);
    const parsed = tryParseJsonBuffer(body, request.headers["content-type"]);

    if (!parsed) {
      sendJson(response, 400, proxyError("Expected a JSON body."));
      return;
    }

    let payload: ServerConfig;
    try {
      payload = parseServerConfigSavePayload(parsed);
    } catch (error) {
      sendJson(response, 400, proxyError(toErrorMessage(error)));
      return;
    }

    try {
      const currentRuntimeServer = this.loadBalancer.getServerConfig();
      const nextConfig = await this.configStore.updateServerConfig(payload);
      const changedFields = findChangedServerFields(currentRuntimeServer, nextConfig.server);
      const restartRequiredFields = changedFields.filter((field) => RESTART_REQUIRED_SERVER_FIELDS.includes(field));
      const appliedImmediatelyFields = changedFields.filter((field) => !RESTART_REQUIRED_SERVER_FIELDS.includes(field));
      const runtimeConfig = buildRuntimeAppliedConfig(nextConfig, currentRuntimeServer);

      this.loadBalancer.replaceConfig(runtimeConfig);
      sendJson(response, 200, {
        ok: true,
        server: nextConfig.server,
        restartRequiredFields,
        appliedImmediatelyFields,
      });
    } catch (error) {
      sendJson(response, 400, proxyError(toErrorMessage(error)));
    }
  }

  private async handleBackendPatch(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const backendId = decodeURIComponent(pathname.replace("/api/backends/", ""));
    const body = await readRequestBody(request);
    const parsed = tryParseJsonBuffer(body, request.headers["content-type"]);

    if (!parsed) {
      sendJson(response, 400, proxyError("Expected a JSON body."));
      return;
    }

    const patch: BackendPatch = {};

    if ("enabled" in parsed) {
      if (typeof parsed.enabled !== "boolean") {
        sendJson(response, 400, proxyError('"enabled" must be a boolean.'));
        return;
      }

      patch.enabled = parsed.enabled;
    }

    if ("maxConcurrency" in parsed) {
      if (!isPositiveInteger(parsed.maxConcurrency)) {
        sendJson(response, 400, proxyError('"maxConcurrency" must be a positive integer.'));
        return;
      }

      patch.maxConcurrency = parsed.maxConcurrency;
    }

    try {
      const nextConfig = await this.configStore.updateBackend(backendId, patch);
      this.loadBalancer.replaceConfig(nextConfig);
      sendJson(response, 200, { ok: true, backendId, patch });
    } catch (error) {
      sendJson(response, 404, proxyError(toErrorMessage(error)));
    }
  }

  private async handleBackendCreate(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readRequestBody(request);
    const parsed = tryParseJsonBuffer(body, request.headers["content-type"]);

    if (!parsed) {
      sendJson(response, 400, proxyError("Expected a JSON body."));
      return;
    }

    let payload: BackendSavePayload;
    try {
      payload = parseBackendSavePayload(parsed);
    } catch (error) {
      sendJson(response, 400, proxyError(toErrorMessage(error)));
      return;
    }

    try {
      const result = await this.configStore.createBackend(payload);
      this.loadBalancer.replaceConfig(result.config);
      sendJson(response, 201, { ok: true, backend: result.backend });
    } catch (error) {
      sendJson(response, 400, proxyError(toErrorMessage(error)));
    }
  }

  private async handleBackendReplace(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const currentId = decodeURIComponent(pathname.replace("/api/backends/", ""));
    const body = await readRequestBody(request);
    const parsed = tryParseJsonBuffer(body, request.headers["content-type"]);

    if (!parsed) {
      sendJson(response, 400, proxyError("Expected a JSON body."));
      return;
    }

    let payload: BackendSavePayload;
    try {
      payload = parseBackendSavePayload(parsed);
    } catch (error) {
      sendJson(response, 400, proxyError(toErrorMessage(error)));
      return;
    }

    try {
      const result = await this.configStore.replaceBackend(currentId, payload);
      this.loadBalancer.replaceConfig(result.config);
      sendJson(response, 200, { ok: true, backend: result.backend });
    } catch (error) {
      sendJson(response, 400, proxyError(toErrorMessage(error)));
    }
  }

  private async handleBackendDelete(response: ServerResponse, pathname: string): Promise<void> {
    const backendId = decodeURIComponent(pathname.replace("/api/backends/", ""));

    try {
      const nextConfig = await this.configStore.deleteBackend(backendId);
      this.loadBalancer.replaceConfig(nextConfig);
      sendJson(response, 200, { ok: true, backendId });
    } catch (error) {
      sendJson(response, 404, proxyError(toErrorMessage(error)));
    }
  }

  private async runMcpChatCompletion(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { port } = this.loadBalancer.getServerConfig();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const raw = await response.text();
      let parsedMessage = "";

      try {
        const parsed = JSON.parse(raw) as {
          error?: {
            message?: unknown;
          };
        };
        if (typeof parsed.error?.message === "string" && parsed.error.message.trim().length > 0) {
          parsedMessage = parsed.error.message.trim();
        }
      } catch {
        parsedMessage = "";
      }

      throw new Error(parsedMessage || raw || `Chat completion failed with HTTP ${response.status}.`);
    }

    if (isEventStream(response.headers) && response.body) {
      const accumulator = new StreamingAccumulator("chat.completions");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }

        buffer += decoder.decode(next.value, { stream: true });
        const split = splitSseBlocks(buffer, false);
        buffer = split.remainder;

        for (const block of split.blocks) {
          const payloadText = extractSseDataPayload(block);
          if (!payloadText || payloadText === "[DONE]") {
            continue;
          }

          accumulator.applyPayload(JSON.parse(payloadText) as Record<string, unknown>);
        }
      }

      buffer += decoder.decode();
      const trailing = splitSseBlocks(buffer, true);
      for (const block of trailing.blocks) {
        const payloadText = extractSseDataPayload(block);
        if (!payloadText || payloadText === "[DONE]") {
          continue;
        }

        accumulator.applyPayload(JSON.parse(payloadText) as Record<string, unknown>);
      }

      if (!accumulator.hasPayload) {
        throw new Error("Chat completion stream produced no JSON payload.");
      }

      return accumulator.buildResponse();
    }

    const parsed = await response.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Chat completion returned a non-object JSON payload.");
    }

    return parsed as Record<string, unknown>;
  }

  private async handleProxy(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const method = request.method?.toUpperCase() ?? "GET";
    const receivedAt = Date.now();
    const body = await readRequestBody(request);
    const parsedBody = tryParseJsonBuffer(body, request.headers["content-type"]);
    const requestedRouteId = readRequestedProxyRequestId(request.headers["x-llmproxy-request-id"]);
    const routeId = requestedRouteId && !this.activeConnections.has(requestedRouteId) && !this.loadBalancer.getRequestLogDetail(requestedRouteId)
      ? requestedRouteId
      : randomUUID();
    const route: ProxyRouteRequest = {
      id: routeId,
      receivedAt,
      method,
      path: `${url.pathname}${url.search}`,
      model: typeof parsedBody?.model === "string" ? parsedBody.model : undefined,
      stream: parsedBody?.stream === true,
      contentType: request.headers["content-type"],
      clientIp: extractClientIp(request),
      requestBody: parsedBody as JsonValue | undefined,
    };
    const streamingKind = detectStreamingKind(method, url.pathname, parsedBody);
    const upstreamStream = streamingKind ? true : route.stream;
    const abortController = new AbortController();
    let clientDisconnected = false;
    const abortRequest = (
      message: string,
      cancelSource?: ActiveConnectionRuntime["cancelSource"],
    ) => {
      if (!abortController.signal.aborted) {
        this.updateActiveConnection(route.id, {
          cancelSource,
          error: message,
        }, true);
        abortController.abort(new Error(message));
      }
    };
    const cancelActiveRequest = (message = "Request cancelled from dashboard.") => {
      abortRequest(message, "dashboard");
    };

    this.trackActiveConnection(route, streamingKind ?? "other", upstreamStream);
    response.setHeader("x-llmproxy-request-id", route.id);
    const activeConnection = this.activeConnections.get(route.id);
    if (activeConnection) {
      activeConnection.cancel = cancelActiveRequest;
    }

    const onAborted = () => {
      clientDisconnected = true;
      abortRequest("Client disconnected.", "client_disconnect");
    };
    const onResponseClose = () => {
      if (!response.writableEnded) {
        clientDisconnected = true;
        abortRequest("Client disconnected.", "client_disconnect");
      }
    };

    request.on("aborted", onAborted);
    response.on("close", onResponseClose);

    let lease: BackendLease | undefined;
    let timeout: NodeJS.Timeout | undefined;

    try {
      lease = await this.loadBalancer.acquire(route, abortController.signal);
      const routedModel = lease.selectedModel ?? route.model;
      this.updateActiveConnection(route.id, {
        phase: "connected",
        backendId: lease.backend.id,
        backendName: lease.backend.name,
        model: routedModel,
        queueMs: lease.queueMs,
      }, true);
      const upstreamParsedBody = applySelectedModel(parsedBody, lease.selectedModel);
      const requestPlan = buildBackendRequestPlan(
        lease.backend,
        method,
        url.pathname,
        url.search,
        body,
        upstreamParsedBody,
        Boolean(streamingKind),
      );
      const timeoutMs = lease.backend.timeoutMs ?? this.loadBalancer.getServerConfig().requestTimeoutMs;
      timeout = setTimeout(() => {
        abortRequest(`Upstream timeout after ${timeoutMs}ms.`, "timeout");
      }, timeoutMs);

      const upstreamResponse = await fetch(joinUrl(lease.backend.baseUrl, requestPlan.pathAndSearch), {
        method,
        headers: this.buildUpstreamHeaders(request.headers, lease, route.clientIp),
        body: requestPlan.body ? new Uint8Array(requestPlan.body) : undefined,
        signal: abortController.signal,
      });

      this.updateActiveConnection(route.id, { statusCode: upstreamResponse.status }, true);

      if (requestPlan.responseMode === "ollama-ndjson" && !upstreamResponse.ok) {
        const errorMessage = await this.readOllamaErrorMessage(upstreamResponse);
        this.updateActiveConnection(route.id, { error: errorMessage }, true);
        sendJson(response, upstreamResponse.status, proxyError(errorMessage, "upstream_error"));
        lease.release({
          outcome: "error",
          latencyMs: Date.now() - route.receivedAt,
          statusCode: upstreamResponse.status,
          queuedMs: lease.queueMs,
          error: errorMessage,
          ...this.buildReleaseMetrics(route.id),
        });
        return;
      }

      if (
        requestPlan.responseMode === "ollama-ndjson" &&
        streamingKind &&
        upstreamResponse.ok &&
        isOllamaNdjson(upstreamResponse.headers) &&
        upstreamResponse.body
      ) {
        const synthesizedResponse = await this.handleOllamaStreamingProxy({
          requestId: route.id,
          clientStream: route.stream,
          backendId: lease.backend.id,
          model: routedModel,
          upstreamResponse,
          response,
        });

        lease.release({
          outcome: "success",
          latencyMs: Date.now() - route.receivedAt,
          statusCode: upstreamResponse.status,
          queuedMs: lease.queueMs,
          responseBody: synthesizedResponse as JsonValue | undefined,
          ...this.buildReleaseMetrics(route.id),
        });
        return;
      }

      if (
        requestPlan.responseMode === "openai-sse" &&
        streamingKind &&
        upstreamResponse.ok &&
        isEventStream(upstreamResponse.headers) &&
        upstreamResponse.body
      ) {
        const synthesizedResponse = await this.handleStreamingProxy({
          requestId: route.id,
          kind: streamingKind,
          clientStream: route.stream,
          backendId: lease.backend.id,
          model: routedModel,
          upstreamResponse,
          response,
        });

        lease.release({
          outcome: upstreamResponse.status >= 500 ? "error" : "success",
          latencyMs: Date.now() - route.receivedAt,
          statusCode: upstreamResponse.status,
          queuedMs: lease.queueMs,
          responseBody: synthesizedResponse as JsonValue | undefined,
          ...this.buildReleaseMetrics(route.id),
        });
        return;
      }

      response.statusCode = upstreamResponse.status;
      copyResponseHeaders(upstreamResponse.headers, response);
      response.setHeader("x-llmproxy-request-id", route.id);
      response.setHeader("x-llmproxy-backend", lease.backend.id);
      if (routedModel) {
        response.setHeader("x-llmproxy-model", routedModel);
      }

      if (!upstreamResponse.body) {
        response.end();
        lease.release({
          outcome: upstreamResponse.status >= 500 ? "error" : "success",
          latencyMs: Date.now() - route.receivedAt,
          statusCode: upstreamResponse.status,
          queuedMs: lease.queueMs,
          ...this.buildReleaseMetrics(route.id),
        });
        return;
      }

      await pipeline(Readable.fromWeb(upstreamResponse.body as never), response);
      lease.release({
        outcome: upstreamResponse.status >= 500 ? "error" : "success",
        latencyMs: Date.now() - route.receivedAt,
        statusCode: upstreamResponse.status,
        queuedMs: lease.queueMs,
        ...this.buildReleaseMetrics(route.id),
      });
    } catch (error) {
      const message = toErrorMessage(error);
      const connection = this.activeConnections.get(route.id);
      const wasCancelled = connection?.cancelSource === "dashboard" || connection?.cancelSource === "client_disconnect";
      const statusCode = selectProxyStatus(message, abortController.signal.aborted, clientDisconnected, wasCancelled);

      if (lease) {
        this.updateActiveConnection(route.id, { error: message }, true);
        lease.release({
          outcome: wasCancelled ? "cancelled" : "error",
          latencyMs: Date.now() - route.receivedAt,
          queuedMs: lease.queueMs,
          error: message,
          ...this.buildReleaseMetrics(route.id),
        });
      }

      if (!response.headersSent) {
        sendJson(response, statusCode, proxyError(message));
      } else if (!response.writableEnded) {
        response.destroy(error instanceof Error ? error : undefined);
      }
    } finally {
      request.off("aborted", onAborted);
      response.off("close", onResponseClose);

      if (timeout) {
        clearTimeout(timeout);
      }

      this.removeActiveConnection(route.id);
    }
  }

  private getSnapshot(): ProxySnapshot {
    const loadBalancerSnapshot = this.loadBalancer.getSnapshot();

    return {
      ...loadBalancerSnapshot,
      activeConnections: Array.from(this.activeConnections.values())
        .sort((left, right) => left.receivedAt - right.receivedAt)
        .map((connection) => this.toActiveConnectionSnapshot(connection, loadBalancerSnapshot.backends)),
    };
  }

  private trackActiveConnection(
    route: ProxyRouteRequest,
    kind: ActiveConnectionKind,
    upstreamStream: boolean,
  ): void {
    this.activeConnections.set(route.id, {
      id: route.id,
      kind,
      method: route.method,
      path: route.path,
      clientIp: route.clientIp,
      model: route.model,
      clientStream: route.stream,
      upstreamStream,
      phase: "queued",
      receivedAt: route.receivedAt,
      lastUpdatedAt: route.receivedAt,
      queueMs: 0,
      contentTokens: 0,
      reasoningTokens: 0,
      textTokens: 0,
      metricsExact: false,
      requestedCompletionTokenLimit: resolveRequestedCompletionLimit(route.requestBody),
      requestBody: route.requestBody,
    });
    this.broadcastCurrentSnapshot();
  }

  private updateActiveConnection(
    requestId: string,
    patch: Partial<Omit<ActiveConnectionRuntime, "id" | "receivedAt">>,
    immediate = false,
  ): void {
    const connection = this.activeConnections.get(requestId);
    if (!connection) {
      return;
    }

    Object.assign(connection, patch);
    connection.lastUpdatedAt = Date.now();

    if (immediate) {
      this.broadcastCurrentSnapshot();
      return;
    }

    this.scheduleSnapshotBroadcast();
  }

  private applyStreamingUpdate(
    requestId: string,
    update: StreamingAccumulatorUpdate,
    responseBody?: Record<string, unknown>,
  ): void {
    const connection = this.activeConnections.get(requestId);
    if (!connection) {
      return;
    }

    const now = Date.now();
    if (update.addedCompletionTokens > 0 && !connection.firstTokenAt) {
      connection.firstTokenAt = now;
    }

    if (update.addedCompletionTokens > 0 || connection.phase === "connected") {
      connection.phase = "streaming";
    }

    connection.promptTokens = update.metrics.promptTokens;
    connection.completionTokens = update.metrics.completionTokens;
    connection.totalTokens = update.metrics.totalTokens;
    connection.contentTokens = update.metrics.contentTokens;
    connection.reasoningTokens = update.metrics.reasoningTokens;
    connection.textTokens = update.metrics.textTokens;
    connection.promptMs = update.metrics.promptMs;
    connection.generationMs = update.metrics.generationMs;
    connection.promptTokensPerSecond = update.metrics.promptTokensPerSecond;
    connection.completionTokensPerSecond = update.metrics.completionTokensPerSecond;
    connection.finishReason = update.finishReason ?? update.metrics.finishReason;
    connection.metricsExact = update.metrics.exact;
    if (responseBody !== undefined) {
      connection.responseBody = responseBody as JsonValue;
    }
    connection.lastUpdatedAt = now;
    this.scheduleSnapshotBroadcast();
  }

  private removeActiveConnection(requestId: string): void {
    if (!this.activeConnections.delete(requestId)) {
      return;
    }

    this.broadcastCurrentSnapshot();
  }

  private buildReleaseMetrics(requestId: string): Partial<LeaseReleaseResult> {
    const connection = this.activeConnections.get(requestId);

    if (!connection) {
      return {};
    }

    const completionTokens = connection.completionTokens;
    const completionTokensPerSecond =
      connection.completionTokensPerSecond ??
      (connection.firstTokenAt && completionTokens && completionTokens > 0
        ? completionTokens / Math.max(0.001, (Date.now() - connection.firstTokenAt) / 1000)
        : undefined);
    const effectiveCompletionTokenLimit = resolveEffectiveCompletionTokenLimit(
      connection.requestedCompletionTokenLimit,
      resolveModelCompletionLimit(connection.model, connection.backendId, this.loadBalancer.getSnapshot().backends),
    );

    return {
      promptTokens: connection.promptTokens,
      completionTokens,
      totalTokens: connection.totalTokens,
      contentTokens: connection.contentTokens,
      reasoningTokens: connection.reasoningTokens,
      textTokens: connection.textTokens,
      promptMs: connection.promptMs,
      generationMs: connection.generationMs ?? (connection.firstTokenAt ? Date.now() - connection.firstTokenAt : undefined),
      promptTokensPerSecond: connection.promptTokensPerSecond,
      completionTokensPerSecond,
      effectiveCompletionTokenLimit: effectiveCompletionTokenLimit ?? undefined,
      timeToFirstTokenMs: connection.firstTokenAt ? connection.firstTokenAt - connection.receivedAt : undefined,
      finishReason: connection.finishReason,
      metricsExact: connection.metricsExact,
      responseBody: connection.responseBody,
    };
  }

  private toActiveConnectionSnapshot(
    connection: ActiveConnectionRuntime,
    backends: ProxySnapshot["backends"],
  ): ActiveConnectionSnapshot {
    const elapsedMs = Math.max(0, Date.now() - connection.receivedAt);
    const completionTokens = connection.completionTokens;
    const liveCompletionRate =
      connection.completionTokensPerSecond ??
      (connection.firstTokenAt && completionTokens && completionTokens > 0
        ? completionTokens / Math.max(0.001, (Date.now() - connection.firstTokenAt) / 1000)
        : undefined);
    const effectiveCompletionTokenLimit = resolveEffectiveCompletionTokenLimit(
      connection.requestedCompletionTokenLimit,
      resolveModelCompletionLimit(connection.model, connection.backendId, backends),
    );

    return {
      id: connection.id,
      kind: connection.kind,
      method: connection.method,
      path: connection.path,
      clientIp: connection.clientIp,
      model: connection.model,
      clientStream: connection.clientStream,
      upstreamStream: connection.upstreamStream,
      phase: connection.phase,
      startedAt: new Date(connection.receivedAt).toISOString(),
      elapsedMs,
      queueMs: connection.queueMs,
      backendId: connection.backendId,
      backendName: connection.backendName,
      statusCode: connection.statusCode,
      error: connection.error,
      promptTokens: connection.promptTokens,
      completionTokens,
      totalTokens: connection.totalTokens,
      contentTokens: connection.contentTokens,
      reasoningTokens: connection.reasoningTokens,
      textTokens: connection.textTokens,
      promptMs: connection.promptMs,
      generationMs: connection.generationMs ?? (connection.firstTokenAt ? Date.now() - connection.firstTokenAt : undefined),
      promptTokensPerSecond: connection.promptTokensPerSecond,
      completionTokensPerSecond: liveCompletionRate,
      effectiveCompletionTokenLimit: effectiveCompletionTokenLimit ?? undefined,
      timeToFirstTokenMs: connection.firstTokenAt ? connection.firstTokenAt - connection.receivedAt : undefined,
      finishReason: connection.finishReason,
      metricsExact: connection.metricsExact,
      hasDetail: connection.requestBody !== undefined || connection.responseBody !== undefined,
    };
  }

  private buildUpstreamBody(
    method: string,
    body: Buffer,
    parsedBody: Record<string, unknown> | undefined,
    forceStreaming: boolean,
  ): Buffer | undefined {
    if (!canSendBody(method) || body.length === 0) {
      return undefined;
    }

    if (forceStreaming && parsedBody) {
      return buildStreamingRequestBody(parsedBody);
    }

    return body;
  }

  private async handleStreamingProxy(options: {
    requestId: string;
    kind: "chat.completions" | "completions";
    clientStream: boolean;
    backendId: string;
    model?: string;
    upstreamResponse: Response;
    response: ServerResponse;
  }): Promise<Record<string, unknown>> {
    const { requestId, kind, clientStream, backendId, model, upstreamResponse, response } = options;
    const accumulator = new StreamingAccumulator(kind);
    const reader = upstreamResponse.body?.getReader();

    if (!reader) {
      throw new Error("Streaming response had no body.");
    }

    if (clientStream) {
      response.statusCode = upstreamResponse.status;
      copyResponseHeaders(upstreamResponse.headers, response);
      response.setHeader("x-llmproxy-request-id", requestId);
      response.setHeader("x-llmproxy-backend", backendId);
      if (model) {
        response.setHeader("x-llmproxy-model", model);
      }
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      if (clientStream) {
        response.write(Buffer.from(next.value));
      }

      buffer += decoder.decode(next.value, { stream: true });
      buffer = this.consumeStreamingBuffer(requestId, buffer, accumulator, false);
    }

    buffer += decoder.decode();
    this.consumeStreamingBuffer(requestId, buffer, accumulator, true);

    if (!accumulator.hasPayload) {
      throw new Error("Upstream stream produced no JSON payload.");
    }

    const synthesizedResponse = accumulator.buildResponse();

    if (clientStream) {
      response.end();
      return synthesizedResponse;
    }

    this.sendSynthesizedJson(response, upstreamResponse.status, synthesizedResponse, backendId, model);
    return synthesizedResponse;
  }

  private async handleOllamaStreamingProxy(options: {
    requestId: string;
    clientStream: boolean;
    backendId: string;
    model?: string;
    upstreamResponse: Response;
    response: ServerResponse;
  }): Promise<Record<string, unknown>> {
    const { requestId, clientStream, backendId, model, upstreamResponse, response } = options;
    const accumulator = new StreamingAccumulator("chat.completions");
    const reader = upstreamResponse.body?.getReader();

    if (!reader) {
      throw new Error("Ollama streaming response had no body.");
    }

    if (clientStream) {
      this.writeStreamingResponseHeaders(response, upstreamResponse.status, backendId, model);
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      buffer += decoder.decode(next.value, { stream: true });
      buffer = this.consumeOllamaStreamingBuffer(requestId, buffer, accumulator, clientStream, response, false);
    }

    buffer += decoder.decode();
    this.consumeOllamaStreamingBuffer(requestId, buffer, accumulator, clientStream, response, true);

    if (!accumulator.hasPayload) {
      throw new Error("Ollama stream produced no JSON payload.");
    }

    const synthesizedResponse = accumulator.buildResponse();

    if (clientStream) {
      response.end("data: [DONE]\n\n");
      return synthesizedResponse;
    }

    this.sendSynthesizedJson(response, upstreamResponse.status, synthesizedResponse, backendId, model);
    return synthesizedResponse;
  }

  private consumeStreamingBuffer(
    requestId: string,
    buffer: string,
    accumulator: StreamingAccumulator,
    flush: boolean,
  ): string {
    const split = splitSseBlocks(buffer, flush);

    for (const block of split.blocks) {
      const payloadText = extractSseDataPayload(block);
      if (!payloadText || payloadText === "[DONE]") {
        continue;
      }

      try {
        const payload = JSON.parse(payloadText) as Record<string, unknown>;
        const update = accumulator.applyPayload(payload);
        this.applyStreamingUpdate(requestId, update, accumulator.buildResponse());
      } catch {
        continue;
      }
    }

    return split.remainder;
  }

  private consumeOllamaStreamingBuffer(
    requestId: string,
    buffer: string,
    accumulator: StreamingAccumulator,
    clientStream: boolean,
    response: ServerResponse,
    flush: boolean,
  ): string {
    const split = splitJsonLines(buffer, flush);

    for (const line of split.lines) {
      let payload: Record<string, unknown>;

      try {
        payload = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      const chunk = convertOllamaChunkToOpenAiChunk(payload, requestId);
      if (!chunk) {
        continue;
      }

      if (clientStream) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      const update = accumulator.applyPayload(chunk);
      this.applyStreamingUpdate(requestId, update, accumulator.buildResponse());
    }

    return split.remainder;
  }

  private buildActiveRequestDetail(requestId: string): RequestLogDetail | undefined {
    const connection = this.activeConnections.get(requestId);
    if (!connection) {
      return undefined;
    }

    const snapshot = this.toActiveConnectionSnapshot(connection, this.loadBalancer.getSnapshot().backends);
    return {
      live: true,
      entry: {
        id: snapshot.id,
        time: snapshot.startedAt,
        method: snapshot.method,
        path: snapshot.path,
        clientIp: snapshot.clientIp,
        requestType: snapshot.clientStream ? "stream" : "json",
        model: snapshot.model,
        backendId: snapshot.backendId,
        backendName: snapshot.backendName,
        outcome: connection.cancelSource === "dashboard" || connection.cancelSource === "client_disconnect"
          ? "cancelled"
          : (snapshot.error ? "error" : "success"),
        latencyMs: snapshot.elapsedMs,
        queuedMs: snapshot.queueMs,
        statusCode: snapshot.statusCode,
        error: snapshot.error,
        promptTokens: snapshot.promptTokens,
        completionTokens: snapshot.completionTokens,
        totalTokens: snapshot.totalTokens,
        contentTokens: snapshot.contentTokens,
        reasoningTokens: snapshot.reasoningTokens,
        textTokens: snapshot.textTokens,
        promptMs: snapshot.promptMs,
        generationMs: snapshot.generationMs,
        promptTokensPerSecond: snapshot.promptTokensPerSecond,
        completionTokensPerSecond: snapshot.completionTokensPerSecond,
        effectiveCompletionTokenLimit: snapshot.effectiveCompletionTokenLimit,
        timeToFirstTokenMs: snapshot.timeToFirstTokenMs,
        finishReason: snapshot.finishReason,
        metricsExact: snapshot.metricsExact,
        hasDetail: snapshot.hasDetail,
      },
      requestBody: connection.requestBody,
      responseBody: connection.responseBody,
    };
  }

  private getRequestDetail(requestId: string): RequestLogDetail | undefined {
    return this.buildActiveRequestDetail(requestId) ?? this.loadBalancer.getRequestLogDetail(requestId);
  }

  private sendSynthesizedJson(
    response: ServerResponse,
    statusCode: number,
    payload: Record<string, unknown>,
    backendId: string,
    model?: string,
  ): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-llmproxy-backend", backendId);
    if (model) {
      response.setHeader("x-llmproxy-model", model);
    }
    response.end(JSON.stringify(payload));
  }

  private writeStreamingResponseHeaders(response: ServerResponse, statusCode: number, backendId: string, model?: string): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    response.setHeader("x-accel-buffering", "no");
    response.setHeader("x-llmproxy-backend", backendId);
    if (model) {
      response.setHeader("x-llmproxy-model", model);
    }
  }

  private buildUpstreamHeaders(
    incomingHeaders: IncomingHttpHeaders,
    lease: BackendLease,
    clientIp?: string,
  ): Headers {
    const headers = new Headers();

    for (const [key, value] of Object.entries(incomingHeaders)) {
      const lowerKey = key.toLowerCase();

      if (HOP_BY_HOP_HEADERS.has(lowerKey) || value === undefined || !shouldForwardUpstreamHeader(lowerKey)) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const entry of value) {
          headers.append(lowerKey, entry);
        }
      } else {
        headers.set(lowerKey, value);
      }
    }

    if (clientIp) {
      headers.set("x-forwarded-for", clientIp);
    }

    if (incomingHeaders.host) {
      headers.set("x-forwarded-host", incomingHeaders.host);
    }

    headers.set("x-forwarded-proto", "http");
    headers.set("x-llmproxy-backend", lease.backend.id);

    for (const [key, value] of Object.entries(lease.resolvedHeaders)) {
      headers.set(key, value);
    }

    return headers;
  }

  private async readOllamaErrorMessage(response: Response): Promise<string> {
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.length > 0) {
        return body.error;
      }
    } catch {
      // ignore parse failure and fall back to generic error
    }

    return `Ollama backend returned HTTP ${response.status}.`;
  }

  private scheduleSnapshotBroadcast(): void {
    if (this.snapshotTimer) {
      return;
    }

    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      this.broadcastCurrentSnapshot();
    }, 150);
  }

  private broadcastCurrentSnapshot(): void {
    const payload = `event: snapshot\ndata: ${JSON.stringify(this.getSnapshot())}\n\n`;

    for (const client of this.sseClients) {
      if (client.writableEnded) {
        this.sseClients.delete(client);
        continue;
      }

      client.write(payload);
    }
  }

  private readonly handleLoadBalancerSnapshot = (): void => {
    this.broadcastCurrentSnapshot();
  };
}
