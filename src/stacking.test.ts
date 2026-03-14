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

async function startMockOpenAiBackend(
  port: number,
  streamModes: boolean[],
  receivedPayloads?: Array<Record<string, unknown>>,
): Promise<Server> {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
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
            id: "mock-stack-model",
            object: "model",
            created: 0,
            owned_by: "mock-openai-backend",
          },
        ],
      }));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body.toString("utf8")) as {
        stream?: boolean;
        model?: string;
      };
      receivedPayloads?.push(payload);
      streamModes.push(payload.stream === true);

      const chunks = [
        {
          id: "chatcmpl-mock-stack",
          object: "chat.completion.chunk",
          created: 1710000000,
          model: payload.model ?? "mock-stack-model",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: "Stacked ",
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-mock-stack",
          object: "chat.completion.chunk",
          created: 1710000000,
          model: payload.model ?? "mock-stack-model",
          choices: [
            {
              index: 0,
              delta: {
                content: "hello.",
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-mock-stack",
          object: "chat.completion.chunk",
          created: 1710000000,
          model: payload.model ?? "mock-stack-model",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 7,
          },
        },
      ];

      if (payload.stream === true) {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });

        for (const chunk of chunks) {
          response.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        response.end("data: [DONE]\n\n");
        return;
      }

      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({
        id: "chatcmpl-mock-stack",
        object: "chat.completion",
        created: 1710000000,
        model: payload.model ?? "mock-stack-model",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "Stacked hello.",
            },
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7,
        },
      }));
      return;
    }

    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({
      error: {
        message: `Unhandled mock route ${method} ${url.pathname}`,
        type: "invalid_request_error",
      },
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

async function startMockOllamaBackend(
  port: number,
  receivedPayloads: Array<Record<string, unknown>>,
  streamModes: boolean[],
): Promise<Server> {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method?.toUpperCase() ?? "GET";

    if (method === "GET" && url.pathname === "/api/tags") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({
        models: [
          {
            name: "mock-ollama-model",
            model: "mock-ollama-model",
            modified_at: "2026-03-13T11:00:00Z",
            size: 123456,
            details: {
              format: "gguf",
              family: "qwen",
            },
          },
        ],
      }));
      return;
    }

    if (method === "POST" && url.pathname === "/api/chat") {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      receivedPayloads.push(payload);
      streamModes.push(payload.stream === true);

      response.writeHead(200, {
        "content-type": "application/x-ndjson",
      });

      const chunks = [
        {
          model: payload.model ?? "mock-ollama-model",
          created_at: "2026-03-13T11:00:00.000Z",
          message: {
            role: "assistant",
            content: "",
            thinking: "Native reasoning.",
          },
          done: false,
        },
        {
          model: payload.model ?? "mock-ollama-model",
          created_at: "2026-03-13T11:00:00.100Z",
          message: {
            role: "assistant",
            content: "Native hello.",
          },
          done: false,
        },
        {
          model: payload.model ?? "mock-ollama-model",
          created_at: "2026-03-13T11:00:00.200Z",
          message: {
            role: "assistant",
            content: "",
          },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 7,
          prompt_eval_duration: 14_000_000,
          eval_count: 3,
          eval_duration: 30_000_000,
        },
      ];

      for (const chunk of chunks) {
        response.write(`${JSON.stringify(chunk)}\n`);
      }

      response.end();
      return;
    }

    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({
      error: `Unhandled mock Ollama route ${method} ${url.pathname}`,
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

async function startMockToolCallBackend(
  port: number,
  receivedPayloads: Array<Record<string, unknown>>,
): Promise<Server> {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
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
            id: "mock-tool-model",
            object: "model",
            created: 0,
            owned_by: "mock-tool-backend",
          },
        ],
      }));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      receivedPayloads.push(payload);

      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });

      const chunks = [
        {
          id: "chatcmpl-tool-flow",
          object: "chat.completion.chunk",
          created: 1710000100,
          model: payload.model ?? "mock-tool-model",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_weather",
                    type: "function",
                    function: {
                      name: "get_weather",
                      arguments: "{\"city\":",
                    },
                  },
                  {
                    index: 1,
                    id: "call_time",
                    type: "function",
                    function: {
                      name: "get_time",
                      arguments: "{\"timezone\":",
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-tool-flow",
          object: "chat.completion.chunk",
          created: 1710000100,
          model: payload.model ?? "mock-tool-model",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: "\"Berlin\"}",
                    },
                  },
                  {
                    index: 1,
                    function: {
                      arguments: "\"Europe/Berlin\"}",
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-tool-flow",
          object: "chat.completion.chunk",
          created: 1710000100,
          model: payload.model ?? "mock-tool-model",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 9,
            total_tokens: 21,
          },
        },
      ];

      for (const chunk of chunks) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      response.end("data: [DONE]\n\n");
      return;
    }

    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({
      error: {
        message: `Unhandled mock route ${method} ${url.pathname}`,
        type: "invalid_request_error",
      },
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

async function startMockSlowStreamingBackend(
  port: number,
  modelMetadata?: Record<string, unknown>,
): Promise<Server> {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
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
            id: "mock-live-model",
            object: "model",
            created: 0,
            owned_by: "mock-live-backend",
            ...modelMetadata,
          },
        ],
      }));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/chat/completions") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });

      response.write(`data: ${JSON.stringify({
        id: "chatcmpl-live-1",
        object: "chat.completion.chunk",
        created: 1710000200,
        model: "mock-live-model",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: "Streaming ",
            },
            finish_reason: null,
          },
        ],
      })}\n\n`);

      await delay(200);

      response.write(`data: ${JSON.stringify({
        id: "chatcmpl-live-1",
        object: "chat.completion.chunk",
        created: 1710000200,
        model: "mock-live-model",
        choices: [
          {
            index: 0,
            delta: {
              content: "response.",
            },
            finish_reason: null,
          },
        ],
      })}\n\n`);

      await delay(200);

      response.write(`data: ${JSON.stringify({
        id: "chatcmpl-live-1",
        object: "chat.completion.chunk",
        created: 1710000200,
        model: "mock-live-model",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10,
        },
      })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }

    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({
      error: {
        message: `Unhandled mock route ${method} ${url.pathname}`,
        type: "invalid_request_error",
      },
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
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

async function waitForOuterState(
  baseUrl: string,
  expectedModel = "mock-stack-model",
): Promise<{
  backends: Array<{
    id: string;
    healthy: boolean;
    discoveredModels: string[];
  }>;
}> {
  let lastPayload:
    | {
        backends: Array<{
          id: string;
          healthy: boolean;
          discoveredModels: string[];
        }>;
      }
    | undefined;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/state`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      backends: Array<{
        id: string;
        healthy: boolean;
        discoveredModels: string[];
      }>;
    };
    lastPayload = payload;

    if (payload.backends[0]?.discoveredModels.includes(expectedModel)) {
      return payload;
    }

    await delay(50);
  }

  throw new Error(`Timed out waiting for discovered models. Last state: ${JSON.stringify(lastPayload)}`);
}

async function waitForHealthyBackend(
  baseUrl: string,
  backendId: string,
): Promise<void> {
  let lastPayload:
    | {
        backends: Array<{
          id: string;
          healthy: boolean;
        }>;
      }
    | undefined;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/state`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      backends: Array<{
        id: string;
        healthy: boolean;
      }>;
    };
    lastPayload = payload;

    if (payload.backends.some((backend) => backend.id === backendId && backend.healthy)) {
      return;
    }

    await delay(50);
  }

  throw new Error(`Timed out waiting for backend health. Last state: ${JSON.stringify(lastPayload)}`);
}

async function waitForActiveConnection(
  baseUrl: string,
): Promise<{
  id: string;
  hasDetail?: boolean;
  path: string;
  effectiveCompletionTokenLimit?: number;
}> {
  let lastPayload:
    | {
        activeConnections: Array<{
          id: string;
          hasDetail?: boolean;
          path: string;
          effectiveCompletionTokenLimit?: number;
        }>;
      }
    | undefined;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/state`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      activeConnections: Array<{
        id: string;
        hasDetail?: boolean;
        path: string;
        effectiveCompletionTokenLimit?: number;
      }>;
    };
    lastPayload = payload;

    if (payload.activeConnections.length > 0) {
      return payload.activeConnections[0];
    }

    await delay(25);
  }

  throw new Error(`Timed out waiting for an active connection. Last state: ${JSON.stringify(lastPayload)}`);
}

async function waitForRecentRequest(
  baseUrl: string,
  predicate: (entry: {
    id: string;
    path: string;
    outcome: string;
  }) => boolean,
): Promise<{
  id: string;
  path: string;
  outcome: string;
}> {
  let lastPayload:
    | {
        recentRequests: Array<{
          id: string;
          path: string;
          outcome: string;
        }>;
      }
    | undefined;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/state`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      recentRequests: Array<{
        id: string;
        path: string;
        outcome: string;
      }>;
    };
    lastPayload = payload;

    const match = payload.recentRequests.find(predicate);
    if (match) {
      return match;
    }

    await delay(50);
  }

  throw new Error(`Timed out waiting for recent request state. Last state: ${JSON.stringify(lastPayload)}`);
}

test("llmproxy can stack another llmproxy as an OpenAI-compatible backend", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-stack-"));
  const streamModes: boolean[] = [];
  const cleanup: Array<() => Promise<void>> = [];

  t.after(async () => {
    for (const entry of cleanup.reverse()) {
      await entry();
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  const mockPort = await getFreePort();
  const innerPort = await getFreePort();
  const outerPort = await getFreePort();

  const mockServer = await startMockOpenAiBackend(mockPort, streamModes);
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) => {
      mockServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  const innerConfig: ProxyConfig = {
    server: {
      host: "127.0.0.1",
      port: innerPort,
      requestTimeoutMs: 15_000,
      queueTimeoutMs: 2_000,
      healthCheckIntervalMs: 60_000,
      recentRequestLimit: 1000,
      mcpServerEnabled: true,
    },
    backends: [
      {
        id: "mock-upstream",
        name: "mock upstream",
        baseUrl: `http://127.0.0.1:${mockPort}`,
        enabled: true,
        maxConcurrency: 1,
        healthPath: "/v1/models",
        models: ["mock-stack-model"],
      },
    ],
  };

  const innerRouter = await startRouter(innerConfig, path.join(tempDir, "inner-router.config.json"));
  cleanup.push(async () => {
    await innerRouter.server.stop();
    await innerRouter.loadBalancer.stop();
  });

  const outerConfig: ProxyConfig = {
    server: {
      host: "127.0.0.1",
      port: outerPort,
      requestTimeoutMs: 15_000,
      queueTimeoutMs: 2_000,
      healthCheckIntervalMs: 60_000,
      recentRequestLimit: 1000,
      mcpServerEnabled: true,
    },
    backends: [
      {
        id: "inner-router",
        name: "inner router",
        baseUrl: `http://127.0.0.1:${innerPort}`,
        enabled: true,
        maxConcurrency: 1,
        healthPath: "/v1/models",
      },
    ],
  };

  const outerRouter = await startRouter(outerConfig, path.join(tempDir, "outer-router.config.json"));
  cleanup.push(async () => {
    await outerRouter.server.stop();
    await outerRouter.loadBalancer.stop();
  });

  const outerBaseUrl = `http://127.0.0.1:${outerPort}`;

  const statePayload = await waitForOuterState(outerBaseUrl);
  assert.equal(statePayload.backends[0]?.id, "inner-router");
  assert.equal(statePayload.backends[0]?.healthy, true);
  assert.deepEqual(statePayload.backends[0]?.discoveredModels, ["mock-stack-model"]);

  const modelsResponse = await fetch(`${outerBaseUrl}/v1/models`);
  assert.equal(modelsResponse.status, 200);
  const modelsPayload = await modelsResponse.json() as {
    object: string;
    data: Array<{ id: string; object: string; created: number; owned_by: string }>;
  };
  assert.equal(modelsPayload.object, "list");
  assert.deepEqual(
    modelsPayload.data.map((entry) => entry.id),
    ["mock-stack-model"],
  );
  assert.equal(modelsPayload.data[0]?.object, "model");
  assert.equal(modelsPayload.data[0]?.created, 0);
  assert.equal(modelsPayload.data[0]?.owned_by, "");
  assert.equal(
    Object.prototype.hasOwnProperty.call(modelsPayload.data[0] ?? {}, "metadata"),
    false,
  );

  const nonStreamingResponse = await fetch(`${outerBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mock-stack-model",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Test stacked non-streaming.",
        },
      ],
    }),
  });
  assert.equal(nonStreamingResponse.status, 200);
  assert.equal(nonStreamingResponse.headers.get("x-llmproxy-backend"), "inner-router");
  assert.ok(nonStreamingResponse.headers.get("x-llmproxy-request-id"));
  const nonStreamingPayload = await nonStreamingResponse.json() as {
    object: string;
    choices: Array<{
      finish_reason: string | null;
      message: {
        role: string;
        content: string;
      };
    }>;
    usage?: {
      total_tokens?: number;
    };
  };
  assert.equal(nonStreamingPayload.object, "chat.completion");
  assert.equal(nonStreamingPayload.choices[0]?.message.role, "assistant");
  assert.equal(nonStreamingPayload.choices[0]?.message.content, "Stacked hello.");
  assert.equal(nonStreamingPayload.choices[0]?.finish_reason, "stop");
  assert.equal(nonStreamingPayload.usage?.total_tokens, 7);

  const requestedStreamingRequestId = "stacked-streaming-request";
  const streamingResponse = await fetch(`${outerBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-llmproxy-request-id": requestedStreamingRequestId,
    },
    body: JSON.stringify({
      model: "mock-stack-model",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Test stacked streaming.",
        },
      ],
    }),
  });
  assert.equal(streamingResponse.status, 200);
  assert.equal(streamingResponse.headers.get("x-llmproxy-backend"), "inner-router");
  assert.equal(streamingResponse.headers.get("x-llmproxy-request-id"), requestedStreamingRequestId);
  assert.match(
    streamingResponse.headers.get("content-type") ?? "",
    /text\/event-stream/i,
  );
  const streamingBody = await streamingResponse.text();
  assert.match(streamingBody, /"content":"Stacked "/);
  assert.match(streamingBody, /"content":"hello\."/);
  assert.match(streamingBody, /\[DONE\]/);

  const streamingDetailResponse = await fetch(
    `${outerBaseUrl}/api/requests/${encodeURIComponent(requestedStreamingRequestId)}`,
  );
  assert.equal(streamingDetailResponse.status, 200);
  const streamingDetailPayload = await streamingDetailResponse.json() as {
    entry?: {
      id?: string;
      backendId?: string;
    };
  };
  assert.equal(streamingDetailPayload.entry?.id, requestedStreamingRequestId);
  assert.equal(streamingDetailPayload.entry?.backendId, "inner-router");

  const historyResponse = await fetch(`${outerBaseUrl}/api/state`);
  assert.equal(historyResponse.status, 200);
  const historyPayload = await historyResponse.json() as {
    recentRequests: Array<{
      path: string;
      backendName?: string;
      completionTokens?: number;
      totalTokens?: number;
      contentTokens?: number;
      timeToFirstTokenMs?: number;
      finishReason?: string;
      metricsExact?: boolean;
    }>;
  };
  assert.equal(historyPayload.recentRequests[0]?.path, "/v1/chat/completions");
  assert.equal(historyPayload.recentRequests[0]?.backendName, "inner router");
  assert.equal(historyPayload.recentRequests[0]?.completionTokens, 2);
  assert.equal(historyPayload.recentRequests[0]?.totalTokens, 7);
  assert.equal(historyPayload.recentRequests[0]?.contentTokens, 2);
  assert.equal(historyPayload.recentRequests[0]?.finishReason, "stop");
  assert.equal(historyPayload.recentRequests[0]?.metricsExact, true);
  assert.equal(typeof historyPayload.recentRequests[0]?.timeToFirstTokenMs, "number");

  assert.deepEqual(streamModes, [true, true]);
});

test("proxy rewrites auto model requests to the selected backend model", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-auto-model-"));
  const receivedPayloads: Array<Record<string, unknown>> = [];
  const streamModes: boolean[] = [];
  const cleanup: Array<() => Promise<void>> = [];

  t.after(async () => {
    for (const entry of cleanup.reverse()) {
      await entry();
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  const upstreamPort = await getFreePort();
  const proxyPort = await getFreePort();

  const upstreamServer = await startMockOpenAiBackend(upstreamPort, streamModes, receivedPayloads);
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) => {
      upstreamServer.close((error) => {
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
      port: proxyPort,
      requestTimeoutMs: 15_000,
      queueTimeoutMs: 2_000,
      healthCheckIntervalMs: 60_000,
      recentRequestLimit: 1000,
      mcpServerEnabled: true,
    },
    backends: [
      {
        id: "auto-upstream",
        name: "auto upstream",
        baseUrl: `http://127.0.0.1:${upstreamPort}`,
        enabled: true,
        maxConcurrency: 1,
        models: ["*"],
      },
    ],
  };

  const router = await startRouter(config, path.join(tempDir, "auto-router.config.json"));
  cleanup.push(async () => {
    await router.server.stop();
    await router.loadBalancer.stop();
  });

  const baseUrl = `http://127.0.0.1:${proxyPort}`;
  await waitForOuterState(baseUrl, "mock-stack-model");

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "auto",
      stream: false,
      messages: [
        {
          role: "user",
          content: "Hello through automatic model routing.",
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-llmproxy-backend"), "auto-upstream");
  const payload = await response.json() as {
    model?: string;
  };
  assert.equal(payload.model, "mock-stack-model");
  assert.equal(receivedPayloads[0]?.model, "mock-stack-model");
  assert.deepEqual(streamModes, [true]);
});

test("proxy rewrites missing model requests to the selected backend model", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-missing-model-"));
  const receivedPayloads: Array<Record<string, unknown>> = [];
  const streamModes: boolean[] = [];
  const cleanup: Array<() => Promise<void>> = [];

  t.after(async () => {
    for (const entry of cleanup.reverse()) {
      await entry();
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  const upstreamPort = await getFreePort();
  const proxyPort = await getFreePort();

  const upstreamServer = await startMockOpenAiBackend(upstreamPort, streamModes, receivedPayloads);
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) => {
      upstreamServer.close((error) => {
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
      port: proxyPort,
      requestTimeoutMs: 15_000,
      queueTimeoutMs: 2_000,
      healthCheckIntervalMs: 60_000,
      recentRequestLimit: 1000,
      mcpServerEnabled: true,
    },
    backends: [
      {
        id: "missing-upstream",
        name: "missing upstream",
        baseUrl: `http://127.0.0.1:${upstreamPort}`,
        enabled: true,
        maxConcurrency: 1,
        models: ["*"],
      },
    ],
  };

  const router = await startRouter(config, path.join(tempDir, "missing-model-router.config.json"));
  cleanup.push(async () => {
    await router.server.stop();
    await router.loadBalancer.stop();
  });

  const baseUrl = `http://127.0.0.1:${proxyPort}`;
  await waitForOuterState(baseUrl, "mock-stack-model");

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      stream: false,
      messages: [
        {
          role: "user",
          content: "Hello through implicit automatic model routing.",
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-llmproxy-backend"), "missing-upstream");
  const payload = await response.json() as {
    model?: string;
  };
  assert.equal(payload.model, "mock-stack-model");
  assert.equal(receivedPayloads[0]?.model, "mock-stack-model");
  assert.deepEqual(streamModes, [true]);
});

test("ollama connector keeps the client surface OpenAI-compatible", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-ollama-connector-"));
  const receivedPayloads: Array<Record<string, unknown>> = [];
  const streamModes: boolean[] = [];
  const cleanup: Array<() => Promise<void>> = [];

  t.after(async () => {
    for (const entry of cleanup.reverse()) {
      await entry();
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  const ollamaPort = await getFreePort();
  const proxyPort = await getFreePort();

  const ollamaServer = await startMockOllamaBackend(ollamaPort, receivedPayloads, streamModes);
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) => {
      ollamaServer.close((error) => {
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
      port: proxyPort,
      requestTimeoutMs: 15_000,
      queueTimeoutMs: 2_000,
      healthCheckIntervalMs: 60_000,
      recentRequestLimit: 1000,
      mcpServerEnabled: true,
    },
    backends: [
      {
        id: "ollama-native",
        name: "ollama native",
        baseUrl: `http://127.0.0.1:${ollamaPort}`,
        connector: "ollama",
        enabled: true,
        maxConcurrency: 1,
      },
    ],
  };

  const router = await startRouter(config, path.join(tempDir, "ollama-router.config.json"));
  cleanup.push(async () => {
    await router.server.stop();
    await router.loadBalancer.stop();
  });

  const baseUrl = `http://127.0.0.1:${proxyPort}`;
  const statePayload = await waitForOuterState(baseUrl, "mock-ollama-model");
  assert.equal(statePayload.backends[0]?.healthy, true);
  assert.deepEqual(statePayload.backends[0]?.discoveredModels, ["mock-ollama-model"]);

  const modelsResponse = await fetch(`${baseUrl}/v1/models`);
  assert.equal(modelsResponse.status, 200);
  const modelsPayload = await modelsResponse.json() as {
    object: string;
    data: Array<{ id: string }>;
  };
  assert.equal(modelsPayload.object, "list");
  assert.deepEqual(modelsPayload.data.map((entry) => entry.id), ["mock-ollama-model"]);

  const chatResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mock-ollama-model",
      stream: false,
      max_tokens: 42,
      messages: [
        {
          role: "user",
          content: "Say hello natively.",
        },
      ],
    }),
  });
  assert.equal(chatResponse.status, 200);
  assert.equal(chatResponse.headers.get("x-llmproxy-backend"), "ollama-native");
  assert.ok(chatResponse.headers.get("x-llmproxy-request-id"));
  const chatPayload = await chatResponse.json() as {
    object: string;
    choices: Array<{
      finish_reason: string | null;
      message: {
        role: string;
        content: string;
        reasoning_content?: string;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  assert.equal(chatPayload.object, "chat.completion");
  assert.equal(chatPayload.choices[0]?.message.role, "assistant");
  assert.equal(chatPayload.choices[0]?.message.content, "Native hello.");
  assert.equal(chatPayload.choices[0]?.message.reasoning_content, "Native reasoning.");
  assert.equal(chatPayload.choices[0]?.finish_reason, "stop");
  assert.deepEqual(chatPayload.usage, {
    prompt_tokens: 7,
    completion_tokens: 3,
    total_tokens: 10,
  });

  assert.deepEqual(streamModes, [true]);
  assert.equal(receivedPayloads[0]?.stream, true);
  assert.deepEqual(receivedPayloads[0]?.messages, [
    {
      role: "user",
      content: "Say hello natively.",
    },
  ]);
  assert.deepEqual(receivedPayloads[0]?.options, {
    num_predict: 42,
  });
});

test("proxy preserves max_tokens and tool calls for non-streaming chat clients", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-tool-flow-"));
  const receivedPayloads: Array<Record<string, unknown>> = [];
  const cleanup: Array<() => Promise<void>> = [];

  t.after(async () => {
    for (const entry of cleanup.reverse()) {
      await entry();
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  const mockPort = await getFreePort();
  const routerPort = await getFreePort();

  const mockServer = await startMockToolCallBackend(mockPort, receivedPayloads);
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) => {
      mockServer.close((error) => {
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
      requestTimeoutMs: 15_000,
      queueTimeoutMs: 2_000,
      healthCheckIntervalMs: 60_000,
      recentRequestLimit: 1000,
      mcpServerEnabled: true,
    },
    backends: [
      {
        id: "mock-tool-upstream",
        name: "mock tool upstream",
        baseUrl: `http://127.0.0.1:${mockPort}`,
        enabled: true,
        maxConcurrency: 1,
        healthPath: "/v1/models",
        models: ["mock-tool-model"],
      },
    ],
  };

  const router = await startRouter(config, path.join(tempDir, "tool-router.config.json"));
  cleanup.push(async () => {
    await router.server.stop();
    await router.loadBalancer.stop();
  });

  const baseUrl = `http://127.0.0.1:${routerPort}`;
  await waitForHealthyBackend(baseUrl, "mock-tool-upstream");

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mock-tool-model",
      stream: false,
      max_tokens: 777,
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get the weather.",
            parameters: {
              type: "object",
            },
          },
        },
        {
          type: "function",
          function: {
            name: "get_time",
            description: "Get the current time.",
            parameters: {
              type: "object",
            },
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: "Call both tools.",
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-llmproxy-backend"), "mock-tool-upstream");

  const payload = await response.json() as {
    object: string;
    choices: Array<{
      finish_reason: string | null;
      message: {
        role: string;
        content: string | null;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: {
            name?: string;
            arguments: string;
          };
        }>;
      };
    }>;
    usage?: {
      total_tokens?: number;
    };
  };

  assert.equal(payload.object, "chat.completion");
  assert.equal(payload.choices[0]?.finish_reason, "tool_calls");
  assert.equal(payload.choices[0]?.message.role, "assistant");
  assert.equal(payload.choices[0]?.message.content, null);
  assert.deepEqual(payload.choices[0]?.message.tool_calls, [
    {
      id: "call_weather",
      type: "function",
      function: {
        name: "get_weather",
        arguments: "{\"city\":\"Berlin\"}",
      },
    },
    {
      id: "call_time",
      type: "function",
      function: {
        name: "get_time",
        arguments: "{\"timezone\":\"Europe/Berlin\"}",
      },
    },
  ]);
  assert.equal(payload.usage?.total_tokens, 21);

  const stateResponse = await fetch(`${baseUrl}/api/state`);
  assert.equal(stateResponse.status, 200);
  const statePayload = await stateResponse.json() as {
    recentRequests: Array<{
      id: string;
      path: string;
      hasDetail?: boolean;
    }>;
  };
  assert.equal(statePayload.recentRequests[0]?.path, "/v1/chat/completions");
  assert.equal(statePayload.recentRequests[0]?.hasDetail, true);

  const detailResponse = await fetch(`${baseUrl}/api/requests/${encodeURIComponent(statePayload.recentRequests[0]?.id ?? "")}`);
  assert.equal(detailResponse.status, 200);
  const detailPayload = await detailResponse.json() as {
    requestBody?: {
      model?: string;
      stream?: boolean;
      max_tokens?: number;
      messages?: Array<{
        role?: string;
        content?: string;
      }>;
      tools?: unknown[];
    };
    responseBody?: {
      choices?: Array<{
        finish_reason?: string | null;
        message?: {
          tool_calls?: Array<{
            function?: {
              name?: string;
              arguments?: string;
            };
          }>;
        };
      }>;
    };
  };
  assert.equal(detailPayload.requestBody?.model, "mock-tool-model");
  assert.equal(detailPayload.requestBody?.stream, false);
  assert.equal(detailPayload.requestBody?.max_tokens, 777);
  assert.equal(detailPayload.requestBody?.messages?.[0]?.role, "user");
  assert.equal(detailPayload.requestBody?.messages?.[0]?.content, "Call both tools.");
  assert.equal(Array.isArray(detailPayload.requestBody?.tools), true);
  assert.equal(detailPayload.responseBody?.choices?.[0]?.finish_reason, "tool_calls");
  assert.equal(detailPayload.responseBody?.choices?.[0]?.message?.tool_calls?.[0]?.function?.name, "get_weather");
  assert.equal(
    detailPayload.responseBody?.choices?.[0]?.message?.tool_calls?.[1]?.function?.arguments,
    "{\"timezone\":\"Europe/Berlin\"}",
  );

  assert.equal(receivedPayloads.length, 1);
  assert.equal(receivedPayloads[0]?.stream, true);
  assert.equal(receivedPayloads[0]?.max_tokens, 777);
  assert.equal(Array.isArray(receivedPayloads[0]?.tools), true);
  assert.equal((receivedPayloads[0]?.tools as unknown[]).length, 2);
});

test("active connections expose live request details for chat history inspection", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-live-detail-"));
  const cleanup: Array<() => Promise<void>> = [];

  t.after(async () => {
    for (const entry of cleanup.reverse()) {
      await entry();
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  const mockPort = await getFreePort();
  const routerPort = await getFreePort();

  const mockServer = await startMockSlowStreamingBackend(mockPort, {
    max_completion_tokens: 256,
  });
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) => {
      mockServer.close((error) => {
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
      requestTimeoutMs: 15_000,
      queueTimeoutMs: 2_000,
      healthCheckIntervalMs: 60_000,
      recentRequestLimit: 1000,
      mcpServerEnabled: true,
    },
    backends: [
      {
        id: "mock-live-upstream",
        name: "mock live upstream",
        baseUrl: `http://127.0.0.1:${mockPort}`,
        enabled: true,
        maxConcurrency: 1,
        healthPath: "/v1/models",
        models: ["mock-live-model"],
      },
    ],
  };

  const router = await startRouter(config, path.join(tempDir, "live-router.config.json"));
  cleanup.push(async () => {
    await router.server.stop();
    await router.loadBalancer.stop();
  });

  const baseUrl = `http://127.0.0.1:${routerPort}`;
  await waitForHealthyBackend(baseUrl, "mock-live-upstream");
  const requestedRequestId = "chat-debug-live-request";

  const liveResponsePromise = fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-llmproxy-request-id": requestedRequestId,
    },
    body: JSON.stringify({
      model: "mock-live-model",
      max_completion_tokens: 128,
      stream: true,
      messages: [
        {
          role: "system",
          content: "Stay concise.",
        },
        {
          role: "user",
          content: "Show me a live request.",
        },
      ],
    }),
  });

  const activeConnection = await waitForActiveConnection(baseUrl);
  assert.equal(activeConnection.id, requestedRequestId);
  assert.equal(activeConnection.path, "/v1/chat/completions");
  assert.equal(activeConnection.hasDetail, true);
  assert.equal(activeConnection.effectiveCompletionTokenLimit, 128);

  const detailResponse = await fetch(`${baseUrl}/api/requests/${encodeURIComponent(activeConnection.id)}`);
  assert.equal(detailResponse.status, 200);
  const detailPayload = await detailResponse.json() as {
    live?: boolean;
    requestBody?: {
      model?: string;
      max_completion_tokens?: number;
      stream?: boolean;
      messages?: Array<{
        role?: string;
        content?: string;
      }>;
    };
    responseBody?: {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
  };

  assert.equal(detailPayload.live, true);
  assert.equal(detailPayload.requestBody?.model, "mock-live-model");
  assert.equal(detailPayload.requestBody?.max_completion_tokens, 128);
  assert.equal(detailPayload.requestBody?.stream, true);
  assert.equal(detailPayload.requestBody?.messages?.[0]?.role, "system");
  assert.equal(detailPayload.requestBody?.messages?.[0]?.content, "Stay concise.");
  assert.equal(detailPayload.requestBody?.messages?.[1]?.role, "user");
  assert.equal(detailPayload.requestBody?.messages?.[1]?.content, "Show me a live request.");
  assert.match(detailPayload.responseBody?.choices?.[0]?.message?.content ?? "", /Streaming/);

  const liveResponse = await liveResponsePromise;
  assert.equal(liveResponse.status, 200);
  assert.equal(liveResponse.headers.get("x-llmproxy-request-id"), requestedRequestId);
  const liveBody = await liveResponse.text();
  assert.match(liveBody, /Streaming /);
  assert.match(liveBody, /response\./);

  await waitForRecentRequest(baseUrl, (entry) => entry.id === requestedRequestId);
  const stateResponse = await fetch(`${baseUrl}/api/state`);
  assert.equal(stateResponse.status, 200);
  const statePayload = await stateResponse.json() as {
    recentRequests: Array<{
      id: string;
      effectiveCompletionTokenLimit?: number;
    }>;
  };
  assert.equal(
    statePayload.recentRequests.find((entry) => entry.id === requestedRequestId)?.effectiveCompletionTokenLimit,
    128,
  );
});

test("cancelled requests retain the partial streamed response in request history", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-cancelled-history-"));
  const cleanup: Array<() => Promise<void>> = [];

  t.after(async () => {
    for (const entry of cleanup.reverse()) {
      await entry();
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  const mockPort = await getFreePort();
  const routerPort = await getFreePort();

  const mockServer = await startMockSlowStreamingBackend(mockPort);
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) => {
      mockServer.close((error) => {
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
      requestTimeoutMs: 15_000,
      queueTimeoutMs: 2_000,
      healthCheckIntervalMs: 60_000,
      recentRequestLimit: 1000,
      mcpServerEnabled: true,
    },
    backends: [
      {
        id: "mock-cancel-upstream",
        name: "mock cancel upstream",
        baseUrl: `http://127.0.0.1:${mockPort}`,
        enabled: true,
        maxConcurrency: 1,
        healthPath: "/v1/models",
        models: ["mock-live-model"],
      },
    ],
  };

  const router = await startRouter(config, path.join(tempDir, "cancel-router.config.json"));
  cleanup.push(async () => {
    await router.server.stop();
    await router.loadBalancer.stop();
  });

  const baseUrl = `http://127.0.0.1:${routerPort}`;
  await waitForHealthyBackend(baseUrl, "mock-cancel-upstream");

  const clientAbortController = new AbortController();
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mock-live-model",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Cancel after the first streamed chunk.",
        },
      ],
    }),
    signal: clientAbortController.signal,
  });

  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);

  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  const firstChunkText = new TextDecoder().decode(firstChunk.value);
  assert.match(firstChunkText, /Streaming /);

  clientAbortController.abort(new Error("Client cancelled request."));

  try {
    await reader.read();
  } catch {
    // Node fetch rejects the body stream once the client aborts, which is expected here.
  }

  const cancelledEntry = await waitForRecentRequest(baseUrl, (entry) => (
    entry.path === "/v1/chat/completions" && entry.outcome === "cancelled"
  ));

  const detailResponse = await fetch(`${baseUrl}/api/requests/${encodeURIComponent(cancelledEntry.id)}`);
  assert.equal(detailResponse.status, 200);
  const detailPayload = await detailResponse.json() as {
    entry: {
      outcome: string;
    };
    responseBody?: {
      choices?: Array<{
        message?: {
          content?: string | null;
        };
      }>;
    };
  };

  assert.equal(detailPayload.entry.outcome, "cancelled");
  assert.match(detailPayload.responseBody?.choices?.[0]?.message?.content ?? "", /Streaming/);
});

test("dashboard can cancel a live connection and retain the partial response in history", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "llmproxy-dashboard-cancel-"));
  const cleanup: Array<() => Promise<void>> = [];

  t.after(async () => {
    for (const entry of cleanup.reverse()) {
      await entry();
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  const mockPort = await getFreePort();
  const routerPort = await getFreePort();

  const mockServer = await startMockSlowStreamingBackend(mockPort);
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) => {
      mockServer.close((error) => {
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
      requestTimeoutMs: 15_000,
      queueTimeoutMs: 2_000,
      healthCheckIntervalMs: 60_000,
      recentRequestLimit: 1000,
      mcpServerEnabled: true,
    },
    backends: [
      {
        id: "mock-dashboard-cancel-upstream",
        name: "mock dashboard cancel upstream",
        baseUrl: `http://127.0.0.1:${mockPort}`,
        enabled: true,
        maxConcurrency: 1,
        healthPath: "/v1/models",
        models: ["mock-live-model"],
      },
    ],
  };

  const router = await startRouter(config, path.join(tempDir, "dashboard-cancel-router.config.json"));
  cleanup.push(async () => {
    await router.server.stop();
    await router.loadBalancer.stop();
  });

  const baseUrl = `http://127.0.0.1:${routerPort}`;
  await waitForHealthyBackend(baseUrl, "mock-dashboard-cancel-upstream");

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mock-live-model",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Cancel this request from the dashboard.",
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);

  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  const firstChunkText = new TextDecoder().decode(firstChunk.value);
  assert.match(firstChunkText, /Streaming /);

  const activeConnection = await waitForActiveConnection(baseUrl);
  const cancelResponse = await fetch(`${baseUrl}/api/requests/${encodeURIComponent(activeConnection.id)}/cancel`, {
    method: "POST",
  });
  assert.equal(cancelResponse.status, 202);
  const cancelPayload = await cancelResponse.json() as {
    ok?: boolean;
    requestId?: string;
  };
  assert.equal(cancelPayload.ok, true);
  assert.equal(cancelPayload.requestId, activeConnection.id);

  try {
    await reader.read();
  } catch {
    // The dashboard-triggered abort can terminate the client stream abruptly.
  }

  const cancelledEntry = await waitForRecentRequest(baseUrl, (entry) => (
    entry.id === activeConnection.id && entry.outcome === "cancelled"
  ));

  const detailResponse = await fetch(`${baseUrl}/api/requests/${encodeURIComponent(cancelledEntry.id)}`);
  assert.equal(detailResponse.status, 200);
  const detailPayload = await detailResponse.json() as {
    entry: {
      outcome: string;
    };
    responseBody?: {
      choices?: Array<{
        message?: {
          content?: string | null;
        };
      }>;
    };
  };

  assert.equal(detailPayload.entry.outcome, "cancelled");
  assert.match(detailPayload.responseBody?.choices?.[0]?.message?.content ?? "", /Streaming/);
});
