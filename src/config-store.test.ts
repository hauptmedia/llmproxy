import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigStore } from "./config-store";
import { ProxyConfig } from "./types";

const TEST_CONFIG: ProxyConfig = {
  server: {
    host: "127.0.0.1",
    port: 4100,
    dashboardPath: "/dashboard",
    requestTimeoutMs: 600_000,
    queueTimeoutMs: 30_000,
    healthCheckIntervalMs: 10_000,
    recentRequestLimit: 1000,
  },
  backends: [
    {
      id: "primary",
      name: "Primary",
      baseUrl: "http://127.0.0.1:8080",
      connector: "openai",
      enabled: true,
      maxConcurrency: 1,
      healthPath: "/v1/models",
      models: ["*"],
      headers: {
        "x-test-header": "alpha",
      },
      apiKey: "secret-token",
      apiKeyEnv: "PRIMARY_API_KEY",
      timeoutMs: 12_000,
    },
  ],
};

async function withConfigStore(run: (store: ConfigStore, configPath: string) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "llmproxy-config-store-"));
  const configPath = path.join(tempDir, "llmproxy.config.json");

  await writeFile(configPath, `${JSON.stringify(TEST_CONFIG, null, 2)}\n`, "utf8");

  try {
    await run(new ConfigStore(configPath), configPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("lists editable backends without exposing stored API keys", async () => {
  await withConfigStore(async (store) => {
    const backends = await store.listEditableBackends();
    assert.equal(backends.length, 1);
    assert.deepEqual(backends[0], {
      id: "primary",
      name: "Primary",
      baseUrl: "http://127.0.0.1:8080",
      connector: "openai",
      enabled: true,
      maxConcurrency: 1,
      healthPath: "/v1/models",
      models: ["*"],
      headers: {
        "x-test-header": "alpha",
      },
      apiKeyEnv: "PRIMARY_API_KEY",
      apiKeyConfigured: true,
      timeoutMs: 12_000,
    });
  });
});

test("creates a backend and writes it to config", async () => {
  await withConfigStore(async (store, configPath) => {
    const result = await store.createBackend({
      id: "secondary",
      name: "Secondary",
      baseUrl: "https://ollama.example.com",
      connector: "ollama",
      enabled: false,
      maxConcurrency: 2,
      healthPath: "/api/tags",
      models: ["llama3.2", "qwen2.5"],
      headers: {
        "x-cluster": "gpu-a",
      },
      apiKey: "secondary-secret",
      timeoutMs: 30_000,
    });

    assert.equal(result.backend.id, "secondary");
    assert.equal(result.backend.connector, "ollama");
    assert.equal(result.backend.apiKeyConfigured, true);
    assert.equal(result.config.backends.length, 2);

    const persisted = JSON.parse(await readFile(configPath, "utf8")) as ProxyConfig;
    const created = persisted.backends.find((backend) => backend.id === "secondary");

    assert.deepEqual(created, {
      id: "secondary",
      name: "Secondary",
      baseUrl: "https://ollama.example.com",
      connector: "ollama",
      enabled: false,
      maxConcurrency: 2,
      healthPath: "/api/tags",
      allowedModels: ["llama3.2", "qwen2.5"],
      headers: {
        "x-cluster": "gpu-a",
      },
      apiKey: "secondary-secret",
      timeoutMs: 30_000,
    });
  });
});

test("replaces a backend, keeps stored api keys unless cleared, and supports renaming", async () => {
  await withConfigStore(async (store, configPath) => {
    const firstUpdate = await store.replaceBackend("primary", {
      id: "primary-renamed",
      name: "Primary Renamed",
      baseUrl: "http://127.0.0.1:9090",
      connector: "openai",
      enabled: true,
      maxConcurrency: 3,
      healthPath: "/healthz",
      models: ["gpt-*"],
      headers: {
        "x-test-header": "beta",
      },
      apiKeyEnv: "PRIMARY_RENAMED_API_KEY",
      timeoutMs: 15_000,
    });

    assert.equal(firstUpdate.backend.id, "primary-renamed");
    assert.equal(firstUpdate.backend.apiKeyConfigured, true);

    let persisted = JSON.parse(await readFile(configPath, "utf8")) as ProxyConfig;
    let updated = persisted.backends.find((backend) => backend.id === "primary-renamed");

    assert.deepEqual(updated, {
      id: "primary-renamed",
      name: "Primary Renamed",
      baseUrl: "http://127.0.0.1:9090",
      connector: "openai",
      enabled: true,
      maxConcurrency: 3,
      healthPath: "/healthz",
      allowedModels: ["gpt-*"],
      headers: {
        "x-test-header": "beta",
      },
      apiKey: "secret-token",
      apiKeyEnv: "PRIMARY_RENAMED_API_KEY",
      timeoutMs: 15_000,
    });

    const secondUpdate = await store.replaceBackend("primary-renamed", {
      id: "primary-renamed",
      name: "Primary Renamed",
      baseUrl: "http://127.0.0.1:9090",
      connector: "openai",
      enabled: true,
      maxConcurrency: 3,
      healthPath: "/healthz",
      models: ["gpt-*"],
      headers: {
        "x-test-header": "beta",
      },
      apiKeyEnv: "PRIMARY_RENAMED_API_KEY",
      clearApiKey: true,
      timeoutMs: 15_000,
    });

    assert.equal(secondUpdate.backend.apiKeyConfigured, false);

    persisted = JSON.parse(await readFile(configPath, "utf8")) as ProxyConfig;
    updated = persisted.backends.find((backend) => backend.id === "primary-renamed");
    assert.equal(updated?.apiKey, undefined);
  });
});
