import type {
  ActiveConnectionSnapshot,
  DebugState,
  ProxySnapshot,
  RequestFieldRow,
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
  const healthyTone =
    healthyCount === 0
      ? "bad"
      : healthyCount < enabledCount
        ? "warn"
        : "good";
  const chatCompletionConnections = snapshot.activeConnections.filter(
    (connection) => connection.kind === "chat.completions",
  );
  const activeConnections = chatCompletionConnections.filter(
    (connection) => connection.phase !== "queued" || Boolean(connection.backendId),
  ).length;
  const waitingConnections = chatCompletionConnections.filter(
    (connection) => connection.phase === "queued" && !connection.backendId,
  ).length;
  const uptimeMs = Math.max(0, Date.now() - new Date(snapshot.startedAt).getTime());

  return [
    {
      key: "healthy-backends",
      label: "Healthy Backends",
      value: `${healthyCount} / ${enabledCount}`,
      note: "",
      title: "Enabled backends that passed their most recent health check.",
      tone: healthyTone,
    },
    {
      key: "live-connections",
      label: "Active Connections",
      value: activeConnections,
      note: "",
      title: "Chat completion requests that are currently running through llmproxy or already assigned to a backend slot.",
      tone: "info",
    },
    {
      key: "waiting-connections",
      label: "Queue",
      value: waitingConnections,
      note: "",
      title: "Chat completion requests that are still waiting in the scheduler queue because no backend slot is available yet.",
      tone: "warn",
    },
    {
      key: "successful-requests",
      label: "Successful Requests",
      value: snapshot.totals.successfulRequests,
      note: "",
      title: "Successfully completed requests observed since this llmproxy instance started.",
      tone: "good",
    },
    {
      key: "failed-requests",
      label: "Failed Requests",
      value: snapshot.totals.failedRequests,
      note: "",
      title: "Requests that failed while being proxied or returned an upstream/server error.",
      tone: "bad",
    },
    {
      key: "uptime",
      label: "Uptime",
      value: formatDuration(uptimeMs),
      note: "",
      title: `How long the current llmproxy process has been running. Started: ${formatDate(snapshot.startedAt)}.`,
    },
  ];
}

export function buildRequestStateBadge(entry?: RequestLogEntry, live = false): UiBadge | null {
  if (!entry) {
    return null;
  }

  if (live) {
    return badgeSpec("running", "warn", "This request is still active and has not reached a final state yet.");
  }

  return buildRequestOutcomeBadge(entry);
}

export function buildRequestParamRows(requestBody: unknown): RequestFieldRow[] {
  if (!isClientRecord(requestBody)) {
    return [];
  }

  return Object.entries(requestBody)
    .filter(([key, value]) => key !== "messages" && key !== "tools" && value !== undefined)
    .map(([key, value]) => ({
      key,
      value: formatCompactValue(value),
      title: `Top-level OpenAI request field "${key}".`,
    }));
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

export function buildConnectionTransportBadges(connection: ActiveConnectionSnapshot): UiBadge[] {
  const queueDurationMs =
    connection.phase === "queued" ? connection.elapsedMs : connection.queueMs;
  const showQueueDuration =
    connection.phase === "queued" || connection.queueMs > 0;
  const tokenRate = formatTokenRate(connection.completionTokensPerSecond);
  const liveCompletionTokens = typeof connection.completionTokens === "number"
    ? connection.completionTokens
    : connection.contentTokens + connection.reasoningTokens + connection.textTokens;
  const tokenCountLabel = liveCompletionTokens > 0 ? `${liveCompletionTokens} tok` : "";
  const timeToFirstToken = typeof connection.timeToFirstTokenMs === "number"
    ? formatDuration(connection.timeToFirstTokenMs)
    : "";
  const generationDuration = typeof connection.generationMs === "number"
    ? formatDuration(connection.generationMs)
    : "";
  const downstreamTokenRate = connection.clientStream && tokenRate ? tokenRate : "";
  const upstreamTokenRate = connection.upstreamStream && tokenRate ? tokenRate : "";
  const downstreamLabel = [
    connection.clientStream ? "\u2191 stream" : "\u2191 json",
    ...(showQueueDuration ? [formatDuration(queueDurationMs)] : []),
    formatDuration(connection.elapsedMs),
    ...(downstreamTokenRate ? (tokenCountLabel ? [tokenCountLabel] : []) : []),
    ...(downstreamTokenRate ? [downstreamTokenRate] : []),
  ].join(" \u00b7 ");
  const elapsedDetail = ` Total downstream lifetime so far: ${formatDuration(connection.elapsedMs)}.`;
  const queueDetail =
    connection.phase === "queued"
      ? ` First time value: queued for ${formatDuration(queueDurationMs)} so far while waiting for a backend slot.`
      : connection.queueMs > 0
        ? ` First time value: waited ${formatDuration(connection.queueMs)} in queue before a backend was assigned.`
        : "";
  const tokenCountDetail = tokenCountLabel
    ? ` Current generated completion tokens: ${liveCompletionTokens}.`
    : "";
  const tokenRateDetail = tokenRate
    ? ` Current generation speed: ${tokenRate}.`
    : "";
  const downstreamTone =
    connection.phase === "streaming" && connection.clientStream
      ? "good"
      : "warn";
  const downstreamTitle =
    connection.phase === "queued"
      ? `The client is still waiting because this request has not been assigned to a backend yet.${elapsedDetail}${queueDetail}${tokenCountDetail}${tokenRateDetail}`
      : connection.phase === "connected"
        ? `A backend is assigned, but the client is still waiting for the response to begin.${elapsedDetail}${queueDetail}${tokenCountDetail}${tokenRateDetail}`
        : connection.clientStream
          ? `The client is receiving streamed tokens or chunks from llmproxy right now.${elapsedDetail}${queueDetail}${tokenCountDetail}${tokenRateDetail}`
          : `The backend is generating, but llmproxy is buffering the response before returning JSON to the client.${elapsedDetail}${queueDetail}${tokenCountDetail}${tokenRateDetail}`;
  const upstreamTone =
    connection.statusCode === undefined
      ? "neutral"
      : connection.statusCode === 200
        ? "good"
        : "bad";
  const upstreamTitle =
    connection.statusCode === undefined
      ? "Upstream request mode from llmproxy to the backend."
      : `Upstream request mode from llmproxy to the backend. Current upstream status: HTTP ${connection.statusCode}.${timeToFirstToken ? ` First time value: time to first upstream token ${timeToFirstToken}.` : ""}${generationDuration ? ` Second time value: upstream generation phase lasted ${generationDuration}.` : ""}${tokenCountDetail}${upstreamTokenRate ? ` Current upstream generation speed: ${upstreamTokenRate}.` : ""}`;

  return [
    badgeSpec(
      downstreamLabel,
      downstreamTone,
      downstreamTitle,
    ),
    badgeSpec(
      [
        connection.upstreamStream ? "\u2193 stream" : "\u2193 json",
        ...(timeToFirstToken ? [timeToFirstToken] : []),
        ...(generationDuration ? [generationDuration] : []),
        ...(upstreamTokenRate ? (tokenCountLabel ? [tokenCountLabel] : []) : []),
        ...(upstreamTokenRate ? [upstreamTokenRate] : []),
      ].join(" \u00b7 "),
      upstreamTone,
      upstreamTitle,
    ),
  ];
}

export function buildConnectionCardBadges(connection: ActiveConnectionSnapshot): UiBadge[] {
  const items: UiBadge[] = [];

  if (connection.finishReason) {
    items.push(badgeSpec(`finish ${connection.finishReason}`, "good", describeFinishReason(connection.finishReason)));
  }

  if (connection.error) {
    items.push(badgeSpec(connection.error, "bad", "Current proxy or upstream error for this live request."));
  }

  return items;
}

export function buildConnectionMetricBadges(connection: ActiveConnectionSnapshot): UiBadge[] {
  void connection;
  return [];
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

export function buildRequestResponseMetricRows(entry?: RequestLogEntry): RequestFieldRow[] {
  if (!entry) {
    return [];
  }

  const items: RequestFieldRow[] = [];

  if (typeof entry.timeToFirstTokenMs === "number") {
    items.push({
      key: "Time to first token",
      value: formatDuration(entry.timeToFirstTokenMs),
      title: "Time to first generated token.",
    });
  }

  if (typeof entry.generationMs === "number") {
    items.push({
      key: "Generation time",
      value: formatDuration(entry.generationMs),
      title: "Generation phase duration.",
    });
  }

  const tokenRate = formatTokenRate(entry.completionTokensPerSecond);
  if (tokenRate) {
    items.push({
      key: "Tokens per second",
      value: tokenRate.replace("tok/s", "tokens/s"),
      title: "Generated completion tokens per second.",
    });
  }

  if (typeof entry.reasoningTokens === "number" && entry.reasoningTokens > 0) {
    items.push({
      key: "Reasoning tokens",
      value: `${entry.reasoningTokens} tokens`,
      title: "Generated tokens attributed to reasoning content.",
    });
  }

  if (typeof entry.contentTokens === "number" && entry.contentTokens > 0) {
    items.push({
      key: "Content tokens",
      value: `${entry.contentTokens} tokens`,
      title: "Generated tokens attributed to normal visible content.",
    });
  }

  if (typeof entry.completionTokens === "number") {
    items.push({
      key: "Completion tokens",
      value: `${entry.completionTokens} tokens`,
      title: "Generated completion tokens reported or inferred for this request.",
    });
  }

  if (typeof entry.textTokens === "number" && entry.textTokens > 0) {
    items.push({
      key: "Legacy text tokens",
      value: `${entry.textTokens} tokens`,
      title: "Generated tokens attributed to legacy text completion output.",
    });
  }

  return items;
}
