export type RequestOutcome = "success" | "error" | "cancelled" | "queued_timeout";
export type ActiveConnectionPhase = "queued" | "connected" | "streaming";
export type ActiveConnectionKind = "chat.completions" | "completions" | "other";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ServerConfig {
  host: string;
  port: number;
  dashboardPath: string;
  requestTimeoutMs: number;
  queueTimeoutMs: number;
  healthCheckIntervalMs: number;
}

export interface BackendConfig {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  maxConcurrency: number;
  healthPath?: string;
  models?: string[];
  headers?: Record<string, string>;
  apiKey?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
}

export interface ProxyConfig {
  server: ServerConfig;
  backends: BackendConfig[];
}

export interface ProxyRouteRequest {
  id: string;
  receivedAt: number;
  method: string;
  path: string;
  model?: string;
  stream: boolean;
  contentType?: string;
  clientIp?: string;
  requestBody?: JsonValue;
}

export interface LeaseReleaseResult {
  outcome: RequestOutcome;
  latencyMs: number;
  statusCode?: number;
  error?: string;
  queuedMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contentTokens?: number;
  reasoningTokens?: number;
  textTokens?: number;
  promptMs?: number;
  generationMs?: number;
  promptTokensPerSecond?: number;
  completionTokensPerSecond?: number;
  timeToFirstTokenMs?: number;
  finishReason?: string;
  metricsExact?: boolean;
  responseBody?: JsonValue;
}

export interface BackendLease {
  requestId: string;
  queueMs: number;
  backend: BackendConfig;
  resolvedHeaders: Record<string, string>;
  release: (result: LeaseReleaseResult) => void;
}

export interface BackendRuntimeSnapshot {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  healthy: boolean;
  maxConcurrency: number;
  activeRequests: number;
  availableSlots: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cancelledRequests: number;
  lastLatencyMs?: number;
  avgLatencyMs?: number;
  lastCheckedAt?: string;
  lastError?: string;
  configuredModels: string[];
  discoveredModels: string[];
  discoveredModelDetails: DiscoveredModelDetail[];
}

export interface DiscoveredModelDetail {
  id: string;
  metadata?: JsonValue;
}

export interface RequestLogEntry {
  id: string;
  time: string;
  method: string;
  path: string;
  model?: string;
  backendId?: string;
  backendName?: string;
  outcome: RequestOutcome;
  latencyMs: number;
  queuedMs: number;
  statusCode?: number;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contentTokens?: number;
  reasoningTokens?: number;
  textTokens?: number;
  promptMs?: number;
  generationMs?: number;
  promptTokensPerSecond?: number;
  completionTokensPerSecond?: number;
  timeToFirstTokenMs?: number;
  finishReason?: string;
  metricsExact?: boolean;
  hasDetail?: boolean;
}

export interface RequestLogDetail {
  entry: RequestLogEntry;
  requestBody?: JsonValue;
  responseBody?: JsonValue;
  live?: boolean;
}

export interface ActiveConnectionSnapshot {
  id: string;
  kind: ActiveConnectionKind;
  method: string;
  path: string;
  clientIp?: string;
  model?: string;
  clientStream: boolean;
  upstreamStream: boolean;
  phase: ActiveConnectionPhase;
  startedAt: string;
  elapsedMs: number;
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
  timeToFirstTokenMs?: number;
  finishReason?: string;
  metricsExact: boolean;
  hasDetail?: boolean;
}

export interface KnownModel {
  id: string;
  backendId: string;
  ownedBy: string;
  source: "configured" | "discovered";
}

export interface ProxySnapshot {
  startedAt: string;
  queueDepth: number;
  totals: {
    activeRequests: number;
    successfulRequests: number;
    failedRequests: number;
    cancelledRequests: number;
    rejectedRequests: number;
  };
  backends: BackendRuntimeSnapshot[];
  activeConnections: ActiveConnectionSnapshot[];
  recentRequests: RequestLogEntry[];
}
