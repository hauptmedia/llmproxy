import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDashboardStore } from "./useDashboardStore";
import { describeFinishReason } from "../utils/dashboard-badges";
import { formatDate, formatTokenRate } from "../utils/formatters";
import {
  buildRequestCatalog,
  type RequestCatalogRow,
} from "../utils/request-catalog";

export type RequestFilterKey =
  | "time"
  | "outcome"
  | "request"
  | "model"
  | "backend"
  | "queue"
  | "latency"
  | "tokens"
  | "maxTokens"
  | "rate"
  | "note";

type SortKey = RequestFilterKey;
type SortDirection = "asc" | "desc" | "";

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

function normalizeOutcomeFilterValue(value: unknown): string {
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

function entryTokenCount(entry: RequestCatalogRow): number | null {
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

function noteSummary(entry: RequestCatalogRow): string {
  return entry.error || "";
}

function matchesOutcomeFilter(entry: RequestCatalogRow, filterValue: string): boolean {
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

function outcomeBadgeClass(entry: RequestCatalogRow): string {
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

function outcomeLabel(entry: RequestCatalogRow): string {
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

function outcomeTitle(entry: RequestCatalogRow): string {
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

function tokenCountSummary(entry: RequestCatalogRow): string {
  const tokenCount = entryTokenCount(entry);

  if (tokenCount === null) {
    return "-";
  }

  const usedLabel = new Intl.NumberFormat("en-US").format(tokenCount);
  return `${usedLabel} tok`;
}

function maxTokensSummary(entry: RequestCatalogRow): string {
  if (typeof entry.effectiveCompletionTokenLimit === "number") {
    return `${new Intl.NumberFormat("en-US").format(entry.effectiveCompletionTokenLimit)} tok`;
  }

  return "∞";
}

function tokenRateSummary(entry: RequestCatalogRow): string {
  return formatTokenRate(entry.completionTokensPerSecond) || "-";
}

function compareEntries(left: RequestCatalogRow, right: RequestCatalogRow, key: SortKey): number {
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

function formatLogDate(value: string): string {
  try {
    return logDateFormatter.format(new Date(value));
  } catch {
    return formatDate(value);
  }
}

function formatLogTime(value: string): string {
  try {
    return logTimeFormatter.format(new Date(value));
  } catch {
    return "";
  }
}

export function useRequestsTable() {
  const store = useDashboardStore();
  const route = useRoute();
  const router = useRouter();

  const openFilterKey = ref<RequestFilterKey | "">("");
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
    maxTokensComparator: "any",
    maxTokensValue: "",
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

  const columnTitles: Record<RequestFilterKey | "action", string> = {
    time: "When llmproxy first saw this request. Live rows update in place until they finish and move into retained history.",
    outcome: "Current live state or final request result. Finished successful requests show their backend finish reason instead of a generic success label.",
    request: "Short request identifier plus the proxied API route that was called.",
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

  const tableEntries = computed<RequestCatalogRow[]>(() => buildRequestCatalog(store.state.snapshot));

  const hasActiveFilters = computed(() => (
    filters.time.trim().length > 0 ||
    filters.outcome !== "all" ||
    filters.request.trim().length > 0 ||
    filters.model !== "all" ||
    filters.backend !== "all" ||
    filters.queueComparator !== "any" ||
    filters.queueValue.trim().length > 0 ||
    filters.latencyComparator !== "any" ||
    filters.latencyValue.trim().length > 0 ||
    filters.tokensComparator !== "any" ||
    filters.tokensValue.trim().length > 0 ||
    filters.maxTokensComparator !== "any" ||
    filters.maxTokensValue.trim().length > 0 ||
    filters.rateComparator !== "any" ||
    filters.rateValue.trim().length > 0 ||
    filters.note.trim().length > 0
  ));

  const outcomeOptions = computed(() => {
    const options = [{ value: "all", label: "All" }];
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

    options.push({ value: "success", label: "Successful" });

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
      { value: "rejected", label: "Rejected" },
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
      if (!matchesText(filters.time, [formatDate(entry.time), formatLogDate(entry.time), formatLogTime(entry.time), entry.time])) {
        return false;
      }

      if (!matchesOutcomeFilter(entry, filters.outcome)) {
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

  function toggleFilter(filterKey: RequestFilterKey): void {
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
    const labelMap: Record<SortKey, string> = {
      time: "time",
      outcome: "status",
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
    const label = labelMap[candidate];
    if (sortKey.value !== candidate || !sortDirection.value) {
      return `Sort by ${label}.`;
    }

    return sortDirection.value === "asc"
      ? `Sorted ascending by ${label}. Click to sort descending.`
      : `Sorted descending by ${label}. Click again to clear sorting.`;
  }

  function isFilterOpen(filterKey: RequestFilterKey): boolean {
    return openFilterKey.value === filterKey;
  }

  function isFilterActive(filterKey: RequestFilterKey): boolean {
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

    if (filterKey === "maxTokens") {
      return filters.maxTokensComparator !== "any" && filters.maxTokensValue.trim().length > 0;
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
    filters.maxTokensComparator = "any";
    filters.maxTokensValue = "";
    filters.rateComparator = "any";
    filters.rateValue = "";
    filters.note = "";
    openFilterKey.value = "";
  }

  function clearFilter(filterKey: RequestFilterKey): void {
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

    if (filterKey === "note") {
      filters.note = "";
    }
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

  watch(
    () => route.query.outcome,
    (queryValue) => {
      const normalized = normalizeOutcomeFilterValue(queryValue);
      if (filters.outcome !== normalized) {
        filters.outcome = normalized;
      }
    },
    { immediate: true },
  );

  watch(
    () => filters.outcome,
    (value) => {
      const normalizedRouteOutcome = normalizeOutcomeFilterValue(route.query.outcome);
      if (value === normalizedRouteOutcome) {
        return;
      }

      const nextQuery = { ...route.query };
      if (value === "all") {
        delete nextQuery.outcome;
      } else {
        nextQuery.outcome = value;
      }

      void router.replace({ query: nextQuery });
    },
  );

  onMounted(() => {
    document.addEventListener("pointerdown", handleDocumentPointerDown);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
  });

  return {
    backendOptions,
    clearFilter,
    columnTitles,
    filterIconPath,
    filters,
    filteredEntries,
    formatLogDate,
    formatLogTime,
    hasActiveFilters,
    isFilterActive,
    isFilterOpen,
    isSortedBy,
    maxTokensSummary,
    modelOptions,
    noteSummary,
    numericComparatorOptions,
    outcomeBadgeClass,
    outcomeLabel,
    outcomeOptions,
    outcomeTitle,
    resetFilters,
    sortIndicator,
    sortTitle,
    sortedEntries,
    tableEntries,
    toggleFilter,
    toggleSort,
    tokenCountSummary,
    tokenRateSummary,
  };
}
