import type { DashboardState, ProxySnapshot, RequestLogDetail } from "../types/dashboard";

export function useLiveFeed(
  state: DashboardState,
  onSnapshot: (snapshot: ProxySnapshot) => void,
  onRequestDetail: (detail: RequestLogDetail) => void,
  onErrorToast: (title: string, message: string) => void,
) {
  let eventSource: EventSource | null = null;
  let lastErrorToastAt = 0;

  function connectLiveFeed(): void {
    if (eventSource) {
      eventSource.close();
    }

    state.connectionStatus = "connecting";
    state.connectionText = "Connecting to live feed";
    eventSource = new EventSource("/api/events");

    eventSource.addEventListener("snapshot", (event: MessageEvent) => {
      try {
        onSnapshot(JSON.parse(event.data) as ProxySnapshot);
      } catch {
        return;
      }
    });

    eventSource.addEventListener("request_detail", (event: MessageEvent) => {
      try {
        onRequestDetail(JSON.parse(event.data) as RequestLogDetail);
      } catch {
        return;
      }
    });

    eventSource.onopen = () => {
      state.connectionStatus = "connected";
      state.connectionText = "Live feed connected";
    };

    eventSource.onerror = () => {
      const shouldToast = Date.now() - lastErrorToastAt > 10000;
      state.connectionStatus = "connecting";
      state.connectionText = "Reconnecting live feed";
      if (shouldToast) {
        lastErrorToastAt = Date.now();
        onErrorToast("Live feed", "The live dashboard feed disconnected. Reconnecting...");
      }
    };
  }

  function stopLiveFeed(): void {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  return {
    connectLiveFeed,
    stopLiveFeed,
  };
}
