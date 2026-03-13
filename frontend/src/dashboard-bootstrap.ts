import type { DashboardBootstrap, DashboardPage } from "./types/dashboard";

const dashboardWindow = window as Window & {
  __LLMPROXY_DASHBOARD_BOOTSTRAP__?: DashboardBootstrap;
};

const bootstrapCandidate = dashboardWindow.__LLMPROXY_DASHBOARD_BOOTSTRAP__;
if (!bootstrapCandidate) {
  throw new Error("Dashboard bootstrap payload is missing.");
}

export const dashboardBootstrap: DashboardBootstrap = bootstrapCandidate;

export function getPageTitle(page: DashboardPage): string {
  if (page === "logs") {
    return "Requests";
  }

  if (page === "chat") {
    return "Chat";
  }

  if (page === "backends") {
    return "Backends";
  }

  return "Overview";
}
