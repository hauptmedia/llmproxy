import { promises as fs } from "node:fs";
import path from "node:path";
import { BackendConfig, BackendConnector, BackendEditorConfig, BackendSavePayload, ProxyConfig, ProxyEditorConfig, ServerConfig } from "./types";

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  host: "0.0.0.0",
  port: 4100,
  requestTimeoutMs: 10 * 60 * 1000,
  queueTimeoutMs: 30 * 1000,
  healthCheckIntervalMs: 10 * 1000,
  recentRequestLimit: 1000,
  mcpServerEnabled: true,
};

export type BackendPatch = Partial<Pick<BackendConfig, "enabled" | "maxConcurrency">>;

export class ConfigStore {
  public readonly configPath: string;

  public constructor(configPath = resolveConfigPath()) {
    this.configPath = configPath;
  }

  public async load(): Promise<ProxyConfig> {
    await this.ensureConfigExists();
    const raw = await fs.readFile(this.configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProxyConfig>;
    return normalizeConfig(parsed, this.configPath);
  }

  public async updateBackend(id: string, patch: BackendPatch): Promise<ProxyConfig> {
    const current = await this.load();
    const backend = current.backends.find((entry) => entry.id === id);

    if (!backend) {
      throw new Error(`Backend "${id}" was not found in ${this.configPath}.`);
    }

    if (patch.enabled !== undefined) {
      backend.enabled = patch.enabled;
    }

    if (patch.maxConcurrency !== undefined) {
      backend.maxConcurrency = patch.maxConcurrency;
    }

    const next = normalizeConfig(current, this.configPath);
    await this.writeConfig(next);
    return next;
  }

  public async updateServerConfig(server: ServerConfig): Promise<ProxyConfig> {
    const current = await this.load();
    current.server = normalizeServerConfig(server);

    const next = normalizeConfig(current, this.configPath);
    await this.writeConfig(next);
    return next;
  }

  public async listEditableBackends(): Promise<BackendEditorConfig[]> {
    const current = await this.load();
    return current.backends.map(toBackendEditorConfig);
  }

  public async loadEditableConfig(): Promise<ProxyEditorConfig> {
    const current = await this.load();
    return {
      server: current.server,
      backends: current.backends.map(toBackendEditorConfig),
    };
  }

  public async createBackend(payload: BackendSavePayload): Promise<{ config: ProxyConfig; backend: BackendEditorConfig }> {
    const current = await this.load();
    const candidate = materializeBackendConfig(undefined, payload);
    current.backends.push(candidate);

    const next = normalizeConfig(current, this.configPath);
    await this.writeConfig(next);

    const createdBackend = next.backends.find((backend) => backend.id === candidate.id);
    if (!createdBackend) {
      throw new Error(`Backend "${candidate.id}" could not be created in ${this.configPath}.`);
    }

    return {
      config: next,
      backend: toBackendEditorConfig(createdBackend),
    };
  }

  public async replaceBackend(currentId: string, payload: BackendSavePayload): Promise<{ config: ProxyConfig; backend: BackendEditorConfig }> {
    const current = await this.load();
    const backendIndex = current.backends.findIndex((entry) => entry.id === currentId);

    if (backendIndex < 0) {
      throw new Error(`Backend "${currentId}" was not found in ${this.configPath}.`);
    }

    const candidate = materializeBackendConfig(current.backends[backendIndex], payload);
    current.backends.splice(backendIndex, 1, candidate);

    const next = normalizeConfig(current, this.configPath);
    await this.writeConfig(next);

    const updatedBackend = next.backends.find((backend) => backend.id === candidate.id);
    if (!updatedBackend) {
      throw new Error(`Backend "${candidate.id}" could not be updated in ${this.configPath}.`);
    }

    return {
      config: next,
      backend: toBackendEditorConfig(updatedBackend),
    };
  }

  public async deleteBackend(id: string): Promise<ProxyConfig> {
    const current = await this.load();
    const backendIndex = current.backends.findIndex((entry) => entry.id === id);

    if (backendIndex < 0) {
      throw new Error(`Backend "${id}" was not found in ${this.configPath}.`);
    }

    current.backends.splice(backendIndex, 1);

    const next = normalizeConfig(current, this.configPath);
    await this.writeConfig(next);
    return next;
  }

  private async writeConfig(config: ProxyConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, `${JSON.stringify(serializeConfig(config), null, 2)}\n`, "utf8");
  }

  private async ensureConfigExists(): Promise<void> {
    try {
      await fs.access(this.configPath);
      return;
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }

    await this.writeConfig(normalizeConfig({}, this.configPath));
  }
}

export function resolveBackendHeaders(backend: BackendConfig): Record<string, string> {
  const headers: Record<string, string> = { ...(backend.headers ?? {}) };
  const apiKey = backend.apiKeyEnv ? process.env[backend.apiKeyEnv] ?? backend.apiKey : backend.apiKey;

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function resolveConfigPath(): string {
  const fromEnv = process.env.LLMPROXY_CONFIG;
  return path.resolve(fromEnv ?? path.join(process.cwd(), "llmproxy.config.json"));
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  return "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function normalizeConfig(config: Partial<ProxyConfig>, configPath: string): ProxyConfig {
  const server = normalizeServerConfig(config.server);
  const backends = Array.isArray(config.backends) ? config.backends.map(normalizeBackendConfig) : [];
  const uniqueIds = new Set<string>();

  for (const backend of backends) {
    if (uniqueIds.has(backend.id)) {
      throw new Error(`Duplicate backend id "${backend.id}" in ${configPath}.`);
    }

    uniqueIds.add(backend.id);
  }

  return { server, backends };
}

function normalizeServerConfig(config?: Partial<ServerConfig>): ServerConfig {
  return {
    host: typeof config?.host === "string" && config.host.trim().length > 0 ? config.host.trim() : DEFAULT_SERVER_CONFIG.host,
    port: typeof config?.port === "number" && config.port > 0 ? config.port : DEFAULT_SERVER_CONFIG.port,
    requestTimeoutMs:
      typeof config?.requestTimeoutMs === "number" && config.requestTimeoutMs > 0
        ? config.requestTimeoutMs
        : DEFAULT_SERVER_CONFIG.requestTimeoutMs,
    queueTimeoutMs:
      typeof config?.queueTimeoutMs === "number" && config.queueTimeoutMs > 0
        ? config.queueTimeoutMs
        : DEFAULT_SERVER_CONFIG.queueTimeoutMs,
    healthCheckIntervalMs:
      typeof config?.healthCheckIntervalMs === "number" && config.healthCheckIntervalMs > 0
        ? config.healthCheckIntervalMs
        : DEFAULT_SERVER_CONFIG.healthCheckIntervalMs,
    recentRequestLimit:
      typeof config?.recentRequestLimit === "number" && Number.isInteger(config.recentRequestLimit) && config.recentRequestLimit > 0
        ? config.recentRequestLimit
        : DEFAULT_SERVER_CONFIG.recentRequestLimit,
    mcpServerEnabled:
      typeof config?.mcpServerEnabled === "boolean"
        ? config.mcpServerEnabled
        : DEFAULT_SERVER_CONFIG.mcpServerEnabled,
  };
}

function normalizeBackendConfig(config: Partial<BackendConfig>): BackendConfig {
  if (!config.id || typeof config.id !== "string") {
    throw new Error("Every backend requires a string id.");
  }

  if (!config.name || typeof config.name !== "string") {
    throw new Error(`Backend "${config.id}" requires a string name.`);
  }

  if (!config.baseUrl || typeof config.baseUrl !== "string") {
    throw new Error(`Backend "${config.id}" requires a string baseUrl.`);
  }

  return {
    id: config.id.trim(),
    name: config.name.trim(),
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
    connector: normalizeConnector(config.connector),
    enabled: config.enabled !== false,
    maxConcurrency:
      typeof config.maxConcurrency === "number" && Number.isInteger(config.maxConcurrency) && config.maxConcurrency > 0
        ? config.maxConcurrency
        : 1,
    healthPath:
      typeof config.healthPath === "string" && config.healthPath.trim().length > 0 ? config.healthPath.trim() : undefined,
    models: Array.isArray(config.allowedModels)
      ? config.allowedModels
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
      : Array.isArray(config.models)
        ? config.models
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
        : undefined,
    headers:
      config.headers && typeof config.headers === "object"
        ? Object.fromEntries(
            Object.entries(config.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          )
        : undefined,
    apiKey: typeof config.apiKey === "string" && config.apiKey.trim().length > 0 ? config.apiKey : undefined,
    apiKeyEnv: typeof config.apiKeyEnv === "string" && config.apiKeyEnv.trim().length > 0 ? config.apiKeyEnv : undefined,
    timeoutMs: typeof config.timeoutMs === "number" && config.timeoutMs > 0 ? config.timeoutMs : undefined,
  };
}

function normalizeConnector(value: unknown): BackendConnector {
  if (value === "llama.cpp") {
    return "llama.cpp";
  }

  return value === "ollama" ? "ollama" : "openai";
}

function serializeConfig(config: ProxyConfig): Record<string, unknown> {
  return {
    server: config.server,
    backends: config.backends.map(serializeBackendConfig),
  };
}

function serializeBackendConfig(backend: BackendConfig): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    id: backend.id,
    name: backend.name,
    baseUrl: backend.baseUrl,
    connector: backend.connector,
    enabled: backend.enabled,
    maxConcurrency: backend.maxConcurrency,
  };

  if (backend.healthPath) {
    serialized.healthPath = backend.healthPath;
  }

  if (backend.models && backend.models.length > 0) {
    serialized.allowedModels = [...backend.models];
  }

  if (backend.headers && Object.keys(backend.headers).length > 0) {
    serialized.headers = { ...backend.headers };
  }

  if (backend.apiKey) {
    serialized.apiKey = backend.apiKey;
  }

  if (backend.apiKeyEnv) {
    serialized.apiKeyEnv = backend.apiKeyEnv;
  }

  if (backend.timeoutMs) {
    serialized.timeoutMs = backend.timeoutMs;
  }

  return serialized;
}

function materializeBackendConfig(current: BackendConfig | undefined, payload: BackendSavePayload): BackendConfig {
  const nextApiKey =
    payload.clearApiKey
      ? undefined
      : (typeof payload.apiKey === "string" && payload.apiKey.trim().length > 0
          ? payload.apiKey.trim()
          : current?.apiKey);

  return normalizeBackendConfig({
    id: payload.id,
    name: payload.name,
    baseUrl: payload.baseUrl,
    connector: payload.connector,
    enabled: payload.enabled,
    maxConcurrency: payload.maxConcurrency,
    healthPath: payload.healthPath,
    models: payload.models,
    headers: payload.headers,
    apiKey: nextApiKey,
    apiKeyEnv: payload.apiKeyEnv,
    timeoutMs: payload.timeoutMs,
  });
}

function toBackendEditorConfig(backend: BackendConfig): BackendEditorConfig {
  return {
    id: backend.id,
    name: backend.name,
    baseUrl: backend.baseUrl,
    connector: backend.connector === "ollama"
      ? "ollama"
      : backend.connector === "llama.cpp"
        ? "llama.cpp"
        : "openai",
    enabled: backend.enabled,
    maxConcurrency: backend.maxConcurrency,
    healthPath: backend.healthPath,
    models: backend.models ? [...backend.models] : undefined,
    headers: backend.headers ? { ...backend.headers } : undefined,
    apiKeyEnv: backend.apiKeyEnv,
    apiKeyConfigured: typeof backend.apiKey === "string" && backend.apiKey.length > 0,
    timeoutMs: backend.timeoutMs,
  };
}
