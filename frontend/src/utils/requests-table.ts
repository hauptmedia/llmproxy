import { describeFinishReason } from "./dashboard-badges";
import { formatDate, formatTokenRate } from "./formatters";
import type { RequestCatalogRow } from "./request-catalog";

export type RequestFilterKey =
  | "issues"
  | "time"
  | "outcome"
  | "finishReason"
  | "type"
  | "request"
  | "model"
  | "backend"
  | "queue"
  | "latency"
  | "tokens"
  | "maxTokens"
  | "rate"
  | "note";

export type RequestSortKey = RequestFilterKey;
export type RequestSortDirection = "asc" | "desc" | "";

export interface RequestTableFilters {
  issues: string;
  time: string;
  outcome: string;
  finishReason: string;
  type: string;
  request: string;
  model: string;
  backend: string;
  queueComparator: string;
  queueValue: string;
  latencyComparator: string;
  latencyValue: string;
  tokensComparator: string;
  tokensValue: string;
  maxTokensComparator: string;
  maxTokensValue: string;
  rateComparator: string;
  rateValue: string;
  note: string;
}

const logDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
});

const logTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeStyle: "short",
});

const supportedOutcomeFilters = new Set([
  "all",
  "queued",
  "connected",
  "streaming",
  "success",
  "completed",
  "error",
  "cancelled",
  "rejected",
  "queued_timeout",
]);

export const requestFilterIconPath = [
  "M4 6h16",
  "M7 12h10",
  "M10 18h4",
];

export const requestNumericComparatorOptions = [
  { value: "any", label: "Any" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "eq", label: "=" },
  { value: "lte", label: "<=" },
  { value: "lt", label: "<" },
];

export const requestIssueFilterOptions = [
  { value: "all", label: "All" },
  { value: "problematic", label: "Problematic" },
  { value: "clean", label: "No issue" },
];

export const requestTypeFilterOptions = [
  { value: "all", label: "All types" },
  { value: "stream", label: "Stream" },
  { value: "json", label: "JSON" },
];

export const requestColumnTitles: Record<RequestFilterKey | "action", string> = {
  issues: "Whether llmproxy's built-in heuristic diagnostics flagged this stored request as likely problematic.",
  time: "When llmproxy first saw this request. Live rows update in place until they finish and move into retained history.",
  outcome: "Current live state or final request status such as success, error, cancelled, or rejected.",
  finishReason: "Backend finish reason for completed responses, for example stop, length, or tool_calls. Live or incomplete requests may not have one yet.",
  type: "Whether the client requested a streaming response or a regular JSON response.",
  request: "Short request identifier plus the proxied API route that was called. A yellow warning triangle marks requests where llmproxy's built-in heuristic diagnostics found a likely problem.",
  model: "Model that llmproxy actually routed this request to.",
  backend: "Backend that currently handles or finally handled the request.",
  queue: "Time the request spent waiting for a free backend slot before execution began, or the current wait time while it is still queued.",
  latency: "Total end-to-end request duration so far for live rows, or final duration for retained history.",
  tokens: "Generated completion tokens for this request.",
  maxTokens: "Effective completion-token limit for this request, resolved from request parameters or backend model metadata when available. Unbounded cases display as infinity.",
  rate: "Generation speed in tokens per second, when available from live or final metrics.",
  note: "Error text or other noteworthy final detail recorded for this request.",
  action: "Open the request debugger for this entry when detailed request data is available.",
};

export const requestSortLabels: Record<RequestSortKey, string> = {
  issues: "problem state",
  time: "time",
  outcome: "status",
  finishReason: "finish reason",
  type: "request type",
  request: "request",
  model: "model",
  backend: "backend",
  queue: "queued",
  latency: "latency",
  tokens: "tokens",
  maxTokens: "max tokens",
  rate: "tok/s",
  note: "note",
};

export function createRequestTableFilters(): RequestTableFilters {
  return {
    issues: "all",
    time: "",
    outcome: "all",
    finishReason: "all",
    type: "all",
    request: "",
    model: "all",
    backend: "all",
    queueComparator: "any",
    queueValue: "",
    latencyComparator: "any",
    latencyValue: "",
    tokensComparator: "any",
    tokensValue: "",
    maxTokensComparator: "any",
    maxTokensValue: "",
    rateComparator: "any",
    rateValue: "",
    note: "",
  };
}

export function normalizeOutcomeFilterValue(value: unknown): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string") {
    return "all";
  }

  const normalized = rawValue.trim();
  if (!normalized) {
    return "all";
  }

  if (supportedOutcomeFilters.has(normalized) || normalized.startsWith("finish:")) {
    return normalized;
  }

  return "all";
}

function matchesText(query: string, values: Array<string | undefined>): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return values
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function matchesNumeric(
  value: number | null | undefined,
  comparator: string,
  rawFilterValue: string,
): boolean {
  if (comparator === "any") {
    return true;
  }

  const filterValue = Number(rawFilterValue.trim());
  if (!Number.isFinite(filterValue)) {
    return true;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    return false;
  }

  if (comparator === "gt") {
    return value > filterValue;
  }

  if (comparator === "gte") {
    return value >= filterValue;
  }

  if (comparator === "eq") {
    return value === filterValue;
  }

  if (comparator === "lte") {
    return value <= filterValue;
  }

  if (comparator === "lt") {
    return value < filterValue;
  }

  return true;
}

function hasNumericFilterValue(rawFilterValue: string): boolean {
  return rawFilterValue.trim().length > 0;
}

function hasActiveNumericFilter(comparator: string, rawFilterValue: string): boolean {
  return comparator !== "any" && hasNumericFilterValue(rawFilterValue);
}

function compareNumberValues(left: number, right: number): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function compareNullableNumbers(left: number | null | undefined, right: number | null | undefined): number {
  if (left == null && right == null) {
    return 0;
  }

  if (left == null) {
    return 1;
  }

  if (right == null) {
    return -1;
  }

  return compareNumberValues(left, right);
}

function compareTextValues(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function finishOutcomeKey(finishReason: string): string {
  return `finish:${finishReason}`;
}

function logOutcomeKey(entry: RequestCatalogRow): string {
  if (entry.outcome === "queued" || entry.outcome === "connected" || entry.outcome === "streaming") {
    return entry.outcome;
  }

  if (entry.outcome === "success" && entry.finishReason) {
    return finishOutcomeKey(entry.finishReason);
  }

  if (entry.outcome === "success") {
    return "completed";
  }

  return entry.outcome;
}

function isRejectedOutcome(entry: RequestCatalogRow): boolean {
  return entry.outcome !== "success" && !entry.backendId;
}

export function entryTokenCount(entry: RequestCatalogRow): number | null {
  if (typeof entry.completionTokens === "number") {
    return entry.completionTokens;
  }

  if (typeof entry.totalTokens === "number") {
    return entry.totalTokens;
  }

  const derived = (entry.contentTokens ?? 0) + (entry.reasoningTokens ?? 0) + (entry.textTokens ?? 0);
  if (derived > 0) {
    return derived;
  }

  return typeof entry.effectiveCompletionTokenLimit === "number" ? 0 : null;
}

export function noteSummary(entry: RequestCatalogRow): string {
  return entry.error || "";
}

export function hasDiagnosticIssue(entry: RequestCatalogRow): boolean {
  return entry.diagnosticSeverity === "warn" || entry.diagnosticSeverity === "bad";
}

export function diagnosticIssueTitle(entry: RequestCatalogRow): string {
  if (!hasDiagnosticIssue(entry)) {
    return "No heuristic issue detected for this stored request.";
  }

  const title = entry.diagnosticTitle?.trim();
  const summary = entry.diagnosticSummary?.trim();
  if (title && summary) {
    return `${title}: ${summary}`;
  }

  return summary || title || "llmproxy's heuristic diagnostics found a likely issue for this request.";
}

export function matchesOutcomeFilter(entry: RequestCatalogRow, filterValue: string): boolean {
  if (filterValue === "all") {
    return true;
  }

  if (filterValue === "queued" || filterValue === "connected" || filterValue === "streaming") {
    return entry.outcome === filterValue;
  }

  if (filterValue === "success") {
    return entry.outcome === "success";
  }

  if (filterValue === "completed") {
    return entry.outcome === "success" && !entry.finishReason;
  }

  if (filterValue === "error") {
    return entry.outcome === "error" && Boolean(entry.backendId);
  }

  if (filterValue === "cancelled") {
    return entry.outcome === "cancelled" && Boolean(entry.backendId);
  }

  if (filterValue === "rejected") {
    return isRejectedOutcome(entry);
  }

  if (filterValue === "queued_timeout") {
    return entry.outcome === "queued_timeout";
  }

  if (filterValue.startsWith("finish:")) {
    return entry.outcome === "success" && finishOutcomeKey(entry.finishReason ?? "") === filterValue;
  }

  return logOutcomeKey(entry) === filterValue;
}

export function outcomeBadgeClass(entry: RequestCatalogRow): string {
  if (entry.outcome === "streaming") {
    return "badge good";
  }

  if (entry.outcome === "queued" || entry.outcome === "connected") {
    return "badge warn";
  }

  if (entry.outcome === "success") {
    return "badge good";
  }

  if (entry.outcome === "queued_timeout" || entry.outcome === "cancelled") {
    return "badge warn";
  }

  return "badge bad";
}

export function outcomeLabel(entry: RequestCatalogRow): string {
  if (entry.outcome === "queued") {
    return "queued";
  }

  if (entry.outcome === "connected") {
    return "connected";
  }

  if (entry.outcome === "streaming") {
    return "streaming";
  }

  if (entry.outcome === "success") {
    return "success";
  }

  if (entry.outcome === "queued_timeout") {
    return "queue timeout";
  }

  return entry.outcome;
}

export function outcomeTitle(entry: RequestCatalogRow): string {
  if (entry.outcome === "queued") {
    return "This live request is still waiting in the scheduler queue for a free backend slot.";
  }

  if (entry.outcome === "connected") {
    return "This live request already has a backend assigned, but the response has not started streaming yet.";
  }

  if (entry.outcome === "streaming") {
    return "This live request is currently streaming or actively generating.";
  }

  if (entry.outcome === "success") {
    return "The request completed successfully.";
  }

  if (entry.outcome === "queued_timeout") {
    return "The request timed out while waiting in the queue.";
  }

  if (entry.outcome === "cancelled") {
    return "The request was cancelled before completion.";
  }

  return "The request failed while being proxied or upstream.";
}

export function tokenCountSummary(entry: RequestCatalogRow): string {
  const tokenCount = entryTokenCount(entry);

  if (tokenCount === null) {
    return "-";
  }

  const usedLabel = new Intl.NumberFormat("en-US").format(tokenCount);
  return `${usedLabel} tok`;
}

export function maxTokensSummary(entry: RequestCatalogRow): string {
  if (typeof entry.effectiveCompletionTokenLimit === "number") {
    return `${new Intl.NumberFormat("en-US").format(entry.effectiveCompletionTokenLimit)} tok`;
  }

  return "∞";
}

export function tokenRateSummary(entry: RequestCatalogRow): string {
  return formatTokenRate(entry.completionTokensPerSecond) || "-";
}

export function finishReasonSummary(entry: RequestCatalogRow): string {
  return entry.finishReason || "-";
}

export function finishReasonTitle(entry: RequestCatalogRow): string {
  if (entry.finishReason) {
    return describeFinishReason(entry.finishReason);
  }

  if (entry.live) {
    return "No finish reason is available yet because this request has not reached a final backend response state.";
  }

  return "The backend did not report a finish reason for this request.";
}

export function compareRequestEntries(left: RequestCatalogRow, right: RequestCatalogRow, key: RequestSortKey): number {
  if (key === "time") {
    return compareNumberValues(Date.parse(left.time), Date.parse(right.time));
  }

  if (key === "queue") {
    return compareNumberValues(left.queuedMs, right.queuedMs);
  }

  if (key === "latency") {
    return compareNumberValues(left.latencyMs, right.latencyMs);
  }

  if (key === "tokens") {
    return compareNullableNumbers(entryTokenCount(left), entryTokenCount(right));
  }

  if (key === "maxTokens") {
    return compareNullableNumbers(left.effectiveCompletionTokenLimit, right.effectiveCompletionTokenLimit);
  }

  if (key === "rate") {
    return compareNullableNumbers(left.completionTokensPerSecond, right.completionTokensPerSecond);
  }

  if (key === "outcome") {
    return compareTextValues(outcomeLabel(left), outcomeLabel(right));
  }

  if (key === "finishReason") {
    return compareTextValues(left.finishReason ?? "", right.finishReason ?? "");
  }

  if (key === "type") {
    return compareTextValues(left.requestType ?? "", right.requestType ?? "");
  }

  if (key === "request") {
    return compareTextValues(`${left.method} ${left.path} ${left.id}`, `${right.method} ${right.path} ${right.id}`);
  }

  if (key === "model") {
    return compareTextValues(left.model ?? "", right.model ?? "");
  }

  if (key === "backend") {
    return compareTextValues(left.backendName ?? "", right.backendName ?? "");
  }

  return compareTextValues(noteSummary(left), noteSummary(right));
}

export function formatLogDate(value: string): string {
  try {
    return logDateFormatter.format(new Date(value));
  } catch {
    return formatDate(value);
  }
}

export function formatLogTime(value: string): string {
  try {
    return logTimeFormatter.format(new Date(value));
  } catch {
    return "";
  }
}

export function buildOutcomeOptions(entries: RequestCatalogRow[]): Array<{ value: string; label: string }> {
  const options = [{ value: "all", label: "All" }];
  const liveOutcomes = Array.from(
    new Set(
      entries
        .filter((entry) => entry.live)
        .map((entry) => entry.outcome),
    ),
  );

  if (liveOutcomes.includes("queued")) {
    options.push({ value: "queued", label: "Queued" });
  }

  if (liveOutcomes.includes("connected")) {
    options.push({ value: "connected", label: "Connected" });
  }

  if (liveOutcomes.includes("streaming")) {
    options.push({ value: "streaming", label: "Streaming" });
  }

  options.push({ value: "success", label: "Successful" });

  options.push(
    { value: "error", label: "Failed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "rejected", label: "Rejected" },
    { value: "queued_timeout", label: "Queue timeout" },
  );

  return options;
}

export function buildFinishReasonOptions(entries: RequestCatalogRow[]): Array<{ value: string; label: string }> {
  const finishReasons = Array.from(
    new Set(
      entries
        .map((entry) => entry.finishReason)
        .filter((value): value is string => Boolean(value && value.trim().length > 0)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return [
    { value: "all", label: "All finish reasons" },
    { value: "none", label: "None" },
    ...finishReasons.map((finishReason) => ({ value: finishReason, label: finishReason })),
  ];
}

function buildNamedOptions(
  entries: RequestCatalogRow[],
  allLabel: string,
  valueSelector: (entry: RequestCatalogRow) => string | undefined,
): Array<{ value: string; label: string }> {
  const names = Array.from(
    new Set(
      entries
        .map((entry) => valueSelector(entry))
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return [
    { value: "all", label: allLabel },
    ...names.map((name) => ({ value: name, label: name })),
  ];
}

export function buildModelOptions(entries: RequestCatalogRow[]): Array<{ value: string; label: string }> {
  return buildNamedOptions(entries, "All models", (entry) => entry.model);
}

export function buildBackendOptions(entries: RequestCatalogRow[]): Array<{ value: string; label: string }> {
  return buildNamedOptions(entries, "All backends", (entry) => entry.backendName);
}

export function filterRequestEntries(
  entries: RequestCatalogRow[],
  filters: RequestTableFilters,
  shortId: (value: string) => string,
): RequestCatalogRow[] {
  return entries.filter((entry) => {
    if (filters.issues === "problematic" && !hasDiagnosticIssue(entry)) {
      return false;
    }

    if (filters.issues === "clean" && hasDiagnosticIssue(entry)) {
      return false;
    }

    if (!matchesText(filters.time, [formatDate(entry.time), formatLogDate(entry.time), formatLogTime(entry.time), entry.time])) {
      return false;
    }

    if (!matchesOutcomeFilter(entry, filters.outcome)) {
      return false;
    }

    if (filters.finishReason === "none" && entry.finishReason) {
      return false;
    }

    if (filters.finishReason !== "all" && filters.finishReason !== "none" && (entry.finishReason ?? "") !== filters.finishReason) {
      return false;
    }

    if (filters.type !== "all" && (entry.requestType ?? "") !== filters.type) {
      return false;
    }

    if (!matchesText(filters.request, [entry.id, shortId(entry.id), entry.method, entry.path, `${entry.method} ${entry.path}`])) {
      return false;
    }

    if (filters.model !== "all" && (entry.model ?? "") !== filters.model) {
      return false;
    }

    if (filters.backend !== "all" && (entry.backendName ?? "") !== filters.backend) {
      return false;
    }

    if (!matchesNumeric(entry.queuedMs, filters.queueComparator, filters.queueValue)) {
      return false;
    }

    if (!matchesNumeric(entry.latencyMs, filters.latencyComparator, filters.latencyValue)) {
      return false;
    }

    if (!matchesNumeric(entryTokenCount(entry), filters.tokensComparator, filters.tokensValue)) {
      return false;
    }

    if (!matchesNumeric(entry.effectiveCompletionTokenLimit, filters.maxTokensComparator, filters.maxTokensValue)) {
      return false;
    }

    if (!matchesNumeric(entry.completionTokensPerSecond, filters.rateComparator, filters.rateValue)) {
      return false;
    }

    if (!matchesText(filters.note, [noteSummary(entry)])) {
      return false;
    }

    return true;
  });
}

export function sortRequestEntries(
  entries: RequestCatalogRow[],
  sortKey: RequestSortKey | "",
  sortDirection: RequestSortDirection,
): RequestCatalogRow[] {
  if (!sortKey || !sortDirection) {
    return entries;
  }

  const direction = sortDirection === "asc" ? 1 : -1;
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const comparison = compareRequestEntries(left.entry, right.entry, sortKey);
      if (comparison !== 0) {
        return comparison * direction;
      }

      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

export function hasActiveRequestFilters(filters: RequestTableFilters): boolean {
  return (
    filters.issues !== "all" ||
    filters.time.trim().length > 0 ||
    filters.outcome !== "all" ||
    filters.finishReason !== "all" ||
    filters.type !== "all" ||
    filters.request.trim().length > 0 ||
    filters.model !== "all" ||
    filters.backend !== "all" ||
    hasActiveNumericFilter(filters.queueComparator, filters.queueValue) ||
    hasActiveNumericFilter(filters.latencyComparator, filters.latencyValue) ||
    hasActiveNumericFilter(filters.tokensComparator, filters.tokensValue) ||
    hasActiveNumericFilter(filters.maxTokensComparator, filters.maxTokensValue) ||
    hasActiveNumericFilter(filters.rateComparator, filters.rateValue) ||
    filters.note.trim().length > 0
  );
}

export function isRequestFilterActive(filters: RequestTableFilters, filterKey: RequestFilterKey): boolean {
  if (filterKey === "issues") {
    return filters.issues !== "all";
  }

  if (filterKey === "time") {
    return filters.time.trim().length > 0;
  }

  if (filterKey === "outcome") {
    return filters.outcome !== "all";
  }

  if (filterKey === "finishReason") {
    return filters.finishReason !== "all";
  }

  if (filterKey === "type") {
    return filters.type !== "all";
  }

  if (filterKey === "request") {
    return filters.request.trim().length > 0;
  }

  if (filterKey === "model") {
    return filters.model !== "all";
  }

  if (filterKey === "backend") {
    return filters.backend !== "all";
  }

  if (filterKey === "queue") {
    return hasActiveNumericFilter(filters.queueComparator, filters.queueValue);
  }

  if (filterKey === "latency") {
    return hasActiveNumericFilter(filters.latencyComparator, filters.latencyValue);
  }

  if (filterKey === "tokens") {
    return hasActiveNumericFilter(filters.tokensComparator, filters.tokensValue);
  }

  if (filterKey === "maxTokens") {
    return hasActiveNumericFilter(filters.maxTokensComparator, filters.maxTokensValue);
  }

  if (filterKey === "rate") {
    return hasActiveNumericFilter(filters.rateComparator, filters.rateValue);
  }

  return filters.note.trim().length > 0;
}

export function resetRequestFilters(filters: RequestTableFilters): void {
  Object.assign(filters, createRequestTableFilters());
}

export function clearRequestFilter(filters: RequestTableFilters, filterKey: RequestFilterKey): void {
  if (filterKey === "issues") {
    filters.issues = "all";
    return;
  }

  if (filterKey === "time") {
    filters.time = "";
    return;
  }

  if (filterKey === "outcome") {
    filters.outcome = "all";
    return;
  }

  if (filterKey === "finishReason") {
    filters.finishReason = "all";
    return;
  }

  if (filterKey === "type") {
    filters.type = "all";
    return;
  }

  if (filterKey === "request") {
    filters.request = "";
    return;
  }

  if (filterKey === "model") {
    filters.model = "all";
    return;
  }

  if (filterKey === "backend") {
    filters.backend = "all";
    return;
  }

  if (filterKey === "queue") {
    filters.queueComparator = "any";
    filters.queueValue = "";
    return;
  }

  if (filterKey === "latency") {
    filters.latencyComparator = "any";
    filters.latencyValue = "";
    return;
  }

  if (filterKey === "tokens") {
    filters.tokensComparator = "any";
    filters.tokensValue = "";
    return;
  }

  if (filterKey === "maxTokens") {
    filters.maxTokensComparator = "any";
    filters.maxTokensValue = "";
    return;
  }

  if (filterKey === "rate") {
    filters.rateComparator = "any";
    filters.rateValue = "";
    return;
  }

  filters.note = "";
}
