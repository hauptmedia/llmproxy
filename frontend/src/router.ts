import { createRouter, createWebHistory } from "vue-router";
import { dashboardBootstrap } from "./dashboard-bootstrap";
import BackendsPage from "./pages/BackendsPage.vue";
import ChatDebuggerPage from "./pages/ChatDebuggerPage.vue";
import LogsPage from "./pages/LogsPage.vue";
import OverviewPage from "./pages/OverviewPage.vue";

export function createDashboardRouter() {
  return createRouter({
    history: createWebHistory(dashboardBootstrap.dashboardPath),
    scrollBehavior(_to, _from, savedPosition) {
      if (savedPosition) {
        return savedPosition;
      }

      return { left: 0, top: 0 };
    },
    routes: [
      {
        path: "/",
        name: "overview",
        component: OverviewPage,
      },
      {
        path: "/logs",
        name: "logs",
        component: LogsPage,
      },
      {
        path: "/chat",
        name: "chat",
        component: ChatDebuggerPage,
      },
      {
        path: "/config",
        redirect: { name: "backends" },
      },
      {
        path: "/backends",
        name: "backends",
        component: BackendsPage,
      },
    ],
  });
}
