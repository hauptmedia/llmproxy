import { ProxySnapshot } from "./types";
import { escapeHtml } from "./utils";

export type DashboardPage = "overview" | "logs" | "chat" | "backends";

interface DashboardRenderOptions {
  dashboardPath: string;
  page: DashboardPage;
}

interface DashboardBootstrapPayload {
  dashboardPath: string;
  page: DashboardPage;
  snapshot: ProxySnapshot;
}

const DASHBOARD_BOOT_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    min-height: 100vh;
    position: relative;
    color: #1c1917;
    font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
    background:
      radial-gradient(circle at top left, rgba(251, 191, 36, 0.22), transparent 32%),
      radial-gradient(circle at top right, rgba(251, 146, 60, 0.18), transparent 28%),
      linear-gradient(160deg, #fff7ed 0%, #f6efe2 48%, #ecdfcb 100%);
  }
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: 0.55;
    background:
      linear-gradient(rgba(255, 255, 255, 0.2) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.2) 1px, transparent 1px);
    background-size: 22px 22px;
  }
  #app {
    position: relative;
    z-index: 10;
  }
  .shell-loading {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: 24px;
  }
  .boot-panel {
    position: relative;
    z-index: 10;
    width: min(420px, 100%);
    padding: 28px;
    text-align: center;
    border: 1px solid rgba(120, 53, 15, 0.1);
    border-radius: 1.75rem;
    background: rgba(255, 255, 255, 0.85);
    box-shadow: 0 24px 48px rgba(120, 53, 15, 0.12);
    backdrop-filter: blur(10px);
  }
  .boot-brand {
    display: flex;
    justify-content: center;
    margin: 0 0 16px;
  }
  .boot-logo {
    width: 84px;
    height: 84px;
    filter: drop-shadow(0 14px 24px rgba(194, 65, 12, 0.16));
  }
  .boot-panel h1 {
    margin: 0 0 8px;
    font-size: 1.875rem;
    line-height: 1.1;
    font-weight: 700;
    color: #1c1917;
  }
  .boot-panel p {
    margin: 0;
    color: #57534e;
  }
`;

const BRAND_MARK_SVG = `
<svg viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="llmproxy-boot-bg" x1="44" y1="36" x2="214" y2="220" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1C1917" />
      <stop offset="1" stop-color="#0C0A09" />
    </linearGradient>
    <linearGradient id="llmproxy-boot-stroke" x1="28" y1="42" x2="226" y2="214" gradientUnits="userSpaceOnUse">
      <stop stop-color="#F59E0B" />
      <stop offset="1" stop-color="#EA580C" />
    </linearGradient>
    <linearGradient id="llmproxy-boot-lane" x1="48" y1="84" x2="208" y2="172" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FACC15" />
      <stop offset="0.55" stop-color="#F59E0B" />
      <stop offset="1" stop-color="#FB923C" />
    </linearGradient>
    <radialGradient id="llmproxy-boot-core" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(128 128) rotate(90) scale(38)">
      <stop stop-color="#FEF3C7" />
      <stop offset="0.72" stop-color="#F59E0B" />
      <stop offset="1" stop-color="#C2410C" />
    </radialGradient>
  </defs>
  <path d="M76 24H180L232 76V180L180 232H76L24 180V76L76 24Z" fill="url(#llmproxy-boot-bg)" stroke="url(#llmproxy-boot-stroke)" stroke-width="10" stroke-linejoin="round" />
  <path d="M52 88H102L128 114L154 88H198" stroke="url(#llmproxy-boot-lane)" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M52 168H102L128 142L154 168H198" stroke="url(#llmproxy-boot-lane)" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M186 76L214 88L186 100V76Z" fill="#FACC15" />
  <path d="M186 156L214 168L186 180V156Z" fill="#F59E0B" />
  <circle cx="46" cy="88" r="11" fill="#FDE68A" stroke="#F59E0B" stroke-width="6" />
  <circle cx="46" cy="168" r="11" fill="#FDBA74" stroke="#EA580C" stroke-width="6" />
  <circle cx="128" cy="128" r="34" fill="url(#llmproxy-boot-core)" stroke="#FFF7ED" stroke-width="7" />
  <path d="M111 128H145" stroke="#1C1917" stroke-width="10" stroke-linecap="round" />
  <path d="M128 111V145" stroke="#1C1917" stroke-width="10" stroke-linecap="round" />
  <circle cx="128" cy="128" r="8" fill="#FFF7ED" />
</svg>
`;

export function renderDashboardHtml(snapshot: ProxySnapshot, options: DashboardRenderOptions): string {
  const dashboardPath =
    options.dashboardPath !== "/" && options.dashboardPath.endsWith("/")
      ? options.dashboardPath.slice(0, -1)
      : options.dashboardPath;
  const pageTitle =
    options.page === "logs"
      ? "Requests"
      : options.page === "chat"
      ? "Chat"
      : (options.page === "backends" ? "Backends" : "Overview");
  const bootstrap: DashboardBootstrapPayload = {
    dashboardPath,
    page: options.page,
    snapshot,
  };
  const bootstrapJson = JSON.stringify(bootstrap).replace(/</g, "\\u003c");
  const devServerOrigin = resolveDashboardDevServerOrigin();
  const stylesheetHref = devServerOrigin ? undefined : `${dashboardPath}/assets/dashboard.css`;
  const logoHref = `${dashboardPath}/assets/llmproxy-logo.svg`;
  const moduleScripts = devServerOrigin
    ? [`${devServerOrigin}/@vite/client`, `${devServerOrigin}/src/main.ts`]
    : [`${dashboardPath}/assets/dashboard-app.js`];
  const stylesheetTag = stylesheetHref
    ? `<link rel="stylesheet" href="${escapeHtml(stylesheetHref)}" />`
    : "";
  const moduleScriptTags = moduleScripts
    .map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`)
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`llmproxy - ${pageTitle}`)}</title>
    <meta name="theme-color" content="#f59e0b" />
    <link rel="icon" type="image/svg+xml" href="${escapeHtml(logoHref)}" />
    <style data-dashboard-boot>${DASHBOARD_BOOT_STYLES}</style>
    ${stylesheetTag}
  </head>
  <body>
    <div id="app">
      <div class="shell-loading">
        <div class="boot-panel">
          <div class="boot-brand">
            <div class="boot-logo">${BRAND_MARK_SVG}</div>
          </div>
          <h1>llmproxy</h1>
          <p>Loading dashboard...</p>
        </div>
      </div>
    </div>
    <script>
      window.__LLMPROXY_DASHBOARD_BOOTSTRAP__ = ${bootstrapJson};
    </script>
    ${moduleScriptTags}
  </body>
</html>`;
}

function resolveDashboardDevServerOrigin(): string | undefined {
  const rawOrigin = process.env.LLMPROXY_DASHBOARD_DEV_SERVER?.trim();
  if (!rawOrigin) {
    return undefined;
  }

  return rawOrigin.endsWith("/") ? rawOrigin.slice(0, -1) : rawOrigin;
}
