<script setup lang="ts">
import { computed } from "vue";
import DialogCloseButton from "./DialogCloseButton.vue";
import type { EditableServerConfig, ServerEditorState } from "../types/dashboard";

const props = defineProps<{
  state: ServerEditorState;
  currentConfig?: EditableServerConfig | null;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "save"): void;
}>();

const restartFieldLabels: Record<"host" | "port" | "dashboardPath", string> = {
  host: "host",
  port: "port",
  dashboardPath: "dashboard path",
};

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

function normalizeStringValue(value: string | undefined): string {
  return (value ?? "").trim();
}

const pendingRestartFields = computed(() => {
  const current = props.currentConfig;
  if (!current) {
    return [];
  }

  const changed: Array<keyof typeof restartFieldLabels> = [];

  if (normalizeStringValue(props.state.fields.host) !== normalizeStringValue(current.host)) {
    changed.push("host");
  }

  if (normalizeStringValue(props.state.fields.port) !== String(current.port)) {
    changed.push("port");
  }

  if (normalizeStringValue(props.state.fields.dashboardPath) !== normalizeStringValue(current.dashboardPath)) {
    changed.push("dashboardPath");
  }

  return changed;
});

const pendingRestartMessage = computed(() => {
  if (pendingRestartFields.value.length === 0) {
    return "";
  }

  const labels = pendingRestartFields.value.map((field) => restartFieldLabels[field]).join(", ");
  return `These edits change ${labels}. Save writes them to config, but llmproxy must be restarted before they take effect.`;
});

const hasPendingRestartEdits = computed(() => pendingRestartFields.value.length > 0);

function liveFieldSummary(): string {
  return "request timeout, queue timeout, health check interval, and recent request limit";
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
              Runtime settings like <span class="mono">{{ liveFieldSummary() }}</span> apply immediately where possible.
            </p>
          </div>
          <DialogCloseButton compact :disabled="state.saving" @click="closeDialog" />
        </div>

        <section class="request-detail-card">
          <div class="detail-card-viewport">
            <div v-if="hasPendingRestartEdits" class="config-notice warn mb-4">
              {{ pendingRestartMessage }}
            </div>
            <div class="field-grid backend-form-grid">
              <label class="field">
                <span class="field-label">Host</span>
                <input v-model="state.fields.host" type="text" autocomplete="off" spellcheck="false" placeholder="0.0.0.0" />
              </label>

              <label class="field">
                <span class="field-label">Port</span>
                <input v-model="state.fields.port" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field field-span-2">
                <span class="field-label">Dashboard path</span>
                <input v-model="state.fields.dashboardPath" type="text" autocomplete="off" spellcheck="false" placeholder="/dashboard" />
              </label>

              <label class="field">
                <span class="field-label">Request timeout (ms)</span>
                <input v-model="state.fields.requestTimeoutMs" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="field-label">Queue timeout (ms)</span>
                <input v-model="state.fields.queueTimeoutMs" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="field-label">Health check interval (ms)</span>
                <input v-model="state.fields.healthCheckIntervalMs" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="field-label">Recent request limit</span>
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
