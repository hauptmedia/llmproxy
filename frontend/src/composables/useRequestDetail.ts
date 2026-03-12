import { computed } from "vue";
import type { DashboardState, RequestLogDetail } from "../types/dashboard";
import { buildRequestParamBadges, buildRequestSummaryBadges } from "../utils/dashboard-badges";
import { formatDate, shortId } from "../utils/formatters";
import { isClientRecord } from "../utils/guards";
import { readErrorResponse } from "../utils/http";
import { renderResponseChoicesHtml, renderToolsHtml } from "../utils/message-rendering";

export function useRequestDetail(state: DashboardState) {
  let detailRefreshTimer: number | undefined;

  function isActiveRequestId(requestId: string): boolean {
    return state.snapshot.activeConnections.some((connection) => connection.id === requestId);
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

      state.requestDetail.loading = false;
      state.requestDetail.error = error instanceof Error ? error.message : String(error);
    }
  }

  async function openRequestDetail(requestId: string): Promise<void> {
    state.requestDetail.open = true;
    state.requestDetail.requestId = requestId;
    state.requestDetail.error = "";
    await loadRequestDetail(requestId);
  }

  function closeRequestDetail(): void {
    state.requestDetail.open = false;
    state.requestDetail.loading = false;
    state.requestDetail.requestId = "";
    state.requestDetail.error = "";
  }

  function scheduleOpenDetailRefresh(): void {
    if (!state.requestDetail.open || !state.requestDetail.requestId || !isActiveRequestId(state.requestDetail.requestId)) {
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

    return (
      `${detail?.live ? "Live request" : `req ${shortId(entry.id)}`}` +
      `${entry.model ? ` · model ${entry.model}` : ""}` +
      `${entry.backendName ? ` · backend ${entry.backendName}` : ""}` +
      ` · ${formatDate(entry.time)}` +
      `${detail?.live ? " · still running" : ""}`
    );
  });

  const requestMessages = computed(() => (
    Array.isArray(requestBody.value?.messages) ? requestBody.value.messages : []
  ));

  const requestSummaryBadges = computed(() => buildRequestSummaryBadges(state.requestDetail.detail?.entry));
  const requestParamBadges = computed(() => buildRequestParamBadges(requestBody.value));
  const requestToolsHtml = computed(() => renderToolsHtml(requestBody.value?.tools));
  const requestResponseHtml = computed(() => renderResponseChoicesHtml(state.requestDetail.detail?.responseBody));

  return {
    closeRequestDetail,
    openRequestDetail,
    requestDetailSubtitle,
    requestDetailTitle,
    requestMessages,
    requestParamBadges,
    requestResponseHtml,
    requestSummaryBadges,
    requestToolsHtml,
    scheduleOpenDetailRefresh,
    stopRequestDetailRefresh,
  };
}
