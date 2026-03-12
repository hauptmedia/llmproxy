<script setup lang="ts">
import { ref } from "vue";
import ModelInfoDialog from "./ModelInfoDialog.vue";
import {
  type BackendDraft,
  type BackendSnapshot,
  type ModelDetailView,
} from "../types/dashboard";
import { formatDate, formatDuration } from "../utils/formatters";
import { buildModelSpecs } from "../utils/model-specs";

defineProps<{
  backends: BackendSnapshot[];
  drafts: Record<string, BackendDraft>;
}>();

const emit = defineEmits<{
  (event: "save-backend", backendId: string): void;
}>();

const selectedModelDetail = ref<ModelDetailView | null>(null);

function modelSpecs(backend: BackendSnapshot) {
  return buildModelSpecs(backend.configuredModels, backend.discoveredModels, backend.discoveredModelDetails);
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

function saveBackend(backendId: string): void {
  emit("save-backend", backendId);
}

function openModelDetail(detail: ModelDetailView | undefined): void {
  if (!detail) {
    return;
  }

  selectedModelDetail.value = detail;
}
</script>

<template>
  <div class="table-wrap">
    <table class="backend-table">
      <thead>
        <tr>
          <th>Backend</th>
          <th>Status</th>
          <th>Models</th>
          <th>Traffic</th>
          <th>Latency</th>
          <th>Controls</th>
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
            <div class="table-sub">{{ backend.baseUrl }}</div>
          </td>
          <td>
            <div class="request-meta">
              <span class="badge neutral" title="Active requests currently occupying backend slots.">
                active {{ backend.activeRequests }} / {{ backend.maxConcurrency }}
              </span>
              <span class="badge neutral" title="Routing slots still free on this backend.">
                free {{ backend.availableSlots }}
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
          <td>
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
          <td>
            <div class="request-meta">
              <span class="badge good" title="Successful requests served by this backend.">ok {{ backend.successfulRequests }}</span>
              <span class="badge bad" title="Failed requests served by this backend.">fail {{ backend.failedRequests }}</span>
              <span class="badge warn" title="Cancelled requests served by this backend.">cancel {{ backend.cancelledRequests }}</span>
            </div>
            <div class="table-sub">total {{ backend.totalRequests }}</div>
          </td>
          <td>
            <div class="request-meta">
              <span class="badge neutral" title="Rolling average latency observed for this backend.">avg {{ formatDuration(backend.avgLatencyMs) }}</span>
              <span class="badge neutral" title="Most recent observed latency for this backend.">last {{ formatDuration(backend.lastLatencyMs) }}</span>
            </div>
          </td>
          <td v-if="drafts[backend.id]">
            <label class="inline-toggle">
              <input v-model="drafts[backend.id].enabled" type="checkbox" />
              Enabled
            </label>
            <label class="inline-number">
              max
              <input v-model.number="drafts[backend.id].maxConcurrency" type="number" min="1" step="1" />
            </label>
            <div>
              <button
                class="button secondary small"
                type="button"
                :disabled="drafts[backend.id].saving"
                @click="saveBackend(backend.id)"
              >
                {{ drafts[backend.id].saving ? "Saving..." : "Save" }}
              </button>
            </div>
            <div v-if="drafts[backend.id].error" class="inline-error">{{ drafts[backend.id].error }}</div>
          </td>
          <td v-else>
            <div class="table-sub">Waiting for backend controls...</div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <ModelInfoDialog :detail="selectedModelDetail" @close="selectedModelDetail = null" />
</template>
