<script setup lang="ts">
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Health Status</h2>
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
          <h2 class="panel-title">Live Connections</h2>
        </div>
      </div>
      <div v-if="store.state.snapshot.activeConnections.length" class="request-list">
        <article
          v-for="connection in store.state.snapshot.activeConnections"
          :key="connection.id"
          class="request-card interactive"
        >
          <div class="request-main">
            <button
              type="button"
              class="request-card-trigger"
              :disabled="!connection.hasDetail"
              :title="connection.hasDetail ? 'Open the live request inspector.' : 'Detail data is not available for this request yet.'"
              @click="store.openRequestDetail(connection.id)"
            >
              <div>
                <h3>{{ connection.method }} {{ connection.path }}</h3>
                <div class="request-subtitle">
                  <span class="mono">{{ store.shortId(connection.id) }}</span>
                  <template v-if="connection.backendName"> · {{ connection.backendName }}</template>
                  <template v-if="connection.model"> · {{ connection.model }}</template>
                </div>
              </div>
            </button>
            <div class="request-actions">
              <button
                type="button"
                class="button secondary small"
                :disabled="store.isRequestCancelling(connection.id)"
                :title="store.isRequestCancelling(connection.id) ? 'Ending the live connection...' : 'End this live connection after confirmation.'"
                @click="store.cancelActiveRequest(connection.id)"
              >
                {{ store.isRequestCancelling(connection.id) ? "Ending..." : "End" }}
              </button>
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
        </article>
      </div>
      <div v-else class="empty">No live connections are active right now.</div>
    </div>
  </section>
</template>
