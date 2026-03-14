import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDashboardStore } from "./useDashboardStore";
import {
  buildBackendOptions,
  buildModelOptions,
  buildOutcomeOptions,
  clearRequestFilter,
  createRequestTableFilters,
  diagnosticIssueTitle,
  filterRequestEntries,
  formatLogDate,
  formatLogTime,
  hasDiagnosticIssue,
  hasActiveRequestFilters,
  isRequestFilterActive,
  maxTokensSummary,
  normalizeOutcomeFilterValue,
  noteSummary,
  outcomeBadgeClass,
  outcomeLabel,
  outcomeTitle,
  requestColumnTitles,
  requestFilterIconPath,
  requestIssueFilterOptions,
  requestNumericComparatorOptions,
  requestSortLabels,
  resetRequestFilters,
  sortRequestEntries,
  tokenCountSummary,
  tokenRateSummary,
  type RequestFilterKey,
  type RequestSortDirection,
  type RequestSortKey,
} from "../utils/requests-table";
import {
  buildRequestCatalog,
  type RequestCatalogRow,
} from "../utils/request-catalog";

export type { RequestFilterKey } from "../utils/requests-table";

export function useRequestsTable() {
  const store = useDashboardStore();
  const route = useRoute();
  const router = useRouter();

  const openFilterKey = ref<RequestFilterKey | "">("");
  const sortKey = ref<RequestSortKey | "">("");
  const sortDirection = ref<RequestSortDirection>("");
  const filters = reactive(createRequestTableFilters());

  const tableEntries = computed<RequestCatalogRow[]>(() => buildRequestCatalog(store.state.snapshot));
  const hasActiveFilters = computed(() => hasActiveRequestFilters(filters));
  const outcomeOptions = computed(() => buildOutcomeOptions(tableEntries.value));
  const modelOptions = computed(() => buildModelOptions(tableEntries.value));
  const backendOptions = computed(() => buildBackendOptions(tableEntries.value));
  const issueEntriesCount = computed(() => tableEntries.value.filter((entry) => hasDiagnosticIssue(entry)).length);
  const issuesFilterToggleDisabled = computed(() => issueEntriesCount.value === 0);
  const issuesFilterTitle = computed(() => {
    if (issueEntriesCount.value > 0) {
      return `Filter stored requests by whether llmproxy's heuristic diagnostics flagged them. ${issueEntriesCount.value} problematic request${issueEntriesCount.value === 1 ? "" : "s"} currently retained.`;
    }

    return "No heuristic issues have been detected in the retained request list.";
  });

  const filteredEntries = computed(() => (
    filterRequestEntries(tableEntries.value, filters, store.shortId)
  ));

  const sortedEntries = computed(() => (
    sortRequestEntries(filteredEntries.value, sortKey.value, sortDirection.value)
  ));

  function toggleFilter(filterKey: RequestFilterKey): void {
    openFilterKey.value = openFilterKey.value === filterKey ? "" : filterKey;
  }

  function toggleSort(nextSortKey: RequestSortKey): void {
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

  function isSortedBy(candidate: RequestSortKey): boolean {
    return sortKey.value === candidate && sortDirection.value !== "";
  }

  function sortTitle(candidate: RequestSortKey): string {
    const label = requestSortLabels[candidate];
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
    return isRequestFilterActive(filters, filterKey);
  }

  function resetFilters(): void {
    resetRequestFilters(filters);
    openFilterKey.value = "";
  }

  function clearFilter(filterKey: RequestFilterKey): void {
    clearRequestFilter(filters, filterKey);
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
    columnTitles: requestColumnTitles,
    diagnosticIssueTitle,
    filterIconPath: requestFilterIconPath,
    filters,
    filteredEntries,
    formatLogDate,
    formatLogTime,
    hasActiveFilters,
    hasDiagnosticIssue,
    issueFilterOptions: requestIssueFilterOptions,
    isFilterActive,
    isFilterOpen,
    isSortedBy,
    issueEntriesCount,
    issuesFilterTitle,
    issuesFilterToggleDisabled,
    maxTokensSummary,
    modelOptions,
    noteSummary,
    numericComparatorOptions: requestNumericComparatorOptions,
    outcomeBadgeClass,
    outcomeLabel,
    outcomeOptions,
    outcomeTitle,
    resetFilters,
    sortTitle,
    sortedEntries,
    tableEntries,
    toggleFilter,
    toggleSort,
    tokenCountSummary,
    tokenRateSummary,
  };
}
