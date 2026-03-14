import {
  JsonValue,
  ProxySnapshot,
  RequestLogDetail,
  RequestLogEntry,
} from "./types";
import {
  resolveEffectiveCompletionTokenLimit,
  resolveModelCompletionLimit,
  resolveRequestedCompletionLimit,
} from "./server-request-utils";

export type DiagnosticSeverity = "info" | "warn" | "bad";

export interface DiagnosticFinding {
  code:
    | "max_tokens_reached"
    | "endless_repetition"
    | "request_rejected"
    | "upstream_error"
    | "cancelled"
    | "no_obvious_issue";
  severity: DiagnosticSeverity;
  title: string;
  summary: string;
  evidence: string[];
  troubleshooting: string[];
}

export interface DiagnosticFact {
  label: string;
  value: string;
}

export interface DiagnosticReport {
  requestId: string;
  generatedAt: string;
  live: boolean;
  status: RequestLogEntry["outcome"];
  summary: string;
  resolvedModel?: string;
  backendName?: string;
  finishReason?: string;
  requestTokenLimit?: number;
  modelTokenLimit?: number;
  effectiveTokenLimit?: number;
  completionTokens?: number;
  outputPreview: string;
  findings: DiagnosticFinding[];
  recommendedPrompts: string[];
  facts: DiagnosticFact[];
  signals: {
    maxTokensReached: boolean;
    repetitionDetected: boolean;
    requestRejected: boolean;
    upstreamError: boolean;
  };
}

export interface DiagnosticPromptDefinition {
  name: DiagnosticPromptName;
  title: string;
  description: string;
  arguments: Array<{
    name: "request_id";
    description: string;
    required: true;
  }>;
}

export interface DiagnosticPromptMessage {
  role: "system" | "user";
  text: string;
}

export type DiagnosticPromptName =
  | "diagnose-request"
  | "troubleshoot-max-tokens"
  | "troubleshoot-repetition"
  | "troubleshoot-routing";

interface RepetitionSignal {
  summary: string;
  evidence: string[];
  troubleshooting: string[];
}

const DIAGNOSTIC_PROMPTS: DiagnosticPromptDefinition[] = [
  {
    name: "diagnose-request",
    title: "General diagnosis",
    description: "Review a stored llmproxy request, explain what happened, and propose concrete next changes.",
    arguments: [
      {
        name: "request_id",
        description: "ID of the stored llmproxy request to diagnose.",
        required: true,
      },
    ],
  },
  {
    name: "troubleshoot-max-tokens",
    title: "Max tokens / truncation",
    description: "Focus on finish_reason=length, token limits, and how to avoid truncation.",
    arguments: [
      {
        name: "request_id",
        description: "ID of the stored llmproxy request to analyze for truncation.",
        required: true,
      },
    ],
  },
  {
    name: "troubleshoot-repetition",
    title: "Repetition / looping",
    description: "Focus on endless repetition, looping outputs, and how to tune the request to stop it.",
    arguments: [
      {
        name: "request_id",
        description: "ID of the stored llmproxy request to analyze for repetition.",
        required: true,
      },
    ],
  },
  {
    name: "troubleshoot-routing",
    title: "Routing / backend selection",
    description: "Focus on rejected requests, queue timeouts, backend selection, and actual routed model choice.",
    arguments: [
      {
        name: "request_id",
        description: "ID of the stored llmproxy request to analyze for routing or backend issues.",
        required: true,
      },
    ],
  },
];

export function listDiagnosticPrompts(): DiagnosticPromptDefinition[] {
  return DIAGNOSTIC_PROMPTS.map((prompt) => ({
    ...prompt,
    arguments: prompt.arguments.map((argument) => ({ ...argument })),
  }));
}

export function buildDiagnosticReport(
  detail: RequestLogDetail,
  snapshot: ProxySnapshot,
): DiagnosticReport {
  const outputText = extractPrimaryAssistantText(detail.responseBody);
  const outputPreview = outputText.length > 600
    ? `${outputText.slice(0, 597).trimEnd()}...`
    : outputText;
  const requestTokenLimit = resolveRequestedCompletionLimit(detail.requestBody);
  const modelTokenLimit = resolveModelCompletionLimit(
    detail.entry.model,
    detail.entry.backendId,
    snapshot.backends,
  );
  const effectiveTokenLimit = resolveEffectiveCompletionTokenLimit(requestTokenLimit, modelTokenLimit)
    ?? detail.entry.effectiveCompletionTokenLimit;
  const completionTokens = detail.entry.completionTokens;
  const findings: DiagnosticFinding[] = [];

  const maxTokensReached = detectMaxTokensReached(detail.entry.finishReason, completionTokens, effectiveTokenLimit);
  if (maxTokensReached) {
    findings.push({
      code: "max_tokens_reached",
      severity: "warn",
      title: "Completion likely hit its token ceiling",
      summary: detail.entry.finishReason === "length"
        ? "The response ended with finish_reason=length, so generation stopped because the completion budget was exhausted."
        : "The generated completion is effectively at the configured token limit, so the answer was likely cut off by the token budget.",
      evidence: buildMaxTokenEvidence(detail.entry.finishReason, completionTokens, requestTokenLimit, modelTokenLimit, effectiveTokenLimit),
      troubleshooting: [
        "Increase max_completion_tokens or max_tokens for this request if you need a longer answer.",
        "Ask for a shorter or more focused answer, or split the task into smaller turns.",
        "If the model itself has a lower output cap than the request asks for, route to a backend model with a larger completion limit.",
      ],
    });
  }

  const repetitionSignal = detectRepetition(outputText);
  if (repetitionSignal) {
    findings.push({
      code: "endless_repetition",
      severity: maxTokensReached ? "bad" : "warn",
      title: "Degenerate repetition detected",
      summary: repetitionSignal.summary,
      evidence: repetitionSignal.evidence,
      troubleshooting: repetitionSignal.troubleshooting,
    });
  }

  if (!detail.entry.backendId && (detail.entry.outcome === "error" || detail.entry.outcome === "queued_timeout")) {
    findings.push({
      code: "request_rejected",
      severity: "bad",
      title: "Request never reached a backend",
      summary: "llmproxy rejected or timed out this request before it could be assigned to any backend.",
      evidence: [
        `Final status: ${detail.entry.outcome}.`,
        detail.entry.error ? `Error: ${detail.entry.error}` : "No backend assignment was stored for this request.",
      ],
      troubleshooting: [
        "Check whether a healthy enabled backend exists for the requested model.",
        'If the client sent model "auto" or "*", ensure at least one backend currently exposes a concrete model.',
        "Increase backend max concurrency or queue timeout if the request is timing out while waiting for capacity.",
      ],
    });
  }

  if (detail.entry.backendId && detail.entry.outcome === "error") {
    findings.push({
      code: "upstream_error",
      severity: "bad",
      title: "Backend request failed after routing",
      summary: "The request was assigned to a backend, but the upstream call still failed before a successful completion.",
      evidence: [
        detail.entry.backendName ? `Backend: ${detail.entry.backendName}.` : "A backend had already been assigned.",
        detail.entry.statusCode ? `HTTP status: ${detail.entry.statusCode}.` : "No final upstream status code was stored.",
        detail.entry.error ? `Error: ${detail.entry.error}` : "The upstream backend returned an unspecified error.",
      ],
      troubleshooting: [
        "Inspect the backend health state and upstream logs for the selected backend.",
        "Verify connector compatibility, request schema, and model availability on that backend.",
        "If this only fails for one model, compare the request against a known-good model/backend combination.",
      ],
    });
  }

  if (detail.entry.outcome === "cancelled") {
    findings.push({
      code: "cancelled",
      severity: "info",
      title: "Request was cancelled",
      summary: "Generation stopped because the client or dashboard cancelled the request before completion.",
      evidence: [
        detail.entry.error ? `Cancellation detail: ${detail.entry.error}` : "The stored request ended with outcome=cancelled.",
      ],
      troubleshooting: [
        "Only troubleshoot this if the cancellation was unexpected.",
        "If cancellations happen under load, check client timeouts, user abort logic, and dashboard-triggered cancels.",
      ],
    });
  }

  if (findings.length === 0) {
    findings.push({
      code: "no_obvious_issue",
      severity: "info",
      title: "No obvious failure signal detected",
      summary: "This request does not show a clear truncation, routing, repetition, or upstream failure signal in the stored data.",
      evidence: [
        detail.entry.finishReason
          ? `finish_reason=${detail.entry.finishReason}.`
          : "No explicit finish reason was stored.",
        detail.entry.outcome === "success"
          ? "The stored request completed successfully."
          : `Stored outcome: ${detail.entry.outcome}.`,
      ],
      troubleshooting: [
        "Use the general diagnosis prompt to inspect prompt quality, tool behavior, and response quality in more detail.",
      ],
    });
  }

  const recommendedPrompts = buildRecommendedPrompts(findings);
  const summary = buildDiagnosticSummary(findings, detail.entry);

  return {
    requestId: detail.entry.id,
    generatedAt: new Date().toISOString(),
    live: detail.live === true,
    status: detail.entry.outcome,
    summary,
    resolvedModel: detail.entry.model,
    backendName: detail.entry.backendName,
    finishReason: detail.entry.finishReason,
    requestTokenLimit,
    modelTokenLimit,
    effectiveTokenLimit,
    completionTokens,
    outputPreview,
    findings,
    recommendedPrompts,
    facts: buildFacts(detail.entry, requestTokenLimit, modelTokenLimit, effectiveTokenLimit, outputText),
    signals: {
      maxTokensReached,
      repetitionDetected: Boolean(repetitionSignal),
      requestRejected: findings.some((finding) => finding.code === "request_rejected"),
      upstreamError: findings.some((finding) => finding.code === "upstream_error"),
    },
  };
}

export function buildDiagnosticPrompt(
  name: DiagnosticPromptName,
  detail: RequestLogDetail,
  snapshot: ProxySnapshot,
): { name: DiagnosticPromptName; title: string; description: string; messages: DiagnosticPromptMessage[] } {
  const definition = DIAGNOSTIC_PROMPTS.find((entry) => entry.name === name);
  if (!definition) {
    throw new Error(`Unknown diagnostics prompt "${name}".`);
  }

  const report = buildDiagnosticReport(detail, snapshot);
  const serializedContext = JSON.stringify({
    report,
    request: {
      entry: detail.entry,
      requestBody: detail.requestBody ?? null,
      responseBodyPreview: buildResponseBodyPreview(detail.responseBody),
    },
  }, null, 2);

  const systemText = buildSystemPrompt(name);
  const userText = [
    "Diagnose this llmproxy request using the provided structured context.",
    "Return:",
    "1. A concise diagnosis",
    "2. The strongest evidence",
    "3. Concrete troubleshooting changes to try next",
    "",
    "Structured context:",
    "```json",
    serializedContext,
    "```",
  ].join("\n");

  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    messages: [
      {
        role: "system",
        text: systemText,
      },
      {
        role: "user",
        text: userText,
      },
    ],
  };
}

function buildSystemPrompt(name: DiagnosticPromptName): string {
  if (name === "troubleshoot-max-tokens") {
    return "You diagnose llmproxy requests with a focus on truncation, finish_reason=length, token ceilings, and how to adjust prompts or token limits without causing new failures.";
  }

  if (name === "troubleshoot-repetition") {
    return "You diagnose llmproxy requests with a focus on endless repetition, looping generations, and concrete decoding or prompt changes that reduce degeneration.";
  }

  if (name === "troubleshoot-routing") {
    return "You diagnose llmproxy routing issues with a focus on backend selection, missing model matches, queue saturation, and backend compatibility problems.";
  }

  return "You are an llmproxy diagnostics assistant. Explain what happened, identify the likeliest failure mode, and recommend precise next changes to the request, model choice, or backend configuration.";
}

function buildFacts(
  entry: RequestLogEntry,
  requestTokenLimit: number | undefined,
  modelTokenLimit: number | undefined,
  effectiveTokenLimit: number | undefined,
  outputText: string,
): DiagnosticFact[] {
  const facts: DiagnosticFact[] = [
    {
      label: "Status",
      value: entry.outcome,
    },
  ];

  if (entry.finishReason) {
    facts.push({
      label: "Finish reason",
      value: entry.finishReason,
    });
  }

  if (entry.model) {
    facts.push({
      label: "Model",
      value: entry.model,
    });
  }

  if (entry.backendName) {
    facts.push({
      label: "Backend",
      value: entry.backendName,
    });
  }

  if (entry.completionTokens !== undefined) {
    facts.push({
      label: "Completion tokens",
      value: effectiveTokenLimit !== undefined
        ? `${entry.completionTokens} / ${effectiveTokenLimit}`
        : `${entry.completionTokens}`,
    });
  }

  if (requestTokenLimit !== undefined) {
    facts.push({
      label: "Request token limit",
      value: String(requestTokenLimit),
    });
  }

  if (modelTokenLimit !== undefined) {
    facts.push({
      label: "Model token limit",
      value: String(modelTokenLimit),
    });
  }

  if (entry.completionTokensPerSecond !== undefined) {
    facts.push({
      label: "Completion throughput",
      value: `${round(entry.completionTokensPerSecond)} tok/s`,
    });
  }

  facts.push({
    label: "Output chars",
    value: String(outputText.length),
  });

  return facts;
}

function buildRecommendedPrompts(findings: DiagnosticFinding[]): DiagnosticPromptName[] {
  const prompts = new Set<DiagnosticPromptName>(["diagnose-request"]);

  if (findings.some((finding) => finding.code === "max_tokens_reached")) {
    prompts.add("troubleshoot-max-tokens");
  }

  if (findings.some((finding) => finding.code === "endless_repetition")) {
    prompts.add("troubleshoot-repetition");
  }

  if (findings.some((finding) => finding.code === "request_rejected" || finding.code === "upstream_error")) {
    prompts.add("troubleshoot-routing");
  }

  return Array.from(prompts);
}

function buildDiagnosticSummary(findings: DiagnosticFinding[], entry: RequestLogEntry): string {
  const badFinding = findings.find((finding) => finding.severity === "bad");
  if (badFinding) {
    return badFinding.summary;
  }

  const warnFinding = findings.find((finding) => finding.severity === "warn");
  if (warnFinding) {
    return warnFinding.summary;
  }

  if (entry.outcome === "success") {
    return "The stored request completed without an obvious failure signal in the retained diagnostics data.";
  }

  return "The retained request data does not point to one dominant failure mode yet.";
}

function buildMaxTokenEvidence(
  finishReason: string | undefined,
  completionTokens: number | undefined,
  requestLimit: number | undefined,
  modelLimit: number | undefined,
  effectiveLimit: number | undefined,
): string[] {
  const evidence: string[] = [];

  if (finishReason) {
    evidence.push(`finish_reason=${finishReason}.`);
  }

  if (completionTokens !== undefined) {
    evidence.push(
      effectiveLimit !== undefined
        ? `Generated ${completionTokens} / ${effectiveLimit} completion tokens.`
        : `Generated ${completionTokens} completion tokens.`,
    );
  }

  if (requestLimit !== undefined) {
    evidence.push(`Requested completion limit: ${requestLimit}.`);
  }

  if (modelLimit !== undefined) {
    evidence.push(`Model completion limit: ${modelLimit}.`);
  }

  return evidence;
}

function detectMaxTokensReached(
  finishReason: string | undefined,
  completionTokens: number | undefined,
  effectiveLimit: number | undefined,
): boolean {
  if (finishReason === "length") {
    return true;
  }

  if (completionTokens === undefined || effectiveLimit === undefined || effectiveLimit <= 0) {
    return false;
  }

  return completionTokens >= Math.max(1, Math.floor(effectiveLimit * 0.98));
}

function detectRepetition(text: string): RepetitionSignal | undefined {
  if (!text.trim()) {
    return undefined;
  }

  const normalized = normalizeWhitespace(text);
  const repeatedLine = detectRepeatedLine(text);
  if (repeatedLine) {
    return repeatedLine;
  }

  const repeatedTailPhrase = detectRepeatedTailPhrase(normalized);
  if (repeatedTailPhrase) {
    return repeatedTailPhrase;
  }

  return undefined;
}

function detectRepeatedLine(text: string): RepetitionSignal | undefined {
  const counts = new Map<string, number>();
  const lines = text
    .split(/\r?\n/g)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length >= 12);

  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  const repeated = Array.from(counts.entries())
    .filter((entry) => entry[1] >= 3)
    .sort((left, right) => right[1] - left[1])[0];

  if (!repeated) {
    return undefined;
  }

  return {
    summary: "The assistant output repeats the same line multiple times, which strongly suggests degenerate looping instead of useful progress.",
    evidence: [
      `Repeated line (${repeated[1]}x): "${truncate(repeated[0], 180)}".`,
    ],
    troubleshooting: [
      "Lower max_completion_tokens so the model has less room to get stuck in a loop.",
      "Increase repeat_penalty and consider adding a stop sequence if the answer has a clear terminal pattern.",
      "Tighten the prompt so the model knows when to stop instead of continuing open-ended text.",
    ],
  };
}

function detectRepeatedTailPhrase(text: string): RepetitionSignal | undefined {
  const words = text
    .toLowerCase()
    .split(/\s+/g)
    .filter((word) => word.length > 0);

  if (words.length < 12) {
    return undefined;
  }

  for (let phraseLength = 3; phraseLength <= 10; phraseLength += 1) {
    let repeats = 1;
    let start = words.length - phraseLength;
    const phrase = words.slice(start, start + phraseLength).join(" ");

    while (start - phraseLength >= 0) {
      const previous = words.slice(start - phraseLength, start).join(" ");
      if (previous !== phrase) {
        break;
      }

      repeats += 1;
      start -= phraseLength;
    }

    if (repeats >= 3 && phrase.length >= 16) {
      return {
        summary: "The response tail contains the same phrase repeated several times in a row, which is a classic endless-repetition signal.",
        evidence: [
          `Repeated tail phrase (${repeats}x): "${truncate(phrase, 180)}".`,
        ],
        troubleshooting: [
          "Reduce max_completion_tokens so the model stops earlier instead of burning tokens in a loop.",
          "Increase repeat_penalty and keep temperature/top_p conservative while troubleshooting.",
          "Add an explicit instruction for what the final line should look like, or provide a stop sequence that matches the desired ending.",
        ],
      };
    }
  }

  return undefined;
}

function extractPrimaryAssistantText(value: JsonValue | undefined): string {
  const segments = collectAssistantTextSegments(value);
  return normalizeWhitespace(segments.join("\n\n"));
}

function buildResponseBodyPreview(value: JsonValue | undefined): string {
  if (value === undefined) {
    return "";
  }

  const serialized = JSON.stringify(value, null, 2);
  return serialized.length > 6000
    ? `${serialized.slice(0, 5997)}...`
    : serialized;
}

function collectAssistantTextSegments(value: JsonValue | undefined): string[] {
  if (!isJsonRecord(value)) {
    return [];
  }

  const segments: string[] = [];

  if (typeof value.output_text === "string" && value.output_text.trim().length > 0) {
    segments.push(value.output_text.trim());
  }

  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      if (!isJsonRecord(choice)) {
        continue;
      }

      if (typeof choice.text === "string" && choice.text.trim().length > 0) {
        segments.push(choice.text.trim());
      }

      if (isJsonRecord(choice.message)) {
        segments.push(...collectMessageTextSegments(choice.message));
      }
    }
  }

  if (Array.isArray(value.output)) {
    for (const item of value.output) {
      if (isJsonRecord(item)) {
        segments.push(...collectMessageTextSegments(item));
      }
    }
  }

  return segments;
}

function collectMessageTextSegments(message: Record<string, JsonValue>): string[] {
  const segments: string[] = [];

  if (typeof message.content === "string" && message.content.trim().length > 0) {
    segments.push(message.content.trim());
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (!isJsonRecord(part)) {
        continue;
      }

      const explicitText = readStringField(part, ["text", "content", "value"]);
      if (explicitText) {
        segments.push(explicitText);
      }
    }
  }

  return segments;
}

function readStringField(value: Record<string, JsonValue>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
    : value;
}

function round(value: number): string {
  return value.toFixed(value >= 100 ? 0 : 1);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
