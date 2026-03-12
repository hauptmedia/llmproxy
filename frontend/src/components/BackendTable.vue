<script setup lang="ts">
import {
  type BackendDraft,
  type BackendSnapshot,
} from "../types/dashboard";
import { formatDate, formatDuration } from "../utils/formatters";
import { buildModelSpecs } from "../utils/model-specs";

const props = defineProps<{
  backends: BackendSnapshot[];
  drafts: Record<string, BackendDraft>;
}>();

const emit = defineEmits<{
  (event: "save-backend", backendId: string): void;
}>();

function modelSpecs(backend: BackendSnapshot) {
  return buildModelSpecs(backend.configuredModels, backend.discoveredModels, backend.discoveredModelDetails);
}

function saveBackend(backendId: string): void {
  emit("save-backend", backendId);
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
            <div class="table-name">{{ backend.name }}</div>
            <div class="table-sub">{{ backend.baseUrl }}</div>
          </td>
          <td>
            <div class="request-meta">
              <span :class="'badge ' + (backend.healthy && backend.enabled ? 'good' : (backend.enabled ? 'bad' : 'warn'))">
                {{ backend.healthy && backend.enabled ? "healthy" : (backend.enabled ? "unhealthy" : "disabled") }}
              </span>
              <span class="badge neutral" title="Active requests currently occupying backend slots.">
                active {{ backend.activeRequests }} / {{ backend.maxConcurrency }}
              </span>
              <span class="badge neutral" title="Routing slots still free on this backend.">
                free {{ backend.availableSlots }}
              </span>
            </div>
            <div class="table-sub">
              Last check: {{ formatDate(backend.lastCheckedAt) }}
              <template v-if="backend.lastError">
                <br />
                {{ backend.lastError }}
              </template>
            </div>
          </td>
          <td>
            <div class="models">
              <span
                v-for="spec in modelSpecs(backend)"
                :key="spec.text + spec.className"
                :class="spec.className"
                :title="spec.title"
              >
                {{ spec.text }}
              </span>
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
</template>
