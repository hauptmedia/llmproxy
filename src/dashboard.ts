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
    <linearGradient id="llmproxy-boot-shell" x1="38" y1="28" x2="214" y2="228" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1F2937" />
      <stop offset="0.52" stop-color="#111827" />
      <stop offset="1" stop-color="#0B1220" />
    </linearGradient>
    <linearGradient id="llmproxy-boot-stroke" x1="30" y1="38" x2="226" y2="220" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FBBF24" />
      <stop offset="0.58" stop-color="#F59E0B" />
      <stop offset="1" stop-color="#D97706" />
    </linearGradient>
    <linearGradient id="llmproxy-boot-lane-top" x1="58" y1="92" x2="186" y2="92" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FDE68A" />
      <stop offset="0.55" stop-color="#FBBF24" />
      <stop offset="1" stop-color="#F59E0B" />
    </linearGradient>
    <linearGradient id="llmproxy-boot-lane-bottom" x1="58" y1="164" x2="186" y2="164" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FCD34D" />
      <stop offset="0.58" stop-color="#F59E0B" />
      <stop offset="1" stop-color="#EA580C" />
    </linearGradient>
    <linearGradient id="llmproxy-boot-core" x1="106" y1="70" x2="150" y2="186" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFF7ED" />
      <stop offset="0.38" stop-color="#FDE68A" />
      <stop offset="1" stop-color="#F59E0B" />
    </linearGradient>
    <radialGradient id="llmproxy-boot-glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(128 128) rotate(90) scale(92)">
      <stop stop-color="#F59E0B" stop-opacity="0.24" />
      <stop offset="1" stop-color="#F59E0B" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect x="20" y="20" width="216" height="216" rx="56" fill="url(#llmproxy-boot-shell)" />
  <rect x="20" y="20" width="216" height="216" rx="56" stroke="url(#llmproxy-boot-stroke)" stroke-width="8" />
  <rect x="34" y="34" width="188" height="188" rx="42" stroke="#FFF7ED" stroke-opacity="0.18" stroke-width="2" />
  <g opacity="0.16" stroke="#FFF7ED" stroke-width="2">
    <path d="M58 72H198" />
    <path d="M58 128H198" />
    <path d="M58 184H198" />
  </g>
  <circle cx="128" cy="128" r="82" fill="url(#llmproxy-boot-glow)" />
  <path d="M72 92H96C105 92 111 94 117 100L128 111" stroke="url(#llmproxy-boot-lane-top)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M128 111L139 100C145 94 151 92 160 92H184" stroke="url(#llmproxy-boot-lane-top)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M72 164H96C105 164 111 162 117 156L128 145" stroke="url(#llmproxy-boot-lane-bottom)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M128 145L139 156C145 162 151 164 160 164H184" stroke="url(#llmproxy-boot-lane-bottom)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="62" cy="92" r="10" fill="#FFF7ED" stroke="#FBBF24" stroke-width="5" />
  <circle cx="62" cy="164" r="10" fill="#FFF7ED" stroke="#F59E0B" stroke-width="5" />
  <circle cx="194" cy="92" r="10" fill="#FFF7ED" stroke="#FBBF24" stroke-width="5" />
  <circle cx="194" cy="164" r="10" fill="#FFF7ED" stroke="#F59E0B" stroke-width="5" />
  <rect x="106" y="70" width="44" height="116" rx="22" fill="url(#llmproxy-boot-core)" stroke="#FFF7ED" stroke-width="4" />
  <rect x="114" y="92" width="28" height="12" rx="6" fill="#111827" opacity="0.88" />
  <rect x="114" y="122" width="28" height="12" rx="6" fill="#111827" opacity="0.88" />
  <rect x="114" y="152" width="28" height="12" rx="6" fill="#111827" opacity="0.88" />
  <path d="M128 100V156" stroke="#FFF7ED" stroke-opacity="0.32" stroke-width="2" stroke-linecap="round" />
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
      : (options.page === "backends" ? "Config" : "Dashboard");
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
