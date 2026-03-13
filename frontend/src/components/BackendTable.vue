<script setup lang="ts">
import { ref } from "vue";
import ModelInfoDialog from "./ModelInfoDialog.vue";
import {
  type BackendSnapshot,
  type ModelDetailView,
} from "../types/dashboard";
import { formatDate, formatDuration } from "../utils/formatters";
import { buildModelSpecs } from "../utils/model-specs";

const props = withDefaults(defineProps<{
  backends: BackendSnapshot[];
  mode?: "runtime" | "config";
}>(), {
  mode: "runtime",
});

const emit = defineEmits<{
  (event: "edit-backend", backendId: string): void;
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
  if (!backend.enabled) {
    return "Backend is disabled and excluded from routing.";
  }

  return backend.healthy
    ? "Backend is healthy and routable."
    : "Backend is currently unhealthy or unavailable for routing.";
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

function openModelDetail(detail: ModelDetailView | undefined): void {
  if (!detail) {
    return;
  }

  selectedModelDetail.value = detail;
}

function connectorLabel(connector: BackendSnapshot["connector"]): string {
  return connector === "ollama" ? "Ollama" : "OpenAI-compatible";
}
</script>

<template>
  <div class="table-wrap">
    <table class="backend-table">
      <thead>
        <tr>
          <th>Backend</th>
          <th>Type</th>
          <th v-if="isConfigMode()">Max concurrency</th>
          <th v-if="isRuntimeMode()">Status</th>
          <th v-if="isConfigMode()">Effective models</th>
          <th v-if="isRuntimeMode()">Traffic</th>
          <th v-if="isRuntimeMode()">Latency</th>
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
          <td>
            <div class="log-primary">{{ connectorLabel(backend.connector) }}</div>
          </td>
          <td v-if="isConfigMode()">
            <div class="log-primary" title="Configured maximum number of concurrent requests for this backend.">
              {{ backend.maxConcurrency }}
            </div>
          </td>
          <td v-if="isRuntimeMode()">
            <div class="request-meta">
              <span
                class="badge neutral"
                title="Current backend slot usage. The first number is the active connections on this backend, and the second is the configured maximum concurrency."
              >
                connections {{ backend.activeRequests }} / {{ backend.maxConcurrency }}
              </span>
            </div>
            <div class="table-sub">
              Last check: {{ formatDate(backend.lastCheckedAt) }}
              <template v-if="backendStatusError(backend)">
                <br />
                {{ backendStatusError(backend) }}
              </template>
            </div>
          </td>
          <td v-if="isConfigMode()">
            <div class="models">
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
            <div class="request-meta">
              <span class="badge good" title="Successful requests served by this backend.">ok {{ backend.successfulRequests }}</span>
              <span class="badge bad" title="Failed requests served by this backend.">fail {{ backend.failedRequests }}</span>
              <span class="badge warn" title="Cancelled requests served by this backend.">cancel {{ backend.cancelledRequests }}</span>
            </div>
            <div class="table-sub">total {{ backend.totalRequests }}</div>
          </td>
          <td v-if="isRuntimeMode()">
            <div class="request-meta">
              <span class="badge neutral" title="Rolling average latency observed for this backend.">avg {{ formatDuration(backend.avgLatencyMs) }}</span>
              <span class="badge neutral" title="Most recent observed latency for this backend.">last {{ formatDuration(backend.lastLatencyMs) }}</span>
            </div>
          </td>
          <td v-if="isConfigMode()" class="backend-action-cell">
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
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <ModelInfoDialog :detail="selectedModelDetail" @close="selectedModelDetail = null" />
</template>
