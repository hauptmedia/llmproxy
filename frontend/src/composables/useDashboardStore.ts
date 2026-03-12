import { computed, reactive, shallowReactive } from "vue";
import { dashboardBootstrap } from "../dashboard-bootstrap";
import type { BackendDraft, DashboardState } from "../types/dashboard";
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

function createInitialState(): DashboardState {
  return {
    snapshot: dashboardBootstrap.snapshot,
    connectionStatus: "connecting",
    connectionText: "Connecting to live feed",
    models: collectSnapshotModels(dashboardBootstrap.snapshot),
    requestDetail: reactive({
      open: false,
      loading: false,
      requestId: "",
      error: "",
      detail: null,
      cache: {},
      lastFetchedAt: 0,
    }),
    backendDrafts: reactive({}) as Record<string, BackendDraft>,
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
        max_tokens: 512,
      },
    }),
  };
}

function createDashboardStoreInternal() {
  const state = shallowReactive(createInitialState()) as DashboardState;

  const backendControls = useBackendControls(state);
  const requestDetail = useRequestDetail(state);
  const debugChat = useDebugChat(state);

  const applySnapshot = (snapshot: typeof state.snapshot): void => {
    backendControls.applySnapshot(snapshot);
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
    backendControls.syncBackendDrafts(state.snapshot.backends);
    backendControls.ensureDebugModel();
    liveFeed.connectLiveFeed();
    void backendControls.refreshModels();
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

  return reactive({
    state,
    summaryCards,
    requestDetailTitle: requestDetail.requestDetailTitle,
    requestDetailSubtitle: requestDetail.requestDetailSubtitle,
    requestMessages: requestDetail.requestMessages,
    requestSummaryBadges: requestDetail.requestSummaryBadges,
    requestParamBadges: requestDetail.requestParamBadges,
    requestToolsHtml: requestDetail.requestToolsHtml,
    requestResponseHtml: requestDetail.requestResponseHtml,
    debugMetaBadges: debugChat.debugMetaBadges,
    badgeClass,
    connectionCardBadges: buildConnectionCardBadges,
    connectionMetricBadges: buildConnectionMetricBadges,
    openRequestDetail: requestDetail.openRequestDetail,
    closeRequestDetail: requestDetail.closeRequestDetail,
    refreshModels: backendControls.refreshModels,
    saveBackend: backendControls.saveBackend,
    sendDebugChat: debugChat.sendDebugChat,
    stopDebugChat: debugChat.stopDebugChat,
    clearDebugChat: debugChat.clearDebugChat,
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
