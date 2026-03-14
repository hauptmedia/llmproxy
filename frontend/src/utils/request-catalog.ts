import type {
  ActiveConnectionSnapshot,
  ProxySnapshot,
  RequestLogEntry,
} from "../types/dashboard";

export type RequestCatalogOutcome = RequestLogEntry["outcome"] | "queued" | "connected" | "streaming";

export interface RequestCatalogRow {
  id: string;
  time: string;
  method: string;
  path: string;
  model?: string;
  backendName?: string;
  backendId?: string;
  outcome: RequestCatalogOutcome;
  queuedMs: number;
  latencyMs: number;
  statusCode?: number;
  error?: string;
  completionTokens?: number;
  totalTokens?: number;
  contentTokens?: number;
  reasoningTokens?: number;
  textTokens?: number;
  completionTokensPerSecond?: number;
  effectiveCompletionTokenLimit?: number;
  finishReason?: string;
  diagnosticSeverity?: "warn" | "bad";
  diagnosticTitle?: string;
  diagnosticSummary?: string;
  hasDetail: boolean;
  live: boolean;
}

export interface DiagnosticsRequestOption {
  id: string;
  time: string;
  label: string;
  status: string;
  model: string;
  backend: string;
  live: boolean;
}

export function normalizeRequestLogRow(entry: RequestLogEntry): RequestCatalogRow {
  return {
    id: entry.id,
    time: entry.time,
    method: entry.method,
    path: entry.path,
    model: entry.model,
    backendName: entry.backendName,
    backendId: entry.backendId,
    outcome: entry.outcome,
    queuedMs: entry.queuedMs,
    latencyMs: entry.latencyMs,
    statusCode: entry.statusCode,
    error: entry.error,
    completionTokens: entry.completionTokens,
    totalTokens: entry.totalTokens,
    contentTokens: entry.contentTokens,
    reasoningTokens: entry.reasoningTokens,
    textTokens: entry.textTokens,
    completionTokensPerSecond: entry.completionTokensPerSecond,
    effectiveCompletionTokenLimit: entry.effectiveCompletionTokenLimit,
    finishReason: entry.finishReason,
    diagnosticSeverity: entry.diagnosticSeverity,
    diagnosticTitle: entry.diagnosticTitle,
    diagnosticSummary: entry.diagnosticSummary,
    hasDetail: Boolean(entry.hasDetail),
    live: false,
  };
}

export function normalizeActiveConnectionRow(connection: ActiveConnectionSnapshot): RequestCatalogRow {
  return {
    id: connection.id,
    time: connection.startedAt,
    method: connection.method,
    path: connection.path,
    model: connection.model,
    backendName: connection.backendName,
    backendId: connection.backendId,
    outcome: connection.phase,
    queuedMs: connection.phase === "queued" ? connection.elapsedMs : connection.queueMs,
    latencyMs: connection.elapsedMs,
    statusCode: connection.statusCode,
    error: connection.error,
    completionTokens: connection.completionTokens,
    totalTokens: connection.totalTokens,
    contentTokens: connection.contentTokens,
    reasoningTokens: connection.reasoningTokens,
    textTokens: connection.textTokens,
    completionTokensPerSecond: connection.completionTokensPerSecond,
    effectiveCompletionTokenLimit: connection.effectiveCompletionTokenLimit,
    finishReason: connection.finishReason,
    diagnosticSeverity: undefined,
    diagnosticTitle: undefined,
    diagnosticSummary: undefined,
    hasDetail: Boolean(connection.hasDetail),
    live: true,
  };
}

export function buildRequestCatalog(
  snapshot: Pick<ProxySnapshot, "activeConnections" | "recentRequests">,
): RequestCatalogRow[] {
  const rows = new Map<string, RequestCatalogRow>();

  for (const connection of snapshot.activeConnections) {
    rows.set(connection.id, normalizeActiveConnectionRow(connection));
  }

  for (const entry of snapshot.recentRequests) {
    if (rows.has(entry.id)) {
      continue;
    }

    rows.set(entry.id, normalizeRequestLogRow(entry));
  }

  return Array.from(rows.values());
}

export function normalizeRequestStatus(entry: RequestLogEntry): string {
  if (entry.outcome === "success" && entry.finishReason) {
    return entry.finishReason;
  }

  if (entry.outcome === "queued_timeout") {
    return "queue timeout";
  }

  return entry.outcome;
}

export function buildDiagnosticsRequestOptions(
  snapshot: Pick<ProxySnapshot, "activeConnections" | "recentRequests">,
  shortId: (value: string) => string,
): DiagnosticsRequestOption[] {
  const rows = new Map<string, DiagnosticsRequestOption>();

  for (const connection of snapshot.activeConnections) {
    if (!connection.hasDetail) {
      continue;
    }

    rows.set(connection.id, {
      id: connection.id,
      time: connection.startedAt,
      label: `${shortId(connection.id)} · ${connection.method} ${connection.path}`,
      status: connection.phase,
      model: connection.model || "unknown",
      backend: connection.backendName || "unassigned",
      live: true,
    });
  }

  for (const entry of snapshot.recentRequests) {
    if (!entry.hasDetail || rows.has(entry.id)) {
      continue;
    }

    rows.set(entry.id, {
      id: entry.id,
      time: entry.time,
      label: `${shortId(entry.id)} · ${entry.method} ${entry.path}`,
      status: normalizeRequestStatus(entry),
      model: entry.model || "unknown",
      backend: entry.backendName || "unassigned",
      live: false,
    });
  }

  return Array.from(rows.values()).sort((left, right) => right.time.localeCompare(left.time));
}
