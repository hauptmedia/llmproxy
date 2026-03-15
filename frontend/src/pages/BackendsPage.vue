<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BackendEditorDialog from "../components/BackendEditorDialog.vue";
import BackendTable from "../components/BackendTable.vue";
import ToolDefinitionsView from "../components/ToolDefinitionsView.vue";
import { useDiagnosticsCapabilities } from "../composables/useDiagnosticsCapabilities";
import { useDashboardStore } from "../composables/useDashboardStore";
import { formatDuration } from "../utils/formatters";
import type { McpToolDefinition } from "../types/dashboard";

type ConfigTab = "general" | "openai" | "mcp" | "backends";
type ConnectorParameterSupport = "forwarded" | "mapped" | "ignored" | "dropped";

interface OpenAiConnectorNote {
  title: string;
  description: string;
}

interface OpenAiParameterSupportRow {
  parameter: string;
  openai: ConnectorParameterSupport;
  ollama: ConnectorParameterSupport;
  llamaCpp: ConnectorParameterSupport;
  notes: string;
}

interface OpenAiSupportLegendRow {
  state: ConnectorParameterSupport;
  description: string;
}

const store = useDashboardStore();
const { endpointUrl, loadCapabilities, loadingCapabilities, mcpServerEnabled, serviceDefinitions } = useDiagnosticsCapabilities();
const activeTab = ref<ConfigTab>("general");
const openAiBaseUrl = `${window.location.origin}`;

const configTabs: Array<{ key: ConfigTab; label: string }> = [
  { key: "general", label: "General Settings" },
  { key: "openai", label: "OpenAI compatible API" },
  { key: "mcp", label: "MCP Server" },
  { key: "backends", label: "Backends" },
];

function mapToolDefinitionsForRenderer(tools: readonly McpToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  }));
}

const mcpServicesForDocs = computed(() => (
  activeTab.value === "mcp"
    ? serviceDefinitions.value.map((service) => ({
      ...service,
      helperRoutes: service.helperRoutes.map((route) => ({ ...route })),
      toolsForRenderer: mapToolDefinitionsForRenderer(service.tools),
    }))
    : []
));
const currentBackendConfig = computed(() => {
  const backendId = store.state.backendEditor.originalId;
  return backendId ? store.state.backendConfigs[backendId] ?? null : null;
});

const openAiRouteRows = [
  {
    route: `GET ${openAiBaseUrl}/v1/models`,
    purpose: "List the aggregated model catalog exposed by llmproxy in the standard OpenAI-compatible model-list format.",
  },
  {
    route: `POST ${openAiBaseUrl}/v1/chat/completions`,
    purpose: "Run chat completions through llmproxy with the normal OpenAI-compatible request body, including streaming, tools, and generation parameters.",
  },
];

const openAiConnectorNotes: OpenAiConnectorNote[] = [
  {
    title: "OpenAI backends",
    description:
      "Forward the OpenAI-compatible request body almost unchanged. llmproxy only removes top_k, min_p, and repeat_penalty before sending the request upstream.",
  },
  {
    title: "Ollama backends",
    description:
      "Translate the supported OpenAI-style fields into Ollama's native /api/chat payload. Fields not listed in the matrix below are not connector-mapped for Ollama.",
  },
  {
    title: "llama.cpp backends",
    description:
      "Forward the OpenAI-compatible request body unchanged, including llama.cpp-style sampler fields such as top_k, min_p, and repeat_penalty.",
  },
];

const openAiSupportLegend: OpenAiSupportLegendRow[] = [
  {
    state: "forwarded",
    description: "llmproxy sends the field upstream unchanged. The upstream backend still needs to understand it.",
  },
  {
    state: "mapped",
    description: "llmproxy translates the field into the connector's native request format.",
  },
  {
    state: "ignored",
    description: "llmproxy accepts the field on the public route, but this connector does not emit it upstream.",
  },
  {
    state: "dropped",
    description: "llmproxy removes the field before forwarding the upstream request.",
  },
];

const openAiParameterSupportRows: OpenAiParameterSupportRow[] = [
  {
    parameter: "model",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Required model id. Ollama receives it as the native model field.",
  },
  {
    parameter: "messages",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Ollama normalizes chat messages, multimodal content, and tool-call payloads into its native message format.",
  },
  {
    parameter: "stream",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Accepted on all connectors. llmproxy may still enable upstream streaming internally when it needs streaming transport.",
  },
  {
    parameter: "tools",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Ollama receives native tools, and assistant tool-call arguments are normalized into JSON objects when possible.",
  },
  {
    parameter: "tool_choice",
    openai: "forwarded",
    ollama: "ignored",
    llamaCpp: "forwarded",
    notes: "Currently not translated into Ollama's native /api/chat payload.",
  },
  {
    parameter: "temperature",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Mapped to Ollama options.temperature.",
  },
  {
    parameter: "top_p",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Mapped to Ollama options.top_p.",
  },
  {
    parameter: "top_k",
    openai: "dropped",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Removed only for openai backends. Ollama maps it to options.top_k.",
  },
  {
    parameter: "min_p",
    openai: "dropped",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Removed only for openai backends. Ollama maps it to options.min_p.",
  },
  {
    parameter: "repeat_penalty",
    openai: "dropped",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Removed only for openai backends. Ollama maps it to options.repeat_penalty.",
  },
  {
    parameter: "seed",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Mapped to Ollama options.seed.",
  },
  {
    parameter: "stop",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "String and string[] are accepted. Ollama always receives stop sequences as an array.",
  },
  {
    parameter: "max_completion_tokens",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Preferred completion limit field. Ollama maps it to options.num_predict when max_tokens is not set.",
  },
  {
    parameter: "max_tokens",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Legacy-compatible alias. Ollama also maps it to options.num_predict and it takes precedence if both limit fields are present.",
  },
  {
    parameter: "response_format",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Ollama receives this as format. llmproxy also accepts a direct format field for Ollama-native callers.",
  },
  {
    parameter: "keep_alive",
    openai: "forwarded",
    ollama: "mapped",
    llamaCpp: "forwarded",
    notes: "Mainly useful for Ollama. Other upstreams only honor it if they support the same field name.",
  },
];

const serverConfigRows = computed(() => {
  const config = store.state.serverConfig;
  if (!config) {
    return [];
  }

  return [
    {
      key: "Host",
      value: config.host,
      title: "Bind host for the llmproxy server.",
    },
    {
      key: "Port",
      value: String(config.port),
      title: "Bind port for the llmproxy server.",
    },
    {
      key: "Request timeout",
      value: `${config.requestTimeoutMs} ms (${formatDuration(config.requestTimeoutMs)})`,
      title: "Maximum time llmproxy waits for an upstream request before aborting it.",
    },
    {
      key: "Queue timeout",
      value: `${config.queueTimeoutMs} ms (${formatDuration(config.queueTimeoutMs)})`,
      title: "Maximum time a request may wait for a free backend slot.",
    },
    {
      key: "Health check interval",
      value: `${config.healthCheckIntervalMs} ms (${formatDuration(config.healthCheckIntervalMs)})`,
      title: "How often llmproxy refreshes backend health state.",
    },
    {
      key: "Recent request limit",
      value: String(config.recentRequestLimit),
      title: "Maximum number of retained request rows kept in memory and shown in the dashboard.",
    },
    {
      key: "MCP server",
      value: config.mcpServerEnabled ? "enabled" : "disabled",
      title: "Controls whether the llmproxy MCP endpoint and its registered services are exposed to clients.",
    },
  ];
});

watch(
  activeTab,
  (tab) => {
    if (tab === "mcp" && mcpServerEnabled.value !== false) {
      void loadCapabilities();
    }
  },
  { immediate: true },
);

</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="panel-header config-panel-header">
        <div class="request-detail-tab-bar config-tab-bar">
          <button
            v-for="tab in configTabs"
            :key="tab.key"
            type="button"
            :class="['request-detail-tab-button', activeTab === tab.key ? 'active' : '']"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
      <div v-if="store.state.serverEditor.notice" :class="['mb-4', 'config-notice', store.state.serverEditor.noticeTone]">
        {{ store.state.serverEditor.notice }}
      </div>
      <div v-if="activeTab === 'general'" class="config-tab-panel">
        <div class="panel-header config-section-head">
          <button
            class="icon-button compact"
            type="button"
            title="Edit llmproxy config"
            aria-label="Edit llmproxy config"
            @click="store.openServerEditor"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"></path>
            </svg>
          </button>
        </div>
        <div v-if="serverConfigRows.length" class="detail-table-wrap">
          <table class="detail-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in serverConfigRows" :key="row.key">
                <td :title="row.title" class="detail-table-key">{{ row.key }}</td>
                <td :title="row.title" class="detail-table-value mono">{{ row.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty">Loading llmproxy config...</div>
      </div>

      <div v-else-if="activeTab === 'openai'" class="config-tab-panel">
        <div
          class="mcp-endpoint-card"
          title="Base URL for the OpenAI-compatible llmproxy API."
        >
          <div class="mcp-endpoint-label">Endpoint</div>
          <div class="mcp-endpoint-value mono">{{ openAiBaseUrl }}</div>
        </div>
        <div class="diagnostics-tools">
          <div class="diagnostics-section-label">Available routes</div>
          <div class="detail-table-wrap">
            <table class="detail-table">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in openAiRouteRows" :key="row.route">
                  <td :title="row.purpose" class="detail-table-value mono">{{ row.route }}</td>
                  <td :title="row.purpose" class="detail-table-value">{{ row.purpose }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="diagnostics-tools">
          <div class="diagnostics-section-label">Connector behavior</div>
          <div class="mcp-prompt-grid">
            <article
              v-for="note in openAiConnectorNotes"
              :key="note.title"
              class="mcp-prompt-card"
            >
              <div class="mcp-prompt-title">{{ note.title }}</div>
              <div class="mcp-prompt-description">{{ note.description }}</div>
            </article>
          </div>
        </div>
        <div class="diagnostics-tools">
          <div class="diagnostics-section-label">Chat completion parameter support</div>
          <p class="diagnostics-prompt-description">
            This matrix documents how llmproxy handles the most important fields for
            <span class="mono">POST {{ openAiBaseUrl }}/v1/chat/completions</span>.
            Fields not listed here are forwarded unchanged for <span class="mono">openai</span> and
            <span class="mono">llama.cpp</span> backends, but are not connector-mapped for
            <span class="mono">ollama</span> unless they appear below.
          </p>
          <div class="mcp-prompt-grid">
            <article
              v-for="row in openAiSupportLegend"
              :key="row.state"
              class="mcp-prompt-card"
            >
              <div class="mcp-prompt-title mono">{{ row.state }}</div>
              <div class="mcp-prompt-description">{{ row.description }}</div>
            </article>
          </div>
          <div class="detail-table-wrap">
            <table class="detail-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>openai</th>
                  <th>ollama</th>
                  <th>llama.cpp</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in openAiParameterSupportRows" :key="row.parameter">
                  <td :title="row.notes" class="detail-table-value mono">{{ row.parameter }}</td>
                  <td :title="row.notes" class="detail-table-value mono">{{ row.openai }}</td>
                  <td :title="row.notes" class="detail-table-value mono">{{ row.ollama }}</td>
                  <td :title="row.notes" class="detail-table-value mono">{{ row.llamaCpp }}</td>
                  <td :title="row.notes" class="detail-table-value">{{ row.notes }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'mcp'" class="config-tab-panel">
        <div
          class="mcp-endpoint-card"
          title="Canonical JSON-RPC MCP endpoint exposed by llmproxy."
        >
          <div class="mcp-endpoint-label">Endpoint</div>
          <div class="mcp-endpoint-value mono">{{ endpointUrl }}</div>
        </div>
        <div class="diagnostics-tools">
          <div class="diagnostics-section-label">Available llmproxy functions</div>
          <div class="diagnostics-tools-list">
            <template v-if="mcpServicesForDocs.length">
              <article
                v-for="service in mcpServicesForDocs"
                :key="service.id"
                class="mcp-service-card"
              >
                <div class="mcp-service-head">
                  <h3 class="mcp-service-title">{{ service.title }}</h3>
                  <p class="mcp-service-description">{{ service.description }}</p>
                </div>

                <div v-if="service.toolsForRenderer.length" class="mcp-service-section">
                  <div class="diagnostics-section-label">Tools</div>
                  <ToolDefinitionsView :tools="service.toolsForRenderer" />
                </div>
              </article>
            </template>
            <div v-else-if="mcpServerEnabled === false" class="empty">
              MCP server is disabled in config.
            </div>
            <div v-else class="empty">
              {{ loadingCapabilities ? "Loading llmproxy functions..." : "No llmproxy function metadata loaded yet." }}
            </div>
          </div>
        </div>
      </div>

      <div v-else class="config-tab-panel">
        <div class="panel-header config-section-head">
          <button
            class="icon-button compact"
            type="button"
            title="Add backend configuration"
            aria-label="Add backend configuration"
            @click="store.openCreateBackend"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14"></path>
              <path d="M5 12h14"></path>
            </svg>
          </button>
        </div>
        <BackendTable
          v-if="!store.state.backendEditor.open"
          :backends="store.state.snapshot.backends"
          mode="config"
          @edit-backend="store.openEditBackend"
          @delete-backend="store.deleteBackendById"
        />
      </div>
    </div>
    <BackendEditorDialog
      :state="store.state.backendEditor"
      :current-config="currentBackendConfig"
      @close="store.closeBackendEditor"
      @save="store.saveBackendEditor"
    />
  </section>
</template>
