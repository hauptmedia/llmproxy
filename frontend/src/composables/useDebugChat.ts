import type { DashboardState, DebugTranscriptEntry } from "../types/dashboard";
import { buildDiagnosticsChatTools } from "../utils/diagnostics-mcp";
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
  let metricsTicker: number | undefined;
  let activeRunId = 0;

  function isExpectedDebugAbort(error: unknown): boolean {
    return error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError";
  }

  function replaceTranscriptEntry(entry: DebugTranscriptEntry): DebugTranscriptEntry {
    return replaceDebugTranscriptEntry(state.debug.transcript, entry);
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
      return await consumeStreamingResponse(response, state.debug, assistantTurn, replaceTranscriptEntry);
    }

    return applyNonStreamingResponse(
      state.debug,
      await response.json(),
      assistantTurn,
      replaceTranscriptEntry,
    );
  }

  async function sendDebugChat(): Promise<void> {
    if (state.debug.sending) {
      return;
    }

    const runId = activeRunId + 1;
    activeRunId = runId;

    state.debug.stream = true;

    const prompt = state.debug.prompt.trim();
    const lastTranscriptEntry = state.debug.transcript[state.debug.transcript.length - 1];
    const regenerateAssistantReply =
      prompt.length === 0 &&
      state.debug.transcript.length > 0 &&
      typeof lastTranscriptEntry?.role === "string" &&
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

    const diagnosticsAllowed = state.serverConfig?.mcpServerEnabled === true;
    let diagnosticTools: Array<Record<string, unknown>> | undefined;
    if (state.debug.enableDiagnosticTools && diagnosticsAllowed) {
      try {
        diagnosticTools = await buildDiagnosticsChatTools();
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
    let assistantTurn = createAssistantTurn();
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
          ...(diagnosticTools ? { tool_choice: state.debug.params.tool_choice } : {}),
        };

        state.debug.lastRequestId = currentRequestId;
        state.debug.rawRequest = prettyJson(currentPayload);
        currentAssistantTurn = await runSingleDebugAssistantRequest(currentPayload, currentAssistantTurn, currentRequestId);
        assistantTurn = currentAssistantTurn;

        const assistantHistoryMessage = buildDebugHistoryMessage(currentAssistantTurn);
        if (assistantHistoryMessage) {
          history.push(assistantHistoryMessage);
        }

        if (!state.debug.enableDiagnosticTools || !diagnosticsAllowed) {
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

        currentAssistantTurn = createAssistantTurn();
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

        if (removedAssistantTurn) {
          state.debug.transcript.push(removedAssistantTurn);
        }
      }
    } finally {
      if (runId === activeRunId) {
        state.debug.sending = false;
        state.debug.abortController = null;
        stopDebugMetricsTicker();
      }
    }
  }

  function stopDebugChat(): void {
    activeRunId += 1;
    state.debug.abortController?.abort(new Error("Request cancelled from dashboard."));
    state.debug.sending = false;
    state.debug.abortController = null;
    stopDebugMetricsTicker();
  }

  function clearDebugChat(): void {
    activeRunId += 1;
    state.debug.abortController?.abort(new Error("Chat session cleared."));
    state.debug.sending = false;
    state.debug.abortController = null;
    stopDebugMetricsTicker();
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
    activeRunId += 1;
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
