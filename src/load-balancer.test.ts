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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

test("routes by model and queues when the slot is full", async () => {
  const balancer = new LoadBalancer(TEST_CONFIG, {
    fetcher: async () => jsonResponse({ object: "list", data: [] }),
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

test("uses discovered models as the routing source of truth even with wildcard configuration", async () => {
  const config: ProxyConfig = {
    server: {
      ...TEST_CONFIG.server,
      port: 4002,
    },
    backends: [
      {
        id: "wildcard-a",
        name: "Wildcard A",
        baseUrl: "http://127.0.0.1:9100",
        enabled: true,
        maxConcurrency: 1,
        models: ["*"],
      },
      {
        id: "wildcard-b",
        name: "Wildcard B",
        baseUrl: "http://127.0.0.1:9101",
        enabled: true,
        maxConcurrency: 1,
        models: ["*"],
      },
    ],
  };

  const balancer = new LoadBalancer(config, {
    fetcher: async (input) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );

      if (url.port === "9100") {
        return jsonResponse({ object: "list", data: [{ id: "model-a" }] });
      }

      return jsonResponse({ object: "list", data: [{ id: "model-b" }] });
    },
  });

  await balancer.start();

  const lease = await balancer.acquire({
    id: "req-discovered-match",
    receivedAt: Date.now(),
    method: "POST",
    path: "/v1/chat/completions",
    model: "model-b",
    stream: true,
  });

  assert.equal(lease.backend.id, "wildcard-b");

  lease.release({
    outcome: "success",
    latencyMs: 40,
    statusCode: 200,
    queuedMs: lease.queueMs,
  });

  await assert.rejects(
    () => balancer.acquire({
      id: "req-discovered-miss",
      receivedAt: Date.now(),
      method: "POST",
      path: "/v1/chat/completions",
      model: "model-c",
      stream: true,
    }),
    /No backend configured for model "model-c"\./,
  );

  await balancer.stop();
});

test("routes requests using discovered model aliases", async () => {
  const config: ProxyConfig = {
    server: {
      ...TEST_CONFIG.server,
      port: 4003,
    },
    backends: [
      {
        id: "alias-backend",
        name: "Alias Backend",
        baseUrl: "http://127.0.0.1:9200",
        enabled: true,
        maxConcurrency: 1,
        models: ["*"],
      },
    ],
  };

  const balancer = new LoadBalancer(config, {
    fetcher: async () => jsonResponse({
      object: "list",
      data: [
        {
          id: "canonical-model",
          aliases: ["friendly-model"],
        },
      ],
    }),
  });

  await balancer.start();

  const lease = await balancer.acquire({
    id: "req-alias",
    receivedAt: Date.now(),
    method: "POST",
    path: "/v1/chat/completions",
    model: "friendly-model",
    stream: true,
  });

  assert.equal(lease.backend.id, "alias-backend");
  assert.equal(lease.selectedModel, "canonical-model");

  lease.release({
    outcome: "success",
    latencyMs: 35,
    statusCode: 200,
    queuedMs: lease.queueMs,
  });

  await balancer.stop();
});

test("auto selects the first free backend with a concrete model", async () => {
  const config: ProxyConfig = {
    server: {
      ...TEST_CONFIG.server,
      port: 4004,
    },
    backends: [
      {
        id: "auto-a",
        name: "Auto A",
        baseUrl: "http://127.0.0.1:9300",
        enabled: true,
        maxConcurrency: 1,
        models: ["*"],
      },
      {
        id: "auto-b",
        name: "Auto B",
        baseUrl: "http://127.0.0.1:9301",
        enabled: true,
        maxConcurrency: 1,
        models: ["*"],
      },
    ],
  };

  const balancer = new LoadBalancer(config, {
    fetcher: async (input) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );

      if (url.port === "9300") {
        return jsonResponse({ object: "list", data: [{ id: "auto-model-a" }] });
      }

      return jsonResponse({ object: "list", data: [{ id: "auto-model-b" }] });
    },
  });

  await balancer.start();

  const firstLease = await balancer.acquire({
    id: "req-auto-1",
    receivedAt: Date.now(),
    method: "POST",
    path: "/v1/chat/completions",
    model: "auto",
    stream: true,
  });

  assert.equal(firstLease.backend.id, "auto-a");
  assert.equal(firstLease.selectedModel, "auto-model-a");

  const secondLease = await balancer.acquire({
    id: "req-auto-2",
    receivedAt: Date.now(),
    method: "POST",
    path: "/v1/chat/completions",
    model: "*",
    stream: true,
  });

  assert.equal(secondLease.backend.id, "auto-b");
  assert.equal(secondLease.selectedModel, "auto-model-b");

  firstLease.release({
    outcome: "success",
    latencyMs: 25,
    statusCode: 200,
    queuedMs: firstLease.queueMs,
  });
  secondLease.release({
    outcome: "success",
    latencyMs: 25,
    statusCode: 200,
    queuedMs: secondLease.queueMs,
  });

  await balancer.stop();
});

test("missing model selects the first free backend with a concrete model", async () => {
  const config: ProxyConfig = {
    server: {
      ...TEST_CONFIG.server,
      port: 4005,
    },
    backends: [
      {
        id: "missing-a",
        name: "Missing A",
        baseUrl: "http://127.0.0.1:9400",
        enabled: true,
        maxConcurrency: 1,
        models: ["*"],
      },
      {
        id: "missing-b",
        name: "Missing B",
        baseUrl: "http://127.0.0.1:9401",
        enabled: true,
        maxConcurrency: 1,
        models: ["*"],
      },
    ],
  };

  const balancer = new LoadBalancer(config, {
    fetcher: async (input) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );

      if (url.port === "9400") {
        return jsonResponse({ object: "list", data: [{ id: "missing-model-a" }] });
      }

      return jsonResponse({ object: "list", data: [{ id: "missing-model-b" }] });
    },
  });

  await balancer.start();

  const lease = await balancer.acquire({
    id: "req-missing-model",
    receivedAt: Date.now(),
    method: "POST",
    path: "/v1/chat/completions",
    stream: true,
  });

  assert.equal(lease.backend.id, "missing-a");
  assert.equal(lease.selectedModel, "missing-model-a");

  lease.release({
    outcome: "success",
    latencyMs: 20,
    statusCode: 200,
    queuedMs: lease.queueMs,
  });

  await balancer.stop();
});

test("missing allowedModels behaves like a wildcard allowlist", async () => {
  const config: ProxyConfig = {
    server: {
      ...TEST_CONFIG.server,
      port: 4006,
    },
    backends: [
      {
        id: "open-backend",
        name: "Open Backend",
        baseUrl: "http://127.0.0.1:9500",
        enabled: true,
        maxConcurrency: 1,
      },
    ],
  };

  const balancer = new LoadBalancer(config, {
    fetcher: async () => jsonResponse({ object: "list", data: [] }),
  });

  const lease = await balancer.acquire({
    id: "req-open-model",
    receivedAt: Date.now(),
    method: "POST",
    path: "/v1/chat/completions",
    model: "any-model-name",
    stream: true,
  });

  assert.equal(lease.backend.id, "open-backend");
  assert.equal(lease.selectedModel, "any-model-name");

  lease.release({
    outcome: "success",
    latencyMs: 20,
    statusCode: 200,
    queuedMs: lease.queueMs,
  });
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
      jsonResponse({
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
    fetcher: async () => jsonResponse({ object: "list", data: [] }),
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
    fetcher: async () => jsonResponse({ object: "list", data: [] }),
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

test("applies health check interval changes without restarting the load balancer", async () => {
  let healthChecks = 0;
  const balancer = new LoadBalancer({
    ...TEST_CONFIG,
    server: {
      ...TEST_CONFIG.server,
      healthCheckIntervalMs: 10_000,
    },
  }, {
    fetcher: async () => {
      healthChecks += 1;
      return jsonResponse({ object: "list", data: [] });
    },
  });

  await balancer.start();
  const baselineChecks = healthChecks;

  balancer.replaceConfig({
    ...TEST_CONFIG,
    server: {
      ...TEST_CONFIG.server,
      healthCheckIntervalMs: 25,
    },
  });

  await delay(70);
  await balancer.stop();

  assert.ok(baselineChecks >= TEST_CONFIG.backends.length);
  assert.ok(
    healthChecks > baselineChecks,
    `expected health checks to increase after interval update, got ${baselineChecks} -> ${healthChecks}`,
  );
});
