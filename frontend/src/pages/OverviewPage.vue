<script setup lang="ts">
import { computed } from "vue";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();

const activeConnections = computed(() => (
  store.state.snapshot.activeConnections.filter((connection) => connection.phase !== "queued" || Boolean(connection.backendId))
));

const queuedConnections = computed(() => (
  store.state.snapshot.activeConnections.filter((connection) => connection.phase === "queued" && !connection.backendId)
));
</script>

<template>
  <section class="page-section">
    <div class="summary-grid">
      <article
        v-for="card in store.summaryCards"
        :key="card.key"
        :class="['summary-card', card.tone ?? 'neutral']"
        :title="card.title"
      >
        <div class="card-label">{{ card.label }}</div>
        <div class="card-value">{{ card.value }}</div>
        <div v-if="card.note" class="card-note">{{ card.note }}</div>
      </article>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Active Connections</h2>
        </div>
      </div>
      <div v-if="activeConnections.length" class="request-list">
        <article
          v-for="connection in activeConnections"
          :key="connection.id"
          class="request-card interactive"
        >
          <div class="request-main">
            <button
              type="button"
              class="request-card-trigger"
              :disabled="!connection.hasDetail"
              :title="connection.hasDetail ? 'Open the active request inspector.' : 'Detail data is not available for this request yet.'"
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
                :title="store.isRequestCancelling(connection.id) ? 'Ending the active connection...' : 'End this active connection after confirmation.'"
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
      <div v-else class="empty">No active connections are running right now.</div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Queued Connections</h2>
        </div>
      </div>
      <div v-if="queuedConnections.length" class="request-list">
        <article
          v-for="connection in queuedConnections"
          :key="connection.id"
          class="request-card interactive"
        >
          <div class="request-main">
            <button
              type="button"
              class="request-card-trigger"
              :disabled="!connection.hasDetail"
              :title="connection.hasDetail ? 'Open the queued request inspector.' : 'Detail data is not available for this request yet.'"
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
                :title="store.isRequestCancelling(connection.id) ? 'Ending the queued connection...' : 'End this queued connection after confirmation.'"
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
      <div v-else class="empty">No requests are waiting in the queue right now.</div>
    </div>
  </section>
</template>
