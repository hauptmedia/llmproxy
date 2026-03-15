import type {
  ConversationTranscriptItem,
  DebugTranscriptEntry,
  RequestLogDetail,
} from "../types/dashboard";
import { isClientRecord } from "./guards";

function cloneTranscriptToolCall(value: unknown): unknown {
  if (!isClientRecord(value)) {
    return value;
  }

  return {
    ...value,
    ...(isClientRecord(value.function) ? { function: { ...value.function } } : {}),
  };
}

export function buildConversationMessageFromDebugEntry(
  entry: DebugTranscriptEntry,
): Record<string, unknown> {
  return {
    role: entry.role,
    content: Object.prototype.hasOwnProperty.call(entry, "content") ? (entry.content ?? null) : null,
    reasoning_content: entry.reasoning_content ?? "",
    refusal: entry.refusal ?? "",
    ...(typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {}),
    ...(typeof entry.tool_call_id === "string" && entry.tool_call_id.length > 0 ? { tool_call_id: entry.tool_call_id } : {}),
    ...(typeof entry.model === "string" && entry.model.length > 0 ? { model: entry.model } : {}),
    ...(typeof entry.backend === "string" && entry.backend.length > 0 ? { backend: entry.backend } : {}),
    ...(typeof entry.finish_reason === "string" && entry.finish_reason.length > 0 ? { finish_reason: entry.finish_reason } : {}),
    ...(entry.pending === true ? { pending: true } : {}),
    ...(typeof entry.pending_title === "string" && entry.pending_title.length > 0 ? { pending_title: entry.pending_title } : {}),
    ...(isClientRecord(entry.function_call) ? { function_call: { ...entry.function_call } } : {}),
    ...(Array.isArray(entry.tool_calls)
      ? { tool_calls: entry.tool_calls.map((toolCall) => cloneTranscriptToolCall(toolCall)) }
      : {}),
    ...(isClientRecord(entry.audio) ? { audio: { ...entry.audio } } : {}),
  };
}

export function buildConversationItemsFromDebugTranscript(
  transcript: DebugTranscriptEntry[],
  options: {
    startIndex?: number;
    hideFinishBadge?: boolean;
    reasoningCollapsed?: boolean;
    keyPrefix?: string;
  } = {},
): ConversationTranscriptItem[] {
  const startIndex = options.startIndex ?? 0;
  const keyPrefix = options.keyPrefix ?? "transcript";

  return transcript.map((entry, index) => ({
    key: `${keyPrefix}:${index}:${entry.role}`,
    message: buildConversationMessageFromDebugEntry(entry),
    index: startIndex + index,
    finishReason: entry.finish_reason || "",
    hideFinishBadge: options.hideFinishBadge ?? true,
    reasoningCollapsed: options.reasoningCollapsed ?? true,
  }));
}

export function buildRequestConversationItems(
  detail: RequestLogDetail | null | undefined,
  options: {
    startIndex?: number;
    includeRequestMessages?: boolean;
    hideFinishBadge?: boolean;
    reasoningCollapsed?: boolean;
    requestKeyPrefix?: string;
    responseKeyPrefix?: string;
  } = {},
): ConversationTranscriptItem[] {
  if (!detail) {
    return [];
  }

  const startIndex = options.startIndex ?? 0;
  const includeRequestMessages = options.includeRequestMessages ?? true;
  const hideFinishBadge = options.hideFinishBadge ?? true;
  const reasoningCollapsed = options.reasoningCollapsed ?? true;
  const requestKeyPrefix = options.requestKeyPrefix ?? "request";
  const responseKeyPrefix = options.responseKeyPrefix ?? "response";

  const requestBody = isClientRecord(detail.requestBody)
    ? detail.requestBody as Record<string, unknown>
    : null;
  const requestMessages = Array.isArray(requestBody?.messages) ? requestBody.messages : [];

  const requestItems: ConversationTranscriptItem[] = includeRequestMessages
    ? requestMessages.map((message, index) => ({
        key: `${requestKeyPrefix}:${index}:${typeof message?.role === "string" ? message.role : "unknown"}`,
        message: isClientRecord(message) ? message as Record<string, unknown> : { role: "unknown", content: message },
        index: startIndex + index,
        hideFinishBadge,
        reasoningCollapsed,
      }))
    : [];

  const responseBody = isClientRecord(detail.responseBody)
    ? detail.responseBody as Record<string, unknown>
    : null;
  const choices = Array.isArray(responseBody?.choices) ? responseBody.choices : null;
  if (!responseBody || !choices || choices.length === 0) {
    return requestItems;
  }

  const resolvedModel =
    typeof responseBody.model === "string" && responseBody.model.trim().length > 0
      ? responseBody.model.trim()
      : (detail.entry.model ?? "");

  const responseStartIndex = startIndex + requestItems.length;
  const responseItems = choices.flatMap((choice: unknown, choiceIndex: number): ConversationTranscriptItem[] => {
    if (isClientRecord(choice) && isClientRecord(choice.message)) {
      return [{
        key: `${responseKeyPrefix}:${choiceIndex}:message`,
        message: {
          ...choice.message,
          ...(resolvedModel ? { model: resolvedModel } : {}),
        } as Record<string, unknown>,
        index: responseStartIndex + choiceIndex,
        finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
        hideFinishBadge,
        reasoningCollapsed,
      }];
    }

    if (isClientRecord(choice) && typeof choice.text === "string") {
      return [{
        key: `${responseKeyPrefix}:${choiceIndex}:text`,
        message: {
          role: "assistant",
          content: choice.text,
          ...(resolvedModel ? { model: resolvedModel } : {}),
        },
        index: responseStartIndex + choiceIndex,
        finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
        hideFinishBadge,
        reasoningCollapsed,
      }];
    }

    return [];
  });

  return [...requestItems, ...responseItems];
}
