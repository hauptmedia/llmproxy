<script setup lang="ts">
import MessageCard from "../components/MessageCard.vue";
import type { DebugTranscriptEntry } from "../types/dashboard";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();

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
</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="debug-grid">
        <div class="debug-card">
          <form class="field-grid" @submit.prevent="store.sendDebugChat()">
            <div class="field">
              <label class="field-label" for="debug-model">Model</label>
              <select id="debug-model" v-model="store.state.debug.model">
                <option value="">Select a model</option>
                <option v-for="model in store.state.models" :key="model.id" :value="model.id">
                  {{ model.id }}
                </option>
              </select>
            </div>

            <div class="field">
              <label class="field-label" for="debug-system-prompt">System Prompt</label>
              <textarea
                id="debug-system-prompt"
                v-model="store.state.debug.systemPrompt"
                placeholder="Optional high-level instructions for the model."
              ></textarea>
            </div>

            <div class="field">
              <label class="field-label" for="debug-prompt">User Message</label>
              <textarea
                id="debug-prompt"
                v-model="store.state.debug.prompt"
                placeholder="Enter the next user message to send through the proxy."
              ></textarea>
            </div>

            <div class="toggle-row">
              <label class="inline-toggle">
                <input v-model="store.state.debug.stream" type="checkbox" />
                Stream response
              </label>
            </div>

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

            <div class="debug-actions">
              <button class="button" type="submit" :disabled="store.state.debug.sending">
                {{ store.state.debug.sending ? "Sending..." : "Send Request" }}
              </button>
              <button class="button secondary" type="button" :disabled="!store.state.debug.sending" @click="store.stopDebugChat()">
                Stop
              </button>
              <button class="button ghost" type="button" @click="store.clearDebugChat()">
                Clear
              </button>
            </div>
          </form>
        </div>

        <div class="debug-card">
          <div class="panel-header">
            <div class="flex items-center gap-2">
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
          </div>

          <div class="transcript">
            <MessageCard
              v-if="store.state.debug.systemPrompt.trim()"
              :message="{ role: 'system', content: store.state.debug.systemPrompt.trim() }"
              :index="0"
              :reasoning-collapsed="true"
            />
            <MessageCard
              v-for="(entry, index) in store.state.debug.transcript"
              :key="index + ':' + entry.role + ':' + (entry.backend || '')"
              :message="entry"
              :index="Number(index) + (store.state.debug.systemPrompt.trim() ? 1 : 0)"
              :finish-reason="entry.finish_reason || ''"
              :reasoning-collapsed="shouldCollapseDebugReasoning(entry, Number(index))"
            />
            <div
              v-if="!store.state.debug.systemPrompt.trim() && store.state.debug.transcript.length === 0"
              class="empty"
            >
              No conversation yet. Send a message to begin the conversation.
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
