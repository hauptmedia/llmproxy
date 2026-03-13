import { computed, reactive, shallowReactive } from "vue";
import { dashboardBootstrap } from "../dashboard-bootstrap";
import type { DashboardState } from "../types/dashboard";
import {
  badgeClass,
  buildConnectionCardBadges,
  buildConnectionMetricBadges,
  buildRecentRequestBadges,
  buildRecentRequestMetrics,
  buildSummaryCards,
} from "../utils/dashboard-badges";
import { shortId } from "../utils/formatters";
import { collectSnapshotModels } from "../utils/model-catalog";
import { createInitialDebugMetrics, useDebugChat } from "./useDebugChat";
import { useBackendControls } from "./useBackendControls";
import { useLiveFeed } from "./useLiveFeed";
import { useRequestDetail } from "./useRequestDetail";
import { readErrorResponse } from "../utils/http";

function createInitialState(): DashboardState {
  return {
    snapshot: dashboardBootstrap.snapshot,
    connectionStatus: "connecting",
    connectionText: "Connecting to live feed",
    models: collectSnapshotModels(dashboardBootstrap.snapshot),
    serverConfig: null,
    requestDetail: reactive({
      open: false,
      loading: false,
      requestId: "",
      error: "",
      detail: null,
      cache: {},
      lastFetchedAt: 0,
    }),
    backendConfigs: reactive({}),
    backendEditor: reactive({
      open: false,
      mode: "create",
      originalId: "",
      saving: false,
      loading: false,
      error: "",
      fields: {
        id: "",
        name: "",
        baseUrl: "",
        connector: "openai",
        enabled: true,
        maxConcurrency: "1",
        healthPath: "",
        modelsText: "*",
        headersText: "",
        apiKey: "",
        apiKeyEnv: "",
        clearApiKey: false,
        timeoutMs: "",
      },
    }),
    serverEditor: reactive({
      open: false,
      saving: false,
      loading: false,
      error: "",
      notice: "",
      noticeTone: "neutral",
      restartRequiredFields: [],
      appliedImmediatelyFields: [],
      fields: {
        host: "",
        port: "",
        dashboardPath: "",
        requestTimeoutMs: "",
        queueTimeoutMs: "",
        healthCheckIntervalMs: "",
        recentRequestLimit: "",
      },
    }),
    debug: reactive({
      model: "",
      systemPrompt: "",
      prompt: "Say hello briefly and mention the model you are using.",
      stream: true,
      sending: false,
      abortController: null,
      backend: "",
      status: "",
      usage: "",
      error: "",
      lastRequestId: "",
      rawRequest: "",
      rawResponse: "",
      transcript: [],
      metrics: createInitialDebugMetrics(),
      params: {
        temperature: 0.7,
        top_p: 0.95,
        top_k: 40,
        min_p: 0.05,
        repeat_penalty: 1.1,
        max_tokens: 4096,
      },
    }),
  };
}

function createDashboardStoreInternal() {
  const state = shallowReactive(createInitialState()) as DashboardState;
  const pendingCancels = reactive<Record<string, boolean>>({});

  const backendControls = useBackendControls(state);
  const requestDetail = useRequestDetail(state);
  const debugChat = useDebugChat(state);

  const applySnapshot = (snapshot: typeof state.snapshot): void => {
    backendControls.applySnapshot(snapshot);

    const activeRequestIds = new Set(snapshot.activeConnections.map((connection) => connection.id));
    for (const requestId of Object.keys(pendingCancels)) {
      if (!activeRequestIds.has(requestId)) {
        delete pendingCancels[requestId];
      }
    }

    if (state.requestDetail.open && state.requestDetail.requestId && state.requestDetail.detail?.live) {
      if (activeRequestIds.has(state.requestDetail.requestId)) {
        requestDetail.scheduleOpenDetailRefresh();
      } else {
        void requestDetail.refreshRequestDetail(state.requestDetail.requestId, false);
      }
      return;
    }

    requestDetail.scheduleOpenDetailRefresh();
  };

  const liveFeed = useLiveFeed(state, applySnapshot);
  const summaryCards = computed(() => buildSummaryCards(state.snapshot));

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && state.requestDetail.open) {
      requestDetail.closeRequestDetail();
    }
  }

  let started = false;

  function start(): void {
    if (started) {
      return;
    }

    started = true;
    backendControls.ensureDebugModel();
    void backendControls.loadBackendConfigs();
    liveFeed.connectLiveFeed();
    window.addEventListener("keydown", handleKeyDown);
  }

  function stop(): void {
    if (!started) {
      return;
    }

    started = false;
    liveFeed.stopLiveFeed();
    debugChat.stopDebugMetricsTicker();
    requestDetail.stopRequestDetailRefresh();
    window.removeEventListener("keydown", handleKeyDown);
  }

  function isRequestCancelling(requestId: string): boolean {
    return Boolean(pendingCancels[requestId]);
  }

  function canCancelRequest(requestId: string): boolean {
    return state.snapshot.activeConnections.some((connection) => connection.id === requestId);
  }

  async function cancelActiveRequest(requestId: string): Promise<void> {
    const connection = state.snapshot.activeConnections.find((entry) => entry.id === requestId);
    if (!connection || pendingCancels[requestId]) {
      return;
    }

    const connectionLabel = `${connection.method} ${connection.path}`;
    const confirmed = window.confirm(
      `End the active connection "${connectionLabel}" now?\n\nThe client will receive a cancelled request, and any partial response already received will stay in request history.`,
    );
    if (!confirmed) {
      return;
    }

    pendingCancels[requestId] = true;

    try {
      const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/cancel`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      if (state.requestDetail.requestId === requestId) {
        await requestDetail.refreshRequestDetail(requestId, false);
      }
    } catch (error) {
      delete pendingCancels[requestId];
      const message = error instanceof Error ? error.message : String(error);
      if (state.requestDetail.requestId === requestId) {
        state.requestDetail.error = message;
      }
      window.alert(`Could not end the active connection.\n\n${message}`);
    }
  }

  return reactive({
    state,
    summaryCards,
    requestDetailTitle: requestDetail.requestDetailTitle,
    requestDetailSubtitle: requestDetail.requestDetailSubtitle,
    requestLiveTransportBadges: requestDetail.requestLiveTransportBadges,
    requestStateBadge: requestDetail.requestStateBadge,
    requestMessages: requestDetail.requestMessages,
    requestResponseMetricRows: requestDetail.requestResponseMetricRows,
    requestParamRows: requestDetail.requestParamRows,
    requestToolsHtml: requestDetail.requestToolsHtml,
    requestResponseHtml: requestDetail.requestResponseHtml,
    badgeClass,
    connectionCardBadges: buildConnectionCardBadges,
    connectionMetricBadges: buildConnectionMetricBadges,
    openRequestDetail: requestDetail.openRequestDetail,
    closeRequestDetail: requestDetail.closeRequestDetail,
    canCancelRequest,
    cancelActiveRequest,
    isRequestCancelling,
    openCreateBackend: backendControls.openCreateBackend,
    openEditBackend: backendControls.openEditBackend,
    closeBackendEditor: backendControls.closeBackendEditor,
    saveBackendEditor: backendControls.saveBackendEditor,
    openServerEditor: backendControls.openServerEditor,
    closeServerEditor: backendControls.closeServerEditor,
    saveServerEditor: backendControls.saveServerEditor,
    sendDebugChat: debugChat.sendDebugChat,
    stopDebugChat: debugChat.stopDebugChat,
    clearDebugChat: debugChat.clearDebugChat,
    openLastDebugRequest: () => {
      if (!state.debug.lastRequestId) {
        return;
      }

      void requestDetail.openRequestDetail(state.debug.lastRequestId);
    },
    shortId,
    recentRequestBadges: buildRecentRequestBadges,
    recentRequestMetrics: buildRecentRequestMetrics,
    start,
    stop,
  });
}

export type DashboardStore = ReturnType<typeof createDashboardStoreInternal>;

let dashboardStore: DashboardStore | null = null;

export function useDashboardStore(): DashboardStore {
  if (!dashboardStore) {
    dashboardStore = createDashboardStoreInternal();
  }

  return dashboardStore;
}
