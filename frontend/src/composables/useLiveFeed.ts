import type { DashboardState, ProxySnapshot } from "../types/dashboard";

export function useLiveFeed(
  state: DashboardState,
  onSnapshot: (snapshot: ProxySnapshot) => void,
) {
  let eventSource: EventSource | null = null;

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

    eventSource.onopen = () => {
      state.connectionStatus = "connected";
      state.connectionText = "Live feed connected";
    };

    eventSource.onerror = () => {
      state.connectionStatus = "connecting";
      state.connectionText = "Reconnecting live feed";
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
