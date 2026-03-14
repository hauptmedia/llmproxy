import { onMounted, readonly, ref } from "vue";
import type {
  DiagnosticPromptDefinition,
  DiagnosticsToolDefinition,
} from "../types/dashboard";
import { listDiagnosticPrompts, listDiagnosticsTools } from "../utils/diagnostics-mcp";
import { useDashboardStore } from "./useDashboardStore";

const loadingCapabilitiesState = ref(false);
const toolDefinitionsState = ref<DiagnosticsToolDefinition[]>([]);
const promptDefinitionsState = ref<DiagnosticPromptDefinition[]>([]);
const endpointUrl = `${window.location.origin}/api/diagnostics/mcp`;

let capabilitiesLoaded = false;
let loadPromise: Promise<void> | null = null;

export function useDiagnosticsCapabilities() {
  const store = useDashboardStore();

  async function loadCapabilities(): Promise<void> {
    if (capabilitiesLoaded) {
      return;
    }

    if (loadPromise) {
      await loadPromise;
      return;
    }

    loadingCapabilitiesState.value = true;
    loadPromise = (async () => {
      try {
        const [tools, prompts] = await Promise.all([
          listDiagnosticsTools(),
          listDiagnosticPrompts(),
        ]);
        toolDefinitionsState.value = tools;
        promptDefinitionsState.value = prompts;
        capabilitiesLoaded = true;
      } catch (error) {
        store.showToast("Diagnostics", error instanceof Error ? error.message : String(error));
      } finally {
        loadingCapabilitiesState.value = false;
        loadPromise = null;
      }
    })();

    await loadPromise;
  }

  onMounted(() => {
    void loadCapabilities();
  });

  return {
    endpointUrl,
    loadingCapabilities: readonly(loadingCapabilitiesState),
    toolDefinitions: readonly(toolDefinitionsState),
    promptDefinitions: readonly(promptDefinitionsState),
    loadCapabilities,
  };
}
