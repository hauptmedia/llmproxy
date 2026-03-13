import { EventEmitter } from "node:events";
import {
  BackendLease,
  BackendRuntimeSnapshot,
  DiscoveredModelDetail,
  JsonValue,
  KnownModel,
  LeaseReleaseResult,
  ProxyConfig,
  ProxyRouteRequest,
  ProxySnapshot,
  RequestLogDetail,
  RequestLogEntry,
} from "./types";
import { getBackendConnector, getDefaultHealthPaths } from "./backend-connectors";
import { joinUrl, toErrorMessage } from "./utils";
import { resolveBackendHeaders } from "./config-store";

interface BackendRuntime {
  config: ProxyConfig["backends"][number];
  resolvedHeaders: Record<string, string>;
  activeRequests: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cancelledRequests: number;
  healthy: boolean;
  lastLatencyMs?: number;
  avgLatencyMs?: number;
  lastCheckedAt?: string;
  lastError?: string;
  discoveredModels: string[];
  discoveredModelDetails: DiscoveredModelDetail[];
}

interface PendingRequest {
  route: ProxyRouteRequest;
  enqueuedAt: number;
  resolve: (lease: BackendLease) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  abortCleanup?: () => void;
}

interface LoadBalancerOptions {
  fetcher?: typeof fetch;
}

interface BackendSelection {
  backend: BackendRuntime;
  model?: string;
}

export class LoadBalancer extends EventEmitter {
  private readonly fetcher: typeof fetch;
  private readonly startedAt = new Date().toISOString();
  private config: ProxyConfig;
  private backends: BackendRuntime[] = [];
  private queue: PendingRequest[] = [];
  private recentRequests: RequestLogEntry[] = [];
  private recentRequestDetails = new Map<string, Omit<RequestLogDetail, "entry">>();
  private rejectedRequests = 0;
  private nextIndex = 0;
  private healthTimer?: NodeJS.Timeout;
  private healthRefreshPromise?: Promise<void>;

  public constructor(config: ProxyConfig, options: LoadBalancerOptions = {}) {
    super();
    this.fetcher = options.fetcher ?? fetch;
    this.config = config;
    this.replaceConfig(config);
  }

  public getServerConfig(): ProxyConfig["server"] {
    return this.config.server;
  }

  public getSnapshot(): ProxySnapshot {
    const backends = this.backends.map((backend) => this.toSnapshot(backend));

    return {
      startedAt: this.startedAt,
      queueDepth: this.queue.length,
      recentRequestLimit: this.config.server.recentRequestLimit,
      totals: {
        activeRequests: backends.reduce((sum, backend) => sum + backend.activeRequests, 0),
        successfulRequests: backends.reduce((sum, backend) => sum + backend.successfulRequests, 0),
        failedRequests: backends.reduce((sum, backend) => sum + backend.failedRequests, 0),
        cancelledRequests: backends.reduce((sum, backend) => sum + backend.cancelledRequests, 0),
        rejectedRequests: this.rejectedRequests,
      },
      backends,
      activeConnections: [],
      recentRequests: [...this.recentRequests],
    };
  }

  public listKnownModels(): KnownModel[] {
    const models = new Map<string, KnownModel>();

    for (const backend of this.backends) {
      for (const model of backend.config.models ?? []) {
        if (!model.includes("*")) {
          models.set(model, {
            id: model,
            backendId: backend.config.id,
            ownedBy: backend.config.name,
            source: "configured",
          });
        }
      }

      for (const model of backend.discoveredModels) {
        if (!model.includes("*") && !models.has(model)) {
          models.set(model, {
            id: model,
            backendId: backend.config.id,
            ownedBy: backend.config.name,
            source: "discovered",
          });
        }
      }
    }

    return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
  }

  public getRequestLogDetail(id: string): RequestLogDetail | undefined {
    const entry = this.recentRequests.find((candidate) => candidate.id === id);

    if (!entry) {
      return undefined;
    }

    const detail = this.recentRequestDetails.get(id);
    return {
      entry: { ...entry },
      requestBody: detail?.requestBody,
      responseBody: detail?.responseBody,
    };
  }

  public replaceConfig(nextConfig: ProxyConfig): void {
    const previousHealthIntervalMs = this.config.server.healthCheckIntervalMs;
    const previous = new Map(this.backends.map((backend) => [backend.config.id, backend] as const));
    this.config = nextConfig;
    this.backends = nextConfig.backends.map((config) => {
      const existing = previous.get(config.id);

      return {
        config,
        resolvedHeaders: resolveBackendHeaders(config),
        activeRequests: existing?.activeRequests ?? 0,
        totalRequests: existing?.totalRequests ?? 0,
        successfulRequests: existing?.successfulRequests ?? 0,
        failedRequests: existing?.failedRequests ?? 0,
        cancelledRequests: existing?.cancelledRequests ?? 0,
        healthy: existing?.healthy ?? config.enabled,
        lastLatencyMs: existing?.lastLatencyMs,
        avgLatencyMs: existing?.avgLatencyMs,
        lastCheckedAt: existing?.lastCheckedAt,
        lastError: existing?.lastError,
        discoveredModels: existing?.discoveredModels ?? [],
        discoveredModelDetails: existing?.discoveredModelDetails ?? [],
      };
    });

    this.emitSnapshot();
    this.trimRecentRequests();
    if (this.healthTimer && previousHealthIntervalMs !== nextConfig.server.healthCheckIntervalMs) {
      clearInterval(this.healthTimer);
      this.healthTimer = setInterval(() => {
        void this.refreshHealth();
      }, this.config.server.healthCheckIntervalMs);
    }
    void this.refreshHealth();
  }

  public async start(): Promise<void> {
    await this.refreshHealth();
    this.healthTimer = setInterval(() => {
      void this.refreshHealth();
    }, this.config.server.healthCheckIntervalMs);
  }

  public async stop(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
  }

  public async acquire(route: ProxyRouteRequest, signal?: AbortSignal): Promise<BackendLease> {
    if (this.backends.length === 0) {
      this.recordRejectedRequest(route, "No backends configured.");
      throw new Error("No backends configured.");
    }

    if (!this.backends.some((backend) => backend.config.enabled)) {
      this.recordRejectedRequest(route, "No enabled backends available.");
      throw new Error("No enabled backends available.");
    }

    if (!this.hasMatchingBackend(route.model)) {
      const message = isAutoModelRequest(route.model)
        ? "No backend with a concrete model is currently available for automatic model selection."
        : route.model
        ? `No backend configured for model "${route.model}".`
        : "No backend can serve this request.";
      this.recordRejectedRequest(route, message);
      throw new Error(message);
    }

    const immediate = this.tryAcquire(route);
    if (immediate) {
      return immediate;
    }

    return new Promise<BackendLease>((resolve, reject) => {
      const pending: PendingRequest = {
        route,
        enqueuedAt: Date.now(),
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.dequeuePending(pending);
          const waitedMs = Date.now() - pending.enqueuedAt;
          const message = `Timed out after ${waitedMs}ms waiting for a free backend slot.`;
          this.recordRejectedRequest(route, message, "queued_timeout", waitedMs);
          reject(new Error(message));
          this.emitSnapshot();
        }, this.config.server.queueTimeoutMs),
      };

      if (signal) {
        const onAbort = () => {
          this.dequeuePending(pending);
          const message = signal.reason instanceof Error ? signal.reason.message : "Request was aborted while queued.";
          this.recordRejectedRequest(route, message, "cancelled", Date.now() - pending.enqueuedAt);
          reject(new Error(message));
          this.emitSnapshot();
        };

        if (signal.aborted) {
          onAbort();
          return;
        }

        signal.addEventListener("abort", onAbort, { once: true });
        pending.abortCleanup = () => signal.removeEventListener("abort", onAbort);
      }

      this.queue.push(pending);
      this.emitSnapshot();
    });
  }

  public markBackendUnhealthy(id: string, error: string): void {
    const backend = this.backends.find((entry) => entry.config.id === id);

    if (!backend) {
      return;
    }

    backend.healthy = false;
    backend.lastCheckedAt = new Date().toISOString();
    backend.lastError = error;
    this.emitSnapshot();
  }

  private hasMatchingBackend(model?: string): boolean {
    return this.backends.some((backend) => backend.config.enabled && this.resolveModelForBackend(backend, model) !== undefined);
  }

  private tryAcquire(route: ProxyRouteRequest): BackendLease | undefined {
    const selection = this.pickBackend(route.model);

    if (!selection) {
      return undefined;
    }

    const { backend: available, model: selectedModel } = selection;
    const queueMs = Date.now() - route.receivedAt;
    available.activeRequests += 1;
    available.totalRequests += 1;
    available.lastError = undefined;
    this.emitSnapshot();

    let released = false;

    return {
      requestId: route.id,
      backend: available.config,
      selectedModel,
      resolvedHeaders: { ...available.resolvedHeaders },
      queueMs,
      release: (result: LeaseReleaseResult) => {
        if (released) {
          return;
        }

        released = true;
        const runtime = this.resolveBackendRuntime(available.config.id, available);
        runtime.activeRequests = Math.max(0, runtime.activeRequests - 1);
        runtime.lastLatencyMs = result.latencyMs;
        runtime.avgLatencyMs = updateAverageLatency(runtime, result.latencyMs);
        runtime.lastCheckedAt = new Date().toISOString();

        if (result.outcome === "success") {
          runtime.successfulRequests += 1;
          runtime.healthy = true;
          runtime.lastError = undefined;
        } else if (result.outcome === "cancelled") {
          runtime.cancelledRequests += 1;
          runtime.lastError = result.error;
        } else {
          runtime.failedRequests += 1;
          runtime.lastError = result.error;

          if (result.outcome === "error") {
            runtime.healthy = false;
          }
        }

        this.recentRequests.unshift({
          id: route.id,
          time: new Date().toISOString(),
          method: route.method,
          path: route.path,
          clientIp: route.clientIp,
          model: route.model,
          backendId: runtime.config.id,
          backendName: runtime.config.name,
          outcome: result.outcome,
          latencyMs: result.latencyMs,
          queuedMs: result.queuedMs,
          statusCode: result.statusCode,
          error: result.error,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          contentTokens: result.contentTokens,
          reasoningTokens: result.reasoningTokens,
          textTokens: result.textTokens,
          promptMs: result.promptMs,
          generationMs: result.generationMs,
          promptTokensPerSecond: result.promptTokensPerSecond,
          completionTokensPerSecond: result.completionTokensPerSecond,
          effectiveCompletionTokenLimit: result.effectiveCompletionTokenLimit,
          timeToFirstTokenMs: result.timeToFirstTokenMs,
          finishReason: result.finishReason,
          metricsExact: result.metricsExact,
          hasDetail: route.requestBody !== undefined || result.responseBody !== undefined,
        });
        this.trimRecentRequests();
        this.storeRecentRequestDetail(route.id, route.requestBody, result.responseBody);

        this.pumpQueue();
        this.emitSnapshot();
      },
    };
  }

  private pickBackend(model?: string): BackendSelection | undefined {
    if (this.backends.length === 0) {
      return undefined;
    }

    const startIndex = isAutoModelRequest(model) ? 0 : this.nextIndex;

    for (let offset = 0; offset < this.backends.length; offset += 1) {
      const index = (startIndex + offset) % this.backends.length;
      const backend = this.backends[index];

      if (!backend.config.enabled || !backend.healthy) {
        continue;
      }

      if (backend.activeRequests >= backend.config.maxConcurrency) {
        continue;
      }

      const resolvedModel = this.resolveModelForBackend(backend, model);
      if (resolvedModel === undefined) {
        continue;
      }

      if (!isAutoModelRequest(model)) {
        this.nextIndex = (index + 1) % this.backends.length;
      }

      return {
        backend,
        model: resolvedModel,
      };
    }

    return undefined;
  }

  private resolveBackendRuntime(id: string, fallback: BackendRuntime): BackendRuntime {
    return this.backends.find((backend) => backend.config.id === id) ?? fallback;
  }

  private backendSupportsModel(backend: BackendRuntime, model?: string): boolean {
    return this.resolveModelForBackend(backend, model) !== undefined;
  }

  private resolveModelForBackend(backend: BackendRuntime, model?: string): string | undefined {
    if (isAutoModelRequest(model)) {
      const automaticModel = pickAutomaticBackendModel(backend);
      if (!automaticModel) {
        return undefined;
      }

      const configuredPatterns = backend.config.models ?? [];
      if (configuredPatterns.length === 0) {
        return automaticModel;
      }

      return configuredPatterns.some((pattern) => matchesPattern(pattern, automaticModel))
        ? automaticModel
        : undefined;
    }

    if (typeof model !== "string") {
      return undefined;
    }

    const configuredPatterns = backend.config.models ?? [];
    const discoveredModel = resolveDiscoveredBackendModel(backend, model);

    if (hasDiscoveredModels(backend)) {
      if (!discoveredModel) {
        return undefined;
      }

      if (configuredPatterns.length === 0) {
        return discoveredModel;
      }

      return configuredPatterns.some((pattern) => matchesPattern(pattern, model) || matchesPattern(pattern, discoveredModel))
        ? discoveredModel
        : undefined;
    }

    if (configuredPatterns.length === 0) {
      return model;
    }

    return configuredPatterns.some((pattern) => matchesPattern(pattern, model))
      ? model
      : undefined;
  }

  private dequeuePending(pending: PendingRequest): void {
    const index = this.queue.indexOf(pending);

    if (index >= 0) {
      this.queue.splice(index, 1);
    }

    pending.abortCleanup?.();
    clearTimeout(pending.timeout);
  }

  private pumpQueue(): void {
    let progressed = true;

    while (progressed) {
      progressed = false;

      for (let index = 0; index < this.queue.length; index += 1) {
        const pending = this.queue[index];
        const lease = this.tryAcquire(pending.route);

        if (!lease) {
          continue;
        }

        this.queue.splice(index, 1);
        pending.abortCleanup?.();
        clearTimeout(pending.timeout);
        pending.resolve(lease);
        progressed = true;
        break;
      }
    }
  }

  private async refreshHealth(): Promise<void> {
    if (this.healthRefreshPromise) {
      return this.healthRefreshPromise;
    }

    this.healthRefreshPromise = (async () => {
      try {
        await Promise.all(
          this.backends.map(async (backend) => {
            await this.refreshBackendHealth(backend);
          }),
        );
        this.emitSnapshot();
        this.pumpQueue();
      } finally {
        this.healthRefreshPromise = undefined;
      }
    })();

    return this.healthRefreshPromise;
  }

  private async refreshBackendHealth(backend: BackendRuntime): Promise<void> {
    if (!backend.config.enabled) {
      backend.healthy = false;
      backend.lastCheckedAt = new Date().toISOString();
      backend.lastError = "Backend disabled.";
      return;
    }

    const healthPaths = getDefaultHealthPaths(backend.config);
    let lastError = "Health check failed.";
    let discoveredModelDetails = backend.discoveredModelDetails;

    for (const healthPath of healthPaths) {
      try {
        const response = await fetchWithTimeout(
          this.fetcher,
          joinUrl(backend.config.baseUrl, healthPath),
          {
            method: "GET",
            headers: backend.resolvedHeaders,
          },
          backend.config.timeoutMs ?? 5000,
        );

        if (!response.ok) {
          lastError = `${healthPath} returned HTTP ${response.status}.`;
          continue;
        }

        discoveredModelDetails = await tryExtractModels(response, discoveredModelDetails);

        backend.healthy = true;
        backend.lastError = undefined;
        backend.lastCheckedAt = new Date().toISOString();
        backend.discoveredModelDetails = discoveredModelDetails;
        backend.discoveredModels = discoveredModelDetails.map((entry) => entry.id);
        return;
      } catch (error) {
        lastError = toErrorMessage(error);
      }
    }

    backend.healthy = false;
    backend.lastCheckedAt = new Date().toISOString();
    backend.lastError = lastError;
  }

  private toSnapshot(backend: BackendRuntime): BackendRuntimeSnapshot {
    return {
      id: backend.config.id,
      name: backend.config.name,
      baseUrl: backend.config.baseUrl,
      connector: getBackendConnector(backend.config),
      enabled: backend.config.enabled,
      healthy: backend.healthy,
      maxConcurrency: backend.config.maxConcurrency,
      activeRequests: backend.activeRequests,
      availableSlots: Math.max(0, backend.config.maxConcurrency - backend.activeRequests),
      totalRequests: backend.totalRequests,
      successfulRequests: backend.successfulRequests,
      failedRequests: backend.failedRequests,
      cancelledRequests: backend.cancelledRequests,
      lastLatencyMs: backend.lastLatencyMs,
      avgLatencyMs: backend.avgLatencyMs,
      lastCheckedAt: backend.lastCheckedAt,
      lastError: backend.lastError,
      configuredModels: backend.config.models ?? [],
      discoveredModels: backend.discoveredModels,
      discoveredModelDetails: backend.discoveredModelDetails,
    };
  }

  private emitSnapshot(): void {
    this.emit("snapshot", this.getSnapshot());
  }

  private recordRejectedRequest(
    route: ProxyRouteRequest,
    error: string,
    outcome: RequestLogEntry["outcome"] = "error",
    queuedMs = 0,
  ): void {
    this.rejectedRequests += 1;
    this.recentRequests.unshift({
      id: route.id,
      time: new Date().toISOString(),
      method: route.method,
      path: route.path,
      clientIp: route.clientIp,
      model: route.model,
      outcome,
      latencyMs: Date.now() - route.receivedAt,
      queuedMs,
      error,
      effectiveCompletionTokenLimit: resolveRequestedCompletionLimit(route.requestBody),
      hasDetail: route.requestBody !== undefined,
    });
    this.trimRecentRequests();
    this.storeRecentRequestDetail(route.id, route.requestBody, undefined);
  }

  private trimRecentRequests(): void {
    this.recentRequests = this.recentRequests.slice(0, this.config.server.recentRequestLimit);

    const activeIds = new Set(this.recentRequests.map((entry) => entry.id));
    for (const id of Array.from(this.recentRequestDetails.keys())) {
      if (!activeIds.has(id)) {
        this.recentRequestDetails.delete(id);
      }
    }
  }

  private storeRecentRequestDetail(
    requestId: string,
    requestBody: ProxyRouteRequest["requestBody"],
    responseBody: LeaseReleaseResult["responseBody"],
  ): void {
    if (requestBody !== undefined || responseBody !== undefined) {
      this.recentRequestDetails.set(requestId, {
        requestBody,
        responseBody,
      });
    } else {
      this.recentRequestDetails.delete(requestId);
    }

    this.trimRecentRequests();
  }
}

function resolveRequestedCompletionLimit(value: ProxyRouteRequest["requestBody"]): number | undefined {
  if (!isJsonRecord(value)) {
    return undefined;
  }

  return readPositiveInteger(value.max_completion_tokens) ?? readPositiveInteger(value.max_tokens);
}

function readPositiveInteger(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === "*") {
    return true;
  }

  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`).test(value);
  }

  return pattern === value;
}

function isAutoModelRequest(model?: string): boolean {
  return typeof model !== "string" || model.trim() === "" || model === "*" || model === "auto";
}

function hasDiscoveredModels(backend: BackendRuntime): boolean {
  return backend.discoveredModels.length > 0 || backend.discoveredModelDetails.length > 0;
}

function pickAutomaticBackendModel(backend: BackendRuntime): string | undefined {
  if (backend.discoveredModels.length > 0) {
    return backend.discoveredModels[0];
  }

  for (const detail of backend.discoveredModelDetails) {
    if (typeof detail.id === "string" && detail.id.length > 0) {
      return detail.id;
    }
  }

  return backend.config.models?.find((model) => !model.includes("*"));
}

function resolveDiscoveredBackendModel(backend: BackendRuntime, requestedModel: string): string | undefined {
  for (const detail of backend.discoveredModelDetails) {
    if (detail.id === requestedModel) {
      return detail.id;
    }

    for (const alias of extractModelAliases(detail.metadata)) {
      if (alias === requestedModel) {
        return detail.id;
      }
    }
  }

  if (backend.discoveredModels.includes(requestedModel)) {
    return requestedModel;
  }

  return undefined;
}

function extractModelAliases(metadata: JsonValue | undefined): string[] {
  if (!isJsonObject(metadata)) {
    return [];
  }

  if (!Array.isArray(metadata.aliases)) {
    return [];
  }

  return metadata.aliases
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function updateAverageLatency(backend: BackendRuntime, latencyMs: number): number {
  const completedRequests =
    backend.successfulRequests + backend.failedRequests + backend.cancelledRequests + 1;

  if (backend.avgLatencyMs === undefined) {
    return latencyMs;
  }

  return Math.round(((backend.avgLatencyMs * (completedRequests - 1)) + latencyMs) / completedRequests);
}

async function tryExtractModels(response: Response, fallback: DiscoveredModelDetail[]): Promise<DiscoveredModelDetail[]> {
  try {
    const body = await response.json() as {
      data?: unknown;
      models?: unknown;
    };
    const discovered = new Map<string, DiscoveredModelDetail>();

    for (const entry of fallback) {
      if (typeof entry?.id === "string" && entry.id.length > 0) {
        discovered.set(entry.id, entry);
      }
    }

    let foundModel = false;

    if (Array.isArray(body.data)) {
      for (const entry of body.data) {
        const modelId = readDiscoveredModelId(entry);
        if (!modelId) {
          continue;
        }

        foundModel = true;
        const previous = discovered.get(modelId);
        discovered.set(modelId, {
          id: modelId,
          metadata: mergeModelMetadata(previous?.metadata, normalizeModelMetadata(entry, modelId)),
        });
      }
    }

    if (Array.isArray(body.models)) {
      for (const entry of body.models) {
        const modelId = readDiscoveredModelId(entry);
        if (!modelId) {
          continue;
        }

        foundModel = true;
        const previous = discovered.get(modelId);
        discovered.set(modelId, {
          id: modelId,
          metadata: mergeModelMetadata(previous?.metadata, normalizeModelMetadata(entry, modelId)),
        });
      }
    }

    if (!foundModel) {
      return fallback;
    }

    return Array.from(discovered.values());
  } catch {
    return fallback;
  }
}

function readDiscoveredModelId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.id === "string" && value.id.length > 0) {
    return value.id;
  }

  if (typeof value.model === "string" && value.model.length > 0) {
    return value.model;
  }

  if (typeof value.name === "string" && value.name.length > 0) {
    return value.name;
  }

  return undefined;
}

function normalizeModelMetadata(value: unknown, modelId: string): JsonValue | undefined {
  const normalized = normalizeJsonValue(value);

  if (isJsonObject(normalized)) {
    return {
      id: modelId,
      ...normalized,
    };
  }

  if (normalized === undefined) {
    return undefined;
  }

  return {
    id: modelId,
    value: normalized,
  };
}

function mergeModelMetadata(left: JsonValue | undefined, right: JsonValue | undefined): JsonValue | undefined {
  if (left === undefined) {
    return right;
  }

  if (right === undefined) {
    return left;
  }

  if (isJsonObject(left) && isJsonObject(right)) {
    return {
      ...left,
      ...right,
    };
  }

  return right;
}

function normalizeJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((entry) => normalizeJsonValue(entry))
      .filter((entry): entry is JsonValue => entry !== undefined);
    return items;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
      .map(([key, entry]) => {
        const normalized = normalizeJsonValue(entry);
        return normalized === undefined ? undefined : [key, normalized] as const;
      })
      .filter((entry): entry is readonly [string, JsonValue] => Boolean(entry));

    return Object.fromEntries(entries);
  }

  return undefined;
}

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  try {
    return await fetcher(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
