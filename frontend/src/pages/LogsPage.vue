<script setup lang="ts">
import { computed, reactive } from "vue";
import { useDashboardStore } from "../composables/useDashboardStore";
import type { RequestLogEntry } from "../types/dashboard";
import { formatDate, formatDuration, formatTokenRate } from "../utils/formatters";

const store = useDashboardStore();

const filters = reactive({
  search: "",
  outcome: "all",
  backend: "all",
  detail: "all",
  tokenComparator: "any",
  tokenValue: "",
});

const outcomeOptions = [
  { value: "all", label: "All outcomes" },
  { value: "success", label: "Successful" },
  { value: "error", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "queued_timeout", label: "Queue timeout" },
];

const backendOptions = computed(() => {
  const names = Array.from(
    new Set(
      store.state.snapshot.recentRequests
        .map((entry) => entry.backendName)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return [
    { value: "all", label: "All backends" },
    ...names.map((name) => ({ value: name, label: name })),
  ];
});

const detailOptions = [
  { value: "all", label: "All entries" },
  { value: "with-detail", label: "With details" },
  { value: "without-detail", label: "Without details" },
];

const tokenComparatorOptions = [
  { value: "any", label: "Any token count" },
  { value: "gt", label: "More than" },
  { value: "gte", label: "At least" },
  { value: "eq", label: "Exactly" },
  { value: "lte", label: "At most" },
  { value: "lt", label: "Less than" },
];

const filteredEntries = computed(() => {
  const query = filters.search.trim().toLowerCase();
  const tokenValue = filters.tokenValue.trim();
  const parsedTokenValue = tokenValue ? Number(tokenValue) : Number.NaN;
  const hasTokenFilter =
    filters.tokenComparator !== "any" &&
    Number.isFinite(parsedTokenValue) &&
    parsedTokenValue >= 0;

  return store.state.snapshot.recentRequests.filter((entry) => {
    if (filters.outcome !== "all" && entry.outcome !== filters.outcome) {
      return false;
    }

    if (filters.backend !== "all" && (entry.backendName ?? "") !== filters.backend) {
      return false;
    }

    if (filters.detail === "with-detail" && !entry.hasDetail) {
      return false;
    }

    if (filters.detail === "without-detail" && entry.hasDetail) {
      return false;
    }

    if (hasTokenFilter) {
      const tokenCount = entryTokenCount(entry);
      if (tokenCount === null) {
        return false;
      }

      if (filters.tokenComparator === "gt" && !(tokenCount > parsedTokenValue)) {
        return false;
      }

      if (filters.tokenComparator === "gte" && !(tokenCount >= parsedTokenValue)) {
        return false;
      }

      if (filters.tokenComparator === "eq" && tokenCount !== parsedTokenValue) {
        return false;
      }

      if (filters.tokenComparator === "lte" && !(tokenCount <= parsedTokenValue)) {
        return false;
      }

      if (filters.tokenComparator === "lt" && !(tokenCount < parsedTokenValue)) {
        return false;
      }
    }

    if (!query) {
      return true;
    }

    const haystack = [
      entry.id,
      store.shortId(entry.id),
      entry.method,
      entry.path,
      entry.model,
      entry.backendName,
      entry.error,
      entry.finishReason,
      entry.statusCode?.toString(),
      entry.outcome,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
});

function resetFilters(): void {
  filters.search = "";
  filters.outcome = "all";
  filters.backend = "all";
  filters.detail = "all";
  filters.tokenComparator = "any";
  filters.tokenValue = "";
}

function outcomeBadgeClass(entry: RequestLogEntry): string {
  if (entry.outcome === "success") {
    return "badge good";
  }

  if (entry.outcome === "queued_timeout" || entry.outcome === "cancelled") {
    return "badge warn";
  }

  return "badge bad";
}

function outcomeLabel(entry: RequestLogEntry): string {
  if (entry.outcome === "queued_timeout") {
    return "queue timeout";
  }

  return entry.outcome;
}

function tokenSummary(entry: RequestLogEntry): string {
  const tokenCount = entryTokenCount(entry);
  const completion = tokenCount !== null ? `${tokenCount} tok` : "";
  const rate = formatTokenRate(entry.completionTokensPerSecond);

  if (completion && rate) {
    return `${completion} · ${rate}`;
  }

  return completion || rate || "—";
}

function entryTokenCount(entry: RequestLogEntry): number | null {
  if (typeof entry.completionTokens === "number") {
    return entry.completionTokens;
  }

  if (typeof entry.totalTokens === "number") {
    return entry.totalTokens;
  }

  const derived = (entry.contentTokens ?? 0) + (entry.reasoningTokens ?? 0) + (entry.textTokens ?? 0);
  return derived > 0 ? derived : null;
}

function noteSummary(entry: RequestLogEntry): string {
  if (entry.error) {
    return entry.error;
  }

  if (entry.finishReason) {
    return `finish: ${entry.finishReason}`;
  }

  return "—";
}
</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Recent Requests</h2>
        </div>
      </div>

      <div class="log-filters">
        <label class="field">
          <span>Search</span>
          <input
            v-model="filters.search"
            type="search"
            placeholder="Request ID, model, backend, path, error..."
          >
        </label>

        <label class="field">
          <span>Outcome</span>
          <select v-model="filters.outcome">
            <option
              v-for="option in outcomeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Backend</span>
          <select v-model="filters.backend">
            <option
              v-for="option in backendOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Details</span>
          <select v-model="filters.detail">
            <option
              v-for="option in detailOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Tokens</span>
          <select v-model="filters.tokenComparator">
            <option
              v-for="option in tokenComparatorOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Token value</span>
          <input
            v-model="filters.tokenValue"
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 512"
          >
        </label>

        <div class="log-filter-actions">
          <div class="log-filter-count">
            {{ filteredEntries.length }} / {{ store.state.snapshot.recentRequests.length }}
          </div>
          <button
            type="button"
            class="button secondary small"
            @click="resetFilters()"
          >
            Reset
          </button>
        </div>
      </div>

      <div v-if="filteredEntries.length" class="table-wrap">
        <table class="backend-table log-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Outcome</th>
              <th>Request</th>
              <th>Model</th>
              <th>Backend</th>
              <th>HTTP</th>
              <th>Queue</th>
              <th>Latency</th>
              <th>Tokens</th>
              <th>Note</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in filteredEntries"
              :key="entry.id"
            >
              <td class="log-cell-tight">
                <div class="log-primary">{{ formatDate(entry.time) }}</div>
              </td>
              <td class="log-cell-tight">
                <span
                  :class="outcomeBadgeClass(entry)"
                  :title="entry.outcome"
                >
                  {{ outcomeLabel(entry) }}
                </span>
              </td>
              <td>
                <div class="log-primary mono">{{ store.shortId(entry.id) }}</div>
                <div class="log-secondary">{{ entry.method }} {{ entry.path }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ entry.model || "—" }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ entry.backendName || "—" }}</div>
              </td>
              <td class="log-cell-tight">
                <span
                  v-if="entry.statusCode !== undefined"
                  :class="entry.statusCode >= 500 ? 'badge bad' : 'badge good'"
                  :title="`Final upstream status: HTTP ${entry.statusCode}`"
                >
                  {{ entry.statusCode }}
                </span>
                <span v-else class="log-muted">—</span>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ formatDuration(entry.queuedMs) }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ formatDuration(entry.latencyMs) }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ tokenSummary(entry) }}</div>
              </td>
              <td>
                <div class="log-note" :title="noteSummary(entry)">
                  {{ noteSummary(entry) }}
                </div>
              </td>
              <td class="log-cell-tight">
                <button
                  type="button"
                  class="icon-button"
                  :disabled="!entry.hasDetail"
                  :aria-label="entry.hasDetail ? 'Open request details' : 'No request details available'"
                  :title="entry.hasDetail ? 'Open the stored request inspector.' : 'No stored detail is available for this request.'"
                  @click="store.openRequestDetail(entry.id)"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="9"></circle>
                    <path d="M12 10v6"></path>
                    <path d="M12 7.25h.01"></path>
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
