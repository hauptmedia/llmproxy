import test from "node:test";
import assert from "node:assert/strict";
import { LoadBalancer } from "./load-balancer";
import { ProxyConfig } from "./types";
import { delay } from "./utils";

const TEST_CONFIG: ProxyConfig = {
  server: {
    host: "127.0.0.1",
    port: 4000,
    dashboardPath: "/dashboard",
    requestTimeoutMs: 5_000,
    queueTimeoutMs: 500,
    healthCheckIntervalMs: 10_000,
    recentRequestLimit: 1000,
  },
  backends: [
    {
      id: "llama-a",
      name: "llama A",
      baseUrl: "http://127.0.0.1:8080",
      enabled: true,
      maxConcurrency: 1,
      models: ["chat-*"],
    },
    {
      id: "llama-b",
      name: "llama B",
      baseUrl: "http://127.0.0.1:8081",
      enabled: true,
      maxConcurrency: 1,
      models: ["embed-*"],
    },
  ],
};

test("routes by model and queues when the slot is full", async () => {
  const balancer = new LoadBalancer(TEST_CONFIG, {
    fetcher: async () =>
      new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
  });
  const firstLease = await balancer.acquire({
    id: "req-1",
    receivedAt: Date.now(),
    method: "POST",
    path: "/v1/chat/completions",
    model: "chat-local",
    stream: true,
  });

  assert.equal(firstLease.backend.id, "llama-a");

  let secondResolved = false;
  const secondLeasePromise = balancer
    .acquire({
      id: "req-2",
      receivedAt: Date.now(),
      method: "POST",
      path: "/v1/chat/completions",
      model: "chat-local",
      stream: true,
    })
    .then((lease) => {
      secondResolved = true;
      return lease;
    });

  await delay(50);
  assert.equal(secondResolved, false);

  firstLease.release({
    outcome: "success",
    latencyMs: 120,
    statusCode: 200,
    queuedMs: firstLease.queueMs,
  });

  const secondLease = await secondLeasePromise;
  assert.equal(secondLease.backend.id, "llama-a");

  secondLease.release({
    outcome: "success",
    latencyMs: 90,
    statusCode: 200,
    queuedMs: secondLease.queueMs,
  });

  const embedLease = await balancer.acquire({
    id: "req-3",
    receivedAt: Date.now(),
    method: "POST",
    path: "/v1/embeddings",
    model: "embed-local",
    stream: false,
  });

  assert.equal(embedLease.backend.id, "llama-b");
  embedLease.release({
    outcome: "success",
    latencyMs: 80,
    statusCode: 200,
    queuedMs: embedLease.queueMs,
  });

  const snapshot = balancer.getSnapshot();
  assert.equal(snapshot.queueDepth, 0);
  assert.equal(snapshot.backends[0]?.successfulRequests, 2);
  assert.equal(snapshot.backends[1]?.successfulRequests, 1);
});

test("captures discovered model metadata from /v1/models for backend snapshots", async () => {
  const config: ProxyConfig = {
    server: {
      host: "127.0.0.1",
      port: 4001,
      dashboardPath: "/dashboard",
      requestTimeoutMs: 5_000,
      queueTimeoutMs: 500,
      healthCheckIntervalMs: 10_000,
      recentRequestLimit: 1000,
    },
    backends: [
      {
        id: "meta-backend",
        name: "Metadata Backend",
        baseUrl: "http://127.0.0.1:9090",
        enabled: true,
        maxConcurrency: 1,
        healthPath: "/v1/models",
      },
    ],
  };

  const balancer = new LoadBalancer(config, {
    fetcher: async () =>
      new Response(JSON.stringify({
        object: "list",
        models: [
          {
            name: "meta-model",
            model: "meta-model",
            description: "Metadata-rich test model",
            capabilities: ["completion", "multimodal"],
            details: {
              format: "gguf",
            },
          },
        ],
        data: [
          {
            id: "meta-model",
            object: "model",
            created: 1773335036,
            owned_by: "llamacpp",
            aliases: ["meta-model"],
            meta: {
              n_ctx_train: 262144,
              n_params: 1234567890,
            },
          },
        ],
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
  });

  await balancer.start();

  const snapshot = balancer.getSnapshot();
  assert.deepEqual(snapshot.backends[0]?.discoveredModels, ["meta-model"]);
  assert.deepEqual(snapshot.backends[0]?.discoveredModelDetails, [
    {
      id: "meta-model",
      metadata: {
        id: "meta-model",
        object: "model",
        created: 1773335036,
        owned_by: "llamacpp",
        aliases: ["meta-model"],
        meta: {
          n_ctx_train: 262144,
          n_params: 1234567890,
        },
        name: "meta-model",
        model: "meta-model",
        description: "Metadata-rich test model",
        capabilities: ["completion", "multimodal"],
        details: {
          format: "gguf",
        },
      },
    },
  ]);

  await balancer.stop();
});

test("releasing a lease after replaceConfig updates the current backend runtime", async () => {
  const balancer = new LoadBalancer(TEST_CONFIG, {
    fetcher: async () =>
      new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
  });

  const firstLease = await balancer.acquire({
    id: "req-replace-1",
    receivedAt: Date.now(),
    method: "POST",
    path: "/v1/chat/completions",
    model: "chat-local",
    stream: true,
  });

  balancer.replaceConfig({
    ...TEST_CONFIG,
    backends: TEST_CONFIG.backends.map((backend) => ({
      ...backend,
    })),
  });

  let secondResolved = false;
  const secondLeasePromise = balancer.acquire({
    id: "req-replace-2",
    receivedAt: Date.now(),
    method: "POST",
    path: "/v1/chat/completions",
    model: "chat-local",
    stream: true,
  }).then((lease) => {
    secondResolved = true;
    return lease;
  });

  await delay(50);
  assert.equal(secondResolved, false);

  firstLease.release({
    outcome: "success",
    latencyMs: 75,
    statusCode: 200,
    queuedMs: firstLease.queueMs,
  });

  const secondLease = await secondLeasePromise;
  assert.equal(secondLease.backend.id, "llama-a");

  secondLease.release({
    outcome: "success",
    latencyMs: 65,
    statusCode: 200,
    queuedMs: secondLease.queueMs,
  });

  const snapshot = balancer.getSnapshot();
  assert.equal(snapshot.backends[0]?.activeRequests, 0);
  assert.equal(snapshot.backends[0]?.successfulRequests, 2);
});

test("retains only the configured number of recent requests", async () => {
  const balancer = new LoadBalancer({
    ...TEST_CONFIG,
    server: {
      ...TEST_CONFIG.server,
      recentRequestLimit: 2,
    },
  }, {
    fetcher: async () =>
      new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
  });

  for (const requestId of ["req-limit-1", "req-limit-2", "req-limit-3"]) {
    const lease = await balancer.acquire({
      id: requestId,
      receivedAt: Date.now(),
      method: "POST",
      path: "/v1/chat/completions",
      model: "chat-local",
      stream: true,
      requestBody: {
        model: "chat-local",
      },
    });

    lease.release({
      outcome: "success",
      latencyMs: 50,
      statusCode: 200,
      queuedMs: lease.queueMs,
      responseBody: {
        id: requestId,
      },
    });
  }

  const snapshot = balancer.getSnapshot();
  assert.equal(snapshot.recentRequestLimit, 2);
  assert.deepEqual(snapshot.recentRequests.map((entry) => entry.id), ["req-limit-3", "req-limit-2"]);
  assert.equal(balancer.getRequestLogDetail("req-limit-1"), undefined);
  assert.equal(balancer.getRequestLogDetail("req-limit-2")?.entry.id, "req-limit-2");
});

