<script setup lang="ts">
import { computed } from "vue";
import BackendEditorDialog from "../components/BackendEditorDialog.vue";
import BackendTable from "../components/BackendTable.vue";
import { useDashboardStore } from "../composables/useDashboardStore";
import { formatDuration } from "../utils/formatters";

const store = useDashboardStore();
const currentBackendConfig = computed(() => {
  const backendId = store.state.backendEditor.originalId || store.state.backendEditor.fields.id;
  return backendId ? store.state.backendConfigs[backendId] ?? null : null;
});

const serverConfigRows = computed(() => {
  const config = store.state.serverConfig;
  if (!config) {
    return [];
  }

  return [
    {
      key: "Host",
      value: config.host,
      title: "Bind host for the llmproxy server.",
    },
    {
      key: "Port",
      value: String(config.port),
      title: "Bind port for the llmproxy server.",
    },
    {
      key: "Dashboard path",
      value: config.dashboardPath,
      title: "Base path where the dashboard SPA is served.",
    },
    {
      key: "Request timeout",
      value: `${config.requestTimeoutMs} ms (${formatDuration(config.requestTimeoutMs)})`,
      title: "Maximum time llmproxy waits for an upstream request before aborting it.",
    },
    {
      key: "Queue timeout",
      value: `${config.queueTimeoutMs} ms (${formatDuration(config.queueTimeoutMs)})`,
      title: "Maximum time a request may wait for a free backend slot.",
    },
    {
      key: "Health check interval",
      value: `${config.healthCheckIntervalMs} ms (${formatDuration(config.healthCheckIntervalMs)})`,
      title: "How often llmproxy refreshes backend health state.",
    },
    {
      key: "Recent request limit",
      value: String(config.recentRequestLimit),
      title: "Maximum number of retained request rows kept in memory and shown in the dashboard.",
    },
  ];
});
</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Config</h2>
        </div>
        <button
          class="icon-button compact"
          type="button"
          title="Edit llmproxy config"
          aria-label="Edit llmproxy config"
          @click="store.openServerEditor"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"></path>
          </svg>
        </button>
      </div>
      <div v-if="store.state.serverEditor.notice" :class="['mb-4', 'config-notice', store.state.serverEditor.noticeTone]">
        {{ store.state.serverEditor.notice }}
      </div>
      <div v-if="serverConfigRows.length" class="detail-table-wrap">
        <table class="detail-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in serverConfigRows" :key="row.key">
              <td :title="row.title" class="detail-table-key">{{ row.key }}</td>
              <td :title="row.title" class="detail-table-value mono">{{ row.value }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty">Loading llmproxy config...</div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Backends</h2>
        </div>
        <button
          class="icon-button compact"
          type="button"
          title="Add backend configuration"
          aria-label="Add backend configuration"
          @click="store.openCreateBackend"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14"></path>
            <path d="M5 12h14"></path>
          </svg>
        </button>
      </div>
      <BackendTable
        :backends="store.state.snapshot.backends"
        mode="config"
        @edit-backend="store.openEditBackend"
        @delete-backend="store.deleteBackendById"
      />
    </div>
    <BackendEditorDialog
      :state="store.state.backendEditor"
      :current-config="currentBackendConfig"
      @close="store.closeBackendEditor"
      @save="store.saveBackendEditor"
    />
  </section>
</template>
