import { createRouter, createWebHistory } from "vue-router";
import { dashboardBootstrap } from "./dashboard-core";
import BackendsPage from "./pages/BackendsPage.vue";
import ChatDebuggerPage from "./pages/ChatDebuggerPage.vue";
import OverviewPage from "./pages/OverviewPage.vue";

export function createDashboardRouter() {
  return createRouter({
    history: createWebHistory(dashboardBootstrap.dashboardPath),
    routes: [
      {
        path: "/",
        name: "overview",
        component: OverviewPage,
      },
      {
        path: "/chat",
        name: "chat",
        component: ChatDebuggerPage,
      },
      {
        path: "/backends",
        name: "backends",
        component: BackendsPage,
      },
      {
        path: "/config",
        redirect: { name: "backends" },
      },
    ],
  });
}
