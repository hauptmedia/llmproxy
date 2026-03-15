import type { DashboardState, DebugTranscriptEntry } from "../types/dashboard";
import { prettyJson } from "./formatters";
import { isClientRecord } from "./guards";
import {
  applyUsageMetrics,
  formatUsage,
  noteStreamingTokenActivity,
  readReasoningText,
} from "./debug-chat-metrics";
import {
  mergeDebugFunctionCall,
  mergeDebugToolCalls,
} from "./debug-chat-transcript";

type DebugStateSlice = DashboardState["debug"];
type ReplaceTranscriptEntry = (entry: DebugTranscriptEntry) => DebugTranscriptEntry;

function hasVisibleFunctionCallDelta(value: unknown): boolean {
  if (!isClientRecord(value)) {
    return false;
  }

  return (
    (typeof value.name === "string" && value.name.length > 0) ||
    (typeof value.arguments === "string" && value.arguments.length > 0)
  );
}

function hasVisibleToolCallsDelta(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.some((toolCall) => {
    if (!isClientRecord(toolCall)) {
      return false;
    }

    if (
      (typeof toolCall.id === "string" && toolCall.id.length > 0) ||
      (typeof toolCall.type === "string" && toolCall.type.length > 0)
    ) {
      return true;
    }

    if (!isClientRecord(toolCall.function)) {
      return false;
    }

    return (
      (typeof toolCall.function.name === "string" && toolCall.function.name.length > 0) ||
      (typeof toolCall.function.arguments === "string" && toolCall.function.arguments.length > 0)
    );
  });
}

export function applyNonStreamingResponse(
  debugState: DebugStateSlice,
  payload: Record<string, any>,
  assistantTurn: DebugTranscriptEntry,
  replaceTranscriptEntry: ReplaceTranscriptEntry,
): DebugTranscriptEntry {
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
  assistantTurn.backend = debugState.backend;
  assistantTurn.finish_reason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "";
  assistantTurn.pending = false;
  assistantTurn.pending_title = "";
  applyUsageMetrics(debugState.metrics, payload?.usage, payload?.timings, choice?.finish_reason);
  debugState.usage = formatUsage(payload?.usage, payload?.timings, choice?.finish_reason);
  debugState.rawResponse = prettyJson(payload);
  return replaceTranscriptEntry(assistantTurn);
}

export function applyStreamingPayload(
  debugState: DebugStateSlice,
  payload: Record<string, any>,
  assistantTurn: DebugTranscriptEntry,
  replaceTranscriptEntry: ReplaceTranscriptEntry,
): DebugTranscriptEntry {
  const choice = Array.isArray(payload?.choices) ? payload[0] : undefined;
  const normalizedChoice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
  const delta = normalizedChoice?.delta ?? normalizedChoice?.message ?? {};

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

  if (typeof normalizedChoice?.finish_reason === "string" && normalizedChoice.finish_reason.length > 0) {
    assistantTurn.finish_reason = normalizedChoice.finish_reason;
  }

  if (
    (typeof delta?.content === "string" && delta.content.length > 0) ||
    Boolean(reasoningDelta) ||
    (typeof delta?.refusal === "string" && delta.refusal.length > 0) ||
    hasVisibleFunctionCallDelta(delta?.function_call) ||
    hasVisibleToolCallsDelta(delta?.tool_calls) ||
    (typeof normalizedChoice?.finish_reason === "string" && normalizedChoice.finish_reason.length > 0)
  ) {
    assistantTurn.pending = false;
    assistantTurn.pending_title = "";
  }

  assistantTurn.backend = debugState.backend;
  noteStreamingTokenActivity(debugState.metrics, delta);
  applyUsageMetrics(debugState.metrics, payload?.usage, payload?.timings, normalizedChoice?.finish_reason);
  debugState.usage = formatUsage(payload?.usage, payload?.timings, normalizedChoice?.finish_reason);
  return replaceTranscriptEntry(assistantTurn);
}

function processStreamBlock(
  debugState: DebugStateSlice,
  block: string,
  rawEvents: string[],
  assistantTurn: DebugTranscriptEntry,
  replaceTranscriptEntry: ReplaceTranscriptEntry,
): DebugTranscriptEntry {
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
    const nextAssistantTurn = applyStreamingPayload(debugState, JSON.parse(payloadText), assistantTurn, replaceTranscriptEntry);
    debugState.rawResponse = rawEvents.join("\n\n");
    return nextAssistantTurn;
  } catch {
    debugState.rawResponse = rawEvents.join("\n\n");
    return assistantTurn;
  }
}

function processStreamBuffer(
  debugState: DebugStateSlice,
  buffer: string,
  rawEvents: string[],
  assistantTurn: DebugTranscriptEntry,
  replaceTranscriptEntry: ReplaceTranscriptEntry,
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
    currentAssistantTurn = processStreamBlock(debugState, block, rawEvents, currentAssistantTurn, replaceTranscriptEntry);
  }

  if (flush && working.trim()) {
    currentAssistantTurn = processStreamBlock(debugState, working, rawEvents, currentAssistantTurn, replaceTranscriptEntry);
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

export async function consumeStreamingResponse(
  response: Response,
  debugState: DebugStateSlice,
  assistantTurn: DebugTranscriptEntry,
  replaceTranscriptEntry: ReplaceTranscriptEntry,
): Promise<DebugTranscriptEntry> {
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
    const update = processStreamBuffer(debugState, buffer, rawEvents, currentAssistantTurn, replaceTranscriptEntry, false);
    buffer = update.buffer;
    currentAssistantTurn = update.assistantTurn;
  }

  buffer += decoder.decode();
  currentAssistantTurn = processStreamBuffer(debugState, buffer, rawEvents, currentAssistantTurn, replaceTranscriptEntry, true).assistantTurn;
  debugState.rawResponse = rawEvents.join("\n\n");
  return currentAssistantTurn;
}
