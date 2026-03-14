<script setup lang="ts">
import { useDashboardStore } from "../composables/useDashboardStore";
import { useRequestsTable } from "../composables/useRequestsTable";
import { formatDuration } from "../utils/formatters";

const store = useDashboardStore();
const {
  backendOptions,
  clearFilter,
  columnTitles,
  diagnosticIssueTitle,
  filterIconPath,
  finishReasonOptions,
  finishReasonSummary,
  finishReasonTitle,
  filters,
  filteredEntries,
  formatLogDate,
  formatLogTime,
  hasActiveFilters,
  hasDiagnosticIssue,
  issueFilterOptions,
  isFilterActive,
  isFilterOpen,
  isSortedBy,
  issuesFilterTitle,
  maxTokensSummary,
  modelOptions,
  noteSummary,
  numericComparatorOptions,
  outcomeBadgeClass,
  outcomeLabel,
  outcomeOptions,
  outcomeTitle,
  resetFilters,
  sortTitle,
  sortedEntries,
  tableEntries,
  typeOptions,
  toggleFilter,
  toggleSort,
  tokenCountSummary,
  tokenRateSummary,
} = useRequestsTable();
</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Requests (last {{ store.state.snapshot.recentRequestLimit }})</h2>
        </div>
        <div class="log-toolbar">
          <div class="log-filter-count">
            {{ filteredEntries.length }} / {{ tableEntries.length }}
          </div>
          <button
            v-if="hasActiveFilters"
            type="button"
            class="icon-button compact"
            title="Reset all request filters"
            aria-label="Reset all request filters"
            @click="resetFilters()"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 4.75h6"></path>
              <path d="M4.75 7.5h14.5"></path>
              <path d="M7.5 7.5 8.2 17a2 2 0 0 0 2 1.85h3.6a2 2 0 0 0 2-1.85l.7-9.5"></path>
              <path d="M10 11v4.5"></path>
              <path d="M14 11v4.5"></path>
            </svg>
          </button>
        </div>
      </div>

      <div v-if="sortedEntries.length" class="table-wrap log-table-wrap">
        <table class="backend-table log-table">
          <colgroup>
            <col class="log-col-issue">
            <col class="log-col-time">
            <col class="log-col-outcome">
            <col class="log-col-finish-reason">
            <col class="log-col-type">
            <col class="log-col-request">
            <col class="log-col-model">
            <col class="log-col-backend">
            <col class="log-col-queue">
            <col class="log-col-latency">
            <col class="log-col-tokens">
            <col class="log-col-max-tokens">
            <col class="log-col-token-rate">
            <col class="log-col-note">
            <col class="log-col-action">
          </colgroup>
          <thead>
            <tr>
              <th class="log-issue-header-cell" :title="columnTitles.issues">
                <div class="log-header-filter">
                  <div class="log-header-cell log-issue-header-content">
                    <button
                      type="button"
                      class="log-filter-trigger"
                      :class="{ active: isFilterActive('issues') }"
                      :title="issuesFilterTitle"
                      aria-label="Filter problematic requests"
                      @click.stop="toggleFilter('issues')"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('issues')" class="table-filter-popover" @click.stop>
                    <select v-model="filters.issues" class="table-filter-select">
                      <option v-for="option in issueFilterOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('issues')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th :title="columnTitles.time">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('time') }" :title="sortTitle('time')" @click="toggleSort('time')">
                      <span class="log-header-label">Time</span>
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
              <th :title="columnTitles.outcome">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('outcome') }" :title="sortTitle('outcome')" @click="toggleSort('outcome')">
                      <span class="log-header-label">Status</span>
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
              <th :title="columnTitles.finishReason">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('finishReason') }" :title="sortTitle('finishReason')" @click="toggleSort('finishReason')">
                      <span class="log-header-label">Finish reason</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('finishReason') }" title="Filter finish reason" @click.stop="toggleFilter('finishReason')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('finishReason')" class="table-filter-popover" @click.stop>
                    <select v-model="filters.finishReason" class="table-filter-select">
                      <option v-for="option in finishReasonOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('finishReason')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th :title="columnTitles.type">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('type') }" :title="sortTitle('type')" @click="toggleSort('type')">
                      <span class="log-header-label">Type</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('type') }" title="Filter request type" @click.stop="toggleFilter('type')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('type')" class="table-filter-popover" @click.stop>
                    <select v-model="filters.type" class="table-filter-select">
                      <option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('type')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th :title="columnTitles.request">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('request') }" :title="sortTitle('request')" @click="toggleSort('request')">
                      <span class="log-header-label">Request</span>
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
              <th :title="columnTitles.model">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('model') }" :title="sortTitle('model')" @click="toggleSort('model')">
                      <span class="log-header-label">Model</span>
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
              <th :title="columnTitles.backend">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('backend') }" :title="sortTitle('backend')" @click="toggleSort('backend')">
                      <span class="log-header-label">Backend</span>
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
              <th :title="columnTitles.queue">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('queue') }" :title="sortTitle('queue')" @click="toggleSort('queue')">
                      <span class="log-header-label">Queued</span>
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
              <th :title="columnTitles.latency">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('latency') }" :title="sortTitle('latency')" @click="toggleSort('latency')">
                      <span class="log-header-label">Latency</span>
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
              <th :title="columnTitles.tokens">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('tokens') }" :title="sortTitle('tokens')" @click="toggleSort('tokens')">
                      <span class="log-header-label">Tokens</span>
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
              <th :title="columnTitles.maxTokens">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('maxTokens') }" :title="sortTitle('maxTokens')" @click="toggleSort('maxTokens')">
                      <span class="log-header-label">Max tokens</span>
                    </button>
                    <button type="button" class="log-filter-trigger" :class="{ active: isFilterActive('maxTokens') }" title="Filter max tokens" @click.stop="toggleFilter('maxTokens')">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="segment in filterIconPath" :key="segment" :d="segment"></path>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isFilterOpen('maxTokens')" class="table-filter-popover" @click.stop>
                    <div class="table-filter-number">
                      <select v-model="filters.maxTokensComparator" class="table-filter-select">
                        <option v-for="option in numericComparatorOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                      </select>
                      <input v-model="filters.maxTokensValue" class="table-filter-input" type="number" min="0" step="1" placeholder="tok">
                    </div>
                    <div class="table-filter-actions">
                      <button type="button" class="button secondary small" @click="clearFilter('maxTokens')">Clear</button>
                    </div>
                  </div>
                </div>
              </th>
              <th :title="columnTitles.rate">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('rate') }" :title="sortTitle('rate')" @click="toggleSort('rate')">
                      <span class="log-header-label">tok/s</span>
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
              <th :title="columnTitles.note">
                <div class="log-header-filter">
                  <div class="log-header-cell">
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('note') }" :title="sortTitle('note')" @click="toggleSort('note')">
                      <span class="log-header-label">Note</span>
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
              <th class="log-action-header" :title="columnTitles.action"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in sortedEntries"
              :key="entry.id"
            >
              <td class="log-cell-tight log-issue-cell">
                <span
                  v-if="hasDiagnosticIssue(entry)"
                  class="log-warning-indicator"
                  :title="diagnosticIssueTitle(entry)"
                  aria-label="Heuristic issue detected"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 3.5 21 19H3L12 3.5Z"></path>
                    <path d="M12 9v4.5"></path>
                    <circle cx="12" cy="16.75" r="0.75" fill="currentColor" stroke="none"></circle>
                  </svg>
                </span>
                <span v-else class="log-warning-placeholder" aria-hidden="true"></span>
              </td>
              <td class="log-cell-tight">
                <div class="log-time-stack">
                  <div class="log-time-date">{{ formatLogDate(entry.time) }}</div>
                  <div class="log-time-clock">{{ formatLogTime(entry.time) }}</div>
                </div>
              </td>
              <td class="log-cell-tight">
                <span
                  :class="outcomeBadgeClass(entry)"
                  :title="outcomeTitle(entry)"
                >
                  {{ outcomeLabel(entry) }}
                </span>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary" :title="finishReasonTitle(entry)">{{ finishReasonSummary(entry) }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ entry.requestType || "-" }}</div>
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
                <div class="log-primary">{{ maxTokensSummary(entry) }}</div>
              </td>
              <td class="log-cell-tight">
                <div class="log-primary">{{ tokenRateSummary(entry) }}</div>
              </td>
              <td>
                <div class="log-note" :title="noteSummary(entry) || 'No note.'">
                  {{ noteSummary(entry) || "-" }}
                </div>
              </td>
              <td class="log-cell-tight log-action-cell">
                <div class="log-action-content">
                  <button
                    type="button"
                    class="icon-button compact"
                    :disabled="!entry.hasDetail"
                    :aria-label="entry.hasDetail ? 'Open request details' : 'No request details available'"
                    :title="entry.hasDetail ? 'Open the stored request inspector.' : 'No stored detail is available for this request.'"
                    @click="store.openRequestDetail(entry.id)"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 6.5V5.25a3 3 0 0 1 6 0V6.5"></path>
                      <path d="M8.5 8h7A1.5 1.5 0 0 1 17 9.5v4.9a5 5 0 0 1-10 0V9.5A1.5 1.5 0 0 1 8.5 8Z"></path>
                      <path d="M12 3.5v1.75"></path>
                      <path d="M7 11.75H4.75"></path>
                      <path d="M19.25 11.75H17"></path>
                      <path d="M7.2 9.35 5.25 7.8"></path>
                      <path d="M16.8 9.35 18.75 7.8"></path>
                      <path d="M7.2 15.65 5.25 17.2"></path>
                      <path d="M16.8 15.65 18.75 17.2"></path>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty">No requests match the current filters.</div>
    </div>
  </section>
</template>

