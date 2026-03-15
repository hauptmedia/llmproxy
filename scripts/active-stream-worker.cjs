const { randomInt } = require("node:crypto");
const { Agent: HttpAgent, request: httpRequest } = require("node:http");

function readCliOption(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function parsePositiveInteger(value, fallback) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function incrementCounter(container, key, delta = 1) {
  container[key] = (container[key] ?? 0) + delta;
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createClientStats() {
  return {
    operations: {},
    results: {},
    statusCodes: {},
    errors: {},
    bytesReceived: 0,
    streamChunks: 0,
    requestIds: [],
  };
}

function createRequestedStreamPayload(requestIndex, targetTokens, chunkDelayMs) {
  return {
    model: requestIndex % 5 === 0 ? "auto" : "chaos-shared-model",
    stream: true,
    max_completion_tokens: targetTokens,
    messages: [
      {
        role: "system",
        content: `[chaos:long] active-stream request=${requestIndex} target_tokens=${targetTokens}`,
      },
      {
        role: "user",
        content: `Keep streaming until the proxy has relayed a long response for soak request ${requestIndex}.`,
      },
    ],
    chaos_target_tokens: targetTokens,
    chaos_chunk_delay_ms: chunkDelayMs,
  };
}

async function sendChatRequestOverHttp(baseUrl, payload, stats, agent) {
  const url = new URL("/v1/chat/completions", baseUrl);
  const body = JSON.stringify(payload);

  return await new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: "POST",
      agent,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const requestIdHeader = response.headers["x-llmproxy-request-id"];
      incrementCounter(stats.statusCodes, String(statusCode));
      resolve({
        response,
        statusCode,
        requestId: Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader,
      });
    });

    request.once("error", reject);
    request.end(body);
  });
}

async function runRequestedStreamingClient(baseUrl, stats, requestIndex, targetTokens, agent) {
  incrementCounter(stats.operations, "stream_fixed");
  const segmentCount = clamp(Math.ceil(targetTokens / 320), 24, 160);
  const chunkDelayMs = clamp(Math.round(22_000 / segmentCount), 160, 260);
  const payload = createRequestedStreamPayload(requestIndex, targetTokens, chunkDelayMs);

  try {
    const { response, requestId, statusCode } = await sendChatRequestOverHttp(baseUrl, payload, stats, agent);
    if (requestId) {
      stats.requestIds.push(requestId);
    }

    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stats.bytesReceived += buffer.length;
      stats.streamChunks += 1;
    }

    incrementCounter(stats.results, statusCode === 200 ? "success" : "error");
  } catch (error) {
    incrementCounter(stats.results, "error");
    incrementCounter(stats.errors, error?.code ?? error?.name ?? "unknown");
  }
}

async function main() {
  const baseUrl = readCliOption("base-url");
  if (!baseUrl) {
    throw new Error("Missing --base-url for active-stream worker.");
  }

  const connections = parsePositiveInteger(readCliOption("connections"), 50);
  const minTokens = parsePositiveInteger(readCliOption("min-tokens"), 1_000);
  const maxTokens = parsePositiveInteger(readCliOption("max-tokens"), 40_000);
  const requestOffset = parsePositiveInteger(readCliOption("request-offset"), 0);
  const startSpacingMs = parsePositiveInteger(readCliOption("start-spacing-ms"), 100);
  const startOffsetMs = parsePositiveInteger(readCliOption("start-offset-ms"), 0);
  const agent = new HttpAgent({
    keepAlive: false,
    maxSockets: Math.max(128, connections * 2),
  });
  const stats = createClientStats();
  const tokenTargets = Array.from({ length: connections }, () => randomInt(minTokens, maxTokens + 1));

  try {
    await Promise.all(tokenTargets.map((targetTokens, index) => (
      delay(startOffsetMs + (index * startSpacingMs))
        .then(() => runRequestedStreamingClient(baseUrl, stats, requestOffset + index, targetTokens, agent))
    )));
  } finally {
    agent.destroy();
  }

  process.send?.({
    type: "result",
    clientStats: stats,
    tokenTargets: {
      count: tokenTargets.length,
      min: tokenTargets.length > 0 ? Math.min(...tokenTargets) : 0,
      max: tokenTargets.length > 0 ? Math.max(...tokenTargets) : 0,
      sum: tokenTargets.reduce((sum, value) => sum + value, 0),
    },
  });
}

main().catch((error) => {
  process.send?.({
    type: "error",
    message: error?.stack ?? String(error),
  });
  process.exitCode = 1;
});
