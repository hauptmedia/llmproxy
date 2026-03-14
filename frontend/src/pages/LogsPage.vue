<script setup lang="ts">
import { useDashboardStore } from "../composables/useDashboardStore";
import { useRequestsTable } from "../composables/useRequestsTable";
import { formatDuration } from "../utils/formatters";

const store = useDashboardStore();
const {
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
            <col class="log-col-time">
            <col class="log-col-outcome">
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
                      <span class="log-header-label" :title="columnTitles.outcome">Status</span>
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
                      <span class="log-header-label" :title="columnTitles.queue">Queued</span>
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
                    <button type="button" class="log-sort-trigger" :class="{ active: isSortedBy('maxTokens') }" :title="sortTitle('maxTokens')" @click="toggleSort('maxTokens')">
                      <span class="log-header-label" :title="columnTitles.maxTokens">Max tokens</span>
                      <span class="log-sort-indicator" aria-hidden="true">{{ sortIndicator('maxTokens') }}</span>
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
              <th class="log-action-header" :title="columnTitles.action">
                <span class="log-action-head-content">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in sortedEntries"
              :key="entry.id"
            >
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
                      <path d="M2.5 12s3.7-6 9.5-6 9.5 6 9.5 6-3.7 6-9.5 6-9.5-6-9.5-6Z"></path>
                      <circle cx="12" cy="12" r="2.8"></circle>
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

