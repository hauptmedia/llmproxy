<script setup lang="ts">
import CodeView from "../components/CodeView.vue";
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
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Chat</h2>
          <p class="hint">Send OpenAI-compatible chat requests through llmproxy and inspect transcript, metrics, and raw payloads.</p>
        </div>
      </div>

      <div class="debug-grid">
        <div class="debug-card">
          <form class="field-grid" @submit.prevent="store.sendDebugChat()">
            <div class="field">
              <label class="field-label" for="debug-model">Model</label>
              <div class="toggle-row">
                <select id="debug-model" v-model="store.state.debug.model">
                  <option value="">Select a model</option>
                  <option v-for="model in store.state.models" :key="model.id" :value="model.id">
                    {{ model.id }}
                  </option>
                </select>
                <button class="button secondary small" type="button" @click="store.refreshModels()">Refresh Models</button>
              </div>
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
            <div>
              <h2 class="panel-title">Transcript</h2>
              <p class="hint">The chat debugger uses the same message component as the request inspector, so message rendering stays consistent.</p>
            </div>
          </div>

          <div v-if="store.debugMetaBadges.length" class="debug-meta">
            <span
              v-for="badge in store.debugMetaBadges"
              :key="badge.text + badge.title"
              :class="store.badgeClass(badge)"
              :title="badge.title"
            >
              {{ badge.text }}
            </span>
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
              No debug conversation yet. Send a request to populate the transcript.
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Raw Payloads</h2>
          <p class="hint">Pretty-formatted request and response payloads for the current debug session.</p>
        </div>
      </div>
      <div class="raw-grid">
        <div class="debug-card raw-box">
          <h3>Request</h3>
          <CodeView :value="store.state.debug.rawRequest" placeholder="No request has been sent yet." />
        </div>
        <div class="debug-card raw-box">
          <h3>Response</h3>
          <CodeView :value="store.state.debug.rawResponse" placeholder="No response has been received yet." />
        </div>
      </div>
    </div>
  </section>
</template>
