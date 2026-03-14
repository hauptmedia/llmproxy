import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigStore } from "./config-store";
import { LoadBalancer } from "./load-balancer";
import { LlmProxyServer } from "./server";
import { ProxyConfig } from "./types";
import { delay, readRequestBody } from "./utils";

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createNetServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();

      if (!address || typeof address === "string") {
        probe.close(() => {
          reject(new Error("Could not determine a free port."));
        });
        return;
      }

      const { port } = address;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function startRouter(
  config: ProxyConfig,
  configPath: string,
): Promise<{
  loadBalancer: LoadBalancer;
  server: LlmProxyServer;
}> {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const configStore = new ConfigStore(configPath);
  const loadBalancer = new LoadBalancer(config);
  await loadBalancer.start();

  const server = new LlmProxyServer(configStore, loadBalancer);
  await server.start();

  return { loadBalancer, server };
}

async function waitForHealthyBackend(baseUrl: string, backendId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/state`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      backends: Array<{
        id: string;
        healthy: boolean;
      }>;
    };

    if (payload.backends.some((backend) => backend.id === backendId && backend.healthy)) {
      return;
    }

    await delay(50);
  }

  throw new Error("Timed out waiting for a healthy backend.");
}

async function waitForRecentRequest(
  baseUrl: string,
  predicate: (entry: {
    id: string;
    outcome: string;
  }) => boolean,
): Promise<{
  id: string;
  outcome: string;
}> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/state`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      recentRequests: Array<{
        id: string;
        outcome: string;
      }>;
    };

    const entry = payload.recentRequests.find(predicate);
    if (entry) {
      return entry;
    }

    await delay(50);
  }

  throw new Error("Timed out waiting for a retained request entry.");
}

async function startMockDiagnosticsBackend(port: number): Promise<Server> {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method?.toUpperCase() ?? "GET";

    if (method === "GET" && url.pathname === "/v1/models") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({
        object: "list",
        data: [
          {
            id: "diagnostics-model",
            object: "model",
            created: 0,
            owned_by: "mock-diagnostics-backend",
            max_completion_tokens: 256,
          },
        ],
      }));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/chat/completions") {
      await readRequestBody(request);
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });

      const chunks = [
        {
          id: "chatcmpl-diagnostics",
          object: "chat.completion.chunk",
          created: 1710000000,
          model: "diagnostics-model",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: "This answer repeats itself. ",
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-diagnostics",
          object: "chat.completion.chunk",
          created: 1710000000,
          model: "diagnostics-model",
          choices: [
            {
              index: 0,
              delta: {
                content: "This answer repeats itself. This answer repeats itself. ",
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-diagnostics",
          object: "chat.completion.chunk",
          created: 1710000000,
          model: "diagnostics-model",
          choices: [
            {
              index: 0,
              delta: {
                content: "This answer repeats itself.",
              },
              finish_reason: "length",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 64,
            total_tokens: 76,
          },
        },
      ];

      for (const chunk of chunks) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }

    response.writeHead(404);
    response.end();
  }).listen(port, "127.0.0.1");
}

test("MCP tools expose heuristic request reports", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-diagnostics-"));
  const cleanup: Array<() => Promise<void>> = [];

  try {
    const backendPort = await getFreePort();
    const routerPort = await getFreePort();

    const backend = await startMockDiagnosticsBackend(backendPort);
    cleanup.push(async () => {
      await new Promise<void>((resolve, reject) => {
        backend.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    });

    const config: ProxyConfig = {
      server: {
        host: "127.0.0.1",
        port: routerPort,
        requestTimeoutMs: 10000,
        queueTimeoutMs: 2000,
        healthCheckIntervalMs: 60000,
        recentRequestLimit: 1000,
        mcpServerEnabled: true,
      },
      backends: [
        {
          id: "mock-diagnostics-upstream",
          name: "mock diagnostics upstream",
          baseUrl: `http://127.0.0.1:${backendPort}`,
          enabled: true,
          maxConcurrency: 1,
          healthPath: "/v1/models",
          models: ["diagnostics-model"],
        },
      ],
    };

    const router = await startRouter(config, path.join(tempDir, "diagnostics-router.config.json"));
    cleanup.push(async () => {
      await router.server.stop();
      await router.loadBalancer.stop();
    });

    const baseUrl = `http://127.0.0.1:${routerPort}`;
    await waitForHealthyBackend(baseUrl, "mock-diagnostics-upstream");

    const chatResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "diagnostics-model",
        stream: false,
        max_tokens: 64,
        messages: [
          {
            role: "user",
            content: "Explain something briefly.",
          },
        ],
      }),
    });
    assert.equal(chatResponse.status, 200);

    const recentRequest = await waitForRecentRequest(baseUrl, (entry) => entry.outcome === "success");

    const reportResponse = await fetch(`${baseUrl}/api/diagnostics/requests/${encodeURIComponent(recentRequest.id)}`);
    assert.equal(reportResponse.status, 200);
    const reportPayload = await reportResponse.json() as {
      report: {
        signals: {
          maxTokensReached: boolean;
          repetitionDetected: boolean;
        };
      };
    };

    assert.equal(reportPayload.report.signals.maxTokensReached, true);
    assert.equal(reportPayload.report.signals.repetitionDetected, true);

    const mcpResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "diagnose_request",
          arguments: {
            request_id: recentRequest.id,
          },
        },
      }),
    });
    assert.equal(mcpResponse.status, 200);
    const mcpPayload = await mcpResponse.json() as {
      result?: {
        structuredContent?: {
          signals?: {
            maxTokensReached?: boolean;
            repetitionDetected?: boolean;
          };
        };
      };
      error?: {
        message: string;
      };
    };

    assert.equal(mcpPayload.error, undefined);
    assert.equal(mcpPayload.result?.structuredContent?.signals?.maxTokensReached, true);
    assert.equal(mcpPayload.result?.structuredContent?.signals?.repetitionDetected, true);
  } finally {
    while (cleanup.length > 0) {
      const task = cleanup.pop();
      if (task) {
        await task();
      }
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});

test("MCP tools expose models and chat completions", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-diagnostics-proxy-"));
  const cleanup: Array<() => Promise<void>> = [];

  try {
    const backendPort = await getFreePort();
    const routerPort = await getFreePort();

    const backend = await startMockDiagnosticsBackend(backendPort);
    cleanup.push(async () => {
      await new Promise<void>((resolve, reject) => {
        backend.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    });

    const config: ProxyConfig = {
      server: {
        host: "127.0.0.1",
        port: routerPort,
        requestTimeoutMs: 10000,
        queueTimeoutMs: 2000,
        healthCheckIntervalMs: 60000,
        recentRequestLimit: 1000,
        mcpServerEnabled: true,
      },
      backends: [
        {
          id: "mock-diagnostics-upstream",
          name: "mock diagnostics upstream",
          baseUrl: `http://127.0.0.1:${backendPort}`,
          enabled: true,
          maxConcurrency: 1,
          healthPath: "/v1/models",
          models: ["diagnostics-model"],
        },
      ],
    };

    const router = await startRouter(config, path.join(tempDir, "diagnostics-router-proxy.config.json"));
    cleanup.push(async () => {
      await router.server.stop();
      await router.loadBalancer.stop();
    });

    const baseUrl = `http://127.0.0.1:${routerPort}`;
    await waitForHealthyBackend(baseUrl, "mock-diagnostics-upstream");

    const modelsResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "list_models",
          arguments: {},
        },
      }),
    });
    assert.equal(modelsResponse.status, 200);
    const modelsPayload = await modelsResponse.json() as {
      result?: {
        structuredContent?: {
          object: string;
          data: Array<{
            id: string;
            owned_by: string;
          }>;
        };
      };
      error?: {
        message?: string;
      };
    };

    assert.equal(modelsPayload.error, undefined);
    assert.equal(modelsPayload.result?.structuredContent?.object, "list");
    assert.deepEqual(modelsPayload.result?.structuredContent?.data.map((entry) => entry.id), ["diagnostics-model"]);
    assert.equal(modelsPayload.result?.structuredContent?.data[0]?.owned_by, "mock diagnostics upstream");

    const chatResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "create_chat_completion",
          arguments: {
            model: "diagnostics-model",
            stream: false,
            max_tokens: 64,
            messages: [
              {
                role: "user",
                content: "Explain something briefly.",
              },
            ],
          },
        },
      }),
    });
    assert.equal(chatResponse.status, 200);
    const chatPayload = await chatResponse.json() as {
      result?: {
        structuredContent?: {
          object?: string;
          model?: string;
          choices?: Array<{
            finish_reason?: string | null;
          }>;
        };
      };
      error?: {
        message?: string;
      };
    };

    assert.equal(chatPayload.error, undefined);
    assert.equal(chatPayload.result?.structuredContent?.object, "chat.completion");
    assert.equal(chatPayload.result?.structuredContent?.model, "diagnostics-model");
    assert.equal(chatPayload.result?.structuredContent?.choices?.[0]?.finish_reason, "length");
  } finally {
    while (cleanup.length > 0) {
      const task = cleanup.pop();
      if (task) {
        await task();
      }
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});

test("MCP manifest exposes a single llmproxy functions service", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-mcp-manifest-"));
  const cleanup: Array<() => Promise<void>> = [];

  try {
    const backendPort = await getFreePort();
    const routerPort = await getFreePort();

    const backend = await startMockDiagnosticsBackend(backendPort);
    cleanup.push(async () => {
      await new Promise<void>((resolve, reject) => {
        backend.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    });

    const config: ProxyConfig = {
      server: {
        host: "127.0.0.1",
        port: routerPort,
        requestTimeoutMs: 10000,
        queueTimeoutMs: 2000,
        healthCheckIntervalMs: 60000,
        recentRequestLimit: 1000,
        mcpServerEnabled: true,
      },
      backends: [
        {
          id: "mock-diagnostics-upstream",
          name: "mock diagnostics upstream",
          baseUrl: `http://127.0.0.1:${backendPort}`,
          enabled: true,
          maxConcurrency: 1,
          healthPath: "/v1/models",
          models: ["diagnostics-model"],
        },
      ],
    };

    const router = await startRouter(config, path.join(tempDir, "mcp-manifest-router.config.json"));
    cleanup.push(async () => {
      await router.server.stop();
      await router.loadBalancer.stop();
    });

    const baseUrl = `http://127.0.0.1:${routerPort}`;
    await waitForHealthyBackend(baseUrl, "mock-diagnostics-upstream");

    const manifestResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "services/list",
      }),
    });
    assert.equal(manifestResponse.status, 200);

    const manifestPayload = await manifestResponse.json() as {
      result?: {
        endpoint?: string;
        services?: Array<{
          id?: string;
          title?: string;
          tools?: Array<{ name?: string }>;
          prompts?: Array<{ name?: string }>;
        }>;
      };
      error?: {
        message?: string;
      };
    };

    assert.equal(manifestPayload.error, undefined);
    assert.equal(manifestPayload.result?.endpoint, "/mcp");
    assert.equal(manifestPayload.result?.services?.length, 1);
    assert.equal(manifestPayload.result?.services?.[0]?.id, "llmproxy");
    assert.equal(manifestPayload.result?.services?.[0]?.title, "llmproxy functions");
    assert.deepEqual(
      manifestPayload.result?.services?.[0]?.tools?.map((tool) => tool.name),
      ["list_models", "create_chat_completion", "list_requests", "get_request_detail", "diagnose_request"],
    );
    assert.deepEqual(
      manifestPayload.result?.services?.[0]?.prompts?.map((prompt) => prompt.name),
      ["diagnose-request", "troubleshoot-max-tokens", "troubleshoot-repetition", "troubleshoot-routing"],
    );
  } finally {
    while (cleanup.length > 0) {
      const task = cleanup.pop();
      if (task) {
        await task();
      }
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});

test("MCP endpoint returns 503 when disabled in server config", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-diagnostics-disabled-"));
  const cleanup: Array<() => Promise<void>> = [];

  try {
    const backendPort = await getFreePort();
    const routerPort = await getFreePort();

    const backend = await startMockDiagnosticsBackend(backendPort);
    cleanup.push(async () => {
      await new Promise<void>((resolve, reject) => {
        backend.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    });

    const config: ProxyConfig = {
      server: {
        host: "127.0.0.1",
        port: routerPort,
        requestTimeoutMs: 10000,
        queueTimeoutMs: 2000,
        healthCheckIntervalMs: 60000,
        recentRequestLimit: 1000,
        mcpServerEnabled: false,
      },
      backends: [
        {
          id: "mock-diagnostics-upstream",
          name: "mock diagnostics upstream",
          baseUrl: `http://127.0.0.1:${backendPort}`,
          enabled: true,
          maxConcurrency: 1,
          healthPath: "/v1/models",
          models: ["diagnostics-model"],
        },
      ],
    };

    const router = await startRouter(config, path.join(tempDir, "diagnostics-router-disabled.config.json"));
    cleanup.push(async () => {
      await router.server.stop();
      await router.loadBalancer.stop();
    });

    const baseUrl = `http://127.0.0.1:${routerPort}`;
    await waitForHealthyBackend(baseUrl, "mock-diagnostics-upstream");

    const mcpResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "test-client",
            version: "1.0.0",
          },
        },
      }),
    });

    assert.equal(mcpResponse.status, 503);
    const payload = await mcpResponse.json() as {
      error?: {
        message?: string;
      };
    };
    assert.equal(payload.error?.message, "MCP server is disabled in config.");

    const modelsResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "list_models",
          arguments: {},
        },
      }),
    });
    assert.equal(modelsResponse.status, 503);
    const modelsPayload = await modelsResponse.json() as {
      error?: {
        message?: string;
      };
    };
    assert.equal(modelsPayload.error?.message, "MCP server is disabled in config.");
  } finally {
    while (cleanup.length > 0) {
      const task = cleanup.pop();
      if (task) {
        await task();
      }
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});

test("legacy diagnostics MCP routes are not exposed anymore", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-legacy-mcp-"));
  const cleanup: Array<() => Promise<void>> = [];

  try {
    const backendPort = await getFreePort();
    const routerPort = await getFreePort();

    const backend = await startMockDiagnosticsBackend(backendPort);
    cleanup.push(async () => {
      await new Promise<void>((resolve, reject) => {
        backend.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    });

    const config: ProxyConfig = {
      server: {
        host: "127.0.0.1",
        port: routerPort,
        requestTimeoutMs: 10000,
        queueTimeoutMs: 2000,
        healthCheckIntervalMs: 60000,
        recentRequestLimit: 1000,
        mcpServerEnabled: true,
      },
      backends: [
        {
          id: "mock-diagnostics-upstream",
          name: "mock diagnostics upstream",
          baseUrl: `http://127.0.0.1:${backendPort}`,
          enabled: true,
          maxConcurrency: 1,
          healthPath: "/v1/models",
          models: ["diagnostics-model"],
        },
      ],
    };

    const router = await startRouter(config, path.join(tempDir, "legacy-mcp-router.config.json"));
    cleanup.push(async () => {
      await router.server.stop();
      await router.loadBalancer.stop();
    });

    const baseUrl = `http://127.0.0.1:${routerPort}`;
    await waitForHealthyBackend(baseUrl, "mock-diagnostics-upstream");

    const legacyMcpResponse = await fetch(`${baseUrl}/api/diagnostics/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      }),
    });
    assert.equal(legacyMcpResponse.status, 404);

    const legacyModelsResponse = await fetch(`${baseUrl}/api/diagnostics/mcp/v1/models`);
    assert.equal(legacyModelsResponse.status, 404);
  } finally {
    while (cleanup.length > 0) {
      const task = cleanup.pop();
      if (task) {
        await task();
      }
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});
