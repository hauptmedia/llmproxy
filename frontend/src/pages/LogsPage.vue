<script setup lang="ts">
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Recent Requests</h2>
          <p class="hint">Completed requests retained in local history. Click a card to inspect the stored conversation and response.</p>
        </div>
      </div>
      <div v-if="store.state.snapshot.recentRequests.length" class="request-list">
        <button
          v-for="entry in store.state.snapshot.recentRequests"
          :key="entry.id"
          type="button"
          class="request-card"
          :disabled="!entry.hasDetail"
          :title="entry.hasDetail ? 'Open the stored request inspector.' : 'No stored detail is available for this request.'"
          @click="store.openRequestDetail(entry.id)"
        >
          <div class="request-main">
            <div>
              <h3>{{ entry.method }} {{ entry.path }}</h3>
              <div class="request-subtitle">
                <span class="mono">{{ store.shortId(entry.id) }}</span>
                <template v-if="entry.backendName"> · {{ entry.backendName }}</template>
                <template v-if="entry.model"> · {{ entry.model }}</template>
              </div>
            </div>
          </div>
          <div class="request-meta">
            <span
              v-for="badge in store.recentRequestBadges(entry)"
              :key="badge.text + badge.title"
              :class="store.badgeClass(badge)"
              :title="badge.title"
            >
              {{ badge.text }}
            </span>
          </div>
          <div v-if="store.recentRequestMetrics(entry).length" class="request-metrics">
            <span
              v-for="badge in store.recentRequestMetrics(entry)"
              :key="badge.text + badge.title"
              :class="store.badgeClass(badge)"
              :title="badge.title"
            >
              {{ badge.text }}
            </span>
          </div>
        </button>
      </div>
      <div v-else class="empty">No requests have been recorded yet.</div>
    </div>
  </section>
</template>
