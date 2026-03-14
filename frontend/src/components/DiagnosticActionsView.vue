<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type {
  DiagnosticPromptPayload,
  DiagnosticReport,
} from "../types/dashboard";
import { useDiagnosticsCapabilities } from "../composables/useDiagnosticsCapabilities";
import { useDashboardStore } from "../composables/useDashboardStore";
import { getDiagnosticPrompt } from "../utils/diagnostics-mcp";

const props = defineProps<{
  requestId: string;
  report: DiagnosticReport | null;
}>();

const store = useDashboardStore();
const router = useRouter();
const { mcpServerEnabled, promptDefinitions } = useDiagnosticsCapabilities();
const loadingPrompt = ref(false);
const promptPayload = ref<DiagnosticPromptPayload | null>(null);
const selectedPromptName = ref("");

const promptButtons = computed(() => {
  const recommended = new Set(props.report?.recommendedPrompts ?? []);
  return [...promptDefinitions.value].sort((left, right) => {
    const leftRecommended = recommended.has(left.name);
    const rightRecommended = recommended.has(right.name);
    if (leftRecommended === rightRecommended) {
      return left.title.localeCompare(right.title);
    }

    return leftRecommended ? -1 : 1;
  });
});

watch(
  () => [props.requestId, props.report?.requestId, mcpServerEnabled.value] as const,
  async ([requestId, reportRequestId, enabled]) => {
    promptPayload.value = null;
    selectedPromptName.value = "";

    if (enabled !== true || !requestId || !reportRequestId || requestId !== reportRequestId) {
      return;
    }

    const preferredPrompt = props.report?.recommendedPrompts[0] || "diagnose-request";
    await loadPrompt(preferredPrompt);
  },
  { immediate: true },
);

async function loadPrompt(promptName: string): Promise<void> {
  if (!props.requestId || !props.report || mcpServerEnabled.value !== true) {
    return;
  }

  const requestIdAtStart = props.requestId;
  selectedPromptName.value = promptName;
  loadingPrompt.value = true;

  try {
    const payload = await getDiagnosticPrompt(promptName, requestIdAtStart);
    if (props.requestId !== requestIdAtStart) {
      return;
    }
    promptPayload.value = payload;
  } catch (error) {
    promptPayload.value = null;
    store.showToast("Diagnosis", error instanceof Error ? error.message : String(error));
  } finally {
    loadingPrompt.value = false;
  }
}

async function copyPrompt(): Promise<void> {
  if (!promptPayload.value || promptPayload.value.messages.length === 0) {
    return;
  }

  const promptText = promptPayload.value.messages
    .map((message) => `# ${message.role.toUpperCase()}\n\n${message.content.text}`)
    .join("\n\n");

  try {
    await navigator.clipboard.writeText(promptText);
    store.showToast("Diagnosis", "Prompt copied to clipboard.", "good", 2600);
  } catch (error) {
    store.showToast("Diagnosis", error instanceof Error ? error.message : String(error));
  }
}

async function openPromptInChat(): Promise<void> {
  if (!promptPayload.value || promptPayload.value.messages.length === 0) {
    return;
  }

  const systemPrompt = promptPayload.value.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const userPrompt = promptPayload.value.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.text.trim())
    .filter(Boolean)
    .join("\n\n");

  if (!userPrompt) {
    store.showToast("Diagnosis", "The selected diagnostics prompt does not include a user message.");
    return;
  }

  store.prepareDebugChatDraft(systemPrompt, userPrompt);
  store.closeRequestDetail();
  await router.push({ name: "chat" });
}
</script>

<template>
  <section class="request-detail-section diagnosis-actions-section">
    <div class="diagnosis-actions-head">
      <div class="diagnostics-section-label">LLM actions</div>
      <button
        class="icon-button compact"
        type="button"
        :disabled="!promptPayload || promptPayload.messages.length === 0"
        title="Copy the current diagnostics prompt"
        aria-label="Copy the current diagnostics prompt"
        @click="copyPrompt"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="10" height="10" rx="2"></rect>
          <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path>
        </svg>
      </button>
    </div>

    <div class="diagnostics-actions">
      <template v-if="mcpServerEnabled === true">
        <button
          v-for="prompt in promptButtons"
          :key="prompt.name"
          type="button"
          class="diagnostics-action-card"
          :class="{ active: selectedPromptName === prompt.name, recommended: report?.recommendedPrompts.includes(prompt.name) }"
          @click="loadPrompt(prompt.name)"
        >
          <div class="diagnostics-action-title">
            {{ prompt.title }}
            <span v-if="report?.recommendedPrompts.includes(prompt.name)" class="diagnostics-action-badge">Suggested</span>
          </div>
          <div class="diagnostics-action-description">{{ prompt.description }}</div>
        </button>
      </template>
      <div v-else-if="mcpServerEnabled === false" class="empty">Diagnostics MCP server is disabled in config.</div>
      <div v-else class="empty">Loading MCP capabilities...</div>
    </div>

    <div class="diagnostics-prompt-preview">
      <div class="diagnostics-prompt-preview-head">
        <div class="diagnostics-section-label">Prompt preview</div>
        <button
          class="icon-button compact"
          type="button"
          :disabled="!promptPayload || promptPayload.messages.length === 0"
          title="Start a new chat session from this diagnostics prompt"
          aria-label="Start a new chat session from this diagnostics prompt"
          @click="openPromptInChat"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5.5 7.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H11l-3 2.6V13.5h-.5a2 2 0 0 1-2-2Z"></path>
            <path d="M14 16.5h4.5"></path>
            <path d="M16.75 14.25 19 16.5l-2.25 2.25"></path>
          </svg>
        </button>
      </div>
      <template v-if="promptPayload">
        <div class="diagnostics-prompt-description">{{ promptPayload.description }}</div>
        <div
          v-for="(message, index) in promptPayload.messages"
          :key="`${message.role}-${index}`"
          class="diagnostics-prompt-message"
        >
          <div class="diagnostics-prompt-role">{{ message.role }}</div>
          <pre class="diagnostics-prompt-text">{{ message.content.text }}</pre>
        </div>
      </template>
      <div v-else-if="loadingPrompt" class="empty">Loading prompt preview...</div>
      <div v-else-if="mcpServerEnabled === false" class="empty">Prompt preview is unavailable while the diagnostics MCP server is disabled.</div>
      <div v-else-if="mcpServerEnabled !== true" class="empty">Loading MCP capabilities...</div>
      <div v-else class="empty">Choose a diagnostics action to preview the stored prompt.</div>
    </div>
  </section>
</template>
