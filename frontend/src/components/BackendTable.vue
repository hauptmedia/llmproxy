<script setup lang="ts">
import { ref } from "vue";
import ModelInfoDialog from "./ModelInfoDialog.vue";
import {
  type ActiveConnectionSnapshot,
  type BackendSnapshot,
  type ModelDetailView,
  type RequestLogEntry,
} from "../types/dashboard";
import { formatDate, formatDuration, formatTokenRate } from "../utils/formatters";
import { buildModelSpecs } from "../utils/model-specs";

const props = withDefaults(defineProps<{
  backends: BackendSnapshot[];
  activeConnections?: ActiveConnectionSnapshot[];
  recentRequests?: RequestLogEntry[];
  recentRequestLimit?: number;
  mode?: "runtime" | "config";
}>(), {
  mode: "runtime",
  activeConnections: () => [],
  recentRequests: () => [],
  recentRequestLimit: 0,
});

const emit = defineEmits<{
  (event: "edit-backend", backendId: string): void;
  (event: "delete-backend", backendId: string): void;
}>();

const selectedModelDetail = ref<ModelDetailView | null>(null);

function modelSpecs(backend: BackendSnapshot) {
  return buildModelSpecs(backend.configuredModels, backend.discoveredModels, backend.discoveredModelDetails);
}

function isRuntimeMode(): boolean {
  return props.mode === "runtime";
}

function isConfigMode(): boolean {
  return props.mode === "config";
}

function backendStateClass(backend: BackendSnapshot): "good" | "bad" | "disabled" {
  if (!backend.enabled) {
    return "disabled";
  }

  return backend.healthy ? "good" : "bad";
}

function backendStateTitle(backend: BackendSnapshot): string {
  const lastCheckText = backend.lastCheckedAt ? ` Last check: ${formatDate(backend.lastCheckedAt)}.` : "";

  if (!backend.enabled) {
    return `Backend is disabled and excluded from routing.${lastCheckText}`;
  }

  return backend.healthy
    ? `Backend is healthy and routable.${lastCheckText}`
    : `Backend is currently unhealthy or unavailable for routing.${lastCheckText}`;
}

function backendStatusError(backend: BackendSnapshot): string {
  if (!backend.enabled) {
    return "";
  }

  return backend.lastError === "Backend disabled." ? "" : (backend.lastError ?? "");
}

function editBackend(backendId: string): void {
  emit("edit-backend", backendId);
}

function deleteBackend(backendId: string): void {
  emit("delete-backend", backendId);
}

function openModelDetail(detail: ModelDetailView | undefined): void {
  if (!detail) {
    return;
  }

  selectedModelDetail.value = detail;
}

function connectorLabel(connector: BackendSnapshot["connector"]): string {
  return connector === "ollama" ? "Ollama" : "OpenAI-compatible";
}

function recentBackendRequests(backend: BackendSnapshot): RequestLogEntry[] {
  return props.recentRequests.filter((entry) => entry.backendId === backend.id);
}

function recentBackendRequestCount(backend: BackendSnapshot): number {
  return recentBackendRequests(backend).length;
}

function recentBackendSuccessCount(backend: BackendSnapshot): number {
  return recentBackendRequests(backend).filter((entry) => entry.outcome === "success").length;
}

function recentBackendFailureCount(backend: BackendSnapshot): number {
  return recentBackendRequests(backend).filter((entry) => entry.outcome === "error").length;
}

function recentBackendCancelledCount(backend: BackendSnapshot): number {
  return recentBackendRequests(backend).filter((entry) => entry.outcome === "cancelled").length;
}

function recentBackendAverageLatency(backend: BackendSnapshot): number | undefined {
  const entries = recentBackendRequests(backend);
  if (entries.length === 0) {
    return undefined;
  }

  const total = entries.reduce((sum, entry) => sum + entry.latencyMs, 0);
  return Math.round(total / entries.length);
}

function recentBackendLastLatency(backend: BackendSnapshot): number | undefined {
  return recentBackendRequests(backend)[0]?.latencyMs;
}

function recentBackendAverageTokenRate(backend: BackendSnapshot): number | undefined {
  const rates = recentBackendRequests(backend)
    .map((entry) => entry.completionTokensPerSecond)
    .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));

  if (rates.length === 0) {
    return undefined;
  }

  const total = rates.reduce((sum, value) => sum + value, 0);
  return total / rates.length;
}

function recentBackendLastTokenRate(backend: BackendSnapshot): number | undefined {
  return recentBackendRequests(backend).find((entry) => typeof entry.completionTokensPerSecond === "number")?.completionTokensPerSecond;
}

function activeBackendConnections(backend: BackendSnapshot): ActiveConnectionSnapshot[] {
  return props.activeConnections.filter((connection) => connection.backendId === backend.id);
}

function currentBackendTokenRate(backend: BackendSnapshot): number | undefined {
  const activeConnections = activeBackendConnections(backend);
  if (activeConnections.length === 0) {
    return 0;
  }

  const rates = activeConnections
    .map((connection) => connection.completionTokensPerSecond)
    .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));

  if (rates.length === 0) {
    return undefined;
  }

  return rates.reduce((sum, value) => sum + value, 0);
}

function recentWindowLabel(): string {
  return props.recentRequestLimit > 0
    ? `within the last ${props.recentRequestLimit} retained requests`
    : "within the current retained request window";
}
</script>

<template>
  <div class="table-wrap">
    <table :class="['backend-table', isRuntimeMode() ? 'backend-table-runtime' : 'backend-table-config']">
      <colgroup v-if="isRuntimeMode()">
        <col class="backend-col-name">
        <col class="backend-col-type">
        <col class="backend-col-connections">
        <col class="backend-col-traffic">
        <col class="backend-col-latency">
        <col class="backend-col-throughput">
      </colgroup>
      <colgroup v-else>
        <col class="backend-col-name">
        <col class="backend-col-type">
        <col class="backend-col-max-concurrency">
        <col class="backend-col-models">
        <col class="backend-col-action">
      </colgroup>
      <thead>
        <tr>
          <th>Backend</th>
          <th class="backend-type-cell">Type</th>
          <th v-if="isConfigMode()" class="backend-number-cell backend-max-concurrency-cell">
            <span class="backend-max-concurrency-content">Max concurrency</span>
          </th>
          <th v-if="isRuntimeMode()" class="backend-runtime-connections-cell">
            <span class="backend-runtime-connections-anchor backend-runtime-connections-heading">Connections</span>
          </th>
          <th v-if="isConfigMode()" class="backend-models-cell">Effective models</th>
          <th v-if="isRuntimeMode()">Traffic</th>
          <th v-if="isRuntimeMode()">Latency</th>
          <th v-if="isRuntimeMode()">Throughput</th>
          <th v-if="isConfigMode()">Action</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="backend in backends" :key="backend.id">
          <td>
            <div class="table-name">
              <span
                :class="['backend-health-dot', backendStateClass(backend)]"
                :title="backendStateTitle(backend)"
                aria-hidden="true"
              ></span>
              <span>{{ backend.name }}</span>
            </div>
            <div class="table-sub backend-identity">
              <span class="backend-url">{{ backend.baseUrl }}</span>
            </div>
          </td>
          <td class="backend-type-cell">
            <div class="backend-type-content">
              <div class="log-primary">{{ connectorLabel(backend.connector) }}</div>
            </div>
          </td>
          <td v-if="isConfigMode()" class="backend-number-cell backend-max-concurrency-cell">
            <div class="backend-max-concurrency-content">
              <div class="log-primary" title="Configured maximum number of concurrent requests for this backend.">
                {{ backend.maxConcurrency }}
              </div>
            </div>
          </td>
          <td v-if="isRuntimeMode()" class="backend-runtime-connections-cell">
            <div class="backend-runtime-connections-shell">
              <div class="backend-runtime-connections-anchor backend-runtime-connections-content">
                <div
                  class="backend-runtime-connections-value"
                  title="Current backend slot usage. The first number is the active connections on this backend, and the second is the configured maximum concurrency."
                >
                  {{ backend.activeRequests }} / {{ backend.maxConcurrency }}
                </div>
                <div v-if="backendStatusError(backend)" class="table-sub">
                  {{ backendStatusError(backend) }}
                </div>
              </div>
            </div>
          </td>
          <td v-if="isConfigMode()" class="backend-models-cell">
            <div class="backend-models-content models">
              <template v-for="spec in modelSpecs(backend)" :key="spec.text + spec.className">
                <button
                  v-if="spec.detail"
                  type="button"
                  :class="[spec.className, 'model-chip-button']"
                  @click="openModelDetail(spec.detail)"
                >
                  <span>{{ spec.text }}</span>
                  <span class="model-chip-link" aria-hidden="true">&nearr;</span>
                </button>
                <span
                  v-else
                  :class="spec.className"
                >
                  {{ spec.text }}
                </span>
              </template>
            </div>
          </td>
          <td v-if="isRuntimeMode()">
            <div class="inline-metric-row log-primary">
              <span class="inline-metric good" :title="`Successful requests served by this backend ${recentWindowLabel()}.`">ok {{ recentBackendSuccessCount(backend) }}</span>
              <span class="inline-metric bad" :title="`Failed requests served by this backend ${recentWindowLabel()}.`">fail {{ recentBackendFailureCount(backend) }}</span>
              <span class="inline-metric warn" :title="`Cancelled requests served by this backend ${recentWindowLabel()}.`">cancel {{ recentBackendCancelledCount(backend) }}</span>
            </div>
            <div class="table-sub" :title="`Total retained requests for this backend ${recentWindowLabel()}.`">total {{ recentBackendRequestCount(backend) }}</div>
          </td>
          <td v-if="isRuntimeMode()">
            <div class="backend-runtime-metric-stack backend-runtime-stat-list log-primary">
              <div class="backend-runtime-stat-row">
                <span class="backend-runtime-stat-label neutral" :title="`Average end-to-end latency for this backend ${recentWindowLabel()}.`">
                  avg
                </span>
                <span class="backend-runtime-stat-value neutral" :title="`Average end-to-end latency for this backend ${recentWindowLabel()}.`">
                  {{ formatDuration(recentBackendAverageLatency(backend)) }}
                </span>
              </div>
              <div class="backend-runtime-stat-row">
                <span class="backend-runtime-stat-label neutral" :title="`Most recent retained request latency for this backend ${recentWindowLabel()}.`">
                  last
                </span>
                <span class="backend-runtime-stat-value neutral" :title="`Most recent retained request latency for this backend ${recentWindowLabel()}.`">
                  {{ formatDuration(recentBackendLastLatency(backend)) }}
                </span>
              </div>
            </div>
          </td>
          <td v-if="isRuntimeMode()">
            <div class="backend-runtime-metric-stack backend-runtime-stat-list log-primary">
              <div class="backend-runtime-stat-row">
                <span class="backend-runtime-stat-label neutral" :title="`Current summed completion token rate across active connections on this backend. Only active connections with measured token-rate metrics are included.`">
                  all
                </span>
                <span class="backend-runtime-stat-value neutral" :title="`Current summed completion token rate across active connections on this backend. Only active connections with measured token-rate metrics are included.`">
                  {{ formatTokenRate(currentBackendTokenRate(backend)) || "n/a" }}
                </span>
              </div>
              <div class="backend-runtime-stat-row">
                <span class="backend-runtime-stat-label neutral" :title="`Average completion token rate for this backend ${recentWindowLabel()}. Only retained requests with measured token-rate metrics are included.`">
                  avg
                </span>
                <span class="backend-runtime-stat-value neutral" :title="`Average completion token rate for this backend ${recentWindowLabel()}. Only retained requests with measured token-rate metrics are included.`">
                  {{ formatTokenRate(recentBackendAverageTokenRate(backend)) || "n/a" }}
                </span>
              </div>
              <div class="backend-runtime-stat-row">
                <span class="backend-runtime-stat-label neutral" :title="`Most recent retained completion token rate for this backend ${recentWindowLabel()}.`">
                  last
                </span>
                <span class="backend-runtime-stat-value neutral" :title="`Most recent retained completion token rate for this backend ${recentWindowLabel()}.`">
                  {{ formatTokenRate(recentBackendLastTokenRate(backend)) || "n/a" }}
                </span>
              </div>
            </div>
          </td>
          <td v-if="isConfigMode()" class="backend-action-cell">
            <div class="backend-action-content">
              <button
                class="icon-button compact danger"
                type="button"
                title="Delete backend configuration"
                aria-label="Delete backend configuration"
                @click="deleteBackend(backend.id)"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 7h16"></path>
                  <path d="M9 7V5.75C9 4.78 9.78 4 10.75 4h2.5C14.22 4 15 4.78 15 5.75V7"></path>
                  <path d="M6 7l1 12a2 2 0 0 0 1.99 1.83h6.02A2 2 0 0 0 17 19l1-12"></path>
                  <path d="M10 11v6"></path>
                  <path d="M14 11v6"></path>
                </svg>
              </button>
              <button
                class="icon-button compact"
                type="button"
                title="Edit backend configuration"
                aria-label="Edit backend configuration"
                @click="editBackend(backend.id)"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <ModelInfoDialog :detail="selectedModelDetail" @close="selectedModelDetail = null" />
</template>
