<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDiagnosticsCapabilities } from "../composables/useDiagnosticsCapabilities";
import { useDashboardStore } from "../composables/useDashboardStore";
import type {
  DiagnosticPromptPayload,
  DiagnosticsReportPayload,
} from "../types/dashboard";
import { getDiagnosticPrompt } from "../utils/diagnostics-mcp";
import { formatDuration } from "../utils/formatters";
import { readErrorResponse } from "../utils/http";
import { buildDiagnosticsRequestOptions } from "../utils/request-catalog";

const store = useDashboardStore();
const route = useRoute();
const router = useRouter();
const { mcpServerEnabled, promptDefinitions } = useDiagnosticsCapabilities();
const selectedRequestId = ref("");
const loadingReport = ref(false);
const loadingPrompt = ref(false);
const diagnosticsPayload = ref<DiagnosticsReportPayload | null>(null);
const promptPayload = ref<DiagnosticPromptPayload | null>(null);
const selectedPromptName = ref("");

const availableRequests = computed(() => buildDiagnosticsRequestOptions(store.state.snapshot, store.shortId));

const selectedReport = computed(() => (
  diagnosticsPayload.value?.report ?? null
));

const promptButtons = computed(() => {
  const recommended = new Set(selectedReport.value?.recommendedPrompts ?? []);
  return [...promptDefinitions.value].sort((left, right) => {
    const leftRecommended = recommended.has(left.name);
    const rightRecommended = recommended.has(right.name);
    if (leftRecommended === rightRecommended) {
      return left.title.localeCompare(right.title);
    }

    return leftRecommended ? -1 : 1;
  });
});

function normalizeSelectedRequestId(value: unknown): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim() : "";
}

watch(
  availableRequests,
  (requests) => {
    if (requests.length === 0) {
      selectedRequestId.value = "";
      diagnosticsPayload.value = null;
      promptPayload.value = null;
      return;
    }

    const requestedByRoute = normalizeSelectedRequestId(route.query.requestId);
    if (requestedByRoute && requests.some((request) => request.id === requestedByRoute)) {
      if (selectedRequestId.value !== requestedByRoute) {
        selectedRequestId.value = requestedByRoute;
      }
      return;
    }

    if (!selectedRequestId.value || !requests.some((request) => request.id === selectedRequestId.value)) {
      selectedRequestId.value = requests[0]?.id ?? "";
    }
  },
  { immediate: true },
);

watch(
  () => route.query.requestId,
  (queryValue) => {
    const normalized = normalizeSelectedRequestId(queryValue);
    if (!normalized || normalized === selectedRequestId.value) {
      return;
    }

    if (availableRequests.value.some((request) => request.id === normalized)) {
      selectedRequestId.value = normalized;
    }
  },
  { immediate: true },
);

watch(
  selectedRequestId,
  (requestId, previousRequestId) => {
    const normalizedRouteRequestId = normalizeSelectedRequestId(route.query.requestId);
    if (requestId !== normalizedRouteRequestId) {
      const nextQuery = { ...route.query };
      if (requestId) {
        nextQuery.requestId = requestId;
      } else {
        delete nextQuery.requestId;
      }

      void router.replace({ query: nextQuery });
    }

    if (!requestId || requestId === previousRequestId) {
      return;
    }

    void loadDiagnosticsReport(requestId);
  },
  { immediate: true },
);

watch(
  mcpServerEnabled,
  (enabled) => {
    if (enabled !== true || !selectedRequestId.value || !diagnosticsPayload.value || loadingPrompt.value) {
      return;
    }

    if (promptPayload.value) {
      return;
    }

    const preferredPrompt = selectedPromptName.value
      || diagnosticsPayload.value.report.recommendedPrompts[0]
      || "diagnose-request";
    void loadPrompt(preferredPrompt);
  },
  { immediate: true },
);

async function loadDiagnosticsReport(requestId: string): Promise<void> {
  loadingReport.value = true;

  try {
    const response = await fetch(`/api/diagnostics/requests/${encodeURIComponent(requestId)}`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(await readErrorResponse(response));
    }

    diagnosticsPayload.value = await response.json() as DiagnosticsReportPayload;
    if (mcpServerEnabled.value) {
      const preferredPrompt = selectedPromptName.value
        || diagnosticsPayload.value.report.recommendedPrompts[0]
        || "diagnose-request";
      await loadPrompt(preferredPrompt);
    } else {
      selectedPromptName.value = "";
      promptPayload.value = null;
    }
  } catch (error) {
    diagnosticsPayload.value = null;
    promptPayload.value = null;
    store.showToast("Diagnostics", error instanceof Error ? error.message : String(error));
  } finally {
    loadingReport.value = false;
  }
}

async function loadPrompt(promptName: string): Promise<void> {
  if (!selectedRequestId.value || !mcpServerEnabled.value) {
    return;
  }

  selectedPromptName.value = promptName;
  loadingPrompt.value = true;

  try {
    promptPayload.value = await getDiagnosticPrompt(promptName, selectedRequestId.value);
  } catch (error) {
    promptPayload.value = null;
    store.showToast("Diagnostics", error instanceof Error ? error.message : String(error));
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
    store.showToast("Diagnostics", "Prompt copied to clipboard.", "good", 2600);
  } catch (error) {
    store.showToast("Diagnostics", error instanceof Error ? error.message : String(error));
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
    store.showToast("Diagnostics", "The selected diagnostics prompt does not include a user message.");
    return;
  }

  store.prepareDebugChatDraft(systemPrompt, userPrompt);
  await router.push({ name: "chat" });
}

function openSelectedRequest(): void {
  if (!selectedRequestId.value) {
    return;
  }

  void store.openRequestDetail(selectedRequestId.value);
}
</script>

<template>
  <section class="page-section diagnostics-page-section">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Diagnostics</h2>
        </div>
        <button
          class="icon-button compact"
          type="button"
          :disabled="!selectedRequestId"
          title="Open selected request in the request debugger"
          aria-label="Open selected request in the request debugger"
          @click="openSelectedRequest"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 12s3.7-6 9.5-6 9.5 6 9.5 6-3.7 6-9.5 6-9.5-6-9.5-6Z"></path>
            <circle cx="12" cy="12" r="2.8"></circle>
          </svg>
        </button>
      </div>

      <div class="diagnostics-toolbar">
        <div class="field diagnostics-toolbar-field">
          <label class="field-label" for="diagnostics-request-select">Request</label>
          <select
            id="diagnostics-request-select"
            v-model="selectedRequestId"
            class="diagnostics-request-select"
            :disabled="availableRequests.length === 0"
          >
            <option v-if="availableRequests.length === 0" value="">No stored request detail available</option>
            <option v-for="request in availableRequests" :key="request.id" :value="request.id">
              {{ request.label }}
            </option>
          </select>
        </div>
      </div>

    </div>

    <div v-if="selectedReport">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">LLM actions</h2>
            <p class="panel-subtitle">
              Ready-made prompt playbooks that call into the same diagnostics context an MCP client can use.
            </p>
          </div>
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
              :class="{ active: selectedPromptName === prompt.name, recommended: selectedReport.recommendedPrompts.includes(prompt.name) }"
              @click="loadPrompt(prompt.name)"
            >
              <div class="diagnostics-action-title">
                {{ prompt.title }}
                <span v-if="selectedReport.recommendedPrompts.includes(prompt.name)" class="diagnostics-action-badge">Suggested</span>
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
      </div>
    </div>

    <div v-else class="panel">
      <div class="empty">
        {{ loadingReport ? "Loading diagnostics..." : "Choose a stored request with detail to generate a diagnosis." }}
      </div>
    </div>
  </section>
</template>
