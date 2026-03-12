import type {
  ActiveConnectionSnapshot,
  DebugState,
  ProxySnapshot,
  RequestLogEntry,
  SummaryCard,
  UiBadge,
} from "../types/dashboard";
import { formatCompactValue, formatDate, formatDuration, formatTokenRate } from "./formatters";
import { isClientRecord } from "./guards";

export function describeFinishReason(reason: string): string {
  if (reason === "stop") {
    return 'Final finish reason reported by the backend. "stop" means the generation ended normally.';
  }

  if (reason === "length") {
    return 'Final finish reason reported by the backend. "length" usually means generation stopped because the token limit was reached.';
  }

  if (reason === "content_filter") {
    return 'Final finish reason reported by the backend. "content_filter" means output was stopped by a safety/content filter.';
  }

  if (reason === "tool_calls") {
    return 'Final finish reason reported by the backend. "tool_calls" means the model stopped because it emitted tool calls.';
  }

  return "Final finish reason reported by the backend for this request.";
}

export function badgeSpec(
  text: string,
  tone: "good" | "warn" | "bad" | "neutral",
  title = "",
): UiBadge {
  return { text, tone, title };
}

export function badgeClass(badge: UiBadge): string {
  return badge.className || `badge ${badge.tone ?? "neutral"}`;
}

export function buildSummaryCards(snapshot: ProxySnapshot): SummaryCard[] {
  const enabledCount = snapshot.backends.filter((backend) => backend.enabled).length;
  const healthyCount = snapshot.backends.filter((backend) => backend.enabled && backend.healthy).length;
  const waitingConnections = snapshot.activeConnections.filter(
    (connection) => connection.phase === "queued" && !connection.backendId,
  ).length;
  const uptimeMs = Math.max(0, Date.now() - new Date(snapshot.startedAt).getTime());

  return [
    {
      key: "live-connections",
      label: "Live Connections",
      value: snapshot.activeConnections.length,
      note: `${snapshot.totals.activeRequests} currently occupy backend slots, ${waitingConnections} are still waiting`,
      title: "Requests currently active inside llmproxy. This includes in-flight requests on a backend and requests waiting in the queue.",
    },
    {
      key: "waiting-connections",
      label: "Waiting For Backend",
      value: waitingConnections,
      note: `${snapshot.queueDepth} queued according to the scheduler`,
      title: "Live requests that are still queued because no backend slot has been assigned to them yet.",
    },
    {
      key: "healthy-backends",
      label: "Healthy Backends",
      value: `${healthyCount} / ${enabledCount}`,
      note: `${snapshot.backends.length} configured in total`,
      title: "Enabled backends that passed their most recent health check.",
    },
    {
      key: "successful-requests",
      label: "Successful Requests",
      value: snapshot.totals.successfulRequests,
      note: `${snapshot.totals.rejectedRequests} rejected, ${snapshot.totals.failedRequests} failed`,
      title: "Successfully completed requests observed since this llmproxy instance started.",
    },
    {
      key: "uptime",
      label: "Uptime",
      value: formatDuration(uptimeMs),
      note: `Started: ${formatDate(snapshot.startedAt)}`,
      title: "How long the current llmproxy process has been running.",
    },
  ];
}

export function buildRequestSummaryBadges(entry?: RequestLogEntry): UiBadge[] {
  if (!entry) {
    return [];
  }

  const items: UiBadge[] = [
    badgeSpec(formatDate(entry.time), "neutral", "Time when this request was recorded."),
  ];

  if (entry.backendName) {
    items.push(badgeSpec(`backend ${entry.backendName}`, "good", "Backend chosen for this request."));
  }

  if (entry.statusCode !== undefined) {
    items.push(badgeSpec(`HTTP ${entry.statusCode}`, entry.statusCode >= 500 ? "bad" : "good", "Final upstream status code."));
  }

  items.push(badgeSpec(`latency ${formatDuration(entry.latencyMs)}`, "neutral", "End-to-end request latency."));
  items.push(badgeSpec(`queued ${formatDuration(entry.queuedMs)}`, "neutral", "Time spent waiting for a free backend slot."));

  if (entry.finishReason) {
    items.push(badgeSpec(`finish ${entry.finishReason}`, "good", describeFinishReason(entry.finishReason)));
  }

  return items;
}

export function buildRequestParamBadges(requestBody: unknown): UiBadge[] {
  if (!isClientRecord(requestBody)) {
    return [];
  }

  return Object.entries(requestBody)
    .filter(([key, value]) => key !== "messages" && key !== "tools" && value !== undefined)
    .map(([key, value]) => badgeSpec(`${key} ${formatCompactValue(value)}`, "neutral", `Top-level OpenAI request field "${key}".`));
}

export function buildDebugMetaBadges(debug: DebugState, liveUsage: string): UiBadge[] {
  const bits: UiBadge[] = [];

  if (debug.sending) {
    bits.push(badgeSpec("running", "warn", "A debug request is currently in flight."));
  }

  if (debug.status) {
    bits.push(badgeSpec(debug.status, "good", "HTTP status returned by the proxied debug request."));
  }

  if (debug.backend) {
    bits.push(badgeSpec(`backend ${debug.backend}`, "good", "Backend chosen for the current debug session."));
  }

  if (liveUsage) {
    bits.push(badgeSpec(liveUsage, "neutral", "Live token metrics estimated from the streaming response."));
  }

  if (debug.usage) {
    bits.push(badgeSpec(debug.usage, "neutral", "Final usage/timing metrics returned by the backend."));
  }

  if (debug.error) {
    bits.push(badgeSpec(debug.error, "bad", "Current debug request error."));
  }

  return bits;
}

export function buildConnectionCardBadges(connection: ActiveConnectionSnapshot): UiBadge[] {
  const items: UiBadge[] = [
    badgeSpec(connection.phase, connection.phase === "queued" ? "warn" : "good", "Current request phase inside llmproxy."),
    badgeSpec(connection.clientStream ? "client stream" : "client json", "neutral", "Whether the downstream client requested streaming."),
    badgeSpec(connection.upstreamStream ? "upstream stream" : "upstream json", "neutral", "llmproxy forces upstream streaming for generation routes to collect live metrics."),
    badgeSpec(`queued ${formatDuration(connection.queueMs)}`, "neutral", "Time spent waiting for a free backend slot before this request started upstream."),
  ];

  if (connection.backendName) {
    items.push(badgeSpec(`backend ${connection.backendName}`, "good", "Backend currently serving this request."));
  }

  if (connection.statusCode !== undefined) {
    items.push(badgeSpec(`HTTP ${connection.statusCode}`, connection.statusCode >= 500 ? "bad" : "good", "Current upstream status code."));
  }

  if (connection.model) {
    items.push(badgeSpec(`model ${connection.model}`, "neutral", "Requested model name."));
  }

  if (connection.finishReason) {
    items.push(badgeSpec(`finish ${connection.finishReason}`, "good", describeFinishReason(connection.finishReason)));
  }

  if (connection.error) {
    items.push(badgeSpec(connection.error, "bad", "Current proxy or upstream error for this live request."));
  }

  return items;
}

export function buildConnectionMetricBadges(connection: ActiveConnectionSnapshot): UiBadge[] {
  const items: UiBadge[] = [
    badgeSpec(`elapsed ${formatDuration(connection.elapsedMs)}`, "neutral", "How long this request has been active."),
  ];

  if (typeof connection.promptTokens === "number") {
    items.push(badgeSpec(`prompt ${connection.promptTokens}`, "neutral", "Prompt tokens reported or inferred for this request."));
  }

  if (typeof connection.completionTokens === "number") {
    items.push(badgeSpec(`completion ${connection.completionTokens}`, "neutral", "Completion tokens reported or inferred for this request."));
  }

  if (typeof connection.totalTokens === "number") {
    items.push(badgeSpec(`total ${connection.totalTokens}`, "neutral", "Total tokens reported or inferred for this request."));
  }

  if (typeof connection.contentTokens === "number" && connection.contentTokens > 0) {
    items.push(badgeSpec(`content ${connection.contentTokens}`, "neutral", "Completion tokens attributed to normal visible content."));
  }

  if (typeof connection.reasoningTokens === "number" && connection.reasoningTokens > 0) {
    items.push(badgeSpec(`reasoning ${connection.reasoningTokens}`, "neutral", "Completion tokens attributed to reasoning content."));
  }

  if (typeof connection.textTokens === "number" && connection.textTokens > 0) {
    items.push(badgeSpec(`text ${connection.textTokens}`, "neutral", "Completion tokens attributed to legacy text completions."));
  }

  if (typeof connection.timeToFirstTokenMs === "number") {
    items.push(badgeSpec(`ttfb ${formatDuration(connection.timeToFirstTokenMs)}`, "neutral", "Time to first generated token."));
  }

  if (typeof connection.generationMs === "number") {
    items.push(badgeSpec(`gen ${formatDuration(connection.generationMs)}`, "neutral", "Generation phase duration."));
  }

  const tokenRate = formatTokenRate(connection.completionTokensPerSecond);
  if (tokenRate) {
    items.push(badgeSpec(tokenRate, "good", "Completion tokens generated per second."));
  }

  return items;
}

function buildRequestOutcomeBadge(entry: RequestLogEntry): UiBadge {
  if (entry.outcome === "success") {
    return badgeSpec("ok", "good", "The request completed successfully.");
  }

  if (entry.outcome === "queued_timeout") {
    return badgeSpec("queue timeout", "warn", "The request timed out while waiting in the queue.");
  }

  if (entry.outcome === "cancelled") {
    return badgeSpec("cancelled", "warn", "The request was cancelled before completion.");
  }

  return badgeSpec("error", "bad", "The request failed while being proxied or upstream.");
}

export function buildRecentRequestBadges(entry: RequestLogEntry): UiBadge[] {
  const items: UiBadge[] = [
    buildRequestOutcomeBadge(entry),
    badgeSpec(formatDate(entry.time), "neutral", "Time when this request finished and was added to recent history."),
    badgeSpec(`latency ${formatDuration(entry.latencyMs)}`, "neutral", "End-to-end request latency."),
    badgeSpec(`queued ${formatDuration(entry.queuedMs)}`, "neutral", "Time spent waiting for a free backend slot."),
  ];

  if (entry.backendName) {
    items.push(badgeSpec(`backend ${entry.backendName}`, "good", "Backend that served this request."));
  }

  if (entry.model) {
    items.push(badgeSpec(`model ${entry.model}`, "neutral", "Requested model name."));
  }

  if (entry.statusCode !== undefined) {
    items.push(badgeSpec(`HTTP ${entry.statusCode}`, entry.statusCode >= 500 ? "bad" : "good", "Final upstream status code."));
  }

  if (entry.finishReason) {
    items.push(badgeSpec(`finish ${entry.finishReason}`, "good", describeFinishReason(entry.finishReason)));
  }

  if (entry.hasDetail) {
    items.push(badgeSpec("details", "neutral", "Open the full request/response inspector for this request."));
  }

  if (entry.error) {
    items.push(badgeSpec(entry.error, "bad", "Stored error message for this request."));
  }

  return items;
}

export function buildRecentRequestMetrics(entry: RequestLogEntry): UiBadge[] {
  const items: UiBadge[] = [];

  if (typeof entry.promptTokens === "number") {
    items.push(badgeSpec(`prompt ${entry.promptTokens}`, "neutral", "Prompt tokens reported or inferred for this request."));
  }

  if (typeof entry.completionTokens === "number") {
    items.push(badgeSpec(`completion ${entry.completionTokens}`, "neutral", "Completion tokens reported or inferred for this request."));
  }

  if (typeof entry.totalTokens === "number") {
    items.push(badgeSpec(`total ${entry.totalTokens}`, "neutral", "Total tokens reported or inferred for this request."));
  }

  if (typeof entry.contentTokens === "number" && entry.contentTokens > 0) {
    items.push(badgeSpec(`content ${entry.contentTokens}`, "neutral", "Completion tokens attributed to normal visible content."));
  }

  if (typeof entry.reasoningTokens === "number" && entry.reasoningTokens > 0) {
    items.push(badgeSpec(`reasoning ${entry.reasoningTokens}`, "neutral", "Completion tokens attributed to reasoning content."));
  }

  if (typeof entry.textTokens === "number" && entry.textTokens > 0) {
    items.push(badgeSpec(`text ${entry.textTokens}`, "neutral", "Completion tokens attributed to legacy text completions."));
  }

  if (typeof entry.timeToFirstTokenMs === "number") {
    items.push(badgeSpec(`ttfb ${formatDuration(entry.timeToFirstTokenMs)}`, "neutral", "Time to first generated token."));
  }

  if (typeof entry.generationMs === "number") {
    items.push(badgeSpec(`gen ${formatDuration(entry.generationMs)}`, "neutral", "Generation phase duration."));
  }

  const tokenRate = formatTokenRate(entry.completionTokensPerSecond);
  if (tokenRate) {
    items.push(badgeSpec(tokenRate, "good", "Completion tokens generated per second."));
  }

  return items;
}
