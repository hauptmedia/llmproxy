import type {
  ActiveConnectionSnapshot,
  BackendSnapshot,
  DebugState,
  JsonValue,
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

export function buildModelIdentityBadge(
  model: string,
  title = `Model that produced this response: ${model}.`,
): UiBadge {
  return {
    text: model,
    title,
    className: "badge identity-model",
  };
}

export function badgeClass(badge: UiBadge): string {
  return badge.className || `badge ${badge.tone ?? "neutral"}`;
}

export function buildSummaryCards(snapshot: ProxySnapshot): SummaryCard[] {
  const enabledCount = snapshot.backends.filter((backend) => backend.enabled).length;
  const healthyCount = snapshot.backends.filter((backend) => backend.enabled && backend.healthy).length;
  const recentSuccessCount = snapshot.recentRequests.filter((entry) => entry.outcome === "success").length;
  const recentFailureCount = snapshot.recentRequests.filter((entry) => entry.outcome === "error" && Boolean(entry.backendId)).length;
  const recentRejectedCount = snapshot.recentRequests.filter((entry) => entry.outcome !== "success" && !entry.backendId).length;
  const recentCancelledCount = snapshot.recentRequests.filter((entry) => entry.outcome === "cancelled" && Boolean(entry.backendId)).length;
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
      key: "uptime",
      label: "Uptime",
      value: formatDuration(uptimeMs),
      note: "",
      title: `How long the current llmproxy process has been running. Started: ${formatDate(snapshot.startedAt)}.`,
    },
    {
      key: "healthy-backends",
      label: "Backends",
      value: `${healthyCount} / ${enabledCount}`,
      note: "",
      title: "Backend availability overview. First value: enabled backends that passed their most recent health check. Second value: total enabled backends configured in llmproxy.",
      tone: healthyTone,
      segments: [
        {
          text: String(healthyCount),
          label: "Healthy",
          tone: healthyTone,
          title: "Enabled backends that passed their most recent health check.",
          drilldown: {
            page: "overview",
            hash: "#backend-runtime",
          },
        },
        {
          text: String(enabledCount),
          label: "Total",
          tone: "neutral",
          title: "Total number of enabled backends currently configured in llmproxy.",
          drilldown: {
            page: "overview",
            hash: "#backend-runtime",
          },
        },
      ],
    },
    {
      key: "live-connections",
      label: "Connections",
      value: `${activeConnections} - ${waitingConnections}`,
      note: "",
      title: "Chat completion request load. First value: requests currently active or already assigned to a backend slot. Second value: requests still queued and waiting for a free backend slot.",
      tone: "info",
      segments: [
        {
          text: String(activeConnections),
          label: "Active",
          tone: "info",
          title: "Requests currently active or already assigned to a backend slot.",
          drilldown: {
            page: "overview",
            hash: "#active-connections",
          },
        },
        {
          text: String(waitingConnections),
          label: "Queued",
          tone: "warn",
          title: "Requests still queued because no backend slot is available yet.",
          drilldown: {
            page: "overview",
            hash: "#queued-connections",
          },
        },
      ],
    },
    {
      key: "requests",
      label: `Requests (last ${snapshot.recentRequestLimit})`,
      value: `${recentSuccessCount} / ${recentFailureCount} / ${recentRejectedCount} / ${recentCancelledCount}`,
      note: "",
      title: `Request outcome overview within the last ${snapshot.recentRequestLimit} retained log entries. Successful: completed requests. Failed: requests that had a backend assigned and then errored. Rejected: requests that never received a backend assignment, including no matching backend, no enabled backend, or queue timeout before assignment. Cancelled: requests that had a backend assigned but were cancelled before completion.`,
      tone: "neutral",
      segments: [
        {
          text: String(recentSuccessCount),
          label: "Successful",
          tone: "good",
          title: `Successfully completed requests within the last ${snapshot.recentRequestLimit} retained log entries.`,
          drilldown: {
            page: "logs",
            query: {
              outcome: "success",
            },
          },
        },
        {
          text: String(recentFailureCount),
          label: "Failed",
          tone: "bad",
          title: `Requests within the last ${snapshot.recentRequestLimit} retained log entries that already had a backend assigned and then failed while being proxied or due to an upstream/server error.`,
          drilldown: {
            page: "logs",
            query: {
              outcome: "error",
            },
          },
        },
        {
          text: String(recentCancelledCount),
          label: "Cancelled",
          tone: "warn",
          title: `Requests within the last ${snapshot.recentRequestLimit} retained log entries that already had a backend assigned but were cancelled before completion.`,
          drilldown: {
            page: "logs",
            query: {
              outcome: "cancelled",
            },
          },
        },
        {
          text: String(recentRejectedCount),
          label: "Rejected",
          tone: "warn",
          title: `Requests within the last ${snapshot.recentRequestLimit} retained log entries that never received a backend assignment. This includes cases like no configured backend match, no enabled backend, or timing out while waiting in the queue before a backend slot was assigned.`,
          drilldown: {
            page: "logs",
            query: {
              outcome: "rejected",
            },
          },
        },
      ],
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

export function buildRequestParamRows(
  requestBody: unknown,
  requestType?: "stream" | "json",
): RequestFieldRow[] {
  const derivedRequestType =
    requestType ||
    (isClientRecord(requestBody) && typeof requestBody.stream === "boolean"
      ? (requestBody.stream ? "stream" : "json")
      : undefined);

  const items: RequestFieldRow[] = [];

  if (derivedRequestType) {
    items.push({
      key: "type",
      value: derivedRequestType,
      title: "Whether the client requested a streaming response or a regular JSON response.",
    });
  }

  if (!isClientRecord(requestBody)) {
    return items;
  }

  return items.concat(
    Object.entries(requestBody)
      .filter(([key, value]) => key !== "messages" && key !== "tools" && key !== "stream" && value !== undefined)
      .map(([key, value]) => ({
        key,
        value: formatCompactValue(value),
        title: describeRequestField(key),
      })),
  );
}

function describeRequestField(key: string): string {
  const normalized = key.trim();

  switch (normalized) {
    case "model":
      return "Model requested by the client. This can be a concrete model name or a routing alias such as auto.";
    case "max_completion_tokens":
      return "Maximum number of completion tokens the model is allowed to generate for this response. When reached, generation usually stops with finish reason \"length\".";
    case "max_tokens":
      return "Legacy maximum completion-token limit for this request. llmproxy treats it as a fallback when max_completion_tokens is not present.";
    case "temperature":
      return "Sampling temperature. Lower values make the response more deterministic; higher values make it more varied and creative.";
    case "top_p":
      return "Nucleus sampling threshold. The model samples only from the smallest probability mass whose total reaches this value.";
    case "top_k":
      return "Top-k sampling limit. The model samples only from the highest-probability candidate tokens up to this count.";
    case "min_p":
      return "Minimum probability threshold for token candidates. Lower-probability options below this threshold are filtered out.";
    case "repeat_penalty":
      return "Penalty applied to already used tokens to reduce repetition and looping output.";
    case "seed":
      return "Optional random seed. When the backend supports it, the same seed can make sampling more reproducible.";
    case "tool_choice":
      return "Controls whether the model may call tools automatically, must call a specific tool, or must avoid tools.";
    case "parallel_tool_calls":
      return "Whether the model is allowed to emit multiple tool calls in parallel within one assistant turn.";
    case "response_format":
      return "Requested output format, for example structured JSON output when supported by the backend.";
    case "presence_penalty":
      return "Penalty that encourages the model to introduce new topics instead of reusing the same concepts repeatedly.";
    case "frequency_penalty":
      return "Penalty that discourages repeatedly using the same tokens or phrases.";
    case "stop":
      return "Custom stop sequence or sequences. Generation ends when one of them is reached.";
    case "n":
      return "Number of completions requested for this call. Most llmproxy flows typically use a single response.";
    case "user":
      return "Optional end-user identifier passed through for abuse monitoring, analytics, or downstream policy handling.";
    default:
      return `Top-level request field "${normalized}". If you set it explicitly, llmproxy forwarded this parameter to the backend request.`;
  }
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

export function buildConnectionTransportBadges(
  connection: ActiveConnectionSnapshot,
  options?: { invertDirections?: boolean },
): UiBadge[] {
  const queueDurationMs =
    connection.phase === "queued" ? connection.elapsedMs : connection.queueMs;
  const showQueueDuration =
    connection.phase === "queued" || connection.queueMs > 0;
  const invertDirections = Boolean(options?.invertDirections);
  const downstreamArrow = invertDirections ? "\u2193" : "\u2191";
  const upstreamArrow = invertDirections ? "\u2191" : "\u2193";
  const tokenRate = formatTokenRate(connection.completionTokensPerSecond);
  const liveCompletionTokens = typeof connection.completionTokens === "number"
    ? connection.completionTokens
    : connection.contentTokens + connection.reasoningTokens + connection.textTokens;
  const completionTokenLimitLabel =
    typeof connection.effectiveCompletionTokenLimit === "number"
      ? new Intl.NumberFormat("en-US").format(connection.effectiveCompletionTokenLimit)
      : "∞";
  const tokenCountLabel = liveCompletionTokens > 0
    ? `${new Intl.NumberFormat("en-US").format(liveCompletionTokens)} / ${completionTokenLimitLabel} tok`
    : "";
  const timeToFirstToken = typeof connection.timeToFirstTokenMs === "number"
    ? formatDuration(connection.timeToFirstTokenMs)
    : "";
  const generationDuration = typeof connection.generationMs === "number"
    ? formatDuration(connection.generationMs)
    : "";
  const downstreamTokenRate = connection.clientStream && tokenRate ? tokenRate : "";
  const upstreamTokenRate = connection.upstreamStream && tokenRate ? tokenRate : "";
  const downstreamLabel = [
    connection.clientStream ? `${downstreamArrow} stream` : `${downstreamArrow} json`,
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
    ? ` Current generated completion tokens: ${new Intl.NumberFormat("en-US").format(liveCompletionTokens)} of ${completionTokenLimitLabel}.`
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
        connection.upstreamStream ? `${upstreamArrow} stream` : `${upstreamArrow} json`,
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
    items.push(badgeSpec(
      `HTTP ${entry.statusCode}`,
      entry.statusCode < 200 || entry.statusCode >= 300 ? "bad" : "good",
      "Final upstream status code.",
    ));
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

export function buildRequestResponseMetricRows(
  entry?: RequestLogEntry,
  options?: {
    requestBody?: unknown;
    responseBody?: unknown;
    backends?: BackendSnapshot[];
    live?: boolean;
  },
): RequestFieldRow[] {
  if (!entry) {
    return [];
  }

  const items: RequestFieldRow[] = [];
  const servedModel = resolveServedModelName(options?.responseBody, options?.requestBody, entry.model);
  const backendLabel = entry.backendName?.trim() || entry.backendId?.trim() || "";

  if (backendLabel) {
    items.push({
      key: "Backend",
      value: backendLabel,
      title: "Backend instance that actually served and answered this request.",
    });
  }

  if (servedModel) {
    items.push({
      key: "Model",
      value: servedModel,
      title: "Concrete model that actually produced the response after llmproxy routing resolved the request.",
    });
  }

  items.push({
    key: "Status",
    value: describeRequestStatus(entry),
    title: "Final request status recorded by llmproxy for this request.",
  });

  if (typeof entry.timeToFirstTokenMs === "number") {
    items.push({
      key: "Time to first token",
      value: formatDuration(entry.timeToFirstTokenMs),
      title: "How long it took from request start until the first completion token arrived from the backend.",
    });
  }

  if (typeof entry.generationMs === "number") {
    items.push({
      key: "Generation time",
      value: formatDuration(entry.generationMs),
      title: "How long the backend spent in the actual generation phase after output started.",
    });
  }

  if (typeof entry.reasoningTokens === "number" && entry.reasoningTokens > 0) {
    items.push({
      key: "Reasoning tokens",
      value: `${entry.reasoningTokens} tokens`,
      title: "Generated tokens attributed to hidden reasoning or thinking content, when the backend reports them separately.",
    });
  }

  if (typeof entry.contentTokens === "number" && entry.contentTokens > 0) {
    items.push({
      key: "Content tokens",
      value: `${entry.contentTokens} tokens`,
      title: "Generated tokens that became normal visible assistant output in the final response.",
    });
  }

  const completionMetric = buildCompletionMetricValue(entry, options, servedModel);
  if (completionMetric) {
    items.push({
      key: "Completion tokens",
      value: completionMetric.value,
      title: completionMetric.title,
    });
  }

  const tokenRate = formatTokenRate(entry.completionTokensPerSecond);
  if (tokenRate) {
    items.push({
      key: "Completion throughput",
      value: tokenRate.replace("tok/s", "tokens/s"),
      title: "Average completion-token throughput during the generation phase.",
    });
  }

  if (typeof entry.textTokens === "number" && entry.textTokens > 0) {
    items.push({
      key: "Legacy text tokens",
      value: `${entry.textTokens} tokens`,
      title: "Generated tokens counted from legacy text-completion style output when the backend reports them separately.",
    });
  }

  if (entry.finishReason) {
    items.push({
      key: "Finish reason",
      value: entry.finishReason,
      title: describeFinishReason(entry.finishReason),
    });
  }

  return items;
}

function buildCompletionMetricValue(
  entry: RequestLogEntry,
  options?: {
    requestBody?: unknown;
    responseBody?: unknown;
    backends?: BackendSnapshot[];
    live?: boolean;
  },
  servedModelName?: string,
): { value: string; title: string } | null {
  const usedTokens = resolveUsedCompletionTokens(entry, Boolean(options?.live));
  const requestedLimit = resolveRequestedCompletionLimit(options?.requestBody);
  const servedModel = servedModelName ?? resolveServedModelName(options?.responseBody, options?.requestBody, entry.model);
  const modelLimit = resolveModelCompletionLimit(servedModel, entry.backendId, options?.backends);

  if (usedTokens === null) {
    return null;
  }

  const effectiveLimit = resolveEffectiveCompletionLimit(requestedLimit?.value, modelLimit?.value);
  const limitLabel = effectiveLimit === null ? "∞" : new Intl.NumberFormat("en-US").format(effectiveLimit);
  const usedLabel = new Intl.NumberFormat("en-US").format(usedTokens);
  const titleParts = [
    "Generated completion tokens reported or inferred for this request.",
  ];

  if (requestedLimit && modelLimit) {
    titleParts.push(
      `Effective limit uses the lower of the request cap (${requestedLimit.value} from ${requestedLimit.source}) and the model cap (${modelLimit.value} from backend model metadata).`,
    );
  } else if (requestedLimit) {
    titleParts.push(`Limit comes from ${requestedLimit.source} (${requestedLimit.value}).`);
  } else if (modelLimit) {
    titleParts.push(`Limit comes from backend model metadata (${modelLimit.value}).`);
  } else {
    titleParts.push("No explicit request-level or model-level completion cap was available, so the limit is treated as unbounded.");
  }

  if (servedModel) {
    titleParts.push(`Resolved model: ${servedModel}.`);
  }

  return {
    value: `${usedLabel} / ${limitLabel} tokens`,
    title: titleParts.join(" "),
  };
}

function describeRequestStatus(entry: RequestLogEntry): string {
  if (entry.outcome === "success") {
    return "success";
  }

  if (entry.outcome === "queued_timeout") {
    return "queue timeout";
  }

  return entry.outcome;
}

function resolveUsedCompletionTokens(entry: RequestLogEntry, live: boolean): number | null {
  if (typeof entry.completionTokens === "number") {
    return entry.completionTokens;
  }

  const derived = (entry.contentTokens ?? 0) + (entry.reasoningTokens ?? 0) + (entry.textTokens ?? 0);
  if (derived > 0) {
    return derived;
  }

  return live ? 0 : null;
}

function resolveRequestedCompletionLimit(requestBody: unknown): { value: number; source: string } | null {
  if (!isClientRecord(requestBody)) {
    return null;
  }

  const maxCompletionTokens = readPositiveInteger(requestBody.max_completion_tokens);
  if (maxCompletionTokens !== null) {
    return {
      value: maxCompletionTokens,
      source: 'request field "max_completion_tokens"',
    };
  }

  const maxTokens = readPositiveInteger(requestBody.max_tokens);
  if (maxTokens !== null) {
    return {
      value: maxTokens,
      source: 'request field "max_tokens"',
    };
  }

  return null;
}

function resolveServedModelName(responseBody: unknown, requestBody: unknown, fallbackModel?: string): string | undefined {
  if (isClientRecord(responseBody) && typeof responseBody.model === "string" && responseBody.model.trim().length > 0) {
    return responseBody.model.trim();
  }

  if (isClientRecord(requestBody) && typeof requestBody.model === "string" && requestBody.model.trim().length > 0) {
    return requestBody.model.trim();
  }

  return typeof fallbackModel === "string" && fallbackModel.trim().length > 0
    ? fallbackModel.trim()
    : undefined;
}

function resolveModelCompletionLimit(
  model: string | undefined,
  backendId: string | undefined,
  backends: BackendSnapshot[] | undefined,
): { value: number; source: string } | null {
  if (!model || !Array.isArray(backends) || backends.length === 0) {
    return null;
  }

  const preferredBackends = backendId
    ? backends.filter((backend) => backend.id === backendId)
    : backends;
  const candidateBackends = preferredBackends.length > 0 ? preferredBackends : backends;

  for (const backend of candidateBackends) {
    const detail = backend.discoveredModelDetails.find((entry) => {
      if (entry.id === model) {
        return true;
      }

      if (!isJsonRecord(entry.metadata)) {
        return false;
      }

      const aliases = entry.metadata.aliases;
      return Array.isArray(aliases) && aliases.some((alias) => alias === model);
    });

    const limit = readExplicitModelCompletionLimit(detail?.metadata);
    if (limit !== null) {
      return {
        value: limit,
        source: `backend "${backend.name}" model metadata`,
      };
    }
  }

  return null;
}

function resolveEffectiveCompletionLimit(
  requestLimit: number | undefined,
  modelLimit: number | undefined,
): number | null {
  if (typeof requestLimit === "number" && typeof modelLimit === "number") {
    return Math.min(requestLimit, modelLimit);
  }

  if (typeof requestLimit === "number") {
    return requestLimit;
  }

  if (typeof modelLimit === "number") {
    return modelLimit;
  }

  return null;
}

function readExplicitModelCompletionLimit(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = readExplicitModelCompletionLimit(entry);
      if (nested !== null) {
        return nested;
      }
    }

    return null;
  }

  if (!isJsonRecord(value)) {
    return null;
  }

  const explicitKeys = [
    "max_completion_tokens",
    "max_output_tokens",
    "max_generated_tokens",
    "completion_token_limit",
    "output_token_limit",
    "num_predict",
  ];

  for (const key of explicitKeys) {
    const parsed = readPositiveInteger(value[key]);
    if (parsed !== null) {
      return parsed;
    }
  }

  for (const nestedValue of Object.values(value)) {
    const nested = readExplicitModelCompletionLimit(nestedValue);
    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
