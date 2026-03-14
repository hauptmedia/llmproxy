import assert from "node:assert/strict";
import test from "node:test";
import { renderDashboardHtml } from "./dashboard";
import { resolveDashboardLandingPage } from "./server-dashboard-paths";
import { ProxySnapshot } from "./types";

const snapshot: ProxySnapshot = {
  startedAt: new Date(0).toISOString(),
  queueDepth: 0,
  recentRequestLimit: 1000,
  totals: {
    activeRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cancelledRequests: 0,
    rejectedRequests: 0,
  },
  backends: [],
  activeConnections: [],
  recentRequests: [],
};

test("renderDashboardHtml uses built dashboard assets by default", () => {
  const previous = process.env.LLMPROXY_DASHBOARD_DEV_SERVER;
  delete process.env.LLMPROXY_DASHBOARD_DEV_SERVER;

  try {
    const html = renderDashboardHtml(snapshot, {
      dashboardPath: "/dashboard",
      page: "overview",
    });

    assert.match(html, /<style data-dashboard-boot>/);
    assert.match(html, /class="shell-loading"/);
    assert.match(html, /llmproxy-logo\.svg/);
    assert.match(html, /rel="icon"/);
    assert.match(html, /\/dashboard\/assets\/dashboard\.css/);
    assert.match(html, /\/dashboard\/assets\/dashboard-app\.js/);
    assert.doesNotMatch(html, /@vite\/client/);
  } finally {
    if (previous === undefined) {
      delete process.env.LLMPROXY_DASHBOARD_DEV_SERVER;
    } else {
      process.env.LLMPROXY_DASHBOARD_DEV_SERVER = previous;
    }
  }
});

test("renderDashboardHtml uses the Vite dev server when configured", () => {
  const previous = process.env.LLMPROXY_DASHBOARD_DEV_SERVER;
  process.env.LLMPROXY_DASHBOARD_DEV_SERVER = "http://127.0.0.1:5173/";

  try {
    const html = renderDashboardHtml(snapshot, {
      dashboardPath: "/dashboard",
      page: "config",
    });

    assert.match(html, /<style data-dashboard-boot>/);
    assert.match(html, /class="boot-panel"/);
    assert.match(html, /llmproxy-logo\.svg/);
    assert.match(html, /http:\/\/127\.0\.0\.1:5173\/@vite\/client/);
    assert.match(html, /http:\/\/127\.0\.0\.1:5173\/src\/main\.ts/);
    assert.doesNotMatch(html, /\/dashboard\/assets\/dashboard\.css/);
    assert.doesNotMatch(html, /\/dashboard\/assets\/dashboard-app\.js/);
  } finally {
    if (previous === undefined) {
      delete process.env.LLMPROXY_DASHBOARD_DEV_SERVER;
    } else {
      process.env.LLMPROXY_DASHBOARD_DEV_SERVER = previous;
    }
  }
});

test("dashboard landing page defaults to config when no backends are configured", () => {
  assert.equal(resolveDashboardLandingPage(snapshot), "config");
});

test("dashboard landing page defaults to overview when backends are configured", () => {
  assert.equal(resolveDashboardLandingPage({
    ...snapshot,
    backends: [
      {
        id: "backend-a",
        name: "Backend A",
        baseUrl: "http://127.0.0.1:8080",
        connector: "openai",
        enabled: true,
        healthy: true,
        maxConcurrency: 1,
        activeRequests: 0,
        availableSlots: 1,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        cancelledRequests: 0,
        configuredModels: ["*"],
        discoveredModels: [],
        discoveredModelDetails: [],
      },
    ],
  }), "overview");
});
