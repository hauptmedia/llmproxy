import { toRaw } from "vue";
import type { DashboardState, DebugMetrics, DebugTranscriptEntry } from "../types/dashboard";
import { formatTokenRate, prettyJson } from "../utils/formatters";
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

function readReasoningText(value: unknown): string {
  if (!isClientRecord(value)) {
    return "";
  }

  if (typeof value.reasoning_content === "string") {
    return value.reasoning_content;
  }

  if (typeof value.reasoning === "string") {
    return value.reasoning;
  }

  if (typeof value.thinking === "string") {
    return value.thinking;
  }

  return "";
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

function createClientDebugRequestId(): string {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return `dbg_${window.crypto.randomUUID()}`;
  }

  return `dbg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function useDebugChat(
  state: DashboardState,
  onErrorToast: (title: string, message: string) => void,
) {
  let metricsTicker: number | undefined;
  let cachedDiagnosticTools: Array<Record<string, unknown>> | null = null;

  function cloneDebugToolCall(value: unknown): unknown {
    if (!isClientRecord(value)) {
      return value;
    }

    return {
      ...value,
      ...(isClientRecord(value.function) ? { function: { ...value.function } } : {}),
    };
  }

  function replaceTranscriptEntry(entry: DebugTranscriptEntry): DebugTranscriptEntry {
    const entryRaw = toRaw(entry);
    const index = state.debug.transcript.findIndex((candidate) => toRaw(candidate) === entryRaw);
    if (index === -1) {
      return entry;
    }

    const nextEntry: DebugTranscriptEntry = {
      ...entry,
      ...(isClientRecord(entry.function_call) ? { function_call: { ...entry.function_call } } : {}),
      ...(isClientRecord(entry.audio) ? { audio: { ...entry.audio } } : {}),
      ...(Array.isArray(entry.tool_calls)
        ? { tool_calls: entry.tool_calls.map((toolCall) => cloneDebugToolCall(toolCall)) as DebugTranscriptEntry["tool_calls"] }
        : {}),
    };

    state.debug.transcript.splice(index, 1, nextEntry);
    return state.debug.transcript[index] as DebugTranscriptEntry;
  }

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
    const addedReasoningTokens = estimateTokenCount(readReasoningText(delta));
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

  function applyNonStreamingResponse(payload: Record<string, any>, assistantTurn: DebugTranscriptEntry): DebugTranscriptEntry {
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
    const message = choice?.message;

    if (typeof message?.role === "string" && message.role.length > 0) {
      assistantTurn.role = message.role;
    }

    assistantTurn.content =
      message && Object.prototype.hasOwnProperty.call(message, "content")
        ? (message.content ?? null)
        : "";
    assistantTurn.reasoning_content = readReasoningText(message);
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
    return replaceTranscriptEntry(assistantTurn);
  }

  function applyStreamingPayload(payload: Record<string, any>, assistantTurn: DebugTranscriptEntry): DebugTranscriptEntry {
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
    const delta = choice?.delta ?? choice?.message ?? {};

    if (typeof delta?.role === "string" && delta.role.length > 0) {
      assistantTurn.role = delta.role;
    }

    if (typeof delta?.content === "string") {
      assistantTurn.content = String(assistantTurn.content ?? "") + delta.content;
    }

    const reasoningDelta = readReasoningText(delta);
    if (reasoningDelta) {
      assistantTurn.reasoning_content = String(assistantTurn.reasoning_content ?? "") + reasoningDelta;
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
    return replaceTranscriptEntry(assistantTurn);
  }

  function processStreamBlock(block: string, rawEvents: string[], assistantTurn: DebugTranscriptEntry): DebugTranscriptEntry {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      return assistantTurn;
    }

    const payloadText = dataLines.join("\n");
    if (!payloadText || payloadText === "[DONE]") {
      return assistantTurn;
    }

    rawEvents.push(payloadText);

    try {
      const nextAssistantTurn = applyStreamingPayload(JSON.parse(payloadText), assistantTurn);
      state.debug.rawResponse = rawEvents.join("\n\n");
      return nextAssistantTurn;
    } catch {
      state.debug.rawResponse = rawEvents.join("\n\n");
      return assistantTurn;
    }
  }

  function processStreamBuffer(
    buffer: string,
    rawEvents: string[],
    assistantTurn: DebugTranscriptEntry,
    flush: boolean,
  ): { buffer: string; assistantTurn: DebugTranscriptEntry } {
    let working = buffer;
    let currentAssistantTurn = assistantTurn;

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
      currentAssistantTurn = processStreamBlock(block, rawEvents, currentAssistantTurn);
    }

    if (flush && working.trim()) {
      currentAssistantTurn = processStreamBlock(working, rawEvents, currentAssistantTurn);
      return {
        buffer: "",
        assistantTurn: currentAssistantTurn,
      };
    }

    return {
      buffer: working,
      assistantTurn: currentAssistantTurn,
    };
  }

  async function consumeStreamingResponse(response: Response, assistantTurn: DebugTranscriptEntry): Promise<DebugTranscriptEntry> {
    if (!response.body) {
      throw new Error("Streaming response had no body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const rawEvents: string[] = [];
    let buffer = "";
    let currentAssistantTurn = assistantTurn;

    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      buffer += decoder.decode(next.value, { stream: true });
      const update = processStreamBuffer(buffer, rawEvents, currentAssistantTurn, false);
      buffer = update.buffer;
      currentAssistantTurn = update.assistantTurn;
    }

    buffer += decoder.decode();
    currentAssistantTurn = processStreamBuffer(buffer, rawEvents, currentAssistantTurn, true).assistantTurn;
    state.debug.rawResponse = rawEvents.join("\n\n");
    return currentAssistantTurn;
  }

  async function loadDiagnosticChatTools(): Promise<Array<Record<string, unknown>>> {
    if (cachedDiagnosticTools) {
      return cachedDiagnosticTools.map((tool) => ({ ...tool }));
    }

    const response = await fetch("/api/diagnostics/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/list",
      }),
    });

    if (!response.ok) {
      throw new Error(await readErrorResponse(response));
    }

    const payload = await response.json() as {
      result?: {
        tools?: unknown[];
      };
      error?: {
        message?: string;
      };
    };

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const tools = Array.isArray(payload.result?.tools)
      ? payload.result.tools
        .filter((tool): tool is Record<string, unknown> => isClientRecord(tool))
        .map((tool) => ({
          type: "function",
          function: {
            name: typeof tool.name === "string" ? tool.name : "unnamed_tool",
            description: typeof tool.description === "string" ? tool.description : "",
            parameters: isClientRecord(tool.inputSchema)
              ? tool.inputSchema
              : {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
          },
        }))
      : [];

    if (tools.length === 0) {
      throw new Error("Diagnostics MCP endpoint did not return any tools.");
    }

    cachedDiagnosticTools = tools;
    return tools.map((tool) => ({ ...tool }));
  }

  async function callDiagnosticChatTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch("/api/diagnostics/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name,
          arguments: args,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(await readErrorResponse(response));
    }

    const payload = await response.json() as {
      result?: Record<string, unknown>;
      error?: {
        message?: string;
      };
    };

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    return payload.result ?? {};
  }

  function extractDebugToolCalls(entry: DebugTranscriptEntry): Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }> {
    if (!Array.isArray(entry.tool_calls)) {
      return [];
    }

    const calls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];

    for (const toolCall of entry.tool_calls) {
      if (!isClientRecord(toolCall)) {
        continue;
      }

      const toolCallRecord = toolCall as Record<string, unknown>;
      if (!isClientRecord(toolCallRecord.function)) {
        continue;
      }

      const functionRecord = toolCallRecord.function as Record<string, unknown>;
      if (typeof functionRecord.name !== "string") {
        continue;
      }

      const parsedArgs = parseDebugToolArguments(functionRecord.arguments);
      calls.push({
        id: typeof toolCallRecord.id === "string" && toolCallRecord.id.length > 0
          ? toolCallRecord.id
          : `${functionRecord.name}_${calls.length}`,
        name: functionRecord.name,
        args: parsedArgs,
      });
    }

    return calls;
  }

  function parseDebugToolArguments(value: unknown): Record<string, unknown> {
    if (isClientRecord(value)) {
      return { ...value };
    }

    if (typeof value !== "string") {
      return {};
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return {};
    }

    const parsed = JSON.parse(trimmed) as unknown;
    if (!isClientRecord(parsed)) {
      throw new Error("Tool arguments must resolve to a JSON object.");
    }

    return parsed;
  }

  async function executeDebugToolCalls(toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>): Promise<DebugTranscriptEntry[]> {
    const responses: DebugTranscriptEntry[] = [];

    for (const toolCall of toolCalls) {
      try {
        const result = await callDiagnosticChatTool(toolCall.name, toolCall.args);
        responses.push({
          role: "tool",
          name: toolCall.name,
          tool_call_id: toolCall.id,
          content: prettyJson(result.structuredContent ?? result),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        responses.push({
          role: "tool",
          name: toolCall.name,
          tool_call_id: toolCall.id,
          content: prettyJson({
            error: {
              message,
            },
          }),
        });
      }
    }

    return responses;
  }

  async function runSingleDebugAssistantRequest(
    payload: Record<string, unknown>,
    assistantTurn: DebugTranscriptEntry,
    requestId: string,
  ): Promise<DebugTranscriptEntry> {
    const response = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-llmproxy-request-id": requestId,
      },
      body: JSON.stringify(payload),
      signal: state.debug.abortController?.signal,
    });

    state.debug.backend = response.headers.get("x-llmproxy-backend") || "";
    state.debug.lastRequestId = requestId;
    state.debug.status = `HTTP ${response.status}`;
    assistantTurn.backend = state.debug.backend;

    if (!response.ok) {
      throw new Error(await readErrorResponse(response));
    }

    if (payload.stream === true) {
      return await consumeStreamingResponse(response, assistantTurn);
    }

    return applyNonStreamingResponse(await response.json(), assistantTurn);
  }

  async function sendDebugChat(): Promise<void> {
    if (state.debug.sending) {
      return;
    }

    state.debug.stream = true;

    const prompt = state.debug.prompt.trim();
    const lastTranscriptEntry = state.debug.transcript[state.debug.transcript.length - 1];
    const regenerateAssistantReply =
      prompt.length === 0 &&
      state.debug.transcript.length > 0 &&
      isClientRecord(lastTranscriptEntry) &&
      lastTranscriptEntry.role === "assistant";
    const transcriptForReplay = regenerateAssistantReply
      ? state.debug.transcript.slice(0, -1)
      : state.debug.transcript;

    if (!state.debug.model) {
      state.debug.error = "Please select a model first.";
      return;
    }

    if (!prompt && !regenerateAssistantReply) {
      state.debug.error = "Please enter a user message.";
      return;
    }

    const history = transcriptForReplay
      .map((entry) => buildDebugHistoryMessage(entry))
      .filter((entry): entry is Record<string, any> => hasReplayableDebugMessage(entry));

    if (prompt) {
      history.push({
        role: "user",
        content: prompt,
      });
    }

    let diagnosticTools: Array<Record<string, unknown>> | undefined;
    if (state.debug.enableDiagnosticTools) {
      try {
        diagnosticTools = await loadDiagnosticChatTools();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.debug.error = message;
        onErrorToast("Diagnostics tools", message);
        return;
      }
    }

    const userTurn: DebugTranscriptEntry | null = prompt
      ? {
          role: "user",
          content: prompt,
        }
      : null;
    let assistantTurn: DebugTranscriptEntry = {
      role: "assistant",
      content: "",
      reasoning_content: "",
      backend: "",
      finish_reason: "",
    };
    const requestId = createClientDebugRequestId();
    const removedAssistantTurn = regenerateAssistantReply && isClientRecord(lastTranscriptEntry)
      ? { ...(lastTranscriptEntry as Record<string, any>) } as DebugTranscriptEntry
      : null;

    if (regenerateAssistantReply) {
      state.debug.transcript.pop();
    }

    state.debug.sending = true;

    if (userTurn) {
      state.debug.transcript.push(userTurn);
    }

    state.debug.transcript.push(assistantTurn);
    // Continue streaming against the reactive transcript entry so the UI updates live.
    assistantTurn = state.debug.transcript[state.debug.transcript.length - 1] as DebugTranscriptEntry;
    state.debug.error = "";
    state.debug.backend = "";
    state.debug.status = "";
    state.debug.usage = "";
    resetDebugMetrics();
    state.debug.metrics.startedAt = Date.now();
    state.debug.lastRequestId = requestId;
    state.debug.rawRequest = "";
    state.debug.rawResponse = "";
    state.debug.prompt = "";
    state.debug.abortController = new AbortController();
    startDebugMetricsTicker();

    try {
      let currentAssistantTurn = assistantTurn;
      let currentRequestId = requestId;

      for (let round = 0; round < 6; round += 1) {
        const currentPayload = {
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
          stream: true,
          temperature: state.debug.params.temperature,
          top_p: state.debug.params.top_p,
          top_k: Math.round(state.debug.params.top_k),
          min_p: state.debug.params.min_p,
          repeat_penalty: state.debug.params.repeat_penalty,
          max_tokens: Math.max(1, Math.round(state.debug.params.max_tokens)),
          ...(diagnosticTools ? { tools: diagnosticTools } : {}),
        };

        state.debug.lastRequestId = currentRequestId;
        state.debug.rawRequest = prettyJson(currentPayload);
        currentAssistantTurn = await runSingleDebugAssistantRequest(currentPayload, currentAssistantTurn, currentRequestId);
        assistantTurn = currentAssistantTurn;

        const assistantHistoryMessage = buildDebugHistoryMessage(currentAssistantTurn);
        if (assistantHistoryMessage) {
          history.push(assistantHistoryMessage);
        }

        if (!state.debug.enableDiagnosticTools) {
          break;
        }

        const toolCalls = extractDebugToolCalls(currentAssistantTurn);
        if (toolCalls.length === 0) {
          break;
        }

        state.debug.status = `Running ${toolCalls.length} diagnostic tool call${toolCalls.length === 1 ? "" : "s"}...`;
        const toolTurns = await executeDebugToolCalls(toolCalls);

        for (const toolTurn of toolTurns) {
          state.debug.transcript.push(toolTurn);
          const toolHistoryMessage = buildDebugHistoryMessage(toolTurn);
          if (toolHistoryMessage) {
            history.push(toolHistoryMessage);
          }
        }

        if (round === 5) {
          onErrorToast("Diagnostics tools", "Maximum diagnostic tool rounds reached.");
          break;
        }

        currentAssistantTurn = {
          role: "assistant",
          content: "",
          reasoning_content: "",
          backend: "",
          finish_reason: "",
        };
        state.debug.transcript.push(currentAssistantTurn);
        currentAssistantTurn = state.debug.transcript[state.debug.transcript.length - 1] as DebugTranscriptEntry;
        assistantTurn = currentAssistantTurn;
        currentRequestId = createClientDebugRequestId();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.debug.error = message;
      onErrorToast("Chat request", message);

      if (
        !hasVisibleMessageContent(assistantTurn.content) &&
        !assistantTurn.reasoning_content &&
        !(typeof assistantTurn.refusal === "string" && assistantTurn.refusal.length > 0) &&
        !isClientRecord(assistantTurn.function_call) &&
        !(Array.isArray(assistantTurn.tool_calls) && assistantTurn.tool_calls.length > 0)
      ) {
        state.debug.transcript.pop();

        if (removedAssistantTurn) {
          state.debug.transcript.push(removedAssistantTurn);
        }
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
    state.debug.lastRequestId = "";
    state.debug.prompt = "Say hello briefly and mention the model you are using.";
    resetDebugMetrics();
  }

  function prepareDebugChatDraft(systemPrompt: string, prompt: string): void {
    stopDebugMetricsTicker();
    state.debug.abortController?.abort(new Error("Chat session reset from diagnostics."));
    state.debug.sending = false;
    state.debug.abortController = null;
    state.debug.transcript = [];
    state.debug.rawRequest = "";
    state.debug.rawResponse = "";
    state.debug.status = "";
    state.debug.usage = "";
    state.debug.error = "";
    state.debug.backend = "";
    state.debug.lastRequestId = "";
    state.debug.systemPrompt = systemPrompt.trim();
    state.debug.prompt = prompt;
    resetDebugMetrics();
  }

  return {
    clearDebugChat,
    prepareDebugChatDraft,
    sendDebugChat,
    stopDebugChat,
    stopDebugMetricsTicker,
  };
}
