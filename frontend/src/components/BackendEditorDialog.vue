<script setup lang="ts">
import { computed } from "vue";
import type { BackendEditorState, EditableBackendConfig } from "../types/dashboard";

const props = defineProps<{
  state: BackendEditorState;
  currentConfig?: EditableBackendConfig | null;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "save"): void;
}>();

const title = computed(() => props.state.mode === "create" ? "Add backend" : "Edit backend");
const saveLabel = computed(() => props.state.mode === "create" ? "Add backend" : "Save changes");
const hasStoredApiKey = computed(() => Boolean(props.currentConfig?.apiKeyConfigured));

function closeDialog(): void {
  if (props.state.saving) {
    return;
  }

  emit("close");
}

function submitDialog(): void {
  emit("save");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="request-detail-overlay"
      @click.self="closeDialog"
    >
      <div class="request-detail-dialog backend-editor-dialog">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">{{ title }}</h2>
            <p class="hint">Changes are written to <span class="mono">llmproxy.config.json</span> and become active immediately.</p>
          </div>
          <button class="icon-button compact" type="button" title="Close" aria-label="Close" :disabled="state.saving" @click="closeDialog">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6L18 18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
              <path d="M18 6L6 18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
            </svg>
          </button>
        </div>

        <div class="backend-editor-grid">
          <section class="request-detail-card">
            <div class="detail-card-viewport">
              <div class="field-grid backend-form-grid">
                <label class="field">
                  <span class="field-label">ID</span>
                  <input v-model="state.fields.id" type="text" autocomplete="off" spellcheck="false" />
                </label>

                <label class="field">
                  <span class="field-label">Name</span>
                  <input v-model="state.fields.name" type="text" autocomplete="off" />
                </label>

                <label class="field">
                  <span class="field-label">Base URL</span>
                  <input v-model="state.fields.baseUrl" type="text" placeholder="http://127.0.0.1:8080" autocomplete="off" spellcheck="false" />
                </label>

                <label class="field">
                  <span class="field-label">Connector</span>
                  <select v-model="state.fields.connector">
                    <option value="openai">OpenAI-compatible</option>
                    <option value="ollama">Ollama</option>
                  </select>
                </label>

                <label class="field">
                  <span class="field-label">Max concurrency</span>
                  <input v-model="state.fields.maxConcurrency" type="number" min="1" step="1" inputmode="numeric" />
                </label>

                <label class="field">
                  <span class="field-label">Request timeout (ms)</span>
                  <input v-model="state.fields.timeoutMs" type="number" min="1" step="1" inputmode="numeric" placeholder="inherit server default" />
                </label>

                <label class="field field-span-2">
                  <span class="field-label">Health path</span>
                  <input
                    v-model="state.fields.healthPath"
                    type="text"
                    :placeholder="state.fields.connector === 'ollama' ? '/api/tags' : '/v1/models'"
                    autocomplete="off"
                    spellcheck="false"
                  />
                </label>

                <label class="field field-span-2 checkbox-field">
                  <input v-model="state.fields.enabled" type="checkbox" />
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
                    v-model="state.fields.modelsText"
                    placeholder="One model or pattern per line, for example:*&#10;llama-*"
                    spellcheck="false"
                  ></textarea>
                </label>

                <label class="field">
                  <span class="field-label">Headers (JSON)</span>
                  <textarea
                    v-model="state.fields.headersText"
                    placeholder="{&#10;  &quot;x-api-key&quot;: &quot;...&quot;&#10;}"
                    spellcheck="false"
                  ></textarea>
                </label>

                <label class="field">
                  <span class="field-label">API key env</span>
                  <input v-model="state.fields.apiKeyEnv" type="text" autocomplete="off" spellcheck="false" placeholder="UPSTREAM_API_KEY" />
                </label>

                <label class="field">
                  <span class="field-label">API key</span>
                  <input v-model="state.fields.apiKey" type="password" autocomplete="new-password" placeholder="Leave empty to keep current secret" />
                </label>

                <label v-if="hasStoredApiKey" class="field checkbox-field">
                  <input v-model="state.fields.clearApiKey" type="checkbox" />
                  <span>Clear stored API key</span>
                </label>
              </div>
            </div>
          </section>
        </div>

        <div class="backend-editor-actions">
          <div v-if="state.error" class="inline-error">{{ state.error }}</div>
          <div class="toggle-row">
            <button class="button" type="button" :disabled="state.saving" @click="submitDialog">
              {{ state.saving ? "Saving..." : saveLabel }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
