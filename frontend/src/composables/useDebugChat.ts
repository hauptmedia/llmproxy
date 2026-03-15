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
  let liveTranscriptSyncTimer: number | undefined;
  let activeRunId = 0;

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
      max_tokens: source.max_tokens,
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

  function stopLiveTranscriptSync(): void {
    if (liveTranscriptSyncTimer !== undefined) {
      window.clearTimeout(liveTranscriptSyncTimer);
      liveTranscriptSyncTimer = undefined;
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

  async function syncLiveTranscriptFromServer(runId: number): Promise<void> {
    stopLiveTranscriptSync();

    if (runId !== activeRunId || !state.debug.sending) {
      return;
    }

    const requestId = state.debug.lastRequestId;
    if (requestId) {
      try {
        const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}`, { method: "GET" });
        if (response.ok) {
          const detail = await response.json();
          if (runId === activeRunId && state.debug.sending && state.debug.lastRequestId === requestId) {
            state.debug.liveDetail = detail;
          }
        }
      } catch {
        // Ignore polling errors for the live transcript mirror. The primary chat request remains authoritative.
      }
    }

    if (runId !== activeRunId || !state.debug.sending) {
      return;
    }

    liveTranscriptSyncTimer = window.setTimeout(() => {
      void syncLiveTranscriptFromServer(runId);
    }, 250);
  }

  function startLiveTranscriptSync(runId: number): void {
    stopLiveTranscriptSync();
    liveTranscriptSyncTimer = window.setTimeout(() => {
      void syncLiveTranscriptFromServer(runId);
    }, 150);
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
      return await consumeStreamingResponse(response, state.debug, assistantTurn, replaceTranscriptEntry);
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
    const lastTranscriptEntry = state.debug.transcript[state.debug.transcript.length - 1];
    const regenerateAssistantReply =
      queuedMessage === null &&
      prompt.length === 0 &&
      state.debug.transcript.length > 0 &&
      typeof lastTranscriptEntry?.role === "string" &&
      lastTranscriptEntry.role === "assistant";
    const transcriptForReplay = regenerateAssistantReply
      ? state.debug.transcript.slice(0, -1)
      : state.debug.transcript;

    if (!model) {
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

    const diagnosticsAllowed = state.serverConfig?.mcpServerEnabled === true;
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

    const userTurn: DebugTranscriptEntry | null = prompt
      ? {
          role: "user",
          content: prompt,
        }
      : null;
    const initialWaitingTitle = "Waiting for model response.";
    let assistantTurn = createPendingAssistantTurn(initialWaitingTitle);
    const requestId = createClientDebugRequestId();
    const removedAssistantTurn = regenerateAssistantReply && lastTranscriptEntry
      ? { ...lastTranscriptEntry } as DebugTranscriptEntry
      : null;

    if (regenerateAssistantReply) {
      state.debug.transcript.pop();
    }

    state.debug.sending = true;

    if (userTurn) {
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
    state.debug.liveDetail = null;
    if (!queuedMessage) {
      state.debug.prompt = "";
    }
    state.debug.abortController = new AbortController();
    startDebugMetricsTicker();
    startLiveTranscriptSync(runId);

    try {
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
          max_tokens: Math.max(1, Math.round(params.max_tokens)),
          ...(diagnosticTools ? { tools: diagnosticTools } : {}),
          ...(diagnosticTools ? { tool_choice: params.tool_choice } : {}),
        };

        state.debug.lastRequestId = currentRequestId;
        state.debug.rawRequest = prettyJson(currentPayload);
        currentAssistantTurn = await runSingleDebugAssistantRequest(currentPayload, currentAssistantTurn, currentRequestId);
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
        state.debug.liveDetail = null;
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

        if (removedAssistantTurn) {
          state.debug.transcript.push(removedAssistantTurn);
        }
      }
    } finally {
      if (runId === activeRunId) {
        state.debug.sending = false;
        state.debug.abortController = null;
        stopDebugMetricsTicker();
        stopLiveTranscriptSync();

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
    state.debug.liveDetail = null;
    stopDebugMetricsTicker();
    stopLiveTranscriptSync();
  }

  function clearDebugChat(): void {
    activeRunId += 1;
    state.debug.abortController?.abort(new Error("Chat session cleared."));
    state.debug.sending = false;
    state.debug.abortController = null;
    stopDebugMetricsTicker();
    stopLiveTranscriptSync();
    state.debug.transcript = [];
    state.debug.queuedMessages.splice(0);
    state.debug.rawRequest = "";
    state.debug.rawResponse = "";
    state.debug.liveDetail = null;
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
    stopLiveTranscriptSync();
    state.debug.abortController?.abort(new Error("Chat session reset from diagnostics."));
    state.debug.sending = false;
    state.debug.abortController = null;
    state.debug.transcript = [];
    state.debug.queuedMessages.splice(0);
    state.debug.rawRequest = "";
    state.debug.rawResponse = "";
    state.debug.liveDetail = null;
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
