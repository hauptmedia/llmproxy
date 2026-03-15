<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import DialogCloseButton from "./DialogCloseButton.vue";
import { useDialogEscape } from "../composables/useDialogEscape";
import type { EditableServerConfig, ServerEditorState } from "../types/dashboard";

const props = defineProps<{
  state: ServerEditorState;
  currentConfig?: EditableServerConfig | null;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "save", fields: {
    host: string;
    port: string;
    requestTimeoutMs: string;
    queueTimeoutMs: string;
    healthCheckIntervalMs: string;
    recentRequestLimit: string;
    mcpServerEnabled: boolean;
  }): void;
}>();

const restartFieldLabels: Record<"host" | "port", string> = {
  host: "host",
  port: "port",
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

const draftFields = reactive({
  host: "",
  port: "",
  requestTimeoutMs: "",
  queueTimeoutMs: "",
  healthCheckIntervalMs: "",
  recentRequestLimit: "",
  mcpServerEnabled: true,
});

function assignDraftFields(): void {
  draftFields.host = props.state.fields.host;
  draftFields.port = props.state.fields.port;
  draftFields.requestTimeoutMs = props.state.fields.requestTimeoutMs;
  draftFields.queueTimeoutMs = props.state.fields.queueTimeoutMs;
  draftFields.healthCheckIntervalMs = props.state.fields.healthCheckIntervalMs;
  draftFields.recentRequestLimit = props.state.fields.recentRequestLimit;
  draftFields.mcpServerEnabled = props.state.fields.mcpServerEnabled;
}

watch(
  () => props.state.open,
  (open) => {
    if (open) {
      assignDraftFields();
    }
  },
  { immediate: true },
);

function closeDialog(): void {
  if (props.state.saving) {
    return;
  }

  emit("close");
}

function submitDialog(): void {
  emit("save", {
    host: draftFields.host,
    port: String(draftFields.port ?? ""),
    requestTimeoutMs: String(draftFields.requestTimeoutMs ?? ""),
    queueTimeoutMs: String(draftFields.queueTimeoutMs ?? ""),
    healthCheckIntervalMs: String(draftFields.healthCheckIntervalMs ?? ""),
    recentRequestLimit: String(draftFields.recentRequestLimit ?? ""),
    mcpServerEnabled: draftFields.mcpServerEnabled,
  });
}

function normalizeStringValue(value: string | number | undefined): string {
  if (typeof value === "number") {
    return String(value);
  }

  return (value ?? "").trim();
}

const pendingRestartFields = computed(() => {
  const current = props.currentConfig;
  if (!current) {
    return [];
  }

  const changed: Array<keyof typeof restartFieldLabels> = [];

  if (normalizeStringValue(draftFields.host) !== normalizeStringValue(current.host)) {
    changed.push("host");
  }

  if (normalizeStringValue(draftFields.port) !== String(current.port)) {
    changed.push("port");
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

useDialogEscape(
  () => props.state.open,
  closeDialog,
);

</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="request-detail-overlay server-editor-overlay"
      @click.self="closeDialog"
    >
      <div class="request-detail-dialog server-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="server-editor-title">
        <div class="panel-header">
          <div>
            <h2 id="server-editor-title" class="panel-title">Edit llmproxy config</h2>
            <p class="hint">
              Changes are written to <span class="mono">llmproxy.config.json</span>.
              Runtime settings apply immediately where possible.
            </p>
          </div>
          <DialogCloseButton :disabled="state.saving" @click="closeDialog" />
        </div>

        <section class="request-detail-card">
          <div class="detail-card-viewport">
            <div v-if="hasPendingRestartEdits" class="config-notice warn mb-4">
              {{ pendingRestartMessage }}
            </div>
            <div class="field-grid backend-form-grid">
              <label class="field">
                <span class="field-label">Host</span>
                <input v-model="draftFields.host" type="text" autocomplete="off" spellcheck="false" placeholder="0.0.0.0" />
              </label>

              <label class="field">
                <span class="field-label">Port</span>
                <input v-model="draftFields.port" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="field-label">Request timeout (ms)</span>
                <input v-model="draftFields.requestTimeoutMs" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="field-label">Queue timeout (ms)</span>
                <input v-model="draftFields.queueTimeoutMs" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="field-label">Health check interval (ms)</span>
                <input v-model="draftFields.healthCheckIntervalMs" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="field-label">Recent request limit</span>
                <input v-model="draftFields.recentRequestLimit" type="number" min="1" step="1" inputmode="numeric" />
              </label>

              <label class="field field-span-2">
                <span class="field-label">MCP server</span>
                <label class="chat-composer-tool-toggle server-editor-toggle">
                  <input
                    v-model="draftFields.mcpServerEnabled"
                    type="checkbox"
                  >
                  <span>Enable MCP endpoint and tools</span>
                </label>
              </label>
            </div>
          </div>
        </section>

        <div class="backend-editor-actions">
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
