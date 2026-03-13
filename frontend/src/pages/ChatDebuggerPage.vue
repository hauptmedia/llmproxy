<script setup lang="ts">
import { computed, ref } from "vue";
import ConversationSurface from "../components/ConversationSurface.vue";
import MessageCard from "../components/MessageCard.vue";
import type { DebugTranscriptEntry } from "../types/dashboard";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
const hasTranscript = computed(() => store.state.debug.transcript.length > 0);
const trimmedSystemPrompt = computed(() => store.state.debug.systemPrompt.trim());
const showAdvancedParameters = ref(false);
const advancedParamHelp = {
  temperature: "Controls randomness. Lower values are more deterministic, higher values are more creative. Typical range: 0.0 to 2.0. This UI accepts values >= 0.",
  top_p: "Nucleus sampling. The model samples only from the smallest token set whose cumulative probability reaches this value. Range: 0.0 to 1.0.",
  top_k: "Limits sampling to the K most likely next tokens. Lower values are stricter. Typical values: 0 to 100. This UI accepts integers >= 0.",
  min_p: "Filters out very unlikely tokens whose probability falls below a relative threshold. Range: 0.0 to 1.0.",
  repeat_penalty: "Penalizes repeated tokens. 1.0 means no penalty. Typical range: 1.0 to 1.5. This UI accepts values > 0.",
  max_tokens: "Maximum completion tokens to generate for the response. This UI accepts integers >= 1. The effective limit may still be lower if the backend or model enforces a smaller cap.",
} as const;

function handleChatPromptKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();

  if (!store.state.debug.sending) {
    void store.sendDebugChat();
  }
}

function shouldCollapseDebugReasoning(entry: DebugTranscriptEntry, index: number): boolean {
  const isActiveStreamingAssistantTurn =
    store.state.debug.sending &&
    entry.role === "assistant" &&
    index === store.state.debug.transcript.length - 1 &&
    typeof entry.reasoning_content === "string" &&
    entry.reasoning_content.length > 0 &&
    !(typeof entry.finish_reason === "string" && entry.finish_reason.length > 0);

  return !isActiveStreamingAssistantTurn;
}

const chatConversationSignature = computed(() => [
  hasTranscript.value ? "ready" : "initial",
  trimmedSystemPrompt.value,
  store.state.debug.sending ? "sending" : "idle",
  store.state.debug.transcript.map((entry) => [
    entry.role,
    typeof entry.content === "string" ? entry.content.length : JSON.stringify(entry.content ?? null).length,
    entry.reasoning_content?.length ?? 0,
    entry.finish_reason ?? "",
    entry.backend ?? "",
  ].join(":")).join("|"),
].join("|"));
</script>

<template>
  <section class="page-section chat-page-section">
    <div class="chat-panel">
      <div class="chat-thread">
        <ConversationSurface
          title="Conversation"
          card-class="chat-conversation-card"
          viewport-class="chat-conversation-viewport"
          :reset-key="hasTranscript ? 'ready' : 'initial'"
          :scroll-signature="chatConversationSignature"
          follow-mode="latest-turn-start"
          :follow-anchor-active="store.state.debug.sending"
        >
          <template #headerActions>
            <button
              v-if="store.state.debug.lastRequestId"
              class="icon-button compact"
              type="button"
              aria-label="Open the last debug request in the request debugger"
              title="Open the last debug request in the request debugger."
              @click="store.openLastDebugRequest()"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.5 12s3.7-6 9.5-6 9.5 6 9.5 6-3.7 6-9.5 6-9.5-6-9.5-6Z"></path>
                <circle cx="12" cy="12" r="2.8"></circle>
              </svg>
            </button>
            <button
              v-if="hasTranscript"
              class="icon-button compact"
              type="button"
              aria-label="Clear the current chat conversation"
              title="Clear the current chat conversation"
              @click="store.clearDebugChat()"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 4.75h6"></path>
                <path d="M4.75 7.5h14.5"></path>
                <path d="M7.5 7.5 8.2 17a2 2 0 0 0 2 1.85h3.6a2 2 0 0 0 2-1.85l.7-9.5"></path>
                <path d="M10 11v4.5"></path>
                <path d="M14 11v4.5"></path>
              </svg>
            </button>
          </template>

            <div class="transcript chat-transcript">
              <div v-if="!hasTranscript" class="turn system chat-editor-turn">
                <textarea
                  id="debug-system-prompt"
                  v-model="store.state.debug.systemPrompt"
                  class="chat-editor-textarea"
                  placeholder="Optional high-level instruction (System Prompt) for the model."
                ></textarea>
              </div>

            <MessageCard
              v-else-if="trimmedSystemPrompt"
              :message="{ role: 'system', content: trimmedSystemPrompt }"
              :index="0"
              :reasoning-collapsed="true"
            />

            <form v-if="!hasTranscript" class="turn user chat-editor-turn" @submit.prevent="store.sendDebugChat()">
              <textarea
                id="debug-prompt"
                v-model="store.state.debug.prompt"
                class="chat-editor-textarea"
                placeholder="Enter the first user message to send through the proxy."
                @keydown="handleChatPromptKeydown"
              ></textarea>
              <div v-if="showAdvancedParameters" class="chat-advanced-inline">
                <div class="chat-advanced-body">
                  <div class="param-grid">
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-temperature">Temperature</label>
                        <span class="chat-param-help" :title="advancedParamHelp.temperature" aria-label="Temperature help">i</span>
                      </div>
                      <input id="debug-temperature" v-model.number="store.state.debug.params.temperature" :title="advancedParamHelp.temperature" type="number" step="0.1" min="0" />
                    </div>
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-top-p">Top P</label>
                        <span class="chat-param-help" :title="advancedParamHelp.top_p" aria-label="Top P help">i</span>
                      </div>
                      <input id="debug-top-p" v-model.number="store.state.debug.params.top_p" :title="advancedParamHelp.top_p" type="number" step="0.01" min="0" max="1" />
                    </div>
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-top-k">Top K</label>
                        <span class="chat-param-help" :title="advancedParamHelp.top_k" aria-label="Top K help">i</span>
                      </div>
                      <input id="debug-top-k" v-model.number="store.state.debug.params.top_k" :title="advancedParamHelp.top_k" type="number" step="1" min="0" />
                    </div>
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-min-p">Min P</label>
                        <span class="chat-param-help" :title="advancedParamHelp.min_p" aria-label="Min P help">i</span>
                      </div>
                      <input id="debug-min-p" v-model.number="store.state.debug.params.min_p" :title="advancedParamHelp.min_p" type="number" step="0.01" min="0" max="1" />
                    </div>
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-repeat-penalty">Repeat Penalty</label>
                        <span class="chat-param-help" :title="advancedParamHelp.repeat_penalty" aria-label="Repeat Penalty help">i</span>
                      </div>
                      <input id="debug-repeat-penalty" v-model.number="store.state.debug.params.repeat_penalty" :title="advancedParamHelp.repeat_penalty" type="number" step="0.05" min="0" />
                    </div>
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-max-tokens">Max Tokens</label>
                        <span class="chat-param-help" :title="advancedParamHelp.max_tokens" aria-label="Max Tokens help">i</span>
                      </div>
                      <input id="debug-max-tokens" v-model.number="store.state.debug.params.max_tokens" :title="advancedParamHelp.max_tokens" type="number" step="1" min="1" />
                    </div>
                  </div>
                </div>
              </div>
              <div class="chat-composer-actions">
                <div class="chat-composer-settings">
                  <div class="field chat-composer-model-field">
                    <div class="chat-composer-model-inline-control">
                      <label class="field-label chat-composer-model-label" for="debug-model">Model</label>
                      <select id="debug-model" v-model="store.state.debug.model" class="chat-composer-model-select">
                        <option value="auto">auto</option>
                        <option v-for="model in store.state.models" :key="model.id" :value="model.id">
                          {{ model.id }}
                        </option>
                      </select>
                    </div>
                  </div>
                  <button
                    class="icon-button compact"
                    type="button"
                    :aria-label="showAdvancedParameters ? 'Hide advanced parameters' : 'Show advanced parameters'"
                    :title="showAdvancedParameters ? 'Hide advanced parameters' : 'Show advanced parameters'"
                    @click="showAdvancedParameters = !showAdvancedParameters"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 7h10"></path>
                      <path d="M18 7h2"></path>
                      <path d="M14 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"></path>
                      <path d="M4 12h4"></path>
                      <path d="M12 12h8"></path>
                      <path d="M8 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"></path>
                      <path d="M4 17h10"></path>
                      <path d="M18 17h2"></path>
                      <path d="M14 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"></path>
                    </svg>
                  </button>
                </div>
                <div class="chat-composer-primary-actions">
                  <button class="button" type="submit" :disabled="store.state.debug.sending">
                    {{ store.state.debug.sending ? "Sending..." : "Send first message" }}
                  </button>
                </div>
              </div>
            </form>

            <MessageCard
              v-for="(entry, index) in store.state.debug.transcript"
              :key="index + ':' + entry.role + ':' + (entry.backend || '')"
              :message="entry"
              :index="Number(index) + (trimmedSystemPrompt ? 1 : 0)"
              :finish-reason="entry.finish_reason || ''"
              :reasoning-collapsed="shouldCollapseDebugReasoning(entry, Number(index))"
            />
          </div>

          <template #footer>
            <form
              v-if="hasTranscript && !store.state.debug.sending"
              class="chat-composer chat-composer-inline"
              @submit.prevent="store.sendDebugChat()"
            >
              <textarea
                id="debug-follow-up"
                v-model="store.state.debug.prompt"
                class="chat-editor-textarea"
                placeholder="Enter the next message to continue the conversation."
                @keydown="handleChatPromptKeydown"
              ></textarea>
              <div v-if="showAdvancedParameters" class="chat-advanced-inline">
                <div class="chat-advanced-body">
                  <div class="param-grid">
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-temperature-follow-up">Temperature</label>
                        <span class="chat-param-help" :title="advancedParamHelp.temperature" aria-label="Temperature help">i</span>
                      </div>
                      <input id="debug-temperature-follow-up" v-model.number="store.state.debug.params.temperature" :title="advancedParamHelp.temperature" type="number" step="0.1" min="0" />
                    </div>
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-top-p-follow-up">Top P</label>
                        <span class="chat-param-help" :title="advancedParamHelp.top_p" aria-label="Top P help">i</span>
                      </div>
                      <input id="debug-top-p-follow-up" v-model.number="store.state.debug.params.top_p" :title="advancedParamHelp.top_p" type="number" step="0.01" min="0" max="1" />
                    </div>
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-top-k-follow-up">Top K</label>
                        <span class="chat-param-help" :title="advancedParamHelp.top_k" aria-label="Top K help">i</span>
                      </div>
                      <input id="debug-top-k-follow-up" v-model.number="store.state.debug.params.top_k" :title="advancedParamHelp.top_k" type="number" step="1" min="0" />
                    </div>
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-min-p-follow-up">Min P</label>
                        <span class="chat-param-help" :title="advancedParamHelp.min_p" aria-label="Min P help">i</span>
                      </div>
                      <input id="debug-min-p-follow-up" v-model.number="store.state.debug.params.min_p" :title="advancedParamHelp.min_p" type="number" step="0.01" min="0" max="1" />
                    </div>
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-repeat-penalty-follow-up">Repeat Penalty</label>
                        <span class="chat-param-help" :title="advancedParamHelp.repeat_penalty" aria-label="Repeat Penalty help">i</span>
                      </div>
                      <input id="debug-repeat-penalty-follow-up" v-model.number="store.state.debug.params.repeat_penalty" :title="advancedParamHelp.repeat_penalty" type="number" step="0.05" min="0" />
                    </div>
                    <div class="field">
                      <div class="field-label-row">
                        <label class="field-label" for="debug-max-tokens-follow-up">Max Tokens</label>
                        <span class="chat-param-help" :title="advancedParamHelp.max_tokens" aria-label="Max Tokens help">i</span>
                      </div>
                      <input id="debug-max-tokens-follow-up" v-model.number="store.state.debug.params.max_tokens" :title="advancedParamHelp.max_tokens" type="number" step="1" min="1" />
                    </div>
                  </div>
                </div>
              </div>
              <div class="chat-composer-actions">
                <div class="chat-composer-settings">
                  <div class="field chat-composer-model-field">
                    <div class="chat-composer-model-inline-control">
                      <label class="field-label chat-composer-model-label" for="debug-follow-up-model">Model</label>
                      <select id="debug-follow-up-model" v-model="store.state.debug.model" class="chat-composer-model-select">
                        <option value="auto">auto</option>
                        <option v-for="model in store.state.models" :key="model.id" :value="model.id">
                          {{ model.id }}
                        </option>
                      </select>
                    </div>
                  </div>
                  <button
                    class="icon-button compact"
                    type="button"
                    :aria-label="showAdvancedParameters ? 'Hide advanced parameters' : 'Show advanced parameters'"
                    :title="showAdvancedParameters ? 'Hide advanced parameters' : 'Show advanced parameters'"
                    @click="showAdvancedParameters = !showAdvancedParameters"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 7h10"></path>
                      <path d="M18 7h2"></path>
                      <path d="M14 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"></path>
                      <path d="M4 12h4"></path>
                      <path d="M12 12h8"></path>
                      <path d="M8 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"></path>
                      <path d="M4 17h10"></path>
                      <path d="M18 17h2"></path>
                      <path d="M14 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"></path>
                    </svg>
                  </button>
                </div>
                <div class="chat-composer-primary-actions">
                  <button class="button" type="submit" :disabled="store.state.debug.sending">
                    {{ store.state.debug.sending ? "Sending..." : "Send follow-up" }}
                  </button>
                </div>
              </div>
            </form>
          </template>
        </ConversationSurface>
      </div>
    </div>
  </section>
</template>
