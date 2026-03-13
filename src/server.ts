import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ConfigStore, BackendPatch } from "./config-store";
import { renderDashboardHtml } from "./dashboard";
import { LoadBalancer } from "./load-balancer";
import {
  ActiveConnectionKind,
  ActiveConnectionPhase,
  ActiveConnectionSnapshot,
  BackendLease,
  JsonValue,
  KnownModel,
  LeaseReleaseResult,
  ProxyRouteRequest,
  ProxySnapshot,
  RequestLogDetail,
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
  firstTokenAt?: number;
  finishReason?: string;
  metricsExact: boolean;
  requestBody?: JsonValue;
  responseBody?: JsonValue;
  cancelSource?: "client_disconnect" | "dashboard" | "timeout";
  cancel?: (message?: string) => void;
}

interface DashboardRoute {
  page: "overview" | "logs" | "chat" | "backends";
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
    const dashboardPath = normalizeDashboardPath(this.loadBalancer.getServerConfig().dashboardPath);
    const method = request.method?.toUpperCase() ?? "GET";

    if (method === "GET" && url.pathname === "/") {
      response.statusCode = 302;
      response.setHeader("location", dashboardPath);
      response.end();
      return;
    }

    if (method === "GET" && normalizeDashboardSubPath(url.pathname) === `${dashboardPath}/config`) {
      response.statusCode = 302;
      response.setHeader("location", `${dashboardPath}/backends`);
      response.end();
      return;
    }

    const dashboardAssetPath = method === "GET" ? resolveDashboardAssetPath(url.pathname, dashboardPath) : undefined;
    if (dashboardAssetPath) {
      await this.handleDashboardAsset(response, dashboardAssetPath);
      return;
    }

    const dashboardRoute = method === "GET" ? matchDashboardRoute(url.pathname, dashboardPath) : undefined;

    if (dashboardRoute) {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.end(
        renderDashboardHtml(this.getSnapshot(), {
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

    const detail = this.buildActiveRequestDetail(requestId) ?? this.loadBalancer.getRequestLogDetail(requestId);

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
    sendJson(response, 200, {
      object: "list",
      data: models.map((model) => ({
        id: model.id,
        object: "model",
        created: 0,
        owned_by: model.ownedBy,
        metadata: {
          backendId: model.backendId,
          source: model.source,
        },
      })),
    });
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

  private async handleProxy(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const method = request.method?.toUpperCase() ?? "GET";
    const receivedAt = Date.now();
    const body = await readRequestBody(request);
    const parsedBody = tryParseJsonBuffer(body, request.headers["content-type"]);
    const route: ProxyRouteRequest = {
      id: randomUUID(),
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
    const upstreamBody = this.buildUpstreamBody(method, body, parsedBody, Boolean(streamingKind));

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
      this.updateActiveConnection(route.id, {
        phase: "connected",
        backendId: lease.backend.id,
        backendName: lease.backend.name,
        queueMs: lease.queueMs,
      }, true);
      const timeoutMs = lease.backend.timeoutMs ?? this.loadBalancer.getServerConfig().requestTimeoutMs;
      timeout = setTimeout(() => {
        abortRequest(`Upstream timeout after ${timeoutMs}ms.`, "timeout");
      }, timeoutMs);

      const upstreamResponse = await fetch(joinUrl(lease.backend.baseUrl, `${url.pathname}${url.search}`), {
        method,
        headers: this.buildUpstreamHeaders(request.headers, lease, route.clientIp),
        body: upstreamBody ? new Uint8Array(upstreamBody) : undefined,
        signal: abortController.signal,
      });

      this.updateActiveConnection(route.id, { statusCode: upstreamResponse.status }, true);

      if (streamingKind && upstreamResponse.ok && isEventStream(upstreamResponse.headers) && upstreamResponse.body) {
        const synthesizedResponse = await this.handleStreamingProxy({
          requestId: route.id,
          kind: streamingKind,
          clientStream: route.stream,
          backendId: lease.backend.id,
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
      response.setHeader("x-llmproxy-backend", lease.backend.id);

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
    return {
      ...this.loadBalancer.getSnapshot(),
      activeConnections: Array.from(this.activeConnections.values())
        .sort((left, right) => left.receivedAt - right.receivedAt)
        .map((connection) => this.toActiveConnectionSnapshot(connection)),
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
      timeToFirstTokenMs: connection.firstTokenAt ? connection.firstTokenAt - connection.receivedAt : undefined,
      finishReason: connection.finishReason,
      metricsExact: connection.metricsExact,
      responseBody: connection.responseBody,
    };
  }

  private toActiveConnectionSnapshot(connection: ActiveConnectionRuntime): ActiveConnectionSnapshot {
    const elapsedMs = Math.max(0, Date.now() - connection.receivedAt);
    const completionTokens = connection.completionTokens;
    const liveCompletionRate =
      connection.completionTokensPerSecond ??
      (connection.firstTokenAt && completionTokens && completionTokens > 0
        ? completionTokens / Math.max(0.001, (Date.now() - connection.firstTokenAt) / 1000)
        : undefined);

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
    upstreamResponse: Response;
    response: ServerResponse;
  }): Promise<Record<string, unknown>> {
    const { requestId, kind, clientStream, backendId, upstreamResponse, response } = options;
    const accumulator = new StreamingAccumulator(kind);
    const reader = upstreamResponse.body?.getReader();

    if (!reader) {
      throw new Error("Streaming response had no body.");
    }

    if (clientStream) {
      response.statusCode = upstreamResponse.status;
      copyResponseHeaders(upstreamResponse.headers, response);
      response.setHeader("x-llmproxy-backend", backendId);
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

    this.sendSynthesizedJson(response, upstreamResponse.status, synthesizedResponse, backendId);
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

  private buildActiveRequestDetail(requestId: string): RequestLogDetail | undefined {
    const connection = this.activeConnections.get(requestId);
    if (!connection) {
      return undefined;
    }

    const snapshot = this.toActiveConnectionSnapshot(connection);
    return {
      live: true,
      entry: {
        id: snapshot.id,
        time: snapshot.startedAt,
        method: snapshot.method,
        path: snapshot.path,
        clientIp: snapshot.clientIp,
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
        timeToFirstTokenMs: snapshot.timeToFirstTokenMs,
        finishReason: snapshot.finishReason,
        metricsExact: snapshot.metricsExact,
        hasDetail: snapshot.hasDetail,
      },
      requestBody: connection.requestBody,
      responseBody: connection.responseBody,
    };
  }

  private sendSynthesizedJson(
    response: ServerResponse,
    statusCode: number,
    payload: Record<string, unknown>,
    backendId: string,
  ): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-llmproxy-backend", backendId);
    response.end(JSON.stringify(payload));
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

function canSendBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

function copyResponseHeaders(headers: Headers, response: ServerResponse): void {
  headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      return;
    }

    response.setHeader(key, value);
  });
}

function isEventStream(headers: Headers): boolean {
  const contentType = headers.get("content-type");
  return typeof contentType === "string" && contentType.toLowerCase().includes("text/event-stream");
}

function proxyError(message: string, type = "proxy_error"): { error: { message: string; type: string } } {
  return {
    error: {
      message,
      type,
    },
  };
}

function normalizeDashboardPath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/dashboard";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function matchDashboardRoute(pathname: string, dashboardPath: string): DashboardRoute | undefined {
  const normalizedPathname = normalizeDashboardSubPath(pathname);

  if (normalizedPathname === dashboardPath) {
    return { page: "overview" };
  }

  if (normalizedPathname === `${dashboardPath}/chat`) {
    return { page: "chat" };
  }

  if (normalizedPathname === `${dashboardPath}/logs`) {
    return { page: "logs" };
  }

  if (normalizedPathname === `${dashboardPath}/backends`) {
    return { page: "backends" };
  }

  return undefined;
}

function normalizeDashboardSubPath(pathname: string): string {
  return pathname !== "/" && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

function resolveDashboardAssetPath(pathname: string, dashboardPath: string): string | undefined {
  const assetPrefix = `${dashboardPath}/assets/`;
  if (!pathname.startsWith(assetPrefix)) {
    return undefined;
  }

  const rawAssetPath = pathname.slice(assetPrefix.length);
  if (!rawAssetPath) {
    return undefined;
  }

  const segments = rawAssetPath
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === ".." || segment.includes("\\"))
  ) {
    return undefined;
  }

  const assetRoots = [
    resolve(__dirname, "dashboard-app", "assets"),
    resolve(__dirname, "..", "frontend", "src", "assets"),
  ];

  for (const assetRoot of assetRoots) {
    const candidate = resolveDashboardAssetCandidate(assetRoot, segments);
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return resolveDashboardAssetCandidate(assetRoots[0], segments);
}

function resolveDashboardAssetCandidate(assetRoot: string, segments: string[]): string | undefined {
  const candidate = resolve(assetRoot, ...segments);
  const allowedPrefix = assetRoot.endsWith(sep) ? assetRoot : `${assetRoot}${sep}`;

  if (candidate !== assetRoot && !candidate.startsWith(allowedPrefix)) {
    return undefined;
  }

  return candidate;
}

function assetContentType(pathname: string): string {
  const extension = extname(pathname).toLowerCase();

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }

  if (extension === ".json" || extension === ".map") {
    return "application/json; charset=utf-8";
  }

  return "application/octet-stream";
}

function selectProxyStatus(
  message: string,
  aborted: boolean,
  clientDisconnected: boolean,
  dashboardCancelled: boolean,
): number {
  if (aborted && clientDisconnected) {
    return 499;
  }

  if (aborted && dashboardCancelled) {
    return 409;
  }

  if (message.includes("Timed out after") && message.includes("waiting for a free backend slot")) {
    return 503;
  }

  if (message.includes("No backend")) {
    return 503;
  }

  if (message.includes("Upstream timeout")) {
    return 504;
  }

  return 502;
}

function extractApiRequestId(pathname: string, suffix = ""): string | undefined {
  const prefix = "/api/requests/";
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }

  if (suffix && !pathname.endsWith(suffix)) {
    return undefined;
  }

  const endIndex = suffix ? pathname.length - suffix.length : pathname.length;
  const rawRequestId = pathname.slice(prefix.length, endIndex);
  if (!rawRequestId) {
    return undefined;
  }

  return decodeURIComponent(rawRequestId);
}
