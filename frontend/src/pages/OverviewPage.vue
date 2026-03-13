<script setup lang="ts">
import { computed } from "vue";
import { useDashboardStore } from "../composables/useDashboardStore";
import { badgeClass, buildConnectionTransportBadges } from "../utils/dashboard-badges";
import type { ActiveConnectionSnapshot } from "../types/dashboard";

const store = useDashboardStore();

const chatCompletionConnections = computed(() => (
  store.state.snapshot.activeConnections.filter((connection) => connection.kind === "chat.completions")
));

const activeConnections = computed(() => (
  chatCompletionConnections.value.filter((connection) => connection.phase !== "queued" || Boolean(connection.backendId))
));

const queuedConnections = computed(() => (
  chatCompletionConnections.value.filter((connection) => connection.phase === "queued" && !connection.backendId)
));

function formatClientIp(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice(7);
  }

  return trimmed;
}

function connectionHeadline(connection: ActiveConnectionSnapshot): string {
  const parts = [
    formatClientIp(connection.clientIp) ? `IP ${formatClientIp(connection.clientIp)}` : undefined,
    store.shortId(connection.id),
    connection.model,
    connection.backendName,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" › ");
}
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
          class="request-card"
        >
          <div class="request-main">
            <div class="request-card-body">
              <div>
                <div class="request-topline">
                  {{ connectionHeadline(connection) }}
                </div>
                <div class="request-title-row">
                  <span
                    class="badge neutral"
                    title="This live entry is a chat completion request."
                  >
                    Chat Completion
                  </span>
                  <span
                    v-for="(badge, index) in buildConnectionTransportBadges(connection)"
                    :key="`${connection.id}-active-transport-${index}`"
                    :class="badgeClass(badge)"
                    :title="badge.title"
                  >
                    {{ badge.text }}
                  </span>
                </div>
              </div>
            </div>
            <div class="request-actions">
              <button
                type="button"
                class="icon-button"
                :disabled="!connection.hasDetail"
                :aria-label="connection.hasDetail ? 'Open active connection details' : 'Active connection details are not available yet'"
                :title="connection.hasDetail ? 'Open the active request inspector.' : 'Detail data is not available for this request yet.'"
                @click="store.openRequestDetail(connection.id)"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2.5 12s3.7-6 9.5-6 9.5 6 9.5 6-3.7 6-9.5 6-9.5-6-9.5-6Z"></path>
                  <circle cx="12" cy="12" r="2.8"></circle>
                </svg>
              </button>
              <button
                type="button"
                class="icon-button danger"
                :disabled="store.isRequestCancelling(connection.id)"
                :aria-label="store.isRequestCancelling(connection.id) ? 'Ending the active connection' : 'End this active connection'"
                :title="store.isRequestCancelling(connection.id) ? 'Ending the active connection...' : 'End this active connection after confirmation.'"
                @click="store.cancelActiveRequest(connection.id)"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3.5v7"></path>
                  <path d="M7.05 6.05a7 7 0 1 0 9.9 0"></path>
                </svg>
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
          <div v-if="store.connectionMetricBadges(connection).length" class="request-metrics">
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
          <h2 class="panel-title">Queue</h2>
        </div>
      </div>
      <div v-if="queuedConnections.length" class="request-list">
        <article
          v-for="connection in queuedConnections"
          :key="connection.id"
          class="request-card"
        >
          <div class="request-main">
            <div class="request-card-body">
              <div>
                <div class="request-topline">
                  {{ connectionHeadline(connection) }}
                </div>
                <div class="request-title-row">
                  <span
                    class="badge neutral"
                    title="This live entry is a chat completion request."
                  >
                    Chat Completion
                  </span>
                  <span
                    v-for="(badge, index) in buildConnectionTransportBadges(connection)"
                    :key="`${connection.id}-queued-transport-${index}`"
                    :class="badgeClass(badge)"
                    :title="badge.title"
                  >
                    {{ badge.text }}
                  </span>
                </div>
              </div>
            </div>
            <div class="request-actions">
              <button
                type="button"
                class="icon-button"
                :disabled="!connection.hasDetail"
                :aria-label="connection.hasDetail ? 'Open queued connection details' : 'Queued connection details are not available yet'"
                :title="connection.hasDetail ? 'Open the queued request inspector.' : 'Detail data is not available for this request yet.'"
                @click="store.openRequestDetail(connection.id)"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2.5 12s3.7-6 9.5-6 9.5 6 9.5 6-3.7 6-9.5 6-9.5-6-9.5-6Z"></path>
                  <circle cx="12" cy="12" r="2.8"></circle>
                </svg>
              </button>
              <button
                type="button"
                class="icon-button danger"
                :disabled="store.isRequestCancelling(connection.id)"
                :aria-label="store.isRequestCancelling(connection.id) ? 'Ending the queued connection' : 'End this queued connection'"
                :title="store.isRequestCancelling(connection.id) ? 'Ending the queued connection...' : 'End this queued connection after confirmation.'"
                @click="store.cancelActiveRequest(connection.id)"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3.5v7"></path>
                  <path d="M7.05 6.05a7 7 0 1 0 9.9 0"></path>
                </svg>
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
          <div v-if="store.connectionMetricBadges(connection).length" class="request-metrics">
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
