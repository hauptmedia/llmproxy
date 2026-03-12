<script setup lang="ts">
import BackendTable from "../components/BackendTable.vue";
import { useDashboardStore } from "../dashboard-core";

const store = useDashboardStore();
</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Health Status</h2>
          <p class="hint">Live proxy health, queue depth, uptime, and backend readiness.</p>
        </div>
      </div>
      <div class="summary-grid">
        <article
          v-for="card in store.summaryCards"
          :key="card.key"
          class="summary-card"
          :title="card.title"
        >
          <div class="card-label">{{ card.label }}</div>
          <div class="card-value">{{ card.value }}</div>
          <div class="card-note">{{ card.note }}</div>
        </article>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Backends</h2>
          <p class="hint">Availability, discovered models, allowlists, and live routing controls.</p>
        </div>
      </div>
      <BackendTable
        :backends="store.state.snapshot.backends"
        :drafts="store.state.backendDrafts"
        @save-backend="store.saveBackend"
      />
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Live Connections</h2>
          <p class="hint">Requests currently queued or running through the proxy. Click a card to inspect the full request.</p>
        </div>
      </div>
      <div v-if="store.state.snapshot.activeConnections.length" class="request-list">
        <button
          v-for="connection in store.state.snapshot.activeConnections"
          :key="connection.id"
          type="button"
          class="request-card"
          :disabled="!connection.hasDetail"
          :title="connection.hasDetail ? 'Open the live request inspector.' : 'Detail data is not available for this request yet.'"
          @click="store.openRequestDetail(connection.id)"
        >
          <div class="request-main">
            <div>
              <h3>{{ connection.method }} {{ connection.path }}</h3>
              <div class="request-subtitle">
                <span class="mono">{{ store.shortId(connection.id) }}</span>
                <template v-if="connection.backendName"> · {{ connection.backendName }}</template>
                <template v-if="connection.model"> · {{ connection.model }}</template>
              </div>
            </div>
          </div>
          <div class="request-meta">
            <span
              v-for="badge in store.connectionCardBadges(connection)"
              :key="badge.text + badge.title"
              :class="store.badgeClass(badge)"
              :title="badge.title"
            >
              {{ badge.text }}
            </span>
          </div>
          <div class="request-metrics">
            <span
              v-for="badge in store.connectionMetricBadges(connection)"
              :key="badge.text + badge.title"
              :class="store.badgeClass(badge)"
              :title="badge.title"
            >
              {{ badge.text }}
            </span>
          </div>
        </button>
      </div>
      <div v-else class="empty">No live connections are active right now.</div>
    </div>

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
