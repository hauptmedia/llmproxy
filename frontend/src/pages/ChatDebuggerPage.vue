<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import MessageCard from "../components/MessageCard.vue";
import type { DebugTranscriptEntry } from "../types/dashboard";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
const hasTranscript = computed(() => store.state.debug.transcript.length > 0);
const trimmedSystemPrompt = computed(() => store.state.debug.systemPrompt.trim());
const conversationViewport = ref<HTMLElement | null>(null);
const autoFollowConversation = ref(true);

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

function isConversationNearBottom(): boolean {
  const viewport = conversationViewport.value;
  if (!viewport) {
    return true;
  }

  return viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 28;
}

function scrollConversationToBottom(): void {
  const viewport = conversationViewport.value;
  if (!viewport) {
    return;
  }

  viewport.scrollTop = viewport.scrollHeight;
}

function scheduleConversationScrollToBottom(): void {
  void nextTick(() => {
    if (!autoFollowConversation.value) {
      return;
    }

    window.requestAnimationFrame(() => {
      scrollConversationToBottom();
    });
  });
}

function handleConversationScroll(): void {
  autoFollowConversation.value = isConversationNearBottom();
}

watch(
  () => hasTranscript.value,
  () => {
    autoFollowConversation.value = true;
    scheduleConversationScrollToBottom();
  },
);

watch(
  () => store.state.debug.transcript.map((entry) => [
    entry.role,
    typeof entry.content === "string" ? entry.content.length : JSON.stringify(entry.content ?? null).length,
    entry.reasoning_content?.length ?? 0,
    entry.finish_reason ?? "",
    entry.backend ?? "",
  ].join(":")).join("|"),
  () => {
    scheduleConversationScrollToBottom();
  },
);
</script>

<template>
  <section class="page-section">
    <div class="panel chat-panel">
      <div class="panel-header">
        <div class="flex items-center gap-3">
          <h2 class="panel-title">Conversation</h2>
          <button
            class="icon-button"
            type="button"
            :disabled="!store.state.debug.lastRequestId"
            :aria-label="store.state.debug.lastRequestId ? 'Open the last debug request in the request debugger' : 'No debug request is available yet'"
            :title="store.state.debug.lastRequestId ? 'Open the last debug request in the request debugger.' : 'No debug request is available yet.'"
            @click="store.openLastDebugRequest()"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2.5 12s3.7-6 9.5-6 9.5 6 9.5 6-3.7 6-9.5 6-9.5-6-9.5-6Z"></path>
              <circle cx="12" cy="12" r="2.8"></circle>
            </svg>
          </button>
        </div>
        <div class="debug-actions">
          <button class="button secondary small" type="button" :disabled="!store.state.debug.sending" @click="store.stopDebugChat()">
            Stop
          </button>
          <button class="button ghost small" type="button" @click="store.clearDebugChat()">
            Clear
          </button>
        </div>
      </div>

      <div class="chat-toolbar">
        <div class="field chat-model-field chat-model-inline">
          <label class="field-label chat-model-label" for="debug-model">Model</label>
          <select id="debug-model" v-model="store.state.debug.model">
            <option value="">Select a model</option>
            <option value="auto">auto</option>
            <option v-for="model in store.state.models" :key="model.id" :value="model.id">
              {{ model.id }}
            </option>
          </select>
        </div>

        <details class="chat-advanced-panel">
          <summary class="chat-advanced-summary">Advanced parameters</summary>
          <div class="chat-advanced-body">
            <p class="chat-advanced-note">Streaming is always enabled so llmproxy can show live metrics and keep the request debugger in sync.</p>
            <div class="param-grid">
              <div class="field">
                <label class="field-label" for="debug-temperature">Temperature</label>
                <input id="debug-temperature" v-model.number="store.state.debug.params.temperature" type="number" step="0.1" min="0" />
              </div>
              <div class="field">
                <label class="field-label" for="debug-top-p">Top P</label>
                <input id="debug-top-p" v-model.number="store.state.debug.params.top_p" type="number" step="0.01" min="0" max="1" />
              </div>
              <div class="field">
                <label class="field-label" for="debug-top-k">Top K</label>
                <input id="debug-top-k" v-model.number="store.state.debug.params.top_k" type="number" step="1" min="0" />
              </div>
              <div class="field">
                <label class="field-label" for="debug-min-p">Min P</label>
                <input id="debug-min-p" v-model.number="store.state.debug.params.min_p" type="number" step="0.01" min="0" max="1" />
              </div>
              <div class="field">
                <label class="field-label" for="debug-repeat-penalty">Repeat Penalty</label>
                <input id="debug-repeat-penalty" v-model.number="store.state.debug.params.repeat_penalty" type="number" step="0.05" min="0" />
              </div>
              <div class="field">
                <label class="field-label" for="debug-max-tokens">Max Tokens</label>
                <input id="debug-max-tokens" v-model.number="store.state.debug.params.max_tokens" type="number" step="1" min="1" />
              </div>
            </div>
          </div>
        </details>
      </div>

      <div v-if="store.state.debug.error" class="config-notice warn">
        {{ store.state.debug.error }}
      </div>

      <div class="chat-thread">
        <div class="request-detail-card chat-conversation-card">
          <div
            ref="conversationViewport"
            class="conversation-viewport chat-conversation-viewport"
            @scroll="handleConversationScroll"
          >
            <div class="transcript chat-transcript">
              <div v-if="!hasTranscript" class="turn system chat-editor-turn">
                <div class="turn-head">
                  <div class="turn-role">System</div>
                </div>
                <textarea
                  id="debug-system-prompt"
                  v-model="store.state.debug.systemPrompt"
                  class="chat-editor-textarea"
                  placeholder="Optional high-level instructions for the model."
                ></textarea>
              </div>

              <MessageCard
                v-else-if="trimmedSystemPrompt"
                :message="{ role: 'system', content: trimmedSystemPrompt }"
                :index="0"
                :reasoning-collapsed="true"
              />

              <form v-if="!hasTranscript" class="turn user chat-editor-turn" @submit.prevent="store.sendDebugChat()">
                <div class="turn-head">
                  <div class="turn-role">User</div>
                </div>
                <textarea
                  id="debug-prompt"
                  v-model="store.state.debug.prompt"
                  class="chat-editor-textarea"
                  placeholder="Enter the first user message to send through the proxy."
                ></textarea>
                <div class="chat-composer-actions">
                  <button class="button" type="submit" :disabled="store.state.debug.sending">
                    {{ store.state.debug.sending ? "Sending..." : "Send first message" }}
                  </button>
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
          </div>
        </div>

        <form v-if="hasTranscript" class="chat-composer" @submit.prevent="store.sendDebugChat()">
          <label class="field-label" for="debug-follow-up">Follow-up message</label>
          <textarea
            id="debug-follow-up"
            v-model="store.state.debug.prompt"
            class="chat-editor-textarea"
            placeholder="Enter the next message to continue the conversation."
          ></textarea>
          <div class="chat-composer-actions">
            <button class="button" type="submit" :disabled="store.state.debug.sending">
              {{ store.state.debug.sending ? "Sending..." : "Send follow-up" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>
