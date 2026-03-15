import { nextTick } from "vue";
import type {
  DashboardState,
  DebugQueuedMessage,
  DebugTranscriptEntry,
} from "../types/dashboard";
import { buildDiagnosticsChatTools } from "../utils/diagnostics-mcp";
import { defaultDebugChatPrompt } from "../utils/debug-chat-suggestions";
import { readErrorResponse } from "../utils/http";
import {
  consumeStreamingResponse,
  applyNonStreamingResponse,
  truncateDebugRawText,
} from "../utils/debug-chat-stream";
import {
  createAssistantTurn,
  buildDebugHistoryMessage,
  extractDebugToolCalls,
  hasReplayableDebugMessage,
  hasVisibleAssistantTurnPayload,
  replaceTranscriptEntry as replaceDebugTranscriptEntry,
} from "../utils/debug-chat-transcript";
import { executeDebugToolCalls } from "../utils/debug-chat-tools";
import {
  createClientDebugRequestId,
  createInitialDebugMetrics,
} from "../utils/debug-chat-metrics";
import { prettyJson } from "../utils/formatters";

export { createInitialDebugMetrics } from "../utils/debug-chat-metrics";

export function useDebugChat(
  state: DashboardState,
  onErrorToast: (title: string, message: string) => void,
) {
  const maxFunctionRounds = 100;
  let metricsTicker: number | undefined;
  let activeRunId = 0;

  async function yieldDebugChatPaint(): Promise<void> {
    await nextTick();
    await new Promise<void>((resolve) => {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => resolve());
        return;
      }

      setTimeout(resolve, 0);
    });
  }

  function ensureDefaultDebugPrompt(): void {
    if (state.debug.defaultPromptDismissed) {
      return;
    }

    if (state.debug.transcript.length > 0 || state.debug.queuedMessages.length > 0) {
      return;
    }

    if (state.debug.systemPrompt.trim().length > 0 || state.debug.prompt.trim().length > 0) {
      return;
    }

    state.debug.prompt = defaultDebugChatPrompt;
  }

  function isExpectedDebugAbort(error: unknown): boolean {
    return error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError";
  }

  function replaceTranscriptEntry(entry: DebugTranscriptEntry): DebugTranscriptEntry {
    return replaceDebugTranscriptEntry(state.debug.transcript, entry);
  }

  function cloneDebugParams(source = state.debug.params) {
    return {
      temperature: source.temperature,
      top_p: source.top_p,
      top_k: source.top_k,
      min_p: source.min_p,
      repeat_penalty: source.repeat_penalty,
      max_completion_tokens: source.max_completion_tokens,
      tool_choice: source.tool_choice,
    };
  }

  function createPendingAssistantTurn(waitingTitle: string): DebugTranscriptEntry {
    return {
      ...createAssistantTurn(),
      pending: true,
      pending_title: waitingTitle,
    };
  }

  function cloneDebugValue<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((entry) => cloneDebugValue(entry)) as T;
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [key, cloneDebugValue(nestedValue)]),
      ) as T;
    }

    return value;
  }

  function cloneDebugTranscriptEntry(entry: DebugTranscriptEntry): DebugTranscriptEntry {
    return cloneDebugValue(entry);
  }

  function findLastSentUserTurn(): DebugTranscriptEntry | null {
    for (let index = state.debug.transcript.length - 1; index >= 0; index -= 1) {
      const entry = state.debug.transcript[index];
      if (!entry || entry.role !== "user" || typeof entry.content !== "string") {
        continue;
      }

      const prompt = entry.content.trim();
      if (!prompt) {
        continue;
      }

      return {
        ...cloneDebugTranscriptEntry(entry),
        content: prompt,
      };
    }

    return null;
  }

  function queueCurrentDebugMessage(): boolean {
    const prompt = state.debug.prompt.trim();
    if (!prompt) {
      return false;
    }

    state.debug.queuedMessages.push({
      prompt,
      model: state.debug.model,
      enableDiagnosticTools: state.debug.enableDiagnosticTools,
      params: cloneDebugParams(),
    });
    state.debug.prompt = "";
    return true;
  }

  function shiftQueuedDebugMessage(): DebugQueuedMessage | null {
    const next = state.debug.queuedMessages.shift();
    return next ?? null;
  }

  function resetDebugMetrics(): void {
    state.debug.metrics = createInitialDebugMetrics();
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
    assistantTurn.model = response.headers.get("x-llmproxy-model") || assistantTurn.model || "";

    if (!response.ok) {
      throw new Error(await readErrorResponse(response));
    }

    if (payload.stream === true) {
      return await consumeStreamingResponse(response, state.debug, assistantTurn);
    }

    return applyNonStreamingResponse(
      state.debug,
      await response.json(),
      assistantTurn,
      replaceTranscriptEntry,
    );
  }

  async function sendDebugChat(queuedMessage: DebugQueuedMessage | null = null): Promise<void> {
    if (state.debug.sending) {
      queueCurrentDebugMessage();
      return;
    }

    const runId = activeRunId + 1;
    activeRunId = runId;

    state.debug.stream = true;

    const prompt = (queuedMessage?.prompt ?? state.debug.prompt).trim();
    const model = queuedMessage?.model ?? state.debug.model;
    const enableDiagnosticTools = queuedMessage?.enableDiagnosticTools ?? state.debug.enableDiagnosticTools;
    const params = queuedMessage?.params ?? state.debug.params;
    const resendLastUserTurn = queuedMessage === null && prompt.length === 0
      ? findLastSentUserTurn()
      : null;
    const effectivePrompt = resendLastUserTurn?.content ?? prompt;

    if (!model) {
      state.debug.error = "Please select a model first.";
      return;
    }

    if (!effectivePrompt) {
      state.debug.error = "Please enter a user message.";
      return;
    }

    const history = resendLastUserTurn
      ? [{
          role: "user",
          content: effectivePrompt,
        }]
      : [
          ...state.debug.transcript
            .map((entry) => buildDebugHistoryMessage(entry))
            .filter((entry): entry is Record<string, any> => hasReplayableDebugMessage(entry)),
          {
            role: "user",
            content: effectivePrompt,
          },
        ];

    const diagnosticsAllowed = state.serverConfig?.mcpServerEnabled !== false;
    let diagnosticTools: Array<Record<string, unknown>> | undefined;
    if (enableDiagnosticTools && diagnosticsAllowed) {
      try {
        diagnosticTools = await buildDiagnosticsChatTools();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.debug.error = message;
        onErrorToast("llmproxy functions", message);
        return;
      }
    }

    const userTurn: DebugTranscriptEntry = resendLastUserTurn ?? {
      role: "user",
      content: effectivePrompt,
    };
    const initialWaitingTitle = "Waiting for model response.";
    let assistantTurn = createPendingAssistantTurn(initialWaitingTitle);
    const requestId = createClientDebugRequestId();
    const previousTranscript = queuedMessage === null && resendLastUserTurn
      ? state.debug.transcript.map((entry) => cloneDebugTranscriptEntry(entry))
      : null;

    state.debug.sending = true;
    if (queuedMessage === null && resendLastUserTurn) {
      state.debug.transcript.splice(0, state.debug.transcript.length, userTurn);
    } else {
      state.debug.transcript.push(userTurn);
    }

    state.debug.transcript.push(assistantTurn);
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
    if (!queuedMessage) {
      state.debug.prompt = "";
    }
    state.debug.abortController = new AbortController();
    startDebugMetricsTicker();

    try {
      await yieldDebugChatPaint();

      let currentAssistantTurn = assistantTurn;
      let currentRequestId = requestId;

      for (let round = 0; round < maxFunctionRounds; round += 1) {
        const currentPayload = {
          model,
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
          temperature: params.temperature,
          top_p: params.top_p,
          top_k: Math.round(params.top_k),
          min_p: params.min_p,
          repeat_penalty: params.repeat_penalty,
          max_completion_tokens: Math.max(1, Math.round(params.max_completion_tokens)),
          ...(diagnosticTools ? { tools: diagnosticTools } : {}),
          ...(diagnosticTools ? { tool_choice: params.tool_choice } : {}),
        };

        state.debug.lastRequestId = currentRequestId;
        state.debug.rawRequest = truncateDebugRawText(prettyJson(currentPayload));
        currentAssistantTurn = await runSingleDebugAssistantRequest(
          currentPayload,
          currentAssistantTurn,
          currentRequestId,
        );
        assistantTurn = currentAssistantTurn;

        const assistantHistoryMessage = buildDebugHistoryMessage(currentAssistantTurn);
        if (assistantHistoryMessage) {
          history.push(assistantHistoryMessage);
        }

        if (!enableDiagnosticTools || !diagnosticsAllowed) {
          break;
        }

        const toolCalls = extractDebugToolCalls(currentAssistantTurn);
        if (toolCalls.length === 0) {
          break;
        }

        state.debug.status = `Running ${toolCalls.length} llmproxy function call${toolCalls.length === 1 ? "" : "s"}...`;
        const toolTurns = await executeDebugToolCalls(toolCalls, {
          onStart(toolCall) {
            const pendingToolTurn: DebugTranscriptEntry = {
              role: "tool",
              name: toolCall.name,
              tool_call_id: toolCall.id,
              pending: true,
              pending_title: `Waiting for ${toolCall.name} to return...`,
            };
            state.debug.transcript.push(pendingToolTurn);
            return state.debug.transcript[state.debug.transcript.length - 1] as DebugTranscriptEntry;
          },
          onFinish(toolTurn, _toolCall, pendingTurn) {
            if (pendingTurn) {
              Object.assign(pendingTurn, toolTurn, {
                pending: false,
                pending_title: "",
              });
              replaceTranscriptEntry(pendingTurn);
              return;
            }

            state.debug.transcript.push(toolTurn);
          },
        });

        for (const toolTurn of toolTurns) {
          const toolHistoryMessage = buildDebugHistoryMessage(toolTurn);
          if (toolHistoryMessage) {
            history.push(toolHistoryMessage);
          }
        }

        if (round === maxFunctionRounds - 1) {
          onErrorToast("llmproxy functions", "Maximum llmproxy function rounds reached.");
          break;
        }

        currentAssistantTurn = createPendingAssistantTurn("Waiting for the next model response.");
        state.debug.transcript.push(currentAssistantTurn);
        currentAssistantTurn = state.debug.transcript[state.debug.transcript.length - 1] as DebugTranscriptEntry;
        assistantTurn = currentAssistantTurn;
        currentRequestId = createClientDebugRequestId();
      }
    } catch (error) {
      if (runId !== activeRunId || isExpectedDebugAbort(error)) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      state.debug.error = message;
      onErrorToast("Chat request", message);

      if (!hasVisibleAssistantTurnPayload(assistantTurn)) {
        state.debug.transcript.pop();

        if (previousTranscript) {
          state.debug.transcript.splice(0, state.debug.transcript.length, ...previousTranscript);
        }
      }
    } finally {
      if (runId === activeRunId) {
        state.debug.sending = false;
        state.debug.abortController = null;
        stopDebugMetricsTicker();

        const nextQueuedMessage = shiftQueuedDebugMessage();
        if (nextQueuedMessage) {
          void sendDebugChat(nextQueuedMessage);
        }
      }
    }
  }

  function stopDebugChat(): void {
    activeRunId += 1;
    state.debug.abortController?.abort(new Error("Request cancelled from dashboard."));
    state.debug.sending = false;
    state.debug.abortController = null;
    state.debug.queuedMessages.splice(0);
    stopDebugMetricsTicker();
  }

  function clearDebugChat(): void {
    activeRunId += 1;
    state.debug.abortController?.abort(new Error("Chat session cleared."));
    state.debug.sending = false;
    state.debug.abortController = null;
    stopDebugMetricsTicker();
    state.debug.transcript = [];
    state.debug.queuedMessages.splice(0);
    state.debug.rawRequest = "";
    state.debug.rawResponse = "";
    state.debug.status = "";
    state.debug.usage = "";
    state.debug.error = "";
    state.debug.backend = "";
    state.debug.lastRequestId = "";
    state.debug.systemPrompt = "";
    state.debug.prompt = "";
    state.debug.defaultPromptDismissed = true;
    resetDebugMetrics();
  }

  function prepareDebugChatDraft(systemPrompt: string, prompt: string): void {
    activeRunId += 1;
    stopDebugMetricsTicker();
    state.debug.abortController?.abort(new Error("Chat session reset from diagnostics."));
    state.debug.sending = false;
    state.debug.abortController = null;
    state.debug.transcript = [];
    state.debug.queuedMessages.splice(0);
    state.debug.rawRequest = "";
    state.debug.rawResponse = "";
    state.debug.status = "";
    state.debug.usage = "";
    state.debug.error = "";
    state.debug.backend = "";
    state.debug.lastRequestId = "";
    state.debug.systemPrompt = systemPrompt.trim();
    state.debug.prompt = prompt;
    state.debug.defaultPromptDismissed = false;
    resetDebugMetrics();
  }

  return {
    clearDebugChat,
    ensureDefaultDebugPrompt,
    prepareDebugChatDraft,
    sendDebugChat,
    stopDebugChat,
    stopDebugMetricsTicker,
  };
}
