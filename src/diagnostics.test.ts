import assert from "node:assert/strict";
import test from "node:test";
import { buildDiagnosticPrompt, buildDiagnosticReport, listDiagnosticPrompts } from "./diagnostics";
import type { ProxySnapshot, RequestLogDetail } from "./types";

function createSnapshot(): ProxySnapshot {
  return {
    startedAt: new Date().toISOString(),
    queueDepth: 0,
    recentRequestLimit: 1000,
    totals: {
      activeRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cancelledRequests: 0,
      rejectedRequests: 0,
    },
    backends: [
      {
        id: "backend-a",
        name: "Backend A",
        baseUrl: "http://127.0.0.1:1",
        connector: "openai",
        enabled: true,
        healthy: true,
        maxConcurrency: 1,
        activeRequests: 0,
        availableSlots: 1,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        cancelledRequests: 0,
        configuredModels: ["demo-model"],
        discoveredModels: ["demo-model"],
        discoveredModelDetails: [
          {
            id: "demo-model",
            metadata: {
              max_completion_tokens: 4096,
            },
          },
        ],
      },
    ],
    activeConnections: [],
    recentRequests: [],
  };
}

test("diagnostics detect truncated completions that hit the token limit", () => {
  const snapshot = createSnapshot();
  const detail: RequestLogDetail = {
    entry: {
      id: "request-length",
      time: new Date().toISOString(),
      method: "POST",
      path: "/v1/chat/completions",
      model: "demo-model",
      backendId: "backend-a",
      backendName: "Backend A",
      outcome: "success",
      latencyMs: 1200,
      queuedMs: 0,
      completionTokens: 512,
      effectiveCompletionTokenLimit: 512,
      finishReason: "length",
      hasDetail: true,
    },
    requestBody: {
      model: "demo-model",
      max_completion_tokens: 512,
      messages: [
        {
          role: "user",
          content: "Write a very long answer.",
        },
      ],
    },
    responseBody: {
      choices: [
        {
          message: {
            role: "assistant",
            content: "The answer was cut off before it finished.",
          },
        },
      ],
    },
  };

  const report = buildDiagnosticReport(detail, snapshot);

  assert.equal(report.signals.maxTokensReached, true);
  assert.equal(report.requestTokenLimit, 512);
  assert.equal(report.effectiveTokenLimit, 512);
  assert.ok(report.findings.some((finding) => finding.code === "max_tokens_reached"));
});

test("diagnostics detect repeated output patterns", () => {
  const snapshot = createSnapshot();
  const detail: RequestLogDetail = {
    entry: {
      id: "request-repeat",
      time: new Date().toISOString(),
      method: "POST",
      path: "/v1/chat/completions",
      model: "demo-model",
      backendId: "backend-a",
      backendName: "Backend A",
      outcome: "success",
      latencyMs: 1600,
      queuedMs: 0,
      completionTokens: 300,
      finishReason: "stop",
      hasDetail: true,
    },
    requestBody: {
      model: "demo-model",
      messages: [
        {
          role: "user",
          content: "Say one sentence.",
        },
      ],
    },
    responseBody: {
      choices: [
        {
          message: {
            role: "assistant",
            content: "This will loop forever. This will loop forever. This will loop forever. This will loop forever.",
          },
        },
      ],
    },
  };

  const report = buildDiagnosticReport(detail, snapshot);

  assert.equal(report.signals.repetitionDetected, true);
  assert.ok(report.findings.some((finding) => finding.code === "endless_repetition"));
});

test("diagnostics prompts expose a general request diagnosis playbook", () => {
  const snapshot = createSnapshot();
  const detail: RequestLogDetail = {
    entry: {
      id: "request-prompt",
      time: new Date().toISOString(),
      method: "POST",
      path: "/v1/chat/completions",
      model: "demo-model",
      backendId: "backend-a",
      backendName: "Backend A",
      outcome: "error",
      latencyMs: 700,
      queuedMs: 0,
      error: "Upstream timeout after 30000ms.",
      hasDetail: true,
    },
    requestBody: {
      model: "demo-model",
      messages: [
        {
          role: "user",
          content: "Help.",
        },
      ],
    },
    responseBody: undefined,
  };

  const prompts = listDiagnosticPrompts();
  assert.ok(prompts.some((prompt) => prompt.name === "diagnose-request"));

  const prompt = buildDiagnosticPrompt("diagnose-request", detail, snapshot);
  assert.equal(prompt.messages[0]?.role, "system");
  assert.equal(prompt.messages[1]?.role, "user");
  assert.match(prompt.messages[1]?.text ?? "", /request-prompt/);
  assert.match(prompt.messages[1]?.text ?? "", /Structured context/);
});
