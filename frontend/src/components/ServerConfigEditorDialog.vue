<script setup lang="ts">
import { computed } from "vue";
import type { ServerEditorState } from "../types/dashboard";

const props = defineProps<{
  state: ServerEditorState;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "save"): void;
}>();

const liveFields = new Set([
  "requestTimeoutMs",
  "queueTimeoutMs",
  "healthCheckIntervalMs",
  "recentRequestLimit",
]);

const restartFields = new Set([
  "host",
  "port",
  "dashboardPath",
]);

const noticeClass = computed(() => {
  if (props.state.noticeTone === "good") {
    return "config-notice good";
  }

  if (props.state.noticeTone === "warn") {
    return "config-notice warn";
  }

  return "config-notice";
});

function closeDialog(): void {
  if (props.state.saving) {
    return;
  }

  emit("close");
}

function submitDialog(): void {
  emit("save");
}

function isLiveField(field: string): boolean {
  return liveFields.has(field);
}

function isRestartField(field: string): boolean {
  return restartFields.has(field);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="request-detail-overlay"
      @click.self="closeDialog"
    >
      <div class="request-detail-dialog server-editor-dialog">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Edit llmproxy config</h2>
            <p class="hint">
              Changes are written to <span class="mono">llmproxy.config.json</span>.
              Fields marked <span class="mono">Live</span> apply immediately. Fields marked <span class="mono">Restart</span> need an llmproxy restart.
            </p>
          </div>
          <button class="icon-button compact" type="button" title="Close" aria-label="Close" :disabled="state.saving" @click="closeDialog">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6L18 18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
              <path d="M18 6L6 18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
            </svg>
          </button>
        </div>

        <section class="request-detail-card">
          <div class="detail-card-viewport">
            <div class="field-grid backend-form-grid">
              <label class="field">
                <span class="field-label-row">
                  <span class="field-label">Host</span>
                  <span v-if="isRestartField('host')" class="badge warn" title="Changing the bind host requires restarting llmproxy.">Restart</span>
                </span>
                <input v-model="state.fields.host" type="text" autocomplete="off" spellcheck="false" placeholder="0.0.0.0" />
              </label>

              <label class="field">
                <span class="field-label-row">
                  <span class="field-label">Port</span>
                  <span v-if="isRestartField('port')" class="badge warn" title="Changing the listen port requires restarting llmproxy.">Restart</span>
                </span>
                <input v-model="state.fields.port" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field field-span-2">
                <span class="field-label-row">
                  <span class="field-label">Dashboard path</span>
                  <span v-if="isRestartField('dashboardPath')" class="badge warn" title="Changing the dashboard base path requires restarting llmproxy.">Restart</span>
                </span>
                <input v-model="state.fields.dashboardPath" type="text" autocomplete="off" spellcheck="false" placeholder="/dashboard" />
              </label>

              <label class="field">
                <span class="field-label-row">
                  <span class="field-label">Request timeout (ms)</span>
                  <span v-if="isLiveField('requestTimeoutMs')" class="badge good" title="Applies immediately to newly started upstream requests.">Live</span>
                </span>
                <input v-model="state.fields.requestTimeoutMs" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="field-label-row">
                  <span class="field-label">Queue timeout (ms)</span>
                  <span v-if="isLiveField('queueTimeoutMs')" class="badge good" title="Applies immediately to newly queued requests.">Live</span>
                </span>
                <input v-model="state.fields.queueTimeoutMs" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="field-label-row">
                  <span class="field-label">Health check interval (ms)</span>
                  <span v-if="isLiveField('healthCheckIntervalMs')" class="badge good" title="Applies immediately and refreshes the backend health timer without restarting llmproxy.">Live</span>
                </span>
                <input v-model="state.fields.healthCheckIntervalMs" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="field-label-row">
                  <span class="field-label">Recent request limit</span>
                  <span v-if="isLiveField('recentRequestLimit')" class="badge good" title="Applies immediately and trims retained request history in memory right away.">Live</span>
                </span>
                <input v-model="state.fields.recentRequestLimit" type="number" min="1" step="1" inputmode="numeric" />
              </label>
            </div>
          </div>
        </section>

        <div class="backend-editor-actions">
          <div v-if="state.error" class="inline-error">{{ state.error }}</div>
          <div class="toggle-row">
            <button class="button" type="button" :disabled="state.saving || state.loading" @click="submitDialog">
              {{ state.saving ? "Saving..." : "Save changes" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
