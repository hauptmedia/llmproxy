<script setup lang="ts">
import type { PropType } from "vue";
import { useDashboardStore } from "../composables/useDashboardStore";
import { badgeClass, buildConnectionTransportBadges } from "../utils/dashboard-badges";
import type { ActiveConnectionSnapshot } from "../types/dashboard";

const props = defineProps({
  panelId: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  emptyText: {
    type: String,
    required: true,
  },
  connections: {
    type: Array as PropType<ActiveConnectionSnapshot[]>,
    required: true,
  },
  embedded: {
    type: Boolean,
    default: false,
  },
});

const store = useDashboardStore();

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

function connectionIdentityBadges(connection: ActiveConnectionSnapshot): Array<{ text: string; title: string; className: string }> {
  const badges: Array<{ text: string; title: string; className: string }> = [];
  const clientIp = formatClientIp(connection.clientIp);

  badges.push({
    text: store.shortId(connection.id),
    title: `Request ID: ${connection.id}.`,
    className: "badge identity-request",
  });

  badges.push({
    text: "chat completion",
    title: "Request type: chat completion.",
    className: "badge identity-kind",
  });

  if (clientIp) {
    badges.push({
      text: clientIp,
      title: `Client IP address: ${clientIp}.`,
      className: "badge identity-ip",
    });
  }

  if (connection.model) {
    badges.push({
      text: connection.model,
      title: `Requested or selected model: ${connection.model}.`,
      className: "badge identity-model",
    });
  }

  if (connection.backendName) {
    badges.push({
      text: `backend ${connection.backendName}`,
      title: `Currently assigned backend: ${connection.backendName}.`,
      className: "badge identity-backend",
    });
  }

  return badges;
}

function connectionStatusDotClass(connection: ActiveConnectionSnapshot): string {
  if (connection.error) {
    return "bad";
  }

  if (connection.phase === "queued") {
    return "warn";
  }

  if (connection.phase === "streaming" && connection.clientStream) {
    return "good";
  }

  if (connection.phase === "connected" || connection.phase === "streaming") {
    return "warn";
  }

  return "neutral";
}

function connectionStatusDotTitle(connection: ActiveConnectionSnapshot): string {
  if (connection.error) {
    return `Request is currently failing to reach or use the backend. Error: ${connection.error}`;
  }

  if (connection.phase === "queued") {
    return "Request is waiting in the queue for a free backend slot.";
  }

  if (connection.phase === "connected") {
    return "A backend is assigned, but the response has not started yet.";
  }

  if (connection.clientStream) {
    return "The request is actively streaming data back to the client.";
  }

  return "The backend is generating while llmproxy is still buffering the response for the client.";
}
</script>

<template>
  <div :id="props.panelId" :class="props.embedded ? 'connection-section' : 'panel'">
    <div :class="props.embedded ? 'connection-section-header' : 'panel-header'">
      <div>
        <component :is="props.embedded ? 'h3' : 'h2'" :class="props.embedded ? 'connection-section-title' : 'panel-title'">
          {{ props.title }}
        </component>
      </div>
    </div>
    <div v-if="props.connections.length" class="request-list">
      <article
        v-for="connection in props.connections"
        :key="connection.id"
        class="request-card"
      >
        <div class="request-main">
          <div class="request-card-body">
            <div class="request-title-row">
              <span
                class="request-status-dot-shell"
                :title="connectionStatusDotTitle(connection)"
              >
                <span
                  class="request-status-dot"
                  :class="connectionStatusDotClass(connection)"
                  aria-hidden="true"
                ></span>
              </span>
              <span
                v-for="identityBadge in connectionIdentityBadges(connection)"
                :key="`${connection.id}-${identityBadge.text}`"
                :class="identityBadge.className"
                :title="identityBadge.title"
              >
                {{ identityBadge.text }}
              </span>
              <span
                v-for="badge in store.connectionCardBadges(connection)"
                :key="badge.text + badge.title"
                :class="store.badgeClass(badge)"
                :title="badge.title"
              >
                {{ badge.text }}
              </span>
            </div>
          </div>
          <div class="request-actions">
            <button
              type="button"
              class="icon-button danger"
              :disabled="store.isRequestCancelling(connection.id)"
              :aria-label="store.isRequestCancelling(connection.id) ? 'Ending the connection' : 'End this connection'"
              :title="store.isRequestCancelling(connection.id) ? 'Ending the connection...' : 'End this connection after confirmation.'"
              @click="store.cancelActiveRequest(connection.id)"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3.5v7"></path>
                <path d="M7.05 6.05a7 7 0 1 0 9.9 0"></path>
              </svg>
            </button>
            <button
              type="button"
              class="icon-button"
              :disabled="!connection.hasDetail"
              :aria-label="connection.hasDetail ? 'Open connection details' : 'Connection details are not available yet'"
              :title="connection.hasDetail ? 'Open the request inspector.' : 'Detail data is not available for this request yet.'"
              @click="store.openRequestDetail(connection.id)"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.5 12s3.7-6 9.5-6 9.5 6 9.5 6-3.7 6-9.5 6-9.5-6-9.5-6Z"></path>
                <circle cx="12" cy="12" r="2.8"></circle>
              </svg>
            </button>
          </div>
        </div>
        <div class="request-meta">
          <span
            v-for="(badge, index) in buildConnectionTransportBadges(connection, { invertDirections: true })"
            :key="`${connection.id}-transport-${index}`"
            :class="badgeClass(badge)"
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
    <div v-else class="empty">{{ props.emptyText }}</div>
  </div>
</template>
