import type {
  BackendEditorFields,
  BackendEditorState,
  BackendSnapshot,
  DashboardState,
  EditableServerConfig,
  EditableBackendConfig,
  KnownModel,
  ProxySnapshot,
  ServerEditorFields,
} from "../types/dashboard";
import { readErrorResponse } from "../utils/http";
import { collectSnapshotModels } from "../utils/model-catalog";

interface BackendListResponse {
  server?: EditableServerConfig;
  data?: EditableBackendConfig[];
}

interface ServerConfigSaveResponse {
  server?: EditableServerConfig;
  restartRequiredFields?: string[];
  appliedImmediatelyFields?: string[];
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

function createServerFields(config?: EditableServerConfig | null): ServerEditorFields {
  return {
    host: config?.host ?? "",
    port: config ? String(config.port) : "",
    dashboardPath: config?.dashboardPath ?? "/dashboard",
    requestTimeoutMs: config ? String(config.requestTimeoutMs) : "",
    queueTimeoutMs: config ? String(config.queueTimeoutMs) : "",
    healthCheckIntervalMs: config ? String(config.healthCheckIntervalMs) : "",
    recentRequestLimit: config ? String(config.recentRequestLimit) : "",
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
  editor.deleting = false;
  editor.loading = false;
  editor.error = "";
  editor.fields = createEmptyBackendFields();
}

function closeServerEditorState(state: DashboardState): void {
  state.serverEditor.open = false;
  state.serverEditor.saving = false;
  state.serverEditor.loading = false;
  state.serverEditor.error = "";
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

function isServerConfigSaveResponse(value: unknown): value is ServerConfigSaveResponse {
  return Boolean(value) && typeof value === "object";
}

function formatServerFieldLabel(field: string): string {
  if (field === "host") {
    return "host";
  }

  if (field === "port") {
    return "port";
  }

  if (field === "dashboardPath") {
    return "dashboard path";
  }

  if (field === "requestTimeoutMs") {
    return "request timeout";
  }

  if (field === "queueTimeoutMs") {
    return "queue timeout";
  }

  if (field === "healthCheckIntervalMs") {
    return "health check interval";
  }

  if (field === "recentRequestLimit") {
    return "recent request limit";
  }

  return field;
}

function joinFieldLabels(fields: string[]): string {
  return fields.map(formatServerFieldLabel).join(", ");
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
      state.serverConfig = isBackendListResponse(payload) && payload.server ? payload.server : null;
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
    state.backendEditor.deleting = false;
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
    state.backendEditor.deleting = false;
    state.backendEditor.error = "";
    state.backendEditor.fields = toBackendFields(config);
  }

  function closeBackendEditor(): void {
    resetBackendEditor(state.backendEditor);
  }

  async function openServerEditor(): Promise<void> {
    state.serverEditor.error = "";

    if (!state.serverConfig) {
      state.serverEditor.loading = true;
      await loadBackendConfigs();
      state.serverEditor.loading = false;
    }

    if (!state.serverConfig) {
      state.serverEditor.error = "llmproxy config could not be loaded from disk.";
      return;
    }

    state.serverEditor.open = true;
    state.serverEditor.fields = createServerFields(state.serverConfig);
  }

  function closeServerEditor(): void {
    closeServerEditorState(state);
  }

  async function saveServerEditor(): Promise<void> {
    state.serverEditor.error = "";

    try {
      const requestBody = {
        host: state.serverEditor.fields.host.trim(),
        port: parsePositiveIntegerField(state.serverEditor.fields.port, "port"),
        dashboardPath: state.serverEditor.fields.dashboardPath.trim(),
        requestTimeoutMs: parsePositiveIntegerField(state.serverEditor.fields.requestTimeoutMs, "requestTimeoutMs"),
        queueTimeoutMs: parsePositiveIntegerField(state.serverEditor.fields.queueTimeoutMs, "queueTimeoutMs"),
        healthCheckIntervalMs: parsePositiveIntegerField(state.serverEditor.fields.healthCheckIntervalMs, "healthCheckIntervalMs"),
        recentRequestLimit: parsePositiveIntegerField(state.serverEditor.fields.recentRequestLimit, "recentRequestLimit"),
      };

      state.serverEditor.saving = true;

      const response = await fetch("/api/config/server", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const payload = await response.json() as unknown;
      const persistedServerConfig = isServerConfigSaveResponse(payload) && payload.server ? payload.server : null;
      const restartRequiredFields = isServerConfigSaveResponse(payload) && Array.isArray(payload.restartRequiredFields)
        ? payload.restartRequiredFields.filter((field): field is string => typeof field === "string" && field.length > 0)
        : [];
      const appliedImmediatelyFields = isServerConfigSaveResponse(payload) && Array.isArray(payload.appliedImmediatelyFields)
        ? payload.appliedImmediatelyFields.filter((field): field is string => typeof field === "string" && field.length > 0)
        : [];

      await loadBackendConfigs();
      if (persistedServerConfig) {
        state.serverConfig = persistedServerConfig;
      }

      state.serverEditor.restartRequiredFields = restartRequiredFields;
      state.serverEditor.appliedImmediatelyFields = appliedImmediatelyFields;

      if (restartRequiredFields.length > 0 && appliedImmediatelyFields.length > 0) {
        state.serverEditor.notice = `Saved. Applied immediately: ${joinFieldLabels(appliedImmediatelyFields)}. Restart llmproxy to apply: ${joinFieldLabels(restartRequiredFields)}.`;
        state.serverEditor.noticeTone = "warn";
      } else if (restartRequiredFields.length > 0) {
        state.serverEditor.notice = `Saved. Restart llmproxy to apply: ${joinFieldLabels(restartRequiredFields)}.`;
        state.serverEditor.noticeTone = "warn";
      } else if (appliedImmediatelyFields.length > 0) {
        state.serverEditor.notice = `Saved and applied immediately: ${joinFieldLabels(appliedImmediatelyFields)}.`;
        state.serverEditor.noticeTone = "good";
      } else {
        state.serverEditor.notice = "Saved. No config values changed.";
        state.serverEditor.noticeTone = "neutral";
      }

      closeServerEditorState(state);
    } catch (error) {
      state.serverEditor.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.serverEditor.saving = false;
    }
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

  async function deleteBackendEditor(): Promise<void> {
    const { mode, originalId, fields } = state.backendEditor;
    state.backendEditor.error = "";

    if (mode !== "edit" || !originalId) {
      return;
    }

    await deleteBackendById(originalId, fields.name || originalId, true);
  }

  async function deleteBackendById(backendId: string, displayName?: string, fromEditor = false): Promise<void> {
    state.backendEditor.error = "";
    const backendLabel = displayName || state.backendConfigs[backendId]?.name || backendId;

    const confirmed = window.confirm(
      `Remove backend "${backendLabel}" from llmproxy.config.json?\n\nThis takes effect immediately and new requests will no longer be routed to it.`,
    );

    if (!confirmed) {
      return;
    }

    if (fromEditor) {
      state.backendEditor.deleting = true;
    }

    try {
      const response = await fetch(`/api/backends/${encodeURIComponent(backendId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await loadBackendConfigs();
      if (state.backendEditor.open && state.backendEditor.originalId === backendId) {
        closeBackendEditor();
      }
    } catch (error) {
      state.backendEditor.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (fromEditor) {
        state.backendEditor.deleting = false;
      }
    }
  }

  return {
    applySnapshot,
    ensureDebugModel,
    loadBackendConfigs,
    openCreateBackend,
    openEditBackend,
    closeBackendEditor,
    openServerEditor,
    closeServerEditor,
    saveServerEditor,
    saveBackendEditor,
    deleteBackendEditor,
    deleteBackendById,
  };
}
