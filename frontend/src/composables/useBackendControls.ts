import type {
  BackendEditorFields,
  BackendEditorState,
  BackendSnapshot,
  DashboardState,
  EditableBackendConfig,
  KnownModel,
  ProxySnapshot,
} from "../types/dashboard";
import { readErrorResponse } from "../utils/http";
import { collectSnapshotModels } from "../utils/model-catalog";

interface BackendListResponse {
  data?: EditableBackendConfig[];
}

function createEmptyBackendFields(): BackendEditorFields {
  return {
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
  };
}

function toBackendFields(config: EditableBackendConfig): BackendEditorFields {
  return {
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    connector: config.connector,
    enabled: config.enabled,
    maxConcurrency: String(config.maxConcurrency),
    healthPath: config.healthPath ?? "",
    modelsText: config.models?.join("\n") ?? "",
    headersText: config.headers && Object.keys(config.headers).length > 0
      ? JSON.stringify(config.headers, null, 2)
      : "",
    apiKey: "",
    apiKeyEnv: config.apiKeyEnv ?? "",
    clearApiKey: false,
    timeoutMs: config.timeoutMs ? String(config.timeoutMs) : "",
  };
}

function resetBackendEditor(editor: BackendEditorState): void {
  editor.open = false;
  editor.mode = "create";
  editor.originalId = "";
  editor.saving = false;
  editor.loading = false;
  editor.error = "";
  editor.fields = createEmptyBackendFields();
}

function parseModelsText(modelsText: string): string[] | undefined {
  const models = modelsText
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return models.length > 0 ? models : undefined;
}

function parseHeadersText(headersText: string): Record<string, string> | undefined {
  if (!headersText.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(headersText);
  } catch {
    throw new Error("Headers must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Headers must be a JSON object of string values.");
  }

  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(`Header "${key}" must have a string value.`);
    }

    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }

    headers[normalizedKey] = normalizedValue;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function parsePositiveIntegerField(value: string, fieldName: string, allowEmpty = false): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    if (allowEmpty) {
      return undefined;
    }

    throw new Error(`"${fieldName}" is required.`);
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`"${fieldName}" must be a positive integer.`);
  }

  return parsed;
}

function normalizeBackendRecord(backends: EditableBackendConfig[]): Record<string, EditableBackendConfig> {
  return Object.fromEntries(
    backends.map((backend) => [backend.id, backend]),
  );
}

function isBackendListResponse(value: unknown): value is BackendListResponse {
  return Boolean(value) && typeof value === "object";
}

export function useBackendControls(state: DashboardState) {
  async function loadBackendConfigs(): Promise<void> {
    state.backendEditor.error = "";
    state.backendEditor.loading = true;

    try {
      const response = await fetch("/api/backends", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const payload = await response.json() as unknown;
      const backends = isBackendListResponse(payload) && Array.isArray(payload.data) ? payload.data : [];
      state.backendConfigs = normalizeBackendRecord(backends);
    } catch (error) {
      state.backendEditor.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.backendEditor.loading = false;
    }
  }

  function ensureDebugModel(): void {
    if (state.models.length === 0) {
      state.debug.model = "";
      return;
    }

    if (!state.debug.model || !state.models.some((model: KnownModel) => model.id === state.debug.model)) {
      state.debug.model = state.models[0].id;
    }
  }

  function syncModels(models: KnownModel[]): void {
    state.models = [...models].sort((left, right) => left.id.localeCompare(right.id));
    ensureDebugModel();
  }

  function applySnapshot(snapshot: ProxySnapshot): void {
    state.snapshot = snapshot;
    syncModels(collectSnapshotModels(snapshot));
  }

  function openCreateBackend(): void {
    state.backendEditor.open = true;
    state.backendEditor.mode = "create";
    state.backendEditor.originalId = "";
    state.backendEditor.saving = false;
    state.backendEditor.error = "";
    state.backendEditor.fields = createEmptyBackendFields();
  }

  async function openEditBackend(backendId: string): Promise<void> {
    state.backendEditor.error = "";

    if (!state.backendConfigs[backendId]) {
      await loadBackendConfigs();
    }

    const config = state.backendConfigs[backendId];
    if (!config) {
      state.backendEditor.error = `Backend "${backendId}" could not be loaded from config.`;
      return;
    }

    state.backendEditor.open = true;
    state.backendEditor.mode = "edit";
    state.backendEditor.originalId = backendId;
    state.backendEditor.saving = false;
    state.backendEditor.error = "";
    state.backendEditor.fields = toBackendFields(config);
  }

  function closeBackendEditor(): void {
    resetBackendEditor(state.backendEditor);
  }

  async function saveBackendEditor(): Promise<void> {
    const { fields, mode, originalId } = state.backendEditor;
    state.backendEditor.error = "";

    try {
      const requestBody = {
        id: fields.id.trim(),
        name: fields.name.trim(),
        baseUrl: fields.baseUrl.trim(),
        connector: fields.connector,
        enabled: fields.enabled,
        maxConcurrency: parsePositiveIntegerField(fields.maxConcurrency, "maxConcurrency"),
        healthPath: fields.healthPath.trim() || undefined,
        models: parseModelsText(fields.modelsText),
        headers: parseHeadersText(fields.headersText),
        apiKey: fields.apiKey.trim() || undefined,
        apiKeyEnv: fields.apiKeyEnv.trim() || undefined,
        clearApiKey: fields.clearApiKey,
        timeoutMs: parsePositiveIntegerField(fields.timeoutMs, "timeoutMs", true),
      };

      state.backendEditor.saving = true;

      const response = await fetch(
        mode === "create"
          ? "/api/backends"
          : `/api/backends/${encodeURIComponent(originalId)}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      );

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await loadBackendConfigs();
      closeBackendEditor();
    } catch (error) {
      state.backendEditor.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.backendEditor.saving = false;
    }
  }

  return {
    applySnapshot,
    ensureDebugModel,
    loadBackendConfigs,
    openCreateBackend,
    openEditBackend,
    closeBackendEditor,
    saveBackendEditor,
  };
}
