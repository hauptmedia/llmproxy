import { computed } from "vue";
import type { ConversationTranscriptItem, DashboardState, RequestLogDetail } from "../types/dashboard";
import {
  buildConnectionTransportBadges,
  buildRequestParamRows,
  buildRequestResponseMetricRows,
  buildRequestStateBadge,
} from "../utils/dashboard-badges";
import { formatDate, shortId } from "../utils/formatters";
import { isClientRecord } from "../utils/guards";
import { readErrorResponse } from "../utils/http";
import { formatClientIp } from "../utils/client-ip";

export function useRequestDetail(
  state: DashboardState,
  onErrorToast: (title: string, message: string) => void,
) {
  let detailRefreshTimer: number | undefined;

  function isActiveRequestId(requestId: string): boolean {
    return state.snapshot.activeConnections.some((connection) => connection.id === requestId);
  }

  function hasRecentRequestDetail(requestId: string): boolean {
    return state.snapshot.recentRequests.some((entry) => entry.id === requestId && Boolean(entry.hasDetail));
  }

  function hasSnapshotRequestDetail(requestId: string): boolean {
    return isActiveRequestId(requestId) || hasRecentRequestDetail(requestId);
  }

  function shouldRefreshOpenDetail(): boolean {
    if (!state.requestDetail.open || !state.requestDetail.requestId) {
      return false;
    }

    if (!hasSnapshotRequestDetail(state.requestDetail.requestId)) {
      return false;
    }

    if (!state.requestDetail.detail) {
      return true;
    }

    return state.requestDetail.detail.live === true;
  }

  async function loadRequestDetail(requestId: string, useCache = true): Promise<void> {
    if (useCache && !isActiveRequestId(requestId) && state.requestDetail.cache[requestId]) {
      state.requestDetail.detail = state.requestDetail.cache[requestId];
      state.requestDetail.loading = false;
      return;
    }

    state.requestDetail.loading = true;
    state.requestDetail.error = "";

    try {
      const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}`, { method: "GET" });
      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const detail = await response.json() as RequestLogDetail;
      if (state.requestDetail.requestId !== requestId) {
        return;
      }

      state.requestDetail.detail = detail;
      state.requestDetail.loading = false;
      state.requestDetail.lastFetchedAt = Date.now();

      if (!detail.live) {
        state.requestDetail.cache[requestId] = detail;
      }
    } catch (error) {
      if (state.requestDetail.requestId !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      state.requestDetail.loading = false;
      state.requestDetail.error = message;
      onErrorToast("Request details", message);
    }
  }

  async function openRequestDetail(
    requestId: string,
    tab: "request" | "response" | "tools" | "diagnosis" = "request",
  ): Promise<void> {
    state.requestDetail.open = true;
    state.requestDetail.requestId = requestId;
    state.requestDetail.tab = tab;
    state.requestDetail.error = "";
    state.requestDetail.detail = null;
    state.requestDetail.loading = true;
    await loadRequestDetail(requestId);
  }

  async function refreshRequestDetail(requestId = state.requestDetail.requestId, useCache = false): Promise<void> {
    if (!requestId) {
      return;
    }

    await loadRequestDetail(requestId, useCache);
  }

  function closeRequestDetail(): void {
    state.requestDetail.open = false;
    state.requestDetail.loading = false;
    state.requestDetail.requestId = "";
    state.requestDetail.tab = "request";
    state.requestDetail.error = "";
  }

  function scheduleOpenDetailRefresh(): void {
    if (!shouldRefreshOpenDetail()) {
      return;
    }

    const elapsed = Date.now() - state.requestDetail.lastFetchedAt;
    if (elapsed < 600) {
      if (detailRefreshTimer !== undefined) {
        return;
      }

      detailRefreshTimer = window.setTimeout(() => {
        detailRefreshTimer = undefined;
        scheduleOpenDetailRefresh();
      }, Math.max(100, 600 - elapsed));
      return;
    }

    void loadRequestDetail(state.requestDetail.requestId, false);
  }

  function stopRequestDetailRefresh(): void {
    if (detailRefreshTimer !== undefined) {
      window.clearTimeout(detailRefreshTimer);
      detailRefreshTimer = undefined;
    }
  }

  const requestBody = computed<Record<string, any> | null>(() => (
    isClientRecord(state.requestDetail.detail?.requestBody)
      ? state.requestDetail.detail?.requestBody as Record<string, any>
      : null
  ));

  const requestDetailTitle = computed(() => {
    const entry = state.requestDetail.detail?.entry;
    return entry ? `${entry.method} ${entry.path}` : "Request Details";
  });

  const requestDetailSubtitle = computed(() => {
    const detail = state.requestDetail.detail;
    const entry = detail?.entry;

    if (!entry) {
      return "Inspect the original request payload, messages, tools, and final response.";
    }

    return [
      formatDate(entry.time),
      formatClientIp(entry.clientIp) ? `IP ${formatClientIp(entry.clientIp)}` : "",
      detail?.live ? "" : `req ${shortId(entry.id)}`,
      entry.model ? `model ${entry.model}` : "",
      entry.backendName ? `backend ${entry.backendName}` : "",
    ].filter(Boolean).join(" · ");
  });

  const requestMessages = computed(() => (
    Array.isArray(requestBody.value?.messages) ? requestBody.value.messages : []
  ));

  const requestDetailIsLive = computed(() => state.requestDetail.detail?.live === true);

  const requestLiveConnection = computed(() => {
    if (!requestDetailIsLive.value) {
      return null;
    }

    const requestId = state.requestDetail.requestId;
    if (!requestId) {
      return null;
    }

    return state.snapshot.activeConnections.find((connection) => connection.id === requestId) ?? null;
  });

  const requestLiveTransportBadges = computed(() => (
    requestLiveConnection.value ? buildConnectionTransportBadges(requestLiveConnection.value) : []
  ));

  const requestStateBadge = computed(() => buildRequestStateBadge(
    state.requestDetail.detail?.entry,
    Boolean(state.requestDetail.detail?.live && !requestLiveConnection.value),
  ));
  const requestResponseMetricRows = computed(() => buildRequestResponseMetricRows(state.requestDetail.detail?.entry, {
    requestBody: state.requestDetail.detail?.requestBody,
    responseBody: state.requestDetail.detail?.responseBody,
    backends: requestDetailIsLive.value ? state.snapshot.backends : [],
    live: requestDetailIsLive.value,
  }));
  const requestParamRows = computed(() => buildRequestParamRows(
    requestBody.value,
    state.requestDetail.detail?.entry.requestType,
  ));
  const requestConversationItems = computed<ConversationTranscriptItem[]>(() => {
    const requestItems: ConversationTranscriptItem[] = requestMessages.value.map((message, index) => ({
      key: `request:${index}:${typeof message?.role === "string" ? message.role : "unknown"}`,
      message: isClientRecord(message) ? message as Record<string, unknown> : { role: "unknown", content: message },
      index,
      reasoningCollapsed: true,
    }));

    const responseBody = state.requestDetail.detail?.responseBody;
    const responseRecord = isClientRecord(responseBody) ? responseBody as Record<string, unknown> : null;
    const choices = Array.isArray(responseRecord?.choices) ? responseRecord.choices : null;
    if (!responseRecord || !choices || choices.length === 0) {
      return requestItems;
    }

    const resolvedModel =
      typeof responseRecord.model === "string" && responseRecord.model.trim().length > 0
        ? responseRecord.model.trim()
        : (state.requestDetail.detail?.entry.model ?? "");

    const responseItems = choices.flatMap((choice: unknown, choiceIndex: number): ConversationTranscriptItem[] => {
      if (isClientRecord(choice) && isClientRecord(choice.message)) {
        return [{
          key: `response:${choiceIndex}:message`,
          message: {
            ...choice.message,
            ...(resolvedModel ? { model: resolvedModel } : {}),
          } as Record<string, unknown>,
          index: requestItems.length + choiceIndex,
          finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
          reasoningCollapsed: true,
        }];
      }

      if (isClientRecord(choice) && typeof choice.text === "string") {
        return [{
          key: `response:${choiceIndex}:text`,
          message: {
            role: "assistant",
            content: choice.text,
            ...(resolvedModel ? { model: resolvedModel } : {}),
          },
          index: requestItems.length + choiceIndex,
          finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
          reasoningCollapsed: true,
        }];
      }

      return [];
    });

    return [...requestItems, ...responseItems];
  });

  return {
    closeRequestDetail,
    openRequestDetail,
    refreshRequestDetail,
    requestDetailSubtitle,
    requestDetailTitle,
    requestLiveTransportBadges,
    requestConversationItems,
    requestParamRows,
    requestResponseMetricRows,
    requestStateBadge,
    scheduleOpenDetailRefresh,
    stopRequestDetailRefresh,
  };
}
