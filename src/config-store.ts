import { promises as fs } from "node:fs";
import path from "node:path";
import { BackendConfig, BackendConnector, ProxyConfig, ServerConfig } from "./types";

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  host: "0.0.0.0",
  port: 4100,
  dashboardPath: "/dashboard",
  requestTimeoutMs: 10 * 60 * 1000,
  queueTimeoutMs: 30 * 1000,
  healthCheckIntervalMs: 10 * 1000,
  recentRequestLimit: 1000,
};

export type BackendPatch = Partial<Pick<BackendConfig, "enabled" | "maxConcurrency">>;

export class ConfigStore {
  public readonly configPath: string;

  public constructor(configPath = resolveConfigPath()) {
    this.configPath = configPath;
  }

  public async load(): Promise<ProxyConfig> {
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
    await fs.writeFile(this.configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
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
    dashboardPath:
      typeof config?.dashboardPath === "string" && config.dashboardPath.startsWith("/")
        ? config.dashboardPath
        : DEFAULT_SERVER_CONFIG.dashboardPath,
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
    models: Array.isArray(config.models)
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
  return value === "ollama" ? "ollama" : "openai";
}
