import { computed } from "vue";
import type { ConversationTranscriptItem, DashboardState, RequestLogDetail } from "../types/dashboard";
import {
  buildConnectionTransportBadges,
  buildRequestParamRows,
  buildRequestResponseMetricRows,
  buildRequestStateBadge,
} from "../utils/dashboard-badges";
import { buildRequestConversationItems } from "../utils/conversation-transcript";
import { formatDate, shortId } from "../utils/formatters";
import { isClientRecord } from "../utils/guards";
import { readErrorResponse } from "../utils/http";
import { formatClientIp } from "../utils/client-ip";

const REQUEST_DETAIL_CACHE_LIMIT = 24;

export function useRequestDetail(
  state: DashboardState,
  onErrorToast: (title: string, message: string) => void,
) {
  function storeRequestDetailInCache(detail: RequestLogDetail): void {
    state.requestDetail.cache[detail.entry.id] = detail;

    const cachedIds = Object.keys(state.requestDetail.cache);
    while (cachedIds.length > REQUEST_DETAIL_CACHE_LIMIT) {
      const oldestId = cachedIds.shift();
      if (!oldestId) {
        break;
      }

      delete state.requestDetail.cache[oldestId];
    }
  }

  function isActiveRequestId(requestId: string): boolean {
    return state.snapshot.activeConnections.some((connection) => connection.id === requestId);
  }

  async function loadRequestDetail(requestId: string, useCache = true): Promise<boolean> {
    if (useCache && !isActiveRequestId(requestId) && state.requestDetail.cache[requestId]) {
      state.requestDetail.detail = state.requestDetail.cache[requestId];
      state.requestDetail.loading = false;
      return true;
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
        return false;
      }

      state.requestDetail.detail = detail;
      state.requestDetail.loading = false;

      if (!detail.live) {
        storeRequestDetailInCache(detail);
      }

      return true;
    } catch (error) {
      if (state.requestDetail.requestId !== requestId) {
        return false;
      }

      const message = error instanceof Error ? error.message : String(error);
      state.requestDetail.loading = false;
      state.requestDetail.error = message;
      onErrorToast("Request details", message);
      return false;
    }
  }

  async function openRequestDetail(
    requestId: string,
    tab: "request" | "response" | "tools" | "diagnosis" = "request",
  ): Promise<void> {
    const previousState = {
      open: state.requestDetail.open,
      requestId: state.requestDetail.requestId,
      tab: state.requestDetail.tab,
      error: state.requestDetail.error,
      detail: state.requestDetail.detail,
      loading: state.requestDetail.loading,
    };

    state.requestDetail.requestId = requestId;
    state.requestDetail.tab = tab;
    state.requestDetail.error = "";
    if (!previousState.open) {
      state.requestDetail.detail = null;
    }
    state.requestDetail.loading = true;
    const loaded = await loadRequestDetail(requestId);

    if (loaded) {
      state.requestDetail.open = true;
      return;
    }

    state.requestDetail.open = previousState.open;
    state.requestDetail.requestId = previousState.requestId;
    state.requestDetail.tab = previousState.tab;
    state.requestDetail.error = previousState.error;
    state.requestDetail.detail = previousState.detail;
    state.requestDetail.loading = previousState.loading;
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
    state.requestDetail.detail = null;
  }

  function applyLiveRequestDetail(detail: RequestLogDetail): void {
    if (state.requestDetail.requestId !== detail.entry.id) {
      return;
    }

    state.requestDetail.detail = detail;
    state.requestDetail.loading = false;
    state.requestDetail.error = "";

    if (!detail.live) {
      storeRequestDetailInCache(detail);
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
  const requestConversationItems = computed<ConversationTranscriptItem[]>(() => (
    buildRequestConversationItems(state.requestDetail.detail, {
      includeRequestMessages: true,
      hideFinishBadge: true,
      reasoningCollapsed: true,
    })
  ));

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
    applyLiveRequestDetail,
  };
}
