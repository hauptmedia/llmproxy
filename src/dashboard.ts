import { ProxySnapshot } from "./types";
import { escapeHtml } from "./utils";

export type DashboardPage = "overview" | "chat" | "backends";

interface DashboardRenderOptions {
  dashboardPath: string;
  page: DashboardPage;
}

interface DashboardBootstrapPayload {
  dashboardPath: string;
  page: DashboardPage;
  snapshot: ProxySnapshot;
}

export function renderDashboardHtml(snapshot: ProxySnapshot, options: DashboardRenderOptions): string {
  const dashboardPath =
    options.dashboardPath !== "/" && options.dashboardPath.endsWith("/")
      ? options.dashboardPath.slice(0, -1)
      : options.dashboardPath;
  const pageTitle =
    options.page === "chat"
      ? "Chat Debugger"
      : (options.page === "backends" ? "Backends" : "Overview");
  const bootstrap: DashboardBootstrapPayload = {
    dashboardPath,
    page: options.page,
    snapshot,
  };
  const bootstrapJson = JSON.stringify(bootstrap).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`llmproxy - ${pageTitle}`)}</title>
    <link rel="stylesheet" href="${escapeHtml(`${dashboardPath}/assets/dashboard.css`)}" />
  </head>
  <body>
    <div id="app" class="shell-loading">
      <div class="boot-panel">
        <h1>llmproxy</h1>
        <p>Loading dashboard...</p>
      </div>
    </div>
    <script>
      window.__LLMPROXY_DASHBOARD_BOOTSTRAP__ = ${bootstrapJson};
    </script>
    <script type="module" src="${escapeHtml(`${dashboardPath}/assets/dashboard-app.js`)}"></script>
  </body>
</html>`;
}
