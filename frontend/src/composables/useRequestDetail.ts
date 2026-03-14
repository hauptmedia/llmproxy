import { computed } from "vue";
import type { DashboardState, RequestLogDetail } from "../types/dashboard";
import {
  buildConnectionTransportBadges,
  buildRequestParamRows,
  buildRequestResponseMetricRows,
  buildRequestStateBadge,
} from "../utils/dashboard-badges";
import { formatDate, shortId } from "../utils/formatters";
import { isClientRecord } from "../utils/guards";
import { readErrorResponse } from "../utils/http";
import { renderResponseChoicesHtml, renderToolsHtml } from "../utils/message-rendering";
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

  async function openRequestDetail(requestId: string): Promise<void> {
    state.requestDetail.open = true;
    state.requestDetail.requestId = requestId;
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
    state.requestDetail.error = "";
  }

  function scheduleOpenDetailRefresh(): void {
    if (!state.requestDetail.open || !state.requestDetail.requestId || !hasSnapshotRequestDetail(state.requestDetail.requestId)) {
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

  const requestLiveConnection = computed(() => {
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
    backends: state.snapshot.backends,
    live: Boolean(state.requestDetail.detail?.live),
  }));
  const requestParamRows = computed(() => buildRequestParamRows(requestBody.value));
  const requestToolsHtml = computed(() => renderToolsHtml(requestBody.value?.tools));
  const requestResponseHtml = computed(() => renderResponseChoicesHtml(
    state.requestDetail.detail?.responseBody,
    Boolean(state.requestDetail.detail?.live),
    state.requestDetail.detail?.entry.model ?? "",
  ));

  return {
    closeRequestDetail,
    openRequestDetail,
    refreshRequestDetail,
    requestDetailSubtitle,
    requestDetailTitle,
    requestLiveTransportBadges,
    requestMessages,
    requestParamRows,
    requestResponseMetricRows,
    requestResponseHtml,
    requestStateBadge,
    requestToolsHtml,
    scheduleOpenDetailRefresh,
    stopRequestDetailRefresh,
  };
}
