import { computed } from "vue";
import type { DashboardState, DebugMetrics, DebugTranscriptEntry } from "../types/dashboard";
import { buildDebugMetaBadges } from "../utils/dashboard-badges";
import { formatDuration, formatTokenRate, prettyJson } from "../utils/formatters";
import { isClientRecord } from "../utils/guards";
import { readErrorResponse } from "../utils/http";
import { hasVisibleMessageContent } from "../utils/message-rendering";

function createEmptyDebugMetrics(): DebugMetrics {
  return {
    startedAt: 0,
    firstTokenAt: 0,
    lastTokenAt: 0,
    promptTokens: null,
    completionTokens: 0,
    totalTokens: null,
    contentTokens: 0,
    reasoningTokens: 0,
    promptMs: null,
    generationMs: null,
    promptPerSecond: null,
    completionPerSecond: null,
    finishReason: "",
  };
}

function estimateTokenCount(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) {
    return 0;
  }

  return Math.max(1, value.trim().split(/\s+/).filter(Boolean).length);
}

function readPayloadCounts(payload: Record<string, any>) {
  const usage = isClientRecord(payload?.usage) ? payload.usage : null;
  const timings = isClientRecord(payload?.timings) ? payload.timings : null;

  return {
    promptTokens: typeof usage?.prompt_tokens === "number"
      ? usage.prompt_tokens
      : (typeof timings?.prompt_n === "number" ? timings.prompt_n : null),
    completionTokens: typeof usage?.completion_tokens === "number"
      ? usage.completion_tokens
      : (typeof timings?.predicted_n === "number" ? timings.predicted_n : null),
    totalTokens: typeof usage?.total_tokens === "number"
      ? usage.total_tokens
      : null,
    promptMs: typeof timings?.prompt_ms === "number" ? timings.prompt_ms : null,
    generationMs: typeof timings?.predicted_ms === "number" ? timings.predicted_ms : null,
    promptPerSecond: typeof timings?.prompt_per_second === "number" ? timings.prompt_per_second : null,
    completionPerSecond: typeof timings?.predicted_per_second === "number" ? timings.predicted_per_second : null,
  };
}

export function createInitialDebugMetrics(): DebugMetrics {
  return createEmptyDebugMetrics();
}

export function useDebugChat(state: DashboardState) {
  let metricsTicker: number | undefined;

  function resetDebugMetrics(): void {
    state.debug.metrics = createEmptyDebugMetrics();
  }

  function stopDebugMetricsTicker(): void {
    if (metricsTicker !== undefined) {
      window.clearInterval(metricsTicker);
      metricsTicker = undefined;
    }
  }

  function startDebugMetricsTicker(): void {
    stopDebugMetricsTicker();
    metricsTicker = window.setInterval(() => {
      const metrics = state.debug.metrics;
      if (!metrics.startedAt) {
        return;
      }

      if (!metrics.firstTokenAt || metrics.completionPerSecond || metrics.completionTokens === 0) {
        return;
      }

      const seconds = Math.max(0.001, (Date.now() - metrics.firstTokenAt) / 1000);
      metrics.completionPerSecond = metrics.completionTokens / seconds;
    }, 200);
  }

  function noteStreamingTokenActivity(delta: Record<string, any>): void {
    const metrics = state.debug.metrics;
    const now = Date.now();

    const addedContentTokens = estimateTokenCount(delta?.content);
    const addedReasoningTokens = estimateTokenCount(delta?.reasoning_content);
    const addedCompletionTokens = addedContentTokens + addedReasoningTokens;

    if (addedCompletionTokens > 0) {
      if (!metrics.firstTokenAt) {
        metrics.firstTokenAt = now;
      }

      metrics.lastTokenAt = now;
      metrics.completionTokens += addedCompletionTokens;
      metrics.contentTokens += addedContentTokens;
      metrics.reasoningTokens += addedReasoningTokens;

      if (typeof metrics.promptTokens === "number") {
        metrics.totalTokens = metrics.promptTokens + metrics.completionTokens;
      }

      if (metrics.firstTokenAt) {
        metrics.completionPerSecond = metrics.completionTokens / Math.max(0.001, (now - metrics.firstTokenAt) / 1000);
      }
    }
  }

  function applyUsageMetrics(usage: unknown, timings: unknown, finishReason: unknown): void {
    const counts = readPayloadCounts({ usage, timings });
    const metrics = state.debug.metrics;

    if (typeof counts.promptTokens === "number") {
      metrics.promptTokens = counts.promptTokens;
    }

    if (typeof counts.completionTokens === "number") {
      metrics.completionTokens = counts.completionTokens;
    }

    if (typeof counts.totalTokens === "number") {
      metrics.totalTokens = counts.totalTokens;
    } else if (typeof metrics.promptTokens === "number") {
      metrics.totalTokens = metrics.promptTokens + metrics.completionTokens;
    }

    if (typeof counts.promptMs === "number") {
      metrics.promptMs = counts.promptMs;
    }

    if (typeof counts.generationMs === "number") {
      metrics.generationMs = counts.generationMs;
    }

    if (typeof counts.promptPerSecond === "number") {
      metrics.promptPerSecond = counts.promptPerSecond;
    }

    if (typeof counts.completionPerSecond === "number") {
      metrics.completionPerSecond = counts.completionPerSecond;
    }

    if (typeof finishReason === "string") {
      metrics.finishReason = finishReason;
    }
  }

  function formatUsage(usage: unknown, timings: unknown, finishReason: unknown): string {
    const counts = readPayloadCounts({ usage, timings });
    const parts: string[] = [];

    if (typeof finishReason === "string" && finishReason.length > 0) {
      parts.push(`finish ${finishReason}`);
    }

    if (typeof counts.promptTokens === "number") {
      parts.push(`${counts.promptTokens} prompt`);
    }

    if (typeof counts.completionTokens === "number") {
      parts.push(`${counts.completionTokens} completion`);
    }

    if (typeof counts.totalTokens === "number") {
      parts.push(`${counts.totalTokens} total`);
    }

    const rate = formatTokenRate(counts.completionPerSecond);
    if (rate) {
      parts.push(rate);
    }

    return parts.join(" | ");
  }

  function formatLiveUsage(): string {
    const metrics = state.debug.metrics;
    const parts: string[] = [];

    if (metrics.completionTokens > 0) {
      parts.push(`${metrics.completionTokens} live tok`);
    }

    if (metrics.reasoningTokens > 0) {
      parts.push(`${metrics.reasoningTokens} reasoning`);
    }

    const elapsedFromTokens = metrics.firstTokenAt
      ? formatDuration(Date.now() - metrics.firstTokenAt)
      : "";
    if (elapsedFromTokens && elapsedFromTokens !== "n/a") {
      parts.push(`elapsed ${elapsedFromTokens}`);
    }

    const rate = formatTokenRate(metrics.completionPerSecond);
    if (rate) {
      parts.push(rate);
    }

    return parts.join(" | ");
  }

  function mergeDebugFunctionCall(target: Record<string, any>, value: unknown): void {
    if (!isClientRecord(value)) {
      return;
    }

    const nextFunctionCall: Record<string, any> = isClientRecord(target.function_call)
      ? { ...target.function_call }
      : { arguments: "" };

    if (typeof value.name === "string" && value.name.length > 0) {
      nextFunctionCall.name = value.name;
    }

    if (typeof value.arguments === "string") {
      nextFunctionCall.arguments = String(nextFunctionCall.arguments ?? "") + value.arguments;
    }

    target.function_call = nextFunctionCall;
  }

  function mergeDebugToolCalls(target: Record<string, any>, value: unknown): void {
    if (!Array.isArray(value)) {
      return;
    }

    const nextToolCalls = Array.isArray(target.tool_calls)
      ? target.tool_calls.filter((toolCall: any) => isClientRecord(toolCall)).map((toolCall: any) => ({ ...toolCall }))
      : [];

    for (let index = 0; index < value.length; index += 1) {
      const rawToolCall = value[index];
      if (!isClientRecord(rawToolCall)) {
        continue;
      }

      const toolCallIndex = typeof rawToolCall.index === "number" ? rawToolCall.index : index;
      const existingIndex = nextToolCalls.findIndex((toolCall: any) => toolCall.index === toolCallIndex);
      const existingToolCall: Record<string, any> = existingIndex >= 0 && isClientRecord(nextToolCalls[existingIndex])
        ? { ...nextToolCalls[existingIndex] }
        : { index: toolCallIndex };

      if (typeof rawToolCall.id === "string" && rawToolCall.id.length > 0) {
        existingToolCall.id = rawToolCall.id;
      }

      if (typeof rawToolCall.type === "string" && rawToolCall.type.length > 0) {
        existingToolCall.type = rawToolCall.type;
      }

      if (isClientRecord(rawToolCall.function)) {
        const nextFunction: Record<string, any> = isClientRecord(existingToolCall.function)
          ? { ...existingToolCall.function }
          : { arguments: "" };

        if (typeof rawToolCall.function.name === "string" && rawToolCall.function.name.length > 0) {
          nextFunction.name = rawToolCall.function.name;
        }

        if (typeof rawToolCall.function.arguments === "string") {
          nextFunction.arguments = String(nextFunction.arguments ?? "") + rawToolCall.function.arguments;
        }

        existingToolCall.function = nextFunction;
      }

      if (existingIndex >= 0) {
        nextToolCalls[existingIndex] = existingToolCall;
      } else {
        nextToolCalls.push(existingToolCall);
      }
    }

    target.tool_calls = nextToolCalls.sort((left: any, right: any) => left.index - right.index);
  }

  function buildDebugHistoryMessage(entry: DebugTranscriptEntry): Record<string, any> | null {
    if (!isClientRecord(entry) || typeof entry.role !== "string") {
      return null;
    }

    const message: Record<string, any> = {
      role: entry.role,
    };

    if (Object.prototype.hasOwnProperty.call(entry, "content")) {
      message.content = entry.content ?? null;
    }

    if (typeof entry.name === "string" && entry.name.length > 0) {
      message.name = entry.name;
    }

    if (typeof entry.tool_call_id === "string" && entry.tool_call_id.length > 0) {
      message.tool_call_id = entry.tool_call_id;
    }

    if (isClientRecord(entry.function_call)) {
      message.function_call = entry.function_call;
    }

    if (Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0) {
      message.tool_calls = entry.tool_calls;
    }

    if (typeof entry.refusal === "string" && entry.refusal.length > 0) {
      message.refusal = entry.refusal;
    }

    return message;
  }

  function hasReplayableDebugMessage(message: Record<string, any> | null): boolean {
    if (!isClientRecord(message) || typeof message.role !== "string") {
      return false;
    }

    if (hasVisibleMessageContent(message.content)) {
      return true;
    }

    if (typeof message.refusal === "string" && message.refusal.length > 0) {
      return true;
    }

    if (isClientRecord(message.function_call)) {
      return true;
    }

    return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  }

  function applyNonStreamingResponse(payload: Record<string, any>, assistantTurn: DebugTranscriptEntry): void {
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
    const message = choice?.message;

    if (typeof message?.role === "string" && message.role.length > 0) {
      assistantTurn.role = message.role;
    }

    assistantTurn.content =
      message && Object.prototype.hasOwnProperty.call(message, "content")
        ? (message.content ?? null)
        : "";
    assistantTurn.reasoning_content = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
    assistantTurn.refusal = typeof message?.refusal === "string" ? message.refusal : "";
    assistantTurn.function_call = isClientRecord(message?.function_call) ? message.function_call : undefined;
    assistantTurn.tool_calls = Array.isArray(message?.tool_calls) ? message.tool_calls : undefined;
    assistantTurn.audio = isClientRecord(message?.audio) ? message.audio : undefined;
    assistantTurn.name = typeof message?.name === "string" ? message.name : "";
    assistantTurn.backend = state.debug.backend;
    assistantTurn.finish_reason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "";
    applyUsageMetrics(payload?.usage, payload?.timings, choice?.finish_reason);
    state.debug.usage = formatUsage(payload?.usage, payload?.timings, choice?.finish_reason);
    state.debug.rawResponse = prettyJson(payload);
  }

  function applyStreamingPayload(payload: Record<string, any>, assistantTurn: DebugTranscriptEntry): void {
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
    const delta = choice?.delta ?? choice?.message ?? {};

    if (typeof delta?.role === "string" && delta.role.length > 0) {
      assistantTurn.role = delta.role;
    }

    if (typeof delta?.content === "string") {
      assistantTurn.content = String(assistantTurn.content ?? "") + delta.content;
    }

    if (typeof delta?.reasoning_content === "string") {
      assistantTurn.reasoning_content = String(assistantTurn.reasoning_content ?? "") + delta.reasoning_content;
    }

    if (typeof delta?.refusal === "string") {
      assistantTurn.refusal = String(assistantTurn.refusal ?? "") + delta.refusal;
    }

    mergeDebugFunctionCall(assistantTurn as Record<string, any>, delta?.function_call);
    mergeDebugToolCalls(assistantTurn as Record<string, any>, delta?.tool_calls);

    if (typeof choice?.finish_reason === "string" && choice.finish_reason.length > 0) {
      assistantTurn.finish_reason = choice.finish_reason;
    }

    assistantTurn.backend = state.debug.backend;
    noteStreamingTokenActivity(delta);
    applyUsageMetrics(payload?.usage, payload?.timings, choice?.finish_reason);
    state.debug.usage = formatUsage(payload?.usage, payload?.timings, choice?.finish_reason);
  }

  function processStreamBlock(block: string, rawEvents: string[], assistantTurn: DebugTranscriptEntry): void {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      return;
    }

    const payloadText = dataLines.join("\n");
    if (!payloadText || payloadText === "[DONE]") {
      return;
    }

    rawEvents.push(payloadText);

    try {
      applyStreamingPayload(JSON.parse(payloadText), assistantTurn);
      state.debug.rawResponse = rawEvents.join("\n\n");
    } catch {
      state.debug.rawResponse = rawEvents.join("\n\n");
    }
  }

  function processStreamBuffer(
    buffer: string,
    rawEvents: string[],
    assistantTurn: DebugTranscriptEntry,
    flush: boolean,
  ): string {
    let working = buffer;

    while (true) {
      const windowsBreak = working.indexOf("\r\n\r\n");
      const unixBreak = working.indexOf("\n\n");
      let breakIndex = -1;
      let breakLength = 0;

      if (windowsBreak >= 0 && (unixBreak === -1 || windowsBreak < unixBreak)) {
        breakIndex = windowsBreak;
        breakLength = 4;
      } else if (unixBreak >= 0) {
        breakIndex = unixBreak;
        breakLength = 2;
      }

      if (breakIndex === -1) {
        break;
      }

      const block = working.slice(0, breakIndex);
      working = working.slice(breakIndex + breakLength);
      processStreamBlock(block, rawEvents, assistantTurn);
    }

    if (flush && working.trim()) {
      processStreamBlock(working, rawEvents, assistantTurn);
      return "";
    }

    return working;
  }

  async function consumeStreamingResponse(response: Response, assistantTurn: DebugTranscriptEntry): Promise<void> {
    if (!response.body) {
      throw new Error("Streaming response had no body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const rawEvents: string[] = [];
    let buffer = "";

    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      buffer += decoder.decode(next.value, { stream: true });
      buffer = processStreamBuffer(buffer, rawEvents, assistantTurn, false);
    }

    buffer += decoder.decode();
    processStreamBuffer(buffer, rawEvents, assistantTurn, true);
    state.debug.rawResponse = rawEvents.join("\n\n");
  }

  async function sendDebugChat(): Promise<void> {
    if (state.debug.sending) {
      return;
    }

    const prompt = state.debug.prompt.trim();

    if (!state.debug.model) {
      state.debug.error = "Please select a model first.";
      return;
    }

    if (!prompt) {
      state.debug.error = "Please enter a user message.";
      return;
    }

    const history = state.debug.transcript
      .map((entry) => buildDebugHistoryMessage(entry))
      .filter((entry): entry is Record<string, any> => hasReplayableDebugMessage(entry));

    history.push({
      role: "user",
      content: prompt,
    });

    const payload = {
      model: state.debug.model,
      messages: [
        ...(state.debug.systemPrompt.trim()
          ? [{
              role: "system",
              content: state.debug.systemPrompt.trim(),
            }]
          : []),
        ...history,
      ],
      stream: state.debug.stream,
      temperature: state.debug.params.temperature,
      top_p: state.debug.params.top_p,
      top_k: Math.round(state.debug.params.top_k),
      min_p: state.debug.params.min_p,
      repeat_penalty: state.debug.params.repeat_penalty,
      max_tokens: Math.max(1, Math.round(state.debug.params.max_tokens)),
    };

    const userTurn: DebugTranscriptEntry = {
      role: "user",
      content: prompt,
    };
    const assistantTurn: DebugTranscriptEntry = {
      role: "assistant",
      content: "",
      reasoning_content: "",
      backend: "",
      finish_reason: "",
    };

    state.debug.transcript.push(userTurn, assistantTurn);
    state.debug.error = "";
    state.debug.backend = "";
    state.debug.status = "";
    state.debug.usage = "";
    resetDebugMetrics();
    state.debug.metrics.startedAt = Date.now();
    state.debug.rawRequest = prettyJson(payload);
    state.debug.rawResponse = "";
    state.debug.prompt = "";
    state.debug.sending = true;
    state.debug.abortController = new AbortController();
    startDebugMetricsTicker();

    try {
      const response = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: state.debug.abortController.signal,
      });

      state.debug.backend = response.headers.get("x-llmproxy-backend") || "";
      state.debug.status = `HTTP ${response.status}`;
      assistantTurn.backend = state.debug.backend;

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      if (payload.stream) {
        await consumeStreamingResponse(response, assistantTurn);
      } else {
        applyNonStreamingResponse(await response.json(), assistantTurn);
      }
    } catch (error) {
      state.debug.error = error instanceof Error ? error.message : String(error);

      if (
        !hasVisibleMessageContent(assistantTurn.content) &&
        !assistantTurn.reasoning_content &&
        !(typeof assistantTurn.refusal === "string" && assistantTurn.refusal.length > 0) &&
        !isClientRecord(assistantTurn.function_call) &&
        !(Array.isArray(assistantTurn.tool_calls) && assistantTurn.tool_calls.length > 0)
      ) {
        state.debug.transcript.pop();
      }
    } finally {
      state.debug.sending = false;
      state.debug.abortController = null;
      stopDebugMetricsTicker();
    }
  }

  function stopDebugChat(): void {
    state.debug.abortController?.abort(new Error("Request cancelled from dashboard."));
  }

  function clearDebugChat(): void {
    state.debug.transcript = [];
    state.debug.rawRequest = "";
    state.debug.rawResponse = "";
    state.debug.status = "";
    state.debug.usage = "";
    state.debug.error = "";
    state.debug.backend = "";
    resetDebugMetrics();
  }

  const debugMetaBadges = computed(() => buildDebugMetaBadges(state.debug, formatLiveUsage()));

  return {
    clearDebugChat,
    debugMetaBadges,
    sendDebugChat,
    stopDebugChat,
    stopDebugMetricsTicker,
  };
}
