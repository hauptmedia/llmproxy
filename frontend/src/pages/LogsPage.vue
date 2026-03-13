<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useDashboardStore } from "../composables/useDashboardStore";
import type { ActiveConnectionSnapshot, RequestLogEntry } from "../types/dashboard";
import { describeFinishReason } from "../utils/dashboard-badges";
import { formatDate, formatDuration, formatTokenRate } from "../utils/formatters";

const store = useDashboardStore();
type FilterKey =
  | "time"
  | "outcome"
  | "request"
  | "model"
  | "backend"
  | "queue"
  | "latency"
  | "tokens"
  | "rate"
  | "note";
type SortKey = Exclude<FilterKey, never>;
type SortDirection = "asc" | "desc" | "";
type RowOutcome = RequestLogEntry["outcome"] | "queued" | "connected" | "streaming";

interface RecentRequestRow {
  id: string;
  time: string;
  method: string;
  path: string;
  model?: string;
  backendName?: string;
  backendId?: string;
  outcome: RowOutcome;
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
  finishReason?: string;
  hasDetail: boolean;
  live: boolean;
}

const openFilterKey = ref<FilterKey | "">("");
const sortKey = ref<SortKey | "">("");
const sortDirection = ref<SortDirection>("");
const filterIconPath = [
  "M4 6h16",
  "M7 12h10",
  "M10 18h4",
];

const filters = reactive({
  time: "",
  outcome: "all",
  request: "",
  model: "all",
  backend: "all",
  queueComparator: "any",
  queueValue: "",
  latencyComparator: "any",
  latencyValue: "",
  tokensComparator: "any",
  tokensValue: "",
  rateComparator: "any",
  rateValue: "",
  note: "",
});

const numericComparatorOptions = [
  { value: "any", label: "Any" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "eq", label: "=" },
  { value: "lte", label: "<=" },
  { value: "lt", label: "<" },
];

const columnTitles: Record<FilterKey | "action", string> = {
  time: "When llmproxy first saw this request. Live rows update in place until they finish and move into retained history.",
  outcome: "Current live state or final request result. Finished successful requests show their backend finish reason instead of a generic success label.",
  request: "Short request identifier plus the proxied API route that was called.",
  model: "Model name requested by the client.",
  backend: "Backend that currently handles or finally handled the request.",
  queue: "Time the request spent waiting for a free backend slot before execution began, or the current wait time while it is still queued.",
  latency: "Total end-to-end request duration so far for live rows, or final duration for retained history.",
  tokens: "Generated completion tokens for this request. Falls back to other stored token totals when needed.",
  rate: "Generation speed in tokens per second, when available from live or final metrics.",
  note: "Error text or other noteworthy final detail recorded for this request.",
  action: "Open the request debugger for this entry when detailed request data is available.",
};

const tableEntries = computed<RecentRequestRow[]>(() => {
  const rows = new Map<string, RecentRequestRow>();

  for (const connection of store.state.snapshot.activeConnections) {
    rows.set(connection.id, normalizeActiveConnectionRow(connection));
  }

  for (const entry of store.state.snapshot.recentRequests) {
    if (rows.has(entry.id)) {
      continue;
    }

    rows.set(entry.id, normalizeRequestLogRow(entry));
  }

  return Array.from(rows.values());
});

const outcomeOptions = computed(() => {
  const options = [{ value: "all", label: "All outcomes" }];
  const liveOutcomes = Array.from(
    new Set(
      tableEntries.value
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

  const finishReasons = Array.from(
    new Set(
      tableEntries.value
        .filter((entry) => entry.outcome === "success" && typeof entry.finishReason === "string" && entry.finishReason.length > 0)
        .map((entry) => entry.finishReason as string),
    ),
  ).sort((left, right) => left.localeCompare(right));

  for (const finishReason of finishReasons) {
    options.push({
      value: finishOutcomeKey(finishReason),
      label: `Finish: ${finishReason}`,
    });
  }

  if (tableEntries.value.some((entry) => entry.outcome === "success" && !entry.finishReason)) {
    options.push({ value: "completed", label: "Completed" });
  }

  options.push(
    { value: "error", label: "Failed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "queued_timeout", label: "Queue timeout" },
  );

  return options;
});

const modelOptions = computed(() => {
  const names = Array.from(
    new Set(
      tableEntries.value
        .map((entry) => entry.model)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return [
    { value: "all", label: "All models" },
    ...names.map((name) => ({ value: name, label: name })),
  ];
});

const backendOptions = computed(() => {
  const names = Array.from(
    new Set(
      tableEntries.value
        .map((entry) => entry.backendName)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return [
    { value: "all", label: "All backends" },
    ...names.map((name) => ({ value: name, label: name })),
  ];
});

const filteredEntries = computed(() => {
  return tableEntries.value.filter((entry) => {
    if (!matchesText(filters.time, [formatDate(entry.time), entry.time])) {
      return false;
    }

    if (filters.outcome !== "all" && logOutcomeKey(entry) !== filters.outcome) {
      return false;
    }

    if (!matchesText(filters.request, [entry.id, store.shortId(entry.id), entry.method, entry.path, `${entry.method} ${entry.path}`])) {
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

    if (!matchesNumeric(entry.completionTokensPerSecond, filters.rateComparator, filters.rateValue)) {
      return false;
    }

    if (!matchesText(filters.note, [noteSummary(entry)])) {
      return false;
    }

    return true;
  });
});

const sortedEntries = computed(() => {
  if (!sortKey.value || !sortDirection.value) {
    return filteredEntries.value;
  }

  const activeSortKey = sortKey.value;
  const direction = sortDirection.value === "asc" ? 1 : -1;

  return filteredEntries.value
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const comparison = compareEntries(left.entry, right.entry, activeSortKey);
      if (comparison !== 0) {
        return comparison * direction;
      }

      return left.index - right.index;
    })
    .map(({ entry }) => entry);
});

function normalizeRequestLogRow(entry: RequestLogEntry): RecentRequestRow {
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
    finishReason: entry.finishReason,
    hasDetail: Boolean(entry.hasDetail),
    live: false,
  };
}

function normalizeActiveConnectionRow(connection: ActiveConnectionSnapshot): RecentRequestRow {
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
    finishReason: connection.finishReason,
    hasDetail: Boolean(connection.hasDetail),
    live: true,
  };
}

function toggleFilter(filterKey: FilterKey): void {
  openFilterKey.value = openFilterKey.value === filterKey ? "" : filterKey;
}

function toggleSort(nextSortKey: SortKey): void {
  if (sortKey.value !== nextSortKey) {
    sortKey.value = nextSortKey;
    sortDirection.value = nextSortKey === "time" ? "desc" : "asc";
    return;
  }

  if (sortDirection.value === "asc") {
    sortDirection.value = "desc";
    return;
  }

  if (sortDirection.value === "desc") {
    sortKey.value = "";
    sortDirection.value = "";
    return;
  }

  sortDirection.value = nextSortKey === "time" ? "desc" : "asc";
}

function isSortedBy(candidate: SortKey): boolean {
  return sortKey.value === candidate && sortDirection.value !== "";
}

function sortIndicator(candidate: SortKey): string {
  if (sortKey.value !== candidate || !sortDirection.value) {
    return "?";
  }

  return sortDirection.value === "asc" ? "?" : "?";
}

function sortTitle(candidate: SortKey): string {
  const label = candidate === "rate" ? "tok/s" : candidate;
  if (sortKey.value !== candidate || !sortDirection.value) {
    return `Sort by ${label}.`;
  }

  return sortDirection.value === "asc"
    ? `Sorted ascending by ${label}. Click to sort descending.`
    : `Sorted descending by ${label}. Click again to clear sorting.`;
}

function isFilterOpen(filterKey: FilterKey): boolean {
  return openFilterKey.value === filterKey;
}

function isFilterActive(filterKey: FilterKey): boolean {
  if (filterKey === "time") {
    return filters.time.trim().length > 0;
  }

  if (filterKey === "outcome") {
    return filters.outcome !== "all";
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
    return filters.queueComparator !== "any" && filters.queueValue.trim().length > 0;
  }

  if (filterKey === "latency") {
    return filters.latencyComparator !== "any" && filters.latencyValue.trim().length > 0;
  }

  if (filterKey === "tokens") {
    return filters.tokensComparator !== "any" && filters.tokensValue.trim().length > 0;
  }

  if (filterKey === "rate") {
    return filters.rateComparator !== "any" && filters.rateValue.trim().length > 0;
  }

  if (filterKey === "note") {
    return filters.note.trim().length > 0;
  }

  return false;
}

function resetFilters(): void {
  filters.time = "";
  filters.outcome = "all";
  filters.request = "";
  filters.model = "all";
  filters.backend = "all";
  filters.queueComparator = "any";
  filters.queueValue = "";
  filters.latencyComparator = "any";
  filters.latencyValue = "";
  filters.tokensComparator = "any";
  filters.tokensValue = "";
  filters.rateComparator = "any";
  filters.rateValue = "";
  filters.note = "";
  openFilterKey.value = "";
}

function clearFilter(filterKey: FilterKey): void {
  if (filterKey === "time") {
    filters.time = "";
    return;
  }

  if (filterKey === "outcome") {
    filters.outcome = "all";
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

  if (filterKey === "rate") {
    filters.rateComparator = "any";
    filters.rateValue = "";
    return;
  }

  if (filterKey === "note") {
    filters.note = "";
  }
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

function compareEntries(left: RecentRequestRow, right: RecentRequestRow, key: SortKey): number {
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

  if (key === "rate") {
    return compareNullableNumbers(left.completionTokensPerSecond, right.completionTokensPerSecond);
  }

  if (key === "outcome") {
    return compareTextValues(outcomeLabel(left), outcomeLabel(right));
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

function compareNumberValues(left: number, right: number): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function compareTextValues(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function outcomeBadgeClass(entry: RecentRequestRow): string {
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

function outcomeLabel(entry: RecentRequestRow): string {
  if (entry.outcome === "queued") {
    return "queued";
  }

  if (entry.outcome === "connected") {
    return "connected";
  }

  if (entry.outcome === "streaming") {
    return "streaming";
  }

  if (entry.outcome === "success" && entry.finishReason) {
    return entry.finishReason;
  }

  if (entry.outcome === "success") {
    return "completed";
  }

  if (entry.outcome === "queued_timeout") {
    return "queue timeout";
  }

  return entry.outcome;
}

function outcomeTitle(entry: RecentRequestRow): string {
  if (entry.outcome === "queued") {
    return "This live request is still waiting in the scheduler queue for a free backend slot.";
  }

  if (entry.outcome === "connected") {
    return "This live request already has a backend assigned, but the response has not started streaming yet.";
  }

  if (entry.outcome === "streaming") {
    return "This live request is currently streaming or actively generating.";
  }

  if (entry.outcome === "success" && entry.finishReason) {
    return describeFinishReason(entry.finishReason);
  }

  if (entry.outcome === "success") {
    return "The request completed successfully, but the backend did not report a finish reason.";
  }

  if (entry.outcome === "queued_timeout") {
    return "The request timed out while waiting in the queue.";
  }

  if (entry.outcome === "cancelled") {
    return "The request was cancelled before completion.";
  }

  return "The request failed while being proxied or upstream.";
}

function finishOutcomeKey(finishReason: string): string {
  return `finish:${finishReason}`;
}

function logOutcomeKey(entry: RecentRequestRow): string {
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

function tokenCountSummary(entry: RecentRequestRow): string {
  const tokenCount = entryTokenCount(entry);
  return tokenCount !== null ? `${tokenCount} tok` : "-";
}

function tokenRateSummary(entry: RecentRequestRow): string {
  return formatTokenRate(entry.completionTokensPerSecond) || "-";
}

function entryTokenCount(entry: RecentRequestRow): number | null {
  if (typeof entry.completionTokens === "number") {
    return entry.completionTokens;
  }

  if (typeof entry.totalTokens === "number") {
    return entry.totalTokens;
  }

  const derived = (entry.contentTokens ?? 0) + (entry.reasoningTokens ?? 0) + (entry.textTokens ?? 0);
  return derived > 0 ? derived : null;
}

function noteSummary(entry: RecentRequestRow): string {
  return entry.error || "";
}

function handleDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  if (!target.closest(".log-header-filter")) {
    openFilterKey.value = "";
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
});
</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Requests ({{ store.state.snapshot.recentRequestLimit }})</h2>
        </div>
        <div class="log-toolbar">
          <div class="log-filter-count">
            {{ filteredEntries.length }} / {{ tableEntries.length }}
          </div>
          <button
            type="button"
            class="button secondary small"
            @click="resetFilters()"
          >
            Reset Filters
          </button>
        </div>
      </div>

      <div v-if="sortedEntries.length" class="table-wrap log-table-wrap">
        <table class="backend-table log-table">
          <colgroup>
            <col class="log-col-time">
            <col class="log-col-outcome">
          <col class="log-col-request">
          <col class="log-col-model">
          <col class="log-col-backend">
          <col class="log-col-queue">
          <col class="log-col-latency">
          <col class="log-col-tokens">
            <col class="log-col-token-rate">
            <col class="log-col-note">
            <col class="log-col-action">
          </colgroup>
          <thead>
            <tr>
              <th>
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('time') }" :title="sortTitle('time')" @click="toggleSort('time')">
                      <span class="log-header-label" :title="columnTitles.time">Time</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('time') }}</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('time') }" title="Filter time" @click.stop="toggleFilter('time')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('time')" class="table-filter-popover" @click.stop>
                    <input v-model="filters.time" class="table-filter-input" type="search" placeholder="Date / time">
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('time')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th>
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('outcome') }" :title="sortTitle('outcome')" @click="toggleSort('outcome')">
                      <span class="log-header-label" :title="columnTitles.outcome">Outcome</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('outcome') }}</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('outcome') }" title="Filter outcome" @click.stop="toggleFilter('outcome')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('outcome')" class="table-filter-popover" @click.stop>
                    <select v-model="filters.outcome" class="table-filter-select">
                      <option v-for="option in outcomeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('outcome')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th>
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('request') }" :title="sortTitle('request')" @click="toggleSort('request')">
                      <span class="log-header-label" :title="columnTitles.request">Request</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('request') }}</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('request') }" title="Filter request" @click.stop="toggleFilter('request')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('request')" class="table-filter-popover" @click.stop>
                    <input v-model="filters.request" class="table-filter-input" type="search" placeholder="ID / path">
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('request')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th>
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('model') }" :title="sortTitle('model')" @click="toggleSort('model')">
                      <span class="log-header-label" :title="columnTitles.model">Model</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('model') }}</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('model') }" title="Filter model" @click.stop="toggleFilter('model')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('model')" class="table-filter-popover" @click.stop>
                    <select v-model="filters.model" class="table-filter-select">
                      <option v-for="option in modelOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('model')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th>
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('backend') }" :title="sortTitle('backend')" @click="toggleSort('backend')">
                      <span class="log-header-label" :title="columnTitles.backend">Backend</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('backend') }}</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('backend') }" title="Filter backend" @click.stop="toggleFilter('backend')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('backend')" class="table-filter-popover" @click.stop>
                    <select v-model="filters.backend" class="table-filter-select">
                      <option v-for="option in backendOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('backend')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th>
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('queue') }" :title="sortTitle('queue')" @click="toggleSort('queue')">
                      <span class="log-header-label" :title="columnTitles.queue">Queue</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('queue') }}</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('queue') }" title="Filter queue" @click.stop="toggleFilter('queue')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('queue')" class="table-filter-popover" @click.stop>
                    <div class="table-filter-number">
                      <select v-model="filters.queueComparator" class="table-filter-select">
                        <option v-for="option in numericComparatorOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                      </select>
                      <input v-model="filters.queueValue" class="table-filter-input" type="number" min="0" step="1" placeholder="ms">
                    </div>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('queue')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th>
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('latency') }" :title="sortTitle('latency')" @click="toggleSort('latency')">
                      <span class="log-header-label" :title="columnTitles.latency">Latency</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('latency') }}</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('latency') }" title="Filter latency" @click.stop="toggleFilter('latency')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('latency')" class="table-filter-popover" @click.stop>
                    <div class="table-filter-number">
                      <select v-model="filters.latencyComparator" class="table-filter-select">
                        <option v-for="option in numericComparatorOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                      </select>
                      <input v-model="filters.latencyValue" class="table-filter-input" type="number" min="0" step="1" placeholder="ms">
                    </div>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('latency')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th>
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('tokens') }" :title="sortTitle('tokens')" @click="toggleSort('tokens')">
                      <span class="log-header-label" :title="columnTitles.tokens">Tokens</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('tokens') }}</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('tokens') }" title="Filter tokens" @click.stop="toggleFilter('tokens')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('tokens')" class="table-filter-popover" @click.stop>
                    <div class="table-filter-number">
                      <select v-model="filters.tokensComparator" class="table-filter-select">
                        <option v-for="option in numericComparatorOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                      </select>
                      <input v-model="filters.tokensValue" class="table-filter-input" type="number" min="0" step="1" placeholder="tok">
                    </div>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('tokens')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th>
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('rate') }" :title="sortTitle('rate')" @click="toggleSort('rate')">
                      <span class="log-header-label" :title="columnTitles.rate">tok/s</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('rate') }}</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('rate') }" title="Filter token rate" @click.stop="toggleFilter('rate')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('rate')" class="table-filter-popover" @click.stop>
                    <div class="table-filter-number">
                      <select v-model="filters.rateComparator" class="table-filter-select">
                        <option v-for="option in numericComparatorOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                      </select>
                      <input v-model="filters.rateValue" class="table-filter-input" type="number" min="0" step="0.1" placeholder="tok/s">
                    </div>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('rate')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th>
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('note') }" :title="sortTitle('note')" @click="toggleSort('note')">
                      <span class="log-header-label" :title="columnTitles.note">Note</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('note') }}</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('note') }" title="Filter note" @click.stop="toggleFilter('note')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('note')" class="table-filter-popover" @click.stop>
                    <input v-model="filters.note" class="table-filter-input" type="search" placeholder="Error text">
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('note')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th :title="columnTitles.action">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in sortedEntries"
              :key="entry.id"
            >
              <td class="log-cell-tight">
                <div class="log-primary">{{ formatDate(entry.time) }}</div>
              </td>
              <td class="log-cell-tight">
                <span
                  :class="outcomeBadgeClass(entry)"
                  :title="outcomeTitle(entry)"
                >
                  {{ outcomeLabel(entry) }}
                </span>
              </td>
              <td>
                <div class="log-primary mono">{{ store.shortId(entry.id) }}</div>
                <div class="log-secondary">{{ entry.method }} {{ entry.path }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ entry.model || "-" }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ entry.backendName || "-" }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ formatDuration(entry.queuedMs) }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ formatDuration(entry.latencyMs) }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ tokenCountSummary(entry) }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ tokenRateSummary(entry) }}</div>
              </td>
              <td>
                <div class="log-note" :title="noteSummary(entry) || 'No note.'">
                  {{ noteSummary(entry) || "-" }}
                </div>
              </td>
              <td class="log-cell-tight">
                <button
                  type="button"
                  class="icon-button compact"
                  :disabled="!entry.hasDetail"
                  :aria-label="entry.hasDetail ? 'Open request details' : 'No request details available'"
                  :title="entry.hasDetail ? 'Open the stored request inspector.' : 'No stored detail is available for this request.'"
                  @click="store.openRequestDetail(entry.id)"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2.5 12s3.7-6 9.5-6 9.5 6 9.5 6-3.7 6-9.5 6-9.5-6-9.5-6Z"></path>
                    <circle cx="12" cy="12" r="2.8"></circle>
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty">No requests match the current filters.</div>
    </div>
  </section>
</template>
