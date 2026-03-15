import type { BackendSavePayload, ProxyConfig, ServerConfig } from "./types";
import { isPositiveInteger } from "./utils";

export const RESTART_REQUIRED_SERVER_FIELDS: Array<keyof ServerConfig> = ["host", "port"];

export function parseServerConfigSavePayload(input: Record<string, unknown>): ServerConfig {
  return {
    host: parseRequiredTrimmedString(input.host, "host"),
    port: parseRequiredPositiveInteger(input.port, "port"),
    requestTimeoutMs: parseRequiredPositiveInteger(input.requestTimeoutMs, "requestTimeoutMs"),
    queueTimeoutMs: parseRequiredPositiveInteger(input.queueTimeoutMs, "queueTimeoutMs"),
    healthCheckIntervalMs: parseRequiredPositiveInteger(input.healthCheckIntervalMs, "healthCheckIntervalMs"),
    recentRequestLimit: parseRequiredPositiveInteger(input.recentRequestLimit, "recentRequestLimit"),
    mcpServerEnabled: parseRequiredBoolean(input.mcpServerEnabled, "mcpServerEnabled"),
  };
}

export function findChangedServerFields(current: ServerConfig, next: ServerConfig): Array<keyof ServerConfig> {
  const changedFields: Array<keyof ServerConfig> = [];

  for (const field of Object.keys(next) as Array<keyof ServerConfig>) {
    if (current[field] !== next[field]) {
      changedFields.push(field);
    }
  }

  return changedFields;
}

export function buildRuntimeAppliedConfig(
  nextConfig: { server: ServerConfig; backends: ProxyConfig["backends"] },
  currentRuntimeServer: ServerConfig,
) {
  return {
    ...nextConfig,
    server: {
      ...nextConfig.server,
      host: currentRuntimeServer.host,
      port: currentRuntimeServer.port,
    },
  };
}

export function parseBackendSavePayload(input: Record<string, unknown>): BackendSavePayload {
  const id = parseRequiredTrimmedString(input.id, "id");
  const name = parseRequiredTrimmedString(input.name, "name");
  const baseUrl = parseRequiredTrimmedString(input.baseUrl, "baseUrl");
  const connector = parseBackendConnector(input.connector);
  const enabled = parseRequiredBoolean(input.enabled, "enabled");
  const maxConcurrency = parseRequiredPositiveInteger(input.maxConcurrency, "maxConcurrency");
  const healthPath = parseOptionalTrimmedString(input.healthPath, "healthPath");
  const models = parseOptionalStringArray(input.models, "models");
  const headers = parseOptionalStringRecord(input.headers, "headers");
  const apiKey = parseOptionalTrimmedString(input.apiKey, "apiKey");
  const apiKeyEnv = parseOptionalTrimmedString(input.apiKeyEnv, "apiKeyEnv");
  const clearApiKey = parseOptionalBoolean(input.clearApiKey, "clearApiKey");
  const timeoutMs = parseOptionalPositiveInteger(input.timeoutMs, "timeoutMs");

  return {
    id,
    name,
    baseUrl,
    connector,
    enabled,
    maxConcurrency,
    healthPath,
    models,
    headers,
    apiKey,
    apiKeyEnv,
    clearApiKey,
    timeoutMs,
  };
}

function parseRequiredTrimmedString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`"${fieldName}" must be a non-empty string.`);
  }

  return value.trim();
}

function parseOptionalTrimmedString(value: unknown, fieldName: string): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`"${fieldName}" must be a string when provided.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseRequiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`"${fieldName}" must be a boolean.`);
  }

  return value;
}

function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`"${fieldName}" must be a boolean when provided.`);
  }

  return value;
}

function parseRequiredPositiveInteger(value: unknown, fieldName: string): number {
  if (!isPositiveInteger(value)) {
    throw new Error(`"${fieldName}" must be a positive integer.`);
  }

  return value;
}

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (!isPositiveInteger(value)) {
    throw new Error(`"${fieldName}" must be a positive integer when provided.`);
  }

  return value;
}


function parseOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`"${fieldName}" must be an array of strings when provided.`);
  }

  const normalized = value
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalStringRecord(value: unknown, fieldName: string): Record<string, string> | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`"${fieldName}" must be an object of string values when provided.`);
  }

  const entries = Object.entries(value);
  const record: Record<string, string> = {};

  for (const [key, entryValue] of entries) {
    if (typeof entryValue !== "string") {
      throw new Error(`"${fieldName}.${key}" must be a string.`);
    }

    const normalizedKey = key.trim();
    const normalizedValue = entryValue.trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }

    record[normalizedKey] = normalizedValue;
  }

  return Object.keys(record).length > 0 ? record : undefined;
}

function parseBackendConnector(value: unknown): "openai" | "ollama" | "llama.cpp" {
  if (value === undefined || value === null || value === "openai") {
    return "openai";
  }

  if (value === "ollama") {
    return "ollama";
  }

  if (value === "llama.cpp") {
    return "llama.cpp";
  }

  throw new Error('"connector" must be "openai", "ollama", or "llama.cpp".');
}
