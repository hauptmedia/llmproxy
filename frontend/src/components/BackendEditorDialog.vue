<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import DialogCloseButton from "./DialogCloseButton.vue";
import { useDialogEscape } from "../composables/useDialogEscape";
import type { BackendEditorFields, BackendEditorState, EditableBackendConfig } from "../types/dashboard";

const props = defineProps<{
  state: BackendEditorState;
  currentConfig?: EditableBackendConfig | null;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "save", fields: BackendEditorFields): void;
}>();

const title = computed(() => props.state.mode === "create" ? "Add backend" : "Edit backend");
const saveLabel = computed(() => props.state.mode === "create" ? "Add backend" : "Save changes");
const hasStoredApiKey = computed(() => Boolean(props.currentConfig?.apiKeyConfigured));
const draftFields = reactive<BackendEditorFields>({
  id: "",
  name: "",
  baseUrl: "",
  connector: "openai",
  enabled: true,
  maxConcurrency: "1",
  healthPath: "",
  modelsText: "*",
  headersText: "",
  apiKey: "",
  apiKeyEnv: "",
  clearApiKey: false,
  timeoutMs: "",
});

function assignDraftFields(): void {
  draftFields.id = props.state.fields.id;
  draftFields.name = props.state.fields.name;
  draftFields.baseUrl = props.state.fields.baseUrl;
  draftFields.connector = props.state.fields.connector;
  draftFields.enabled = props.state.fields.enabled;
  draftFields.maxConcurrency = props.state.fields.maxConcurrency;
  draftFields.healthPath = props.state.fields.healthPath;
  draftFields.modelsText = props.state.fields.modelsText;
  draftFields.headersText = props.state.fields.headersText;
  draftFields.apiKey = props.state.fields.apiKey;
  draftFields.apiKeyEnv = props.state.fields.apiKeyEnv;
  draftFields.clearApiKey = props.state.fields.clearApiKey;
  draftFields.timeoutMs = props.state.fields.timeoutMs;
}

watch(
  () => [props.state.open, props.state.mode, props.state.originalId, props.state.fields] as const,
  ([open]) => {
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
    id: draftFields.id,
    name: draftFields.name,
    baseUrl: draftFields.baseUrl,
    connector: draftFields.connector,
    enabled: draftFields.enabled,
    maxConcurrency: draftFields.maxConcurrency,
    healthPath: draftFields.healthPath,
    modelsText: draftFields.modelsText,
    headersText: draftFields.headersText,
    apiKey: draftFields.apiKey,
    apiKeyEnv: draftFields.apiKeyEnv,
    clearApiKey: draftFields.clearApiKey,
    timeoutMs: draftFields.timeoutMs,
  });
}

useDialogEscape(
  () => props.state.open,
  closeDialog,
);

</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="request-detail-overlay backend-editor-overlay"
      @click.self="closeDialog"
    >
      <div class="request-detail-dialog backend-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="backend-editor-title">
        <div class="panel-header">
          <div>
            <h2 id="backend-editor-title" class="panel-title">{{ title }}</h2>
            <p class="hint">Changes are written to <span class="mono">llmproxy.config.json</span> and become active immediately.</p>
          </div>
          <DialogCloseButton compact :disabled="state.saving" @click="closeDialog" />
        </div>

        <div class="backend-editor-grid">
          <section class="request-detail-card">
            <div class="detail-card-viewport">
              <div class="field-grid backend-form-grid">
                <label class="field">
                  <span class="field-label">ID</span>
                  <input v-model="draftFields.id" type="text" autocomplete="off" spellcheck="false" />
                </label>

                <label class="field">
                  <span class="field-label">Name</span>
                  <input v-model="draftFields.name" type="text" autocomplete="off" />
                </label>

                <label class="field">
                  <span class="field-label">Base URL</span>
                  <input v-model="draftFields.baseUrl" type="text" placeholder="http://127.0.0.1:8080" autocomplete="off" spellcheck="false" />
                </label>

                <label class="field">
                  <span class="field-label">Connector</span>
                  <select v-model="draftFields.connector">
                    <option value="openai">OpenAI-compatible</option>
                    <option value="llama.cpp">llama.cpp</option>
                    <option value="ollama">Ollama</option>
                  </select>
                </label>

                <label class="field">
                  <span class="field-label">Max concurrency</span>
                  <input v-model="draftFields.maxConcurrency" type="number" min="1" step="1" inputmode="numeric" />
                </label>

                <label class="field">
                  <span class="field-label">Request timeout (ms)</span>
                  <input v-model="draftFields.timeoutMs" type="number" min="1" step="1" inputmode="numeric" placeholder="inherit server default" />
                </label>

                <label class="field field-span-2">
                  <span class="field-label">Health path</span>
                  <input
                    v-model="draftFields.healthPath"
                    type="text"
                    :placeholder="draftFields.connector === 'ollama' ? '/api/tags' : '/v1/models'"
                    autocomplete="off"
                    spellcheck="false"
                  />
                </label>

                <label class="field field-span-2 checkbox-field">
                  <input v-model="draftFields.enabled" type="checkbox" />
                  <span>Backend enabled</span>
                </label>
              </div>
            </div>
          </section>

          <section class="request-detail-card">
            <div class="detail-card-viewport">
              <div class="field-grid">
                <label class="field">
                  <span class="field-label">Allowed models</span>
                  <textarea
                    v-model="draftFields.modelsText"
                    placeholder="One model or pattern per line, for example:*&#10;llama-*"
                    spellcheck="false"
                  ></textarea>
                </label>

                <label class="field">
                  <span class="field-label">Headers (JSON)</span>
                  <textarea
                    v-model="draftFields.headersText"
                    placeholder="{&#10;  &quot;x-api-key&quot;: &quot;...&quot;&#10;}"
                    spellcheck="false"
                  ></textarea>
                </label>

                <label class="field">
                  <span class="field-label">API key env</span>
                  <input v-model="draftFields.apiKeyEnv" type="text" autocomplete="off" spellcheck="false" placeholder="UPSTREAM_API_KEY" />
                </label>

                <label class="field">
                  <span class="field-label">API key</span>
                  <input v-model="draftFields.apiKey" type="password" autocomplete="new-password" placeholder="Leave empty to keep current secret" />
                </label>

                <label v-if="hasStoredApiKey" class="field checkbox-field">
                  <input v-model="draftFields.clearApiKey" type="checkbox" />
                  <span>Clear stored API key</span>
                </label>
              </div>
            </div>
          </section>
        </div>

        <div class="backend-editor-actions">
          <div class="toggle-row">
            <button class="button" type="button" :disabled="state.saving || state.deleting" @click="submitDialog">
              {{ state.saving ? "Saving..." : saveLabel }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
