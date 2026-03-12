import { ProxySnapshot } from "./types";
import { escapeHtml } from "./utils";

export type DashboardPage = "overview" | "chat" | "backends";

interface DashboardRenderOptions {
  dashboardPath: string;
  page: DashboardPage;
}

export function renderDashboardHtml(snapshot: ProxySnapshot, options: DashboardRenderOptions): string {
  const initialState = JSON.stringify(snapshot).replace(/</g, "\\u003c");
  const normalizedDashboardPath =
    options.dashboardPath !== "/" && options.dashboardPath.endsWith("/")
      ? options.dashboardPath.slice(0, -1)
      : options.dashboardPath;
  const pageTitle =
    options.page === "chat"
      ? "Chat Debugger"
      : (options.page === "backends" ? "Backends" : "Overview");
  const overviewPath = normalizedDashboardPath;
  const chatPath = `${normalizedDashboardPath}/chat`;
  const backendsPath = `${normalizedDashboardPath}/backends`;
  const pageConfig = JSON.stringify({
    overview: {
      path: overviewPath,
      title: "Overview",
    },
    chat: {
      path: chatPath,
      title: "Chat Debugger",
    },
    backends: {
      path: backendsPath,
      title: "Backends",
    },
  }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>llmproxy - ${pageTitle}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6efe2;
        --panel: rgba(255, 251, 245, 0.78);
        --panel-strong: rgba(255, 255, 255, 0.92);
        --panel-muted: rgba(255, 247, 238, 0.74);
        --ink: #1c1917;
        --muted: #57534e;
        --accent: #c2410c;
        --accent-deep: #9a3412;
        --accent-soft: rgba(251, 146, 60, 0.16);
        --good: #166534;
        --good-soft: #dcfce7;
        --warn: #b45309;
        --warn-soft: #fef3c7;
        --bad: #991b1b;
        --bad-soft: #fee2e2;
        --shadow: 0 24px 55px rgba(120, 53, 15, 0.12);
        --shadow-soft: 0 14px 30px rgba(120, 53, 15, 0.08);
        --border: rgba(120, 53, 15, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        position: relative;
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

      .shell {
        position: relative;
        z-index: 1;
        width: min(1460px, calc(100vw - 36px));
        margin: 20px auto 40px;
        display: grid;
        gap: 20px;
      }

      .hero,
      .panel {
        background: linear-gradient(180deg, rgba(255, 252, 247, 0.88), rgba(255, 248, 240, 0.78));
        backdrop-filter: blur(16px);
        border: 1px solid var(--border);
        border-radius: 28px;
        box-shadow: var(--shadow);
      }

      .hero {
        overflow: hidden;
        position: relative;
        padding: 24px 26px;
      }

      .hero::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.28), transparent 48%),
          radial-gradient(circle at 18% 18%, rgba(251, 191, 36, 0.18), transparent 30%);
        pointer-events: none;
      }

      .hero::after {
        content: "";
        position: absolute;
        inset: auto -40px -40px auto;
        width: 220px;
        height: 220px;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(251, 146, 60, 0.24), transparent 70%);
        pointer-events: none;
      }

      .hero-bar {
        display: flex;
        gap: 16px;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        position: relative;
        z-index: 1;
      }

      .meta,
      .hint {
        margin: 0;
        color: var(--muted);
      }

      .meta {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        padding: 10px 14px;
        border-radius: 16px;
        border: 1px solid rgba(120, 53, 15, 0.1);
        background: rgba(255, 255, 255, 0.56);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
        line-height: 1.45;
      }

      .hint {
        line-height: 1.5;
      }

      .page-nav {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        margin-right: auto;
        padding: 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.54);
        border: 1px solid rgba(120, 53, 15, 0.08);
      }

      .page-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        padding: 10px 16px;
        border-radius: 999px;
        border: 1px solid rgba(120, 53, 15, 0.12);
        background: rgba(255, 255, 255, 0.88);
        color: var(--muted);
        text-decoration: none;
        font-weight: 600;
        transition: transform 120ms ease, border-color 120ms ease, color 120ms ease, background 120ms ease, box-shadow 120ms ease;
      }

      .page-link:hover {
        color: var(--ink);
        border-color: rgba(120, 53, 15, 0.24);
        background: rgba(255, 255, 255, 0.96);
        transform: translateY(-1px);
      }

      .page-link.active {
        color: white;
        border-color: transparent;
        background: linear-gradient(135deg, #c2410c, #ea580c);
        box-shadow: 0 12px 24px rgba(194, 65, 12, 0.18);
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 10px 14px;
        border-radius: 999px;
        font-weight: 600;
        background: rgba(255, 255, 255, 0.74);
        border: 1px solid var(--border);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
        margin-left: auto;
      }

      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 6px rgba(194, 65, 12, 0.12);
      }

      .status-dot.online {
        background: var(--good);
        box-shadow: 0 0 0 6px rgba(22, 101, 52, 0.12);
      }

      .status-dot.offline {
        background: var(--bad);
        box-shadow: 0 0 0 6px rgba(153, 27, 27, 0.12);
      }

      .grid {
        display: grid;
        gap: 18px;
      }

      .summary-grid {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .card {
        position: relative;
        overflow: hidden;
        padding: 20px;
        border-radius: 24px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(255, 247, 238, 0.78));
        border: 1px solid var(--border);
        box-shadow: var(--shadow-soft);
        transform: translateY(8px);
        opacity: 0;
        animation: rise 500ms ease forwards;
      }

      .card::before {
        content: "";
        position: absolute;
        inset: 0 auto auto 0;
        width: 100%;
        height: 4px;
        background: linear-gradient(90deg, rgba(194, 65, 12, 0.95), rgba(251, 146, 60, 0.72), transparent);
      }

      .card:nth-child(2) { animation-delay: 70ms; }
      .card:nth-child(3) { animation-delay: 140ms; }
      .card:nth-child(4) { animation-delay: 210ms; }

      .card-label {
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }

      .card-value {
        margin-top: 10px;
        font-size: 2.2rem;
        font-weight: 700;
        letter-spacing: -0.04em;
        line-height: 1;
      }

      .card-note {
        margin-top: 12px;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.5;
      }

      .panel {
        padding: 22px;
      }

      .page-section {
        display: none;
        animation: fadePanel 220ms ease;
      }

      body[data-page="overview"] .page-overview,
      body[data-page="chat"] .page-chat,
      body[data-page="backends"] .page-backends {
        display: block;
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
        flex-wrap: wrap;
        margin-bottom: 18px;
      }

      .panel-title {
        margin: 0;
        font-size: 1.36rem;
        letter-spacing: -0.03em;
      }

      .table-actions {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }

      .table-actions label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 42px;
        padding: 0 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.82);
        border: 1px solid rgba(120, 53, 15, 0.12);
      }

      .table input[type="number"] {
        min-width: 84px;
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid rgba(120, 53, 15, 0.18);
        background: rgba(255, 255, 255, 0.9);
        font: inherit;
      }

      .button {
        appearance: none;
        border: none;
        border-radius: 999px;
        background: linear-gradient(135deg, #c2410c, #ea580c);
        color: white;
        min-height: 42px;
        padding: 10px 16px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 12px 24px rgba(194, 65, 12, 0.18);
        transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease, background 120ms ease;
      }

      .button:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 14px 26px rgba(194, 65, 12, 0.22);
      }

      .button:focus-visible,
      .page-link:focus-visible,
      .field input:focus-visible,
      .field textarea:focus-visible,
      .field select:focus-visible,
      .table input[type="number"]:focus-visible {
        outline: none;
        border-color: rgba(194, 65, 12, 0.42);
        box-shadow: 0 0 0 4px rgba(251, 146, 60, 0.14);
      }

      .button:disabled {
        opacity: 0.6;
        cursor: wait;
      }

      .table-wrap {
        overflow-x: auto;
      }

      .table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0 10px;
      }

      .table th,
      .table td {
        padding: 14px 12px;
        text-align: left;
        vertical-align: top;
      }

      .table th {
        color: var(--muted);
        font-weight: 600;
        font-size: 0.9rem;
        padding-bottom: 2px;
      }

      .table td {
        background: rgba(255, 255, 255, 0.8);
        border-top: 1px solid rgba(120, 53, 15, 0.08);
        border-bottom: 1px solid rgba(120, 53, 15, 0.08);
      }

      .table td:first-child {
        border-left: 1px solid rgba(120, 53, 15, 0.08);
        border-top-left-radius: 18px;
        border-bottom-left-radius: 18px;
      }

      .table td:last-child {
        border-right: 1px solid rgba(120, 53, 15, 0.08);
        border-top-right-radius: 18px;
        border-bottom-right-radius: 18px;
      }

      .backend-row:hover td {
        background: rgba(255, 250, 244, 0.92);
      }

      .backend-name {
        font-weight: 700;
        font-size: 1rem;
        margin-bottom: 6px;
      }

      .backend-url {
        color: var(--accent-deep);
      }

      .backend-metric-strong {
        font-weight: 700;
        color: var(--ink);
      }

      .backend-metric {
        color: var(--muted);
      }

      .backend-error {
        display: inline-flex;
        align-items: center;
        padding: 8px 10px;
        min-height: 38px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.64);
        border: 1px solid rgba(120, 53, 15, 0.08);
      }

      .mono {
        font-family: "IBM Plex Mono", "Consolas", monospace;
        font-size: 0.92rem;
        font-variant-ligatures: none;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 0.9rem;
        font-weight: 600;
        border: 1px solid transparent;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32);
      }

      .has-tooltip {
        cursor: help;
      }

      .badge.good {
        background: var(--good-soft);
        color: var(--good);
      }

      .badge.warn {
        background: var(--warn-soft);
        color: var(--warn);
      }

      .badge.bad {
        background: var(--bad-soft);
        color: var(--bad);
      }

      .models {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(194, 65, 12, 0.08);
        border: 1px solid rgba(194, 65, 12, 0.1);
        color: #9a3412;
        font-size: 0.85rem;
      }

      .request-list {
        display: grid;
        gap: 14px;
      }

      .request-item {
        position: relative;
        overflow: hidden;
        padding: 18px;
        border-radius: 24px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 247, 238, 0.76));
        border: 1px solid rgba(120, 53, 15, 0.08);
        box-shadow: var(--shadow-soft);
        display: grid;
        gap: 10px;
      }

      .request-item.interactive {
        cursor: pointer;
      }

      .request-item.interactive:hover {
        transform: translateY(-1px);
        box-shadow: 0 18px 32px rgba(120, 53, 15, 0.1);
      }

      .request-item::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: 4px;
        background: linear-gradient(180deg, rgba(194, 65, 12, 0.92), rgba(251, 146, 60, 0.72));
      }

      .request-top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        align-items: flex-start;
      }

      .request-head {
        display: grid;
        gap: 8px;
        min-width: min(100%, 760px);
      }

      .request-path {
        font-weight: 700;
        font-size: 1.02rem;
        letter-spacing: -0.02em;
      }

      .request-meta,
      .request-badges,
      .request-metrics,
      .request-error {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .request-badges {
        justify-content: flex-end;
        align-items: flex-start;
      }

      .request-meta > span:not(.badge),
      .request-metrics > span:not(.badge),
      .request-error > span:not(.badge) {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 8px 11px;
        border-radius: 12px;
        border: 1px solid rgba(120, 53, 15, 0.1);
        background: rgba(255, 255, 255, 0.7);
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.3;
      }

      .request-meta > .mono {
        color: var(--ink);
        background: rgba(28, 25, 23, 0.06);
      }

      .request-metrics > span:not(.badge) {
        background: rgba(255, 247, 237, 0.9);
        color: var(--accent-deep);
        font-weight: 600;
      }

      .request-error > span:not(.badge) {
        background: var(--bad-soft);
        border-color: rgba(153, 27, 27, 0.14);
        color: var(--bad);
      }

      .empty {
        color: var(--muted);
        font-style: italic;
        padding: 14px 16px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.52);
        border: 1px dashed rgba(120, 53, 15, 0.16);
      }

      .debug-grid {
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(340px, 420px) minmax(0, 1fr);
        align-items: start;
      }

      .debug-card {
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 248, 240, 0.82));
        border: 1px solid rgba(120, 53, 15, 0.08);
        border-radius: 24px;
        padding: 18px;
        box-shadow: var(--shadow-soft);
      }

      .debug-card h3 {
        margin: 0 0 12px;
        font-size: 1rem;
      }

      .field-grid {
        display: grid;
        gap: 14px;
      }

      .param-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .field {
        display: grid;
        gap: 6px;
      }

      .field-label {
        font-size: 0.84rem;
        color: var(--muted);
        font-weight: 600;
      }

      .field input,
      .field textarea,
      .field select {
        width: 100%;
        min-height: 46px;
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid rgba(120, 53, 15, 0.18);
        background: rgba(255, 255, 255, 0.9);
        font: inherit;
        transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
      }

      .field textarea {
        min-height: 110px;
        resize: vertical;
      }

      .toggle-row {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }

      .toggle-row label {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        min-height: 42px;
        padding: 0 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.76);
        border: 1px solid rgba(120, 53, 15, 0.1);
      }

      .debug-actions {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }

      .button.secondary {
        background: rgba(255, 255, 255, 0.88);
        color: var(--ink);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42);
        border: 1px solid rgba(120, 53, 15, 0.16);
      }

      .button.ghost {
        background: transparent;
        color: #9a3412;
        box-shadow: none;
        border: 1px solid rgba(194, 65, 12, 0.18);
      }

      .debug-meta {
        min-height: 32px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        padding-bottom: 14px;
        margin-bottom: 14px;
        border-bottom: 1px solid rgba(120, 53, 15, 0.08);
      }

      .debug-meta .hint {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 8px 11px;
        border-radius: 12px;
        border: 1px solid rgba(120, 53, 15, 0.1);
        background: rgba(255, 255, 255, 0.72);
      }

      .transcript {
        display: grid;
        gap: 14px;
      }

      .turn {
        padding: 16px;
        border-radius: 22px;
        border: 1px solid rgba(120, 53, 15, 0.08);
        background: rgba(255, 255, 255, 0.82);
        display: grid;
        gap: 10px;
        box-shadow: 0 10px 20px rgba(120, 53, 15, 0.05);
      }

      .turn.user {
        border-left: 4px solid rgba(194, 65, 12, 0.7);
        background: linear-gradient(180deg, rgba(255, 247, 237, 0.92), rgba(255, 251, 245, 0.82));
      }

      .turn.assistant {
        border-left: 4px solid rgba(22, 101, 52, 0.65);
        background: linear-gradient(180deg, rgba(240, 253, 244, 0.82), rgba(255, 255, 255, 0.9));
      }

      .turn.system,
      .turn.developer {
        border-left: 4px solid rgba(30, 64, 175, 0.65);
        background: linear-gradient(180deg, rgba(239, 246, 255, 0.9), rgba(255, 255, 255, 0.88));
      }

      .turn.tool {
        border-left: 4px solid rgba(126, 34, 206, 0.58);
        background: linear-gradient(180deg, rgba(250, 245, 255, 0.92), rgba(255, 255, 255, 0.9));
      }

      .turn-head {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
      }

      .turn-role {
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .turn-content,
      .raw-box pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "IBM Plex Mono", "Consolas", monospace;
        font-size: 0.88rem;
        line-height: 1.45;
        tab-size: 2;
      }

      .markdown-content {
        color: var(--ink);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        font-size: 0.96rem;
        line-height: 1.65;
        white-space: normal;
      }

      .markdown-content > :first-child {
        margin-top: 0;
      }

      .markdown-content > :last-child {
        margin-bottom: 0;
      }

      .markdown-content p,
      .markdown-content ul,
      .markdown-content ol,
      .markdown-content blockquote,
      .markdown-content pre,
      .markdown-content h1,
      .markdown-content h2,
      .markdown-content h3,
      .markdown-content h4,
      .markdown-content h5,
      .markdown-content h6 {
        margin: 0 0 0.9em;
      }

      .markdown-content ul,
      .markdown-content ol {
        padding-left: 1.4rem;
      }

      .markdown-content li + li {
        margin-top: 0.28rem;
      }

      .markdown-content blockquote {
        padding: 0.1rem 0 0.1rem 0.95rem;
        border-left: 4px solid rgba(194, 65, 12, 0.25);
        color: var(--muted);
      }

      .markdown-content a {
        color: var(--accent-deep);
        text-decoration: underline;
        text-decoration-thickness: 0.08em;
      }

      .markdown-content code {
        font-family: "IBM Plex Mono", "Consolas", monospace;
        font-size: 0.88em;
        padding: 0.14em 0.38em;
        border-radius: 8px;
        background: rgba(28, 25, 23, 0.08);
      }

      .markdown-content pre {
        overflow: auto;
        padding: 12px;
        border-radius: 16px;
        background: rgba(28, 25, 23, 0.05);
      }

      .markdown-content pre code {
        display: block;
        padding: 0;
        background: transparent;
        border-radius: 0;
      }

      .json-view {
        color: #1f2937;
      }

      .json-key {
        color: #9a3412;
      }

      .json-string {
        color: #166534;
      }

      .json-number {
        color: #1d4ed8;
      }

      .json-boolean {
        color: #7c3aed;
        font-weight: 700;
      }

      .json-null {
        color: #b45309;
        font-weight: 700;
      }

      .reasoning {
        border-radius: 18px;
        border: 1px solid rgba(120, 53, 15, 0.12);
        background: rgba(255, 247, 237, 0.86);
        padding: 10px 12px;
      }

      .reasoning strong {
        display: block;
        margin-bottom: 8px;
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }

      .raw-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .raw-box {
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 248, 240, 0.78));
        border: 1px solid rgba(120, 53, 15, 0.08);
        border-radius: 22px;
        padding: 14px;
        box-shadow: var(--shadow-soft);
      }

      .raw-box h3 {
        margin: 0 0 10px;
        font-size: 0.98rem;
      }

      .raw-box pre {
        max-height: 420px;
        overflow: auto;
      }

      .request-detail-overlay {
        position: fixed;
        inset: 0;
        z-index: 30;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(28, 25, 23, 0.48);
        backdrop-filter: blur(10px);
      }

      .request-detail-overlay[hidden] {
        display: none;
      }

      .request-detail-dialog {
        width: min(1320px, calc(100vw - 32px));
        max-height: calc(100vh - 48px);
        overflow: auto;
        padding: 22px;
        border-radius: 28px;
        border: 1px solid rgba(120, 53, 15, 0.14);
        background: linear-gradient(180deg, rgba(255, 252, 247, 0.98), rgba(255, 248, 240, 0.94));
        box-shadow: 0 30px 80px rgba(28, 25, 23, 0.24);
      }

      .request-detail-grid {
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.9fr);
      }

      .request-detail-card {
        padding: 18px;
        border-radius: 24px;
        border: 1px solid rgba(120, 53, 15, 0.08);
        background: rgba(255, 255, 255, 0.78);
        box-shadow: var(--shadow-soft);
      }

      .request-detail-card h3 {
        margin: 0 0 10px;
        font-size: 1rem;
      }

      .request-detail-section + .request-detail-section {
        margin-top: 18px;
      }

      .detail-stack {
        display: grid;
        gap: 12px;
      }

      .detail-block {
        padding: 12px;
        border-radius: 16px;
        border: 1px solid rgba(120, 53, 15, 0.1);
        background: rgba(255, 250, 244, 0.88);
      }

      .detail-block-label {
        margin-bottom: 8px;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .message-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .message-role-badge {
        justify-content: center;
        min-width: 42px;
        padding-inline: 10px;
        font-size: 1.05rem;
        line-height: 1;
      }

      .message-part-list {
        display: grid;
        gap: 10px;
      }

      .message-part {
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid rgba(120, 53, 15, 0.08);
        background: rgba(255, 255, 255, 0.72);
      }

      .message-part-type {
        margin-bottom: 6px;
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .reasoning-panel {
        border: 1px solid rgba(30, 64, 175, 0.12);
        border-radius: 16px;
        background: rgba(239, 246, 255, 0.68);
        overflow: hidden;
      }

      .reasoning-summary {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        cursor: pointer;
        user-select: none;
        font-weight: 700;
        color: #1d4ed8;
        list-style: none;
      }

      .reasoning-summary::-webkit-details-marker {
        display: none;
      }

      .reasoning-chevron {
        font-size: 0.86rem;
        transition: transform 120ms ease;
      }

      .reasoning-panel[open] .reasoning-chevron {
        transform: rotate(90deg);
      }

      .reasoning-content {
        padding: 0 12px 12px;
      }

      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(12px);
        }

        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes fadePanel {
        from {
          opacity: 0;
          transform: translateY(6px);
        }

        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (max-width: 980px) {
        .hero-bar,
        .request-top {
          align-items: flex-start;
        }

        .request-badges {
          justify-content: flex-start;
        }

        .debug-grid,
        .raw-grid,
        .request-detail-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 720px) {
        .shell {
          width: min(100vw - 20px, 1460px);
          margin: 10px auto 24px;
        }

        .hero,
        .panel,
        .card {
          border-radius: 18px;
        }

        .hero,
        .panel {
          padding: 18px;
        }

        .table th,
        .table td {
          padding: 12px 10px;
        }

        .table {
          border-spacing: 0 8px;
        }

        .page-link {
          flex: 0 1 auto;
        }

        .param-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body data-page="${options.page}">
    <main class="shell">
      <section class="hero">
        <div class="hero-bar">
          <nav class="page-nav" aria-label="Dashboard sections">
            <a class="page-link${options.page === "overview" ? " active" : ""}" data-route-page="overview" href="${escapeHtml(overviewPath)}"${options.page === "overview" ? ' aria-current="page"' : ""}>📊 Overview</a>
            <a class="page-link${options.page === "chat" ? " active" : ""}" data-route-page="chat" href="${escapeHtml(chatPath)}"${options.page === "chat" ? ' aria-current="page"' : ""}>💬 Chat Debugger</a>
            <a class="page-link${options.page === "backends" ? " active" : ""}" data-route-page="backends" href="${escapeHtml(backendsPath)}"${options.page === "backends" ? ' aria-current="page"' : ""}>🧩 Backends</a>
          </nav>
          <div class="status-pill">
            <span class="status-dot" id="connection-dot"></span>
            <span id="connection-text">Connecting live feed...</span>
          </div>
        </div>
      </section>

      <section class="panel page-section page-overview">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Health Status</h2>
          </div>
        </div>
        <section class="grid summary-grid" id="summary-grid"></section>
      </section>

      <section class="panel page-section page-overview">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Live Connections</h2>
            <p class="hint">All currently active proxy connections with queue state, streaming mode, and live metrics.</p>
          </div>
        </div>
        <div id="active-connections" class="request-list"></div>
      </section>

      <section class="panel page-section page-backends">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Backends</h2>
            <p class="hint">Inspect backend status, load, errors, and concurrency settings in one place.</p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Backend</th>
                <th>Status</th>
                <th>Load</th>
                <th>Models</th>
                <th>Metrics</th>
                <th>Last Error</th>
                <th>Controls</th>
              </tr>
            </thead>
            <tbody id="backend-table-body"></tbody>
          </table>
        </div>
      </section>

      <section class="panel page-section page-chat">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Chat Debugger</h2>
            <p class="hint">Chat directly through the proxy, similar to the built-in llama.cpp frontend, including live tokens, sampler parameters, and raw responses.</p>
          </div>
          <div class="debug-actions">
            <button class="button secondary" id="debug-refresh-models">Refresh models</button>
            <button class="button secondary" id="debug-clear-chat">Clear chat</button>
          </div>
        </div>
        <div class="debug-grid">
          <div class="debug-card">
            <div class="field-grid">
              <label class="field">
                <span class="field-label">Model</span>
                <select id="debug-model"></select>
              </label>
              <label class="field">
                <span class="field-label">System Prompt</span>
                <textarea id="debug-system" placeholder="You are a helpful assistant."></textarea>
              </label>
              <label class="field">
                <span class="field-label">Next User Message</span>
                <textarea id="debug-prompt" placeholder="Write your prompt here..."></textarea>
              </label>
              <div class="param-grid">
                <label class="field">
                  <span class="field-label">temperature</span>
                  <input id="debug-temperature" type="number" min="0" max="2" step="0.1" />
                </label>
                <label class="field">
                  <span class="field-label">top_p</span>
                  <input id="debug-top-p" type="number" min="0" max="1" step="0.01" />
                </label>
                <label class="field">
                  <span class="field-label">top_k</span>
                  <input id="debug-top-k" type="number" min="0" step="1" />
                </label>
                <label class="field">
                  <span class="field-label">min_p</span>
                  <input id="debug-min-p" type="number" min="0" max="1" step="0.01" />
                </label>
                <label class="field">
                  <span class="field-label">repeat_penalty</span>
                  <input id="debug-repeat-penalty" type="number" min="0" step="0.05" />
                </label>
                <label class="field">
                  <span class="field-label">max_tokens</span>
                  <input id="debug-max-tokens" type="number" min="1" step="1" />
                </label>
              </div>
              <div class="toggle-row">
                <label><input id="debug-stream" type="checkbox" /> Use streaming</label>
              </div>
              <div class="debug-actions">
                <button class="button" id="debug-send-chat">Send chat</button>
                <button class="button ghost" id="debug-stop-chat" disabled>Stop</button>
              </div>
            </div>
          </div>

          <div class="debug-card">
            <div class="debug-meta" id="debug-meta"></div>
            <div class="transcript" id="debug-transcript"></div>
          </div>
        </div>
        <div class="raw-grid" style="margin-top: 18px;">
          <div class="raw-box">
            <h3>Request JSON</h3>
            <pre id="debug-request">// request appears here</pre>
          </div>
          <div class="raw-box">
            <h3>Response / Stream</h3>
            <pre id="debug-response">// response appears here</pre>
          </div>
        </div>
      </section>

      <section class="panel page-section page-overview">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Recent Requests</h2>
            <p class="hint">Live history with queue time, target backend, and outcome.</p>
          </div>
        </div>
        <div id="recent-requests" class="request-list"></div>
      </section>
    </main>

    <div class="request-detail-overlay" id="request-detail-overlay" hidden>
      <div class="request-detail-dialog">
        <div class="panel-header">
          <div>
            <h2 class="panel-title" id="request-detail-title">Request Details</h2>
            <p class="hint" id="request-detail-subtitle">Inspect the original request payload, messages, tools, and final response.</p>
          </div>
          <button class="button ghost" id="request-detail-close" type="button" aria-label="Close request details" title="Close request details">X</button>
        </div>

        <div class="request-detail-grid">
          <section class="request-detail-card">
            <h3>Conversation</h3>
            <div id="request-detail-messages" class="transcript"></div>
          </section>

          <section class="request-detail-card">
            <div class="request-detail-section">
              <h3>Request Context</h3>
              <div id="request-detail-summary" class="request-metrics"></div>
              <div id="request-detail-params" class="request-metrics" style="margin-top: 12px;"></div>
            </div>

            <div class="request-detail-section">
              <h3>Tools</h3>
              <div id="request-detail-tools" class="detail-stack"></div>
            </div>

            <div class="request-detail-section">
              <h3>Assistant Result</h3>
              <div id="request-detail-response-message" class="detail-stack"></div>
            </div>
          </section>
        </div>

        <div class="raw-grid" style="margin-top: 18px;">
          <div class="raw-box">
            <h3>Request JSON</h3>
            <pre id="request-detail-request">// request details appear here</pre>
          </div>
          <div class="raw-box">
            <h3>Response JSON</h3>
            <pre id="request-detail-response">// response details appear here</pre>
          </div>
        </div>
      </div>
    </div>

    <script>
      const state = {
        snapshot: ${initialState},
        currentPage: ${JSON.stringify(options.page)},
        models: [],
        requestDetail: {
          open: false,
          loading: false,
          requestId: "",
          error: "",
          detail: null,
          cache: {},
        },
        debug: {
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
          metrics: createEmptyDebugMetrics(),
          params: {
            temperature: 0.7,
            top_p: 0.95,
            top_k: 40,
            min_p: 0.05,
            repeat_penalty: 1.1,
            max_tokens: 512,
          },
        },
      };

      const summaryGrid = document.getElementById("summary-grid");
      const activeConnections = document.getElementById("active-connections");
      const backendTableBody = document.getElementById("backend-table-body");
      const recentRequests = document.getElementById("recent-requests");
      const connectionDot = document.getElementById("connection-dot");
      const connectionText = document.getElementById("connection-text");
      const pageNav = document.querySelector(".page-nav");
      const pageLinks = Array.from(document.querySelectorAll(".page-link"));
      const requestDetailOverlay = document.getElementById("request-detail-overlay");
      const requestDetailClose = document.getElementById("request-detail-close");
      const requestDetailTitle = document.getElementById("request-detail-title");
      const requestDetailSubtitle = document.getElementById("request-detail-subtitle");
      const requestDetailSummary = document.getElementById("request-detail-summary");
      const requestDetailParams = document.getElementById("request-detail-params");
      const requestDetailMessages = document.getElementById("request-detail-messages");
      const requestDetailTools = document.getElementById("request-detail-tools");
      const requestDetailResponseMessage = document.getElementById("request-detail-response-message");
      const requestDetailRequest = document.getElementById("request-detail-request");
      const requestDetailResponse = document.getElementById("request-detail-response");
      const debugModel = document.getElementById("debug-model");
      const debugSystem = document.getElementById("debug-system");
      const debugPrompt = document.getElementById("debug-prompt");
      const debugTemperature = document.getElementById("debug-temperature");
      const debugTopP = document.getElementById("debug-top-p");
      const debugTopK = document.getElementById("debug-top-k");
      const debugMinP = document.getElementById("debug-min-p");
      const debugRepeatPenalty = document.getElementById("debug-repeat-penalty");
      const debugMaxTokens = document.getElementById("debug-max-tokens");
      const debugStream = document.getElementById("debug-stream");
      const debugSendChat = document.getElementById("debug-send-chat");
      const debugStopChat = document.getElementById("debug-stop-chat");
      const debugRefreshModels = document.getElementById("debug-refresh-models");
      const debugClearChat = document.getElementById("debug-clear-chat");
      const debugMeta = document.getElementById("debug-meta");
      const debugTranscript = document.getElementById("debug-transcript");
      const debugRequest = document.getElementById("debug-request");
      const debugResponse = document.getElementById("debug-response");
      const dashboardPages = ${pageConfig};
      let debugMetricsTimer = null;

      debugSystem.value = state.debug.systemPrompt;
      debugPrompt.value = state.debug.prompt;
      debugTemperature.value = String(state.debug.params.temperature);
      debugTopP.value = String(state.debug.params.top_p);
      debugTopK.value = String(state.debug.params.top_k);
      debugMinP.value = String(state.debug.params.min_p);
      debugRepeatPenalty.value = String(state.debug.params.repeat_penalty);
      debugMaxTokens.value = String(state.debug.params.max_tokens);
      debugStream.checked = state.debug.stream;

      debugSystem.addEventListener("input", (event) => {
        state.debug.systemPrompt = event.target.value;
      });
      debugPrompt.addEventListener("input", (event) => {
        state.debug.prompt = event.target.value;
      });
      debugStream.addEventListener("change", (event) => {
        state.debug.stream = event.target.checked;
      });
      debugModel.addEventListener("change", (event) => {
        state.debug.model = event.target.value;
      });

      const debugParamInputs = [
        ["temperature", debugTemperature],
        ["top_p", debugTopP],
        ["top_k", debugTopK],
        ["min_p", debugMinP],
        ["repeat_penalty", debugRepeatPenalty],
        ["max_tokens", debugMaxTokens],
      ];

      for (const [key, element] of debugParamInputs) {
        element.addEventListener("input", () => {
          const value = Number(element.value);
          if (!Number.isNaN(value)) {
            state.debug.params[key] = value;
          }
        });
      }

      function normalizePagePath(pathname) {
        if (typeof pathname !== "string" || pathname.length === 0) {
          return dashboardPages.overview.path;
        }

        const normalized = pathname !== "/" && pathname.endsWith("/")
          ? pathname.slice(0, -1)
          : pathname;

        if (normalized === dashboardPages.overview.path + "/config") {
          return dashboardPages.backends.path;
        }

        return normalized;
      }

      function getPageFromPath(pathname) {
        const normalizedPath = normalizePagePath(pathname);

        for (const [page, config] of Object.entries(dashboardPages)) {
          if (config.path === normalizedPath) {
            return page;
          }
        }

        return "overview";
      }

      function syncPageNavigation() {
        document.body.dataset.page = state.currentPage;
        document.title = "llmproxy - " + dashboardPages[state.currentPage].title;

        for (const link of pageLinks) {
          if (!(link instanceof HTMLAnchorElement)) {
            continue;
          }

          const active = link.dataset.routePage === state.currentPage;
          link.classList.toggle("active", active);

          if (active) {
            link.setAttribute("aria-current", "page");
          } else {
            link.removeAttribute("aria-current");
          }
        }
      }

      function setCurrentPage(page, options = {}) {
        const nextPage = dashboardPages[page] ? page : "overview";
        const nextPath = dashboardPages[nextPage].path;
        const currentPath = normalizePagePath(window.location.pathname);
        state.currentPage = nextPage;
        syncPageNavigation();

        if (options.updateHistory === false) {
          return;
        }

        if (options.replaceHistory || currentPath !== nextPath) {
          const historyMethod = options.replaceHistory ? "replaceState" : "pushState";
          window.history[historyMethod]({ page: nextPage }, "", nextPath);
        }
      }

      function formatUiValue(value) {
        if (value === undefined || value === null) {
          return "";
        }

        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          return String(value);
        }

        return formatCompactValue(value);
      }

      function escapeClientHtml(value) {
        return formatUiValue(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function formatDuration(ms) {
        if (typeof ms !== "number") {
          return "n/a";
        }

        if (ms < 1000) {
          return ms + "ms";
        }

        const seconds = ms / 1000;
        if (seconds < 60) {
          return seconds.toFixed(1) + "s";
        }

        return (seconds / 60).toFixed(1) + "m";
      }

      function formatDate(value) {
        if (!value) {
          return "n/a";
        }

        try {
          return new Intl.DateTimeFormat("en-US", {
            dateStyle: "short",
            timeStyle: "medium",
          }).format(new Date(value));
        } catch {
          return value;
        }
      }

      function createEmptyDebugMetrics() {
        return {
          startedAt: 0,
          firstTokenAt: 0,
          lastTokenAt: 0,
          promptTokens: null,
          completionTokens: 0,
          totalTokens: null,
          contentTokens: 0,
          reasoningTokens: 0,
          promptMs: null,
          generationMs: null,
          promptPerSecond: null,
          completionPerSecond: null,
          finishReason: "",
        };
      }

      function resetDebugMetrics() {
        state.debug.metrics = createEmptyDebugMetrics();
      }

      function stopDebugMetricsTicker() {
        if (debugMetricsTimer !== null) {
          clearInterval(debugMetricsTimer);
          debugMetricsTimer = null;
        }
      }

      function startDebugMetricsTicker() {
        stopDebugMetricsTicker();
        debugMetricsTimer = setInterval(() => {
          if (state.debug.sending) {
            renderDebugMeta();
          }
        }, 250);
      }

      function formatTokenRate(value) {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          return "";
        }

        return (value >= 100 ? value.toFixed(0) : value.toFixed(1)) + " tok/s";
      }

      function formatLiveUsage() {
        if (!state.debug.sending) {
          return "";
        }

        const metrics = state.debug.metrics;
        const parts = [];

        if (metrics.completionTokens > 0) {
          parts.push(metrics.completionTokens + " live tok");
        } else {
          parts.push("waiting for first token");
        }

        if (metrics.contentTokens > 0 || metrics.reasoningTokens > 0) {
          const detail = [];

          if (metrics.contentTokens > 0) {
            detail.push(metrics.contentTokens + " content");
          }

          if (metrics.reasoningTokens > 0) {
            detail.push(metrics.reasoningTokens + " reasoning");
          }

          parts.push(detail.join(" + "));
        }

        if (metrics.startedAt > 0) {
          parts.push("elapsed " + formatDuration(Date.now() - metrics.startedAt));
        }

        const liveRate =
          metrics.completionPerSecond ??
          (metrics.firstTokenAt > 0 && metrics.completionTokens > 0
            ? metrics.completionTokens / Math.max(0.001, (Date.now() - metrics.firstTokenAt) / 1000)
            : null);

        const formattedRate = formatTokenRate(liveRate);
        if (formattedRate) {
          parts.push(formattedRate);
        }

        return parts.join(" | ");
      }

      function countStreamDeltaTokens(delta) {
        const counts = {
          completionTokens: 0,
          contentTokens: 0,
          reasoningTokens: 0,
        };

        if (typeof delta?.content === "string" && delta.content.length > 0) {
          counts.completionTokens += 1;
          counts.contentTokens += 1;
        }

        if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0) {
          counts.completionTokens += 1;
          counts.reasoningTokens += 1;
        }

        return counts;
      }

      function noteStreamingTokenActivity(delta) {
        const counts = countStreamDeltaTokens(delta);

        if (counts.completionTokens === 0) {
          return;
        }

        const metrics = state.debug.metrics;
        const now = Date.now();

        if (!metrics.firstTokenAt) {
          metrics.firstTokenAt = now;
        }

        metrics.lastTokenAt = now;
        metrics.completionTokens += counts.completionTokens;
        metrics.contentTokens += counts.contentTokens;
        metrics.reasoningTokens += counts.reasoningTokens;
      }

      function applyUsageMetrics(usage, timings, finishReason) {
        const metrics = state.debug.metrics;

        if (finishReason) {
          metrics.finishReason = finishReason;
        }

        if (usage && typeof usage.prompt_tokens === "number") {
          metrics.promptTokens = usage.prompt_tokens;
        }

        if (usage && typeof usage.completion_tokens === "number") {
          metrics.completionTokens = usage.completion_tokens;
        }

        if (usage && typeof usage.total_tokens === "number") {
          metrics.totalTokens = usage.total_tokens;
        }

        if (timings && typeof timings.prompt_n === "number") {
          metrics.promptTokens = timings.prompt_n;
        }

        if (timings && typeof timings.predicted_n === "number") {
          metrics.completionTokens = timings.predicted_n;
        }

        if (timings && typeof timings.prompt_ms === "number") {
          metrics.promptMs = timings.prompt_ms;
        }

        if (timings && typeof timings.predicted_ms === "number") {
          metrics.generationMs = timings.predicted_ms;
        }

        if (timings && typeof timings.prompt_per_second === "number") {
          metrics.promptPerSecond = timings.prompt_per_second;
        }

        if (timings && typeof timings.predicted_per_second === "number") {
          metrics.completionPerSecond = timings.predicted_per_second;
        }

        if (metrics.totalTokens === null &&
          typeof metrics.promptTokens === "number" &&
          typeof metrics.completionTokens === "number") {
          metrics.totalTokens = metrics.promptTokens + metrics.completionTokens;
        }
      }

      function formatModels(configuredModels, discoveredModels) {
        const all = [...new Set([...(configuredModels ?? []), ...(discoveredModels ?? [])])];

        if (all.length === 0) {
          return '<span class="empty">No model list available</span>';
        }

        return '<div class="models">' + all.map((model) => '<span class="chip">' + escapeClientHtml(model) + '</span>').join("") + "</div>";
      }

      function shortId(value) {
        return typeof value === "string" && value.length > 8 ? value.slice(0, 8) : value;
      }

      function setElementText(element, value) {
        const nextValue = formatUiValue(value);
        if (element.textContent !== nextValue) {
          element.textContent = nextValue;
        }
      }

      function setElementClass(element, className) {
        if (element.className !== className) {
          element.className = className;
        }
      }

      function setElementTooltip(element, value) {
        const nextValue = formatUiValue(value).trim();

        if (nextValue) {
          if (element.getAttribute("title") !== nextValue) {
            element.setAttribute("title", nextValue);
          }

          element.classList.add("has-tooltip");
          return;
        }

        if (element.hasAttribute("title")) {
          element.removeAttribute("title");
        }

        element.classList.remove("has-tooltip");
      }

      function inlineSpec(text, title, className = "", tagName = "span") {
        return {
          text,
          title,
          className,
          tagName,
        };
      }

      function describeFinishReason(reason) {
        if (reason === "stop") {
          return 'Final finish reason reported by the backend. "stop" means the generation ended normally.';
        }

        if (reason === "length") {
          return 'Final finish reason reported by the backend. "length" usually means generation stopped because the token limit was reached.';
        }

        if (reason === "content_filter") {
          return 'Final finish reason reported by the backend. "content_filter" means output was stopped by a safety/content filter.';
        }

        if (reason === "tool_calls") {
          return 'Final finish reason reported by the backend. "tool_calls" means the model stopped because it emitted tool calls.';
        }

        return "Final finish reason reported by the backend for this request.";
      }

      function isClientRecord(value) {
        return typeof value === "object" && value !== null && !Array.isArray(value);
      }

      function prettyJson(value) {
        if (value === undefined) {
          return "";
        }

        try {
          return JSON.stringify(value, null, 2);
        } catch {
          return String(value);
        }
      }

      function escapeCodeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
      }

      function tryParseJsonString(value) {
        if (typeof value !== "string") {
          return undefined;
        }

        const trimmed = value.trim();
        if (!trimmed) {
          return undefined;
        }

        const first = trimmed[0];
        const looksLikeJson =
          first === "{" ||
          first === "[" ||
          first === '"' ||
          first === "-" ||
          (first >= "0" && first <= "9") ||
          trimmed === "true" ||
          trimmed === "false" ||
          trimmed === "null";

        if (!looksLikeJson) {
          return undefined;
        }

        try {
          return JSON.parse(trimmed);
        } catch {
          return undefined;
        }
      }

      function tryParseJsonSequence(value) {
        if (typeof value !== "string") {
          return null;
        }

        const blocks = value
          .split(/\\n\\s*\\n/)
          .map((block) => block.trim())
          .filter(Boolean);

        if (blocks.length < 2) {
          return null;
        }

        const docs = [];
        for (const block of blocks) {
          const parsed = tryParseJsonString(block);
          if (parsed === undefined) {
            return null;
          }

          docs.push(parsed);
        }

        return docs;
      }

      function getJsonDocuments(value) {
        if (value === undefined) {
          return null;
        }

        if (typeof value === "string") {
          const sequence = tryParseJsonSequence(value);
          if (sequence) {
            return sequence;
          }

          const parsed = tryParseJsonString(value);
          return parsed === undefined ? null : [parsed];
        }

        if (typeof value === "object" || typeof value === "number" || typeof value === "boolean") {
          return [value];
        }

        return null;
      }

      function syntaxHighlightJson(jsonText) {
        return escapeCodeHtml(jsonText).replace(
          /("(\\\\u[\\da-fA-F]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g,
          (match) => {
            let className = "json-number";

            if (match[0] === '"') {
              className = match.endsWith(":") ? "json-key" : "json-string";
            } else if (match === "true" || match === "false") {
              className = "json-boolean";
            } else if (match === "null") {
              className = "json-null";
            }

            return '<span class="' + className + '">' + match + "</span>";
          },
        );
      }

      function renderCodeInnerHtml(value) {
        const docs = getJsonDocuments(value);
        if (docs) {
          return {
            html: docs.map((doc) => syntaxHighlightJson(prettyJson(doc))).join("\\n\\n"),
            isJson: true,
          };
        }

        return {
          html: escapeClientHtml(value ?? ""),
          isJson: false,
        };
      }

      function renderCodeBlockHtml(value, baseClass = "turn-content") {
        const rendered = renderCodeInnerHtml(value);
        const className = rendered.isJson ? (baseClass + " json-view") : baseClass;
        return '<pre class="' + escapeClientHtml(className) + '">' + rendered.html + "</pre>";
      }

      function setCodeBlockContent(element, value) {
        const rendered = renderCodeInnerHtml(value);

        element.classList.toggle("json-view", rendered.isJson);
        if (element.innerHTML !== rendered.html) {
          element.innerHTML = rendered.html;
        }
      }

      function renderMarkdownInline(markdown) {
        const placeholders = [];
        const store = (html) => {
          const token = "@@MDTOKEN" + placeholders.length + "@@";
          placeholders.push({
            token,
            html,
          });
          return token;
        };

        let html = escapeCodeHtml(markdown ?? "");

        html = html.replace(
          new RegExp(String.fromCharCode(96) + "([^" + String.fromCharCode(96) + "\\\\n]+)" + String.fromCharCode(96), "g"),
          (_match, code) => store("<code>" + code + "</code>"),
        );

        html = html.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, (_match, label, href) => (
          store('<a href="' + escapeClientHtml(href) + '" target="_blank" rel="noreferrer noopener">' + label + "</a>")
        ));

        html = html.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
        html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
        html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
        html = html.replace(/(^|[\\s(])\\*([^*]+)\\*(?=[$\\s).,!?:;]|$)/g, "$1<em>$2</em>");
        html = html.replace(/(^|[\\s(])_([^_]+)_(?=[$\\s).,!?:;]|$)/g, "$1<em>$2</em>");
        html = html.replace(/(^|[\\s(])(https?:\\/\\/[^\\s<]+)/g, (_match, prefix, href) => (
          prefix + store('<a href="' + escapeClientHtml(href) + '" target="_blank" rel="noreferrer noopener">' + href + "</a>")
        ));

        for (const placeholder of placeholders) {
          html = html.replaceAll(placeholder.token, placeholder.html);
        }

        return html;
      }

      function isMarkdownBlockBoundary(line) {
        const fence = String.fromCharCode(96).repeat(3);
        return (
          line.startsWith(fence) ||
          /^(#{1,6})\\s+/.test(line) ||
          /^[-*+]\\s+/.test(line) ||
          /^\\d+\\.\\s+/.test(line) ||
          /^>\\s?/.test(line)
        );
      }

      function renderMarkdownToHtml(markdown) {
        const fence = String.fromCharCode(96).repeat(3);
        const normalized = String(markdown ?? "").replace(/\\r\\n?/g, "\\n").trim();

        if (!normalized) {
          return '<div class="empty">No message content.</div>';
        }

        const lines = normalized.split("\\n");
        const blocks = [];
        let index = 0;

        while (index < lines.length) {
          const line = lines[index];

          if (!line.trim()) {
            index += 1;
            continue;
          }

          if (line.startsWith(fence)) {
            const codeLines = [];
            const language = line.slice(3).trim().toLowerCase();
            index += 1;

            while (index < lines.length && !lines[index].startsWith(fence)) {
              codeLines.push(lines[index]);
              index += 1;
            }

            if (index < lines.length && lines[index].startsWith(fence)) {
              index += 1;
            }

            const codeValue = codeLines.join("\\n");
            const rendered = renderCodeInnerHtml(codeValue);
            const codeClass = "turn-content" + (rendered.isJson || language === "json" ? " json-view" : "");
            blocks.push('<pre class="' + escapeClientHtml(codeClass) + '"><code>' + rendered.html + "</code></pre>");
            continue;
          }

          const headingMatch = /^(#{1,6})\\s+(.*)$/.exec(line);
          if (headingMatch) {
            const level = Math.min(6, headingMatch[1].length);
            blocks.push("<h" + level + ">" + renderMarkdownInline(headingMatch[2]) + "</h" + level + ">");
            index += 1;
            continue;
          }

          if (/^>\\s?/.test(line)) {
            const quoteLines = [];

            while (index < lines.length && /^>\\s?/.test(lines[index])) {
              quoteLines.push(lines[index].replace(/^>\\s?/, ""));
              index += 1;
            }

            blocks.push("<blockquote><p>" + renderMarkdownInline(quoteLines.join("\\n")).replace(/\\n/g, "<br />") + "</p></blockquote>");
            continue;
          }

          if (/^[-*+]\\s+/.test(line)) {
            const items = [];

            while (index < lines.length && /^[-*+]\\s+/.test(lines[index])) {
              items.push(lines[index].replace(/^[-*+]\\s+/, ""));
              index += 1;
            }

            blocks.push("<ul>" + items.map((item) => "<li>" + renderMarkdownInline(item) + "</li>").join("") + "</ul>");
            continue;
          }

          if (/^\\d+\\.\\s+/.test(line)) {
            const items = [];

            while (index < lines.length && /^\\d+\\.\\s+/.test(lines[index])) {
              items.push(lines[index].replace(/^\\d+\\.\\s+/, ""));
              index += 1;
            }

            blocks.push("<ol>" + items.map((item) => "<li>" + renderMarkdownInline(item) + "</li>").join("") + "</ol>");
            continue;
          }

          const paragraphLines = [];
          while (index < lines.length && lines[index].trim() && !isMarkdownBlockBoundary(lines[index])) {
            paragraphLines.push(lines[index]);
            index += 1;
          }

          blocks.push("<p>" + renderMarkdownInline(paragraphLines.join("\\n")).replace(/\\n/g, "<br />") + "</p>");
        }

        return blocks.join("");
      }

      function renderMarkdownBlockHtml(markdown) {
        return '<div class="markdown-content">' + renderMarkdownToHtml(markdown) + "</div>";
      }

      function renderMessageStringHtml(value) {
        if (getJsonDocuments(value)) {
          return renderCodeBlockHtml(value, "turn-content");
        }

        return renderMarkdownBlockHtml(String(value ?? ""));
      }

      function formatCompactValue(value) {
        if (value === undefined) {
          return "";
        }

        if (typeof value === "string") {
          return value.length > 140 ? value.slice(0, 137) + "..." : value;
        }

        if (typeof value === "number" || typeof value === "boolean") {
          return String(value);
        }

        if (value === null) {
          return "null";
        }

        const json = prettyJson(value).replace(/\s+/g, " ").trim();
        return json.length > 140 ? json.slice(0, 137) + "..." : json;
      }

      function roleTone(role) {
        if (role === "assistant") {
          return "good";
        }

        if (role === "tool" || role === "user" || role === "system" || role === "developer") {
          return "warn";
        }

        return "bad";
      }

      function getMessageRoleEmoji(role) {
        if (role === "system") {
          return "🧭";
        }

        if (role === "user") {
          return "🙂";
        }

        if (role === "assistant") {
          return "🤖";
        }

        if (role === "tool") {
          return "🧰";
        }

        if (role === "developer") {
          return "🛠️";
        }

        return "❓";
      }

      function describeMessageRole(role) {
        if (role === "system") {
          return "System message. Provides high-level instructions and behavior guidance for the model.";
        }

        if (role === "user") {
          return "User message. This is input coming from the user or calling application.";
        }

        if (role === "assistant") {
          return "Assistant message. This is model output or a stored assistant response.";
        }

        if (role === "tool") {
          return "Tool message. This carries the result returned by a tool call back into the model conversation.";
        }

        if (role === "developer") {
          return "Developer message. This carries application-level instructions for the model.";
        }

        return "Unknown OpenAI message role.";
      }

      function buildMessageRoleBadgeSpec(message, role) {
        const tooltipParts = [describeMessageRole(role)];

        if (role === "tool" && typeof message?.tool_call_id === "string" && message.tool_call_id.length > 0) {
          tooltipParts.push("tool_call_id: " + message.tool_call_id);
        }

        return badgeSpec(
          getMessageRoleEmoji(role),
          roleTone(role),
          tooltipParts.join(" "),
          "message-role-badge",
        );
      }

      function renderDetailBlock(label, value) {
        if (value === undefined || value === null || value === "") {
          return "";
        }

        return (
          '<div class="detail-block">' +
            '<div class="detail-block-label">' + escapeClientHtml(label) + '</div>' +
            renderCodeBlockHtml(value, "turn-content") +
          '</div>'
        );
      }

      function hasVisibleMessageContent(content) {
        if (typeof content === "string") {
          return content.length > 0;
        }

        if (Array.isArray(content)) {
          return content.length > 0;
        }

        return content !== undefined && content !== null;
      }

      function renderReasoningHtml(reasoningContent) {
        if (typeof reasoningContent !== "string" || reasoningContent.length === 0) {
          return "";
        }

        return (
          '<details class="reasoning-panel" open>' +
            '<summary class="reasoning-summary" title="Model reasoning captured for this message. Collapse it to focus on the final content.">' +
              '<span aria-hidden="true">🧠</span>' +
              '<span>Reasoning</span>' +
              '<span class="reasoning-chevron" aria-hidden="true">▶</span>' +
            '</summary>' +
            '<div class="reasoning-content">' +
              renderMessageStringHtml(reasoningContent) +
            '</div>' +
          '</details>'
        );
      }

      function renderCollapsedReasoningHtml(reasoningContent) {
        if (typeof reasoningContent !== "string" || reasoningContent.length === 0) {
          return "";
        }

        return (
          '<details class="reasoning-panel">' +
            '<summary class="reasoning-summary" title="Model reasoning captured for this message. Expand it to inspect the chain-of-thought style output.">' +
              '<span aria-hidden="true">🧠</span>' +
              '<span>Reasoning</span>' +
              '<span class="reasoning-chevron" aria-hidden="true">▶</span>' +
            '</summary>' +
            '<div class="reasoning-content">' +
              renderMessageStringHtml(reasoningContent) +
            '</div>' +
          '</details>'
        );
      }

      function renderMessageContentHtml(content) {
        if (typeof content === "string") {
          return renderMessageStringHtml(content);
        }

        if (Array.isArray(content)) {
          if (content.length === 0) {
            return '<div class="empty">No message content.</div>';
          }

          return (
            '<div class="message-part-list">' +
              content.map((part, index) => {
                const partType = isClientRecord(part) && typeof part.type === "string"
                  ? part.type
                  : "part " + (index + 1);
                const displayValue =
                  isClientRecord(part) && typeof part.text === "string"
                    ? part.text
                    : prettyJson(part);

                return (
                  '<div class="message-part">' +
                    '<div class="message-part-type">' + escapeClientHtml(partType) + '</div>' +
                    renderMessageStringHtml(displayValue) +
                  '</div>'
                );
              }).join("") +
            '</div>'
          );
        }

        if (content === null) {
          return '<div class="empty">Content is null.</div>';
        }

        if (content === undefined) {
          return '<div class="empty">No message content.</div>';
        }

        return renderDetailBlock("Content", content);
      }

      function renderMessageHtml(message, index, options = {}) {
        const role = typeof message?.role === "string" ? message.role : (options.role ?? "unknown");
        const metaBits = [
          buildMessageRoleBadgeSpec(message, role),
        ];

        if (typeof message?.name === "string" && message.name.length > 0) {
          metaBits.push(badgeSpec("name " + message.name, "warn", "Optional message name field."));
        }

        if (typeof options.finishReason === "string" && options.finishReason.length > 0) {
          metaBits.push(badgeSpec("finish " + options.finishReason, "good", describeFinishReason(options.finishReason)));
        }

        return (
          '<article class="turn ' + escapeClientHtml(role) + '">' +
            '<div class="turn-head">' +
              '<span class="turn-role">' + escapeClientHtml(options.heading ?? ("message " + (index + 1))) + '</span>' +
              '<div class="message-meta">' +
                metaBits.map((bit) => (
                  '<span class="' + escapeClientHtml(bit.className) + '" title="' + escapeClientHtml(bit.title ?? "") + '">' +
                    escapeClientHtml(bit.text) +
                  '</span>'
                )).join("") +
              '</div>' +
            '</div>' +
            renderReasoningHtml(message?.reasoning_content) +
            (hasVisibleMessageContent(message?.content) || !message?.reasoning_content
              ? renderMessageContentHtml(message?.content)
              : '') +
            (typeof message?.refusal === "string" && message.refusal.length > 0
              ? renderDetailBlock("Refusal", message.refusal)
              : '') +
            (message?.function_call ? renderDetailBlock("Function Call", message.function_call) : '') +
            (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0
              ? message.tool_calls.map((toolCall, toolIndex) => renderDetailBlock("Tool Call " + (toolIndex + 1), toolCall)).join("")
              : '') +
            (typeof message?.audio === "object" && message.audio !== null
              ? renderDetailBlock("Audio", message.audio)
              : '') +
          '</article>'
        );
      }

      function renderToolsHtml(tools) {
        if (!Array.isArray(tools) || tools.length === 0) {
          return '<div class="empty">No tools were included in this request.</div>';
        }

        return tools
          .map((tool, index) => renderDetailBlock("Tool " + (index + 1), tool))
          .join("");
      }

      function renderResponseChoicesHtml(responseBody) {
        if (!isClientRecord(responseBody) || !Array.isArray(responseBody.choices) || responseBody.choices.length === 0) {
          return '<div class="empty">No structured response payload was stored for this request.</div>';
        }

        return responseBody.choices
          .map((choice, index) => {
            if (isClientRecord(choice) && isClientRecord(choice.message)) {
              return renderMessageHtml(choice.message, index, {
                heading: "choice " + (index + 1),
                role: typeof choice.message.role === "string" ? choice.message.role : "assistant",
                finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
              });
            }

            if (isClientRecord(choice) && typeof choice.text === "string") {
              return renderDetailBlock("Choice " + (index + 1), {
                finish_reason: choice.finish_reason ?? null,
                text: choice.text,
              });
            }

            return renderDetailBlock("Choice " + (index + 1), choice);
          })
          .join("");
      }

      function collectRequestSettingSpecs(requestBody) {
        if (!isClientRecord(requestBody)) {
          return [];
        }

        return Object.entries(requestBody)
          .filter(([key, value]) => (
            key !== "messages" &&
            key !== "tools" &&
            value !== undefined
          ))
          .map(([key, value]) => inlineSpec(key + " " + formatCompactValue(value), 'Top-level OpenAI request field "' + key + '".'));
      }

      function renderRequestMessagesHtml(detail) {
        const messages = isClientRecord(detail?.requestBody) && Array.isArray(detail.requestBody.messages)
          ? detail.requestBody.messages
          : [];

        if (messages.length === 0) {
          return '<div class="empty">No chat messages were stored for this request.</div>';
        }

        return messages
          .map((message, index) => renderMessageHtml(message, index))
          .join("");
      }

      function renderRequestDetail() {
        if (!(requestDetailOverlay instanceof HTMLElement)) {
          return;
        }

        requestDetailOverlay.hidden = !state.requestDetail.open;

        if (!state.requestDetail.open) {
          return;
        }

        const detail = state.requestDetail.detail;
        const entry = detail?.entry;

        setElementText(requestDetailTitle, entry ? (entry.method + " " + entry.path) : "Request Details");
        setElementText(
          requestDetailSubtitle,
          entry
            ? (
              (detail.live ? "Live request" : "req " + shortId(entry.id)) +
              (entry.model ? " · model " + entry.model : "") +
              (entry.backendName ? " · backend " + entry.backendName : "") +
              " · " + formatDate(entry.time) +
              (detail.live ? " · still running" : "")
            )
            : "Inspect the original request payload, messages, tools, and final response.",
        );

        if (state.requestDetail.loading) {
          requestDetailMessages.innerHTML = '<div class="empty">Loading request details...</div>';
          requestDetailTools.innerHTML = '<div class="empty">Loading tools...</div>';
          requestDetailResponseMessage.innerHTML = '<div class="empty">Loading response details...</div>';
          requestDetailSummary.innerHTML = "";
          requestDetailParams.innerHTML = "";
          setCodeBlockContent(requestDetailRequest, "// loading request details");
          setCodeBlockContent(requestDetailResponse, "// loading response details");
          return;
        }

        if (state.requestDetail.error) {
          requestDetailMessages.innerHTML = '<div class="empty">' + escapeClientHtml(state.requestDetail.error) + '</div>';
          requestDetailTools.innerHTML = '<div class="empty">No tools available.</div>';
          requestDetailResponseMessage.innerHTML = '<div class="empty">No response details available.</div>';
          requestDetailSummary.innerHTML = "";
          requestDetailParams.innerHTML = "";
          setCodeBlockContent(requestDetailRequest, "// request details unavailable");
          setCodeBlockContent(requestDetailResponse, "// response details unavailable");
          return;
        }

        if (!detail || !entry) {
          requestDetailMessages.innerHTML = '<div class="empty">No request details available.</div>';
          requestDetailTools.innerHTML = '<div class="empty">No tools available.</div>';
          requestDetailResponseMessage.innerHTML = '<div class="empty">No response details available.</div>';
          requestDetailSummary.innerHTML = "";
          requestDetailParams.innerHTML = "";
          setCodeBlockContent(requestDetailRequest, "// request details unavailable");
          setCodeBlockContent(requestDetailResponse, "// response details unavailable");
          return;
        }

          syncInlineElements(requestDetailSummary, [
            inlineSpec("Latency " + formatDuration(entry.latencyMs), "End-to-end request latency recorded for this request."),
            inlineSpec("Queue " + formatDuration(entry.queuedMs), "Time this request waited for a free backend slot before dispatch."),
            ...(detail.live ? [inlineSpec("live", "This request is still active. Response details may still be incomplete.")] : []),
            ...(entry.statusCode ? [inlineSpec("HTTP " + entry.statusCode, "HTTP status returned to the client.")] : []),
            ...(entry.finishReason ? [inlineSpec("finish " + entry.finishReason, describeFinishReason(entry.finishReason))] : []),
          ]);

        const requestSettingSpecs = collectRequestSettingSpecs(detail.requestBody);
        if (requestSettingSpecs.length > 0) {
          syncInlineElements(requestDetailParams, requestSettingSpecs);
        } else {
          requestDetailParams.innerHTML = '<div class="empty">No additional top-level request fields were stored.</div>';
        }

        requestDetailMessages.innerHTML = renderRequestMessagesHtml(detail);
        requestDetailTools.innerHTML = renderToolsHtml(isClientRecord(detail.requestBody) ? detail.requestBody.tools : undefined);
        requestDetailResponseMessage.innerHTML = renderResponseChoicesHtml(detail.responseBody);
        setCodeBlockContent(
          requestDetailRequest,
          detail.requestBody !== undefined
            ? detail.requestBody
            : "// no stored request body",
        );
        setCodeBlockContent(
          requestDetailResponse,
          detail.responseBody !== undefined
            ? detail.responseBody
            : "// no stored response body",
        );
      }

      function closeRequestDetail() {
        state.requestDetail.open = false;
        state.requestDetail.loading = false;
        state.requestDetail.requestId = "";
        state.requestDetail.error = "";
        renderRequestDetail();
      }

      function isActiveRequestId(requestId) {
        return state.snapshot.activeConnections.some((connection) => connection.id === requestId);
      }

      async function openRequestDetail(requestId) {
        if (!requestId) {
          return;
        }

        state.requestDetail.open = true;
        state.requestDetail.requestId = requestId;
        state.requestDetail.error = "";
        const useCache = !isActiveRequestId(requestId) && Boolean(state.requestDetail.cache[requestId]);

        if (useCache) {
          state.requestDetail.detail = state.requestDetail.cache[requestId];
          state.requestDetail.loading = false;
          renderRequestDetail();
          return;
        }

        state.requestDetail.detail = null;
        state.requestDetail.loading = true;
        renderRequestDetail();

        try {
          const response = await fetch("/api/requests/" + encodeURIComponent(requestId));

          if (!response.ok) {
            throw new Error(await readErrorResponse(response));
          }

          const detail = await response.json();

          if (state.requestDetail.requestId !== requestId) {
            return;
          }

          if (!detail?.live) {
            state.requestDetail.cache[requestId] = detail;
          }
          state.requestDetail.detail = detail;
          state.requestDetail.loading = false;
          renderRequestDetail();
        } catch (error) {
          if (state.requestDetail.requestId !== requestId) {
            return;
          }

          state.requestDetail.loading = false;
          state.requestDetail.error = error instanceof Error ? error.message : String(error);
          renderRequestDetail();
        }
      }

      function syncInlineElements(container, items) {
        const specs = items.map((item) => (
          typeof item === "string"
            ? { text: item, className: "", tagName: "span", title: "" }
            : {
                text: item.text ?? "",
                className: item.className ?? "",
                tagName: item.tagName ?? "span",
                title: item.title ?? "",
              }
        ));

        for (let index = 0; index < specs.length; index += 1) {
          const spec = specs[index];
          const expectedTagName = spec.tagName.toUpperCase();
          let child = container.children[index];

          if (!(child instanceof HTMLElement) || child.tagName !== expectedTagName) {
            const nextChild = document.createElement(spec.tagName);
            if (child) {
              container.insertBefore(nextChild, child);
            } else {
              container.appendChild(nextChild);
            }

            child = nextChild;
          }

          setElementClass(child, spec.className);
          setElementText(child, spec.text);
          setElementTooltip(child, spec.title);
        }

        while (container.children.length > specs.length) {
          container.lastElementChild?.remove();
        }
      }

      function removeEmptyState(container) {
        const emptyState = container.querySelector('[data-empty-state="true"]');
        if (emptyState instanceof HTMLElement) {
          emptyState.remove();
        }
      }

      function setEmptyState(container, message) {
        for (const child of Array.from(container.children)) {
          if (child instanceof HTMLElement && child.dataset.key) {
            child.remove();
          }
        }

        let emptyState = container.querySelector('[data-empty-state="true"]');
        if (!(emptyState instanceof HTMLElement)) {
          emptyState = document.createElement("div");
          emptyState.dataset.emptyState = "true";
          emptyState.className = "empty";
          container.appendChild(emptyState);
        }

        setElementText(emptyState, message);
      }

      function syncKeyedChildren(container, items, getKey, createElement, updateElement, emptyMessage) {
        const existing = new Map();

        for (const child of Array.from(container.children)) {
          if (child instanceof HTMLElement && child.dataset.key) {
            existing.set(child.dataset.key, child);
          }
        }

        if (items.length === 0) {
          if (emptyMessage) {
            setEmptyState(container, emptyMessage);
          } else {
            removeEmptyState(container);
            for (const child of existing.values()) {
              child.remove();
            }
          }
          return;
        }

        removeEmptyState(container);

        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const key = String(getKey(item, index));
          let child = existing.get(key);

          if (!(child instanceof HTMLElement)) {
            child = createElement(item, index);
            child.dataset.key = key;
          }

          updateElement(child, item, index);

          const anchor = container.children[index];
          if (anchor !== child) {
            container.insertBefore(child, anchor ?? null);
          }

          existing.delete(key);
        }

        for (const child of existing.values()) {
          child.remove();
        }
      }

      function badgeSpec(text, tone, title = "", extraClass = "") {
        return {
          text,
          className: "badge " + tone + (extraClass ? " " + extraClass : ""),
          title,
        };
      }

      function getSummaryCardParts(card) {
        if (!card._parts) {
          const label = document.createElement("div");
          label.className = "card-label";
          const value = document.createElement("div");
          value.className = "card-value";
          const note = document.createElement("div");
          note.className = "card-note";
          card.append(label, value, note);
          card._parts = { label, value, note };
        }

        return card._parts;
      }

      function renderSummaryCards(cards) {
        syncKeyedChildren(
          summaryGrid,
          cards,
          (card) => card.key,
          () => {
            const article = document.createElement("article");
            article.className = "card";
            return article;
          },
          (article, card) => {
            const parts = getSummaryCardParts(article);
            setElementClass(article, "card");
            setElementTooltip(article, card.title);
            setElementText(parts.label, card.label);
            setElementText(parts.value, card.value);
            setElementText(parts.note, card.note);
          },
        );
      }

      function getRequestItemParts(article) {
        if (!article._parts) {
          const top = document.createElement("div");
          top.className = "request-top";
          const left = document.createElement("div");
          left.className = "request-head";
          const path = document.createElement("div");
          path.className = "request-path";
          const primaryMeta = document.createElement("div");
          primaryMeta.className = "request-meta";
          left.append(path, primaryMeta);
          const badges = document.createElement("div");
          badges.className = "request-badges";
          top.append(left, badges);
          const metrics = document.createElement("div");
          metrics.className = "request-metrics";
          const error = document.createElement("div");
          error.className = "request-error";
          article.append(top, metrics, error);
          article._parts = { path, primaryMeta, badges, metrics, error };
        }

        return article._parts;
      }

      function getRecentRequestParts(article) {
        if (!article._parts) {
          const top = document.createElement("div");
          top.className = "request-top";
          const left = document.createElement("div");
          left.className = "request-head";
          const path = document.createElement("div");
          path.className = "request-path";
          const primaryMeta = document.createElement("div");
          primaryMeta.className = "request-meta";
          left.append(path, primaryMeta);
          const outcome = document.createElement("div");
          outcome.className = "request-badges";
          top.append(left, outcome);
          const details = document.createElement("div");
          details.className = "request-metrics";
          article.append(top, details);
          article._parts = { path, primaryMeta, outcome, details };
        }

        return article._parts;
      }

      function getBackendRowParts(row) {
        if (!row._parts) {
          row.className = "backend-row";
          const nameCell = document.createElement("td");
          const backendName = document.createElement("div");
          backendName.className = "backend-name";
          const baseUrl = document.createElement("div");
          baseUrl.className = "backend-url mono";
          const lastCheck = document.createElement("div");
          lastCheck.className = "hint";
          nameCell.append(backendName, baseUrl, lastCheck);

          const statusCell = document.createElement("td");
          const status = document.createElement("div");
          statusCell.appendChild(status);

          const loadCell = document.createElement("td");
          const loadValue = document.createElement("div");
          loadValue.className = "backend-metric-strong";
          const available = document.createElement("div");
          available.className = "hint";
          loadCell.append(loadValue, available);

          const modelsCell = document.createElement("td");
          const models = document.createElement("div");
          modelsCell.appendChild(models);

          const metricsCell = document.createElement("td");
          const avgLatency = document.createElement("div");
          avgLatency.className = "backend-metric-strong";
          const lastLatency = document.createElement("div");
          lastLatency.className = "backend-metric";
          const totals = document.createElement("div");
          totals.className = "hint";
          metricsCell.append(avgLatency, lastLatency, totals);

          const errorCell = document.createElement("td");
          const error = document.createElement("span");
          error.className = "backend-error";
          errorCell.appendChild(error);

          const controlsCell = document.createElement("td");
          const controls = document.createElement("div");
          controls.className = "table-actions";
          const enabledLabel = document.createElement("label");
          const enabledInput = document.createElement("input");
          enabledInput.type = "checkbox";
          enabledLabel.append(enabledInput, document.createTextNode(" enabled"));
          const maxConcurrencyInput = document.createElement("input");
          maxConcurrencyInput.type = "number";
          maxConcurrencyInput.min = "1";
          maxConcurrencyInput.step = "1";
          const saveButton = document.createElement("button");
          saveButton.className = "button";
          saveButton.type = "button";
          saveButton.textContent = "Save";
          controls.append(enabledLabel, maxConcurrencyInput, saveButton);
          controlsCell.appendChild(controls);

          row.append(nameCell, statusCell, loadCell, modelsCell, metricsCell, errorCell, controlsCell);
          row._parts = {
            backendName,
            baseUrl,
            lastCheck,
            status,
            loadValue,
            available,
            models,
            avgLatency,
            lastLatency,
            totals,
            error,
            enabledInput,
            maxConcurrencyInput,
            saveButton,
          };
        }

        return row._parts;
      }

      function buildConnectionPrimaryMeta(connection) {
        const parts = [
          inlineSpec("req " + shortId(connection.id), "Short request id for correlating live dashboard entries and logs.", "mono"),
          inlineSpec(connection.kind, "OpenAI-compatible route type currently being processed by the proxy."),
        ];

        if (connection.model) {
          parts.push(inlineSpec("model " + connection.model, "Requested model used for backend selection."));
        }

        if (connection.backendName) {
          parts.push(inlineSpec("backend " + connection.backendName, "Backend currently serving this request."));
        }

        parts.push(inlineSpec("elapsed " + formatDuration(connection.elapsedMs), "Time since llmproxy received this request."));
        parts.push(inlineSpec("queue " + formatDuration(connection.queueMs), "Time this request waited for a free backend slot before dispatch."));

        if (connection.statusCode) {
          parts.push(inlineSpec("HTTP " + connection.statusCode, "HTTP status returned by the proxy or observed from upstream."));
        }

        return parts;
      }

      function buildConnectionBadges(connection) {
        const parts = [
          connection.phase === "queued"
            ? badgeSpec("queue", "warn", "This request is waiting for an available backend slot.")
            : (connection.phase === "streaming"
              ? badgeSpec("streaming", "good", "The backend is actively streaming generation output.")
              : badgeSpec("connected", "good", "The request is assigned to a backend but no output stream is active yet.")),
          connection.clientStream
            ? badgeSpec("client stream", "good", "The client requested a streaming response from llmproxy.")
            : badgeSpec("client json", "warn", "The client requested a buffered JSON response instead of streaming."),
          connection.upstreamStream
            ? badgeSpec("upstream sse", "good", "llmproxy uses upstream streaming here to collect live metrics in real time.")
            : badgeSpec("upstream passthrough", "warn", "This request is forwarded upstream without streaming instrumentation."),
        ];

        if (connection.completionTokens !== undefined || connection.promptTokens !== undefined) {
          parts.push(
            connection.metricsExact
              ? badgeSpec("exact", "good", "These are final exact usage/timing values reported by the backend.")
              : badgeSpec("live", "warn", "These values are still live in-flight estimates and may change until the request finishes."),
          );
        }

        return parts;
      }

      function buildRecentRequestKey(entry) {
        return [
          entry.time ?? "time",
          entry.method ?? "method",
          entry.path ?? "path",
          entry.backendName ?? "backend",
          entry.outcome ?? "outcome",
          entry.statusCode ?? "status",
          entry.model ?? "model",
          entry.latencyMs ?? "latency",
          entry.queuedMs ?? "queued",
          entry.error ?? "error",
        ].join(":");
      }

      function renderModelList(container, configuredModels, discoveredModels) {
        const all = [...new Set([...(configuredModels ?? []), ...(discoveredModels ?? [])])];

        if (all.length === 0) {
          setElementClass(container, "");
          syncInlineElements(container, [{ text: "No model list available", className: "empty" }]);
          return;
        }

        setElementClass(container, "models");
        syncInlineElements(container, all.map((model) => ({
          text: model,
          className: "chip",
        })));
      }

      function outcomeBadge(outcome) {
        if (outcome === "success") {
          return '<span class="badge good">ok</span>';
        }

        if (outcome === "queued_timeout") {
          return '<span class="badge warn">queue timeout</span>';
        }

        if (outcome === "cancelled") {
          return '<span class="badge warn">cancelled</span>';
        }

        return '<span class="badge bad">error</span>';
      }

      function connectionPhaseBadge(connection) {
        if (connection.phase === "queued") {
          return '<span class="badge warn">queue</span>';
        }

        if (connection.phase === "streaming") {
          return '<span class="badge good">streaming</span>';
        }

        return '<span class="badge good">connected</span>';
      }

      function connectionMetricBadge(connection) {
        if (connection.completionTokens === undefined && connection.promptTokens === undefined) {
          return "";
        }

        return connection.metricsExact
          ? '<span class="badge good">exact</span>'
          : '<span class="badge warn">live</span>';
      }

      function formatActiveConnectionMetrics(connection) {
        const parts = [];

        if (typeof connection.promptTokens === "number") {
          parts.push(inlineSpec(connection.promptTokens + " prompt", "Number of prompt or input tokens evaluated before generation started."));
        }

        if (typeof connection.completionTokens === "number") {
          parts.push(
            inlineSpec(
              connection.completionTokens + (connection.metricsExact ? " completion" : " live tok"),
              connection.metricsExact
                ? "Final output token count reported by the backend."
                : "Live in-flight output token counter observed during streaming before final usage arrives.",
            ),
          );
        }

        if (typeof connection.totalTokens === "number") {
          parts.push(inlineSpec(connection.totalTokens + " total", "Total tokens for this request: prompt plus completion."));
        }

        const split = [];
        if (connection.contentTokens > 0) {
          split.push(connection.contentTokens + " content");
        }

        if (connection.reasoningTokens > 0) {
          split.push(connection.reasoningTokens + " reasoning");
        }

        if (connection.textTokens > 0) {
          split.push(connection.textTokens + " text");
        }

        if (split.length > 0) {
          parts.push(
            inlineSpec(
              split.join(" + "),
              "Breakdown of generated output by stream field: content is normal assistant text, reasoning is thinking/reasoning output, and text is legacy completion text.",
            ),
          );
        }

        const completionRate = formatTokenRate(connection.completionTokensPerSecond);
        if (completionRate) {
          parts.push(inlineSpec(completionRate, "Generation speed in output tokens per second."));
        }

        const promptRate = formatTokenRate(connection.promptTokensPerSecond);
        if (promptRate) {
          parts.push(inlineSpec("prompt " + promptRate, "Prompt evaluation speed in input tokens per second."));
        }

        if (typeof connection.timeToFirstTokenMs === "number") {
          parts.push(inlineSpec("ttfb " + formatDuration(connection.timeToFirstTokenMs), "Time to first generated token after llmproxy received the request."));
        }

        if (typeof connection.generationMs === "number") {
          parts.push(inlineSpec("gen " + formatDuration(connection.generationMs), "Time spent generating output tokens. During a live stream this may still be growing."));
        }

        if (typeof connection.promptMs === "number") {
          parts.push(inlineSpec("prompt " + formatDuration(connection.promptMs), "Time spent evaluating the prompt before output generation."));
        }

        if (connection.finishReason) {
          parts.push(inlineSpec("finish " + connection.finishReason, describeFinishReason(connection.finishReason)));
        }

        return parts;
      }

      function formatRecentRequestMetrics(entry) {
        const parts = [];

        if (typeof entry.promptTokens === "number") {
          parts.push(inlineSpec(entry.promptTokens + " prompt", "Number of prompt or input tokens evaluated before generation started."));
        }

        if (typeof entry.completionTokens === "number") {
          parts.push(
            inlineSpec(
              entry.completionTokens + (entry.metricsExact ? " completion" : " live tok"),
              entry.metricsExact
                ? "Final output token count reported by the backend."
                : "Live in-flight output token counter observed during streaming before final usage arrived.",
            ),
          );
        }

        if (typeof entry.totalTokens === "number") {
          parts.push(inlineSpec(entry.totalTokens + " total", "Total tokens for this request: prompt plus completion."));
        }

        const split = [];
        if ((entry.contentTokens ?? 0) > 0) {
          split.push(entry.contentTokens + " content");
        }

        if ((entry.reasoningTokens ?? 0) > 0) {
          split.push(entry.reasoningTokens + " reasoning");
        }

        if ((entry.textTokens ?? 0) > 0) {
          split.push(entry.textTokens + " text");
        }

        if (split.length > 0) {
          parts.push(
            inlineSpec(
              split.join(" + "),
              "Breakdown of generated output by stream field: content is normal assistant text, reasoning is thinking/reasoning output, and text is legacy completion text.",
            ),
          );
        }

        const completionRate = formatTokenRate(entry.completionTokensPerSecond);
        if (completionRate) {
          parts.push(inlineSpec(completionRate, "Generation speed in output tokens per second."));
        }

        const promptRate = formatTokenRate(entry.promptTokensPerSecond);
        if (promptRate) {
          parts.push(inlineSpec("prompt " + promptRate, "Prompt evaluation speed in input tokens per second."));
        }

        if (typeof entry.timeToFirstTokenMs === "number") {
          parts.push(inlineSpec("ttfb " + formatDuration(entry.timeToFirstTokenMs), "Time to first generated token after llmproxy received the request."));
        }

        if (typeof entry.generationMs === "number") {
          parts.push(inlineSpec("gen " + formatDuration(entry.generationMs), "Time spent generating output tokens for this completed request."));
        }

        if (typeof entry.promptMs === "number") {
          parts.push(inlineSpec("prompt " + formatDuration(entry.promptMs), "Time spent evaluating the prompt before output generation."));
        }

        if (entry.finishReason) {
          parts.push(inlineSpec("finish " + entry.finishReason, describeFinishReason(entry.finishReason)));
        }

        return parts;
      }

      function renderActiveConnections(snapshot) {
        syncKeyedChildren(
          activeConnections,
          snapshot.activeConnections,
          (connection) => connection.id,
          () => {
            const article = document.createElement("article");
            article.className = "request-item";
            return article;
          },
          (article, connection) => {
            const parts = getRequestItemParts(article);
            const metrics = formatActiveConnectionMetrics(connection);
            article.dataset.requestId = connection.hasDetail ? connection.id : "";
            article.tabIndex = connection.hasDetail ? 0 : -1;
            article.setAttribute("role", connection.hasDetail ? "button" : "article");
            article.classList.toggle("interactive", Boolean(connection.hasDetail));
            setElementTooltip(
              article,
              connection.hasDetail
                ? "Open live request details, including chat history, tools, request parameters, and partial response data."
                : "",
            );

            setElementText(parts.path, connection.method + " " + connection.path);
            syncInlineElements(parts.primaryMeta, buildConnectionPrimaryMeta(connection));
            syncInlineElements(
              parts.badges,
              connection.hasDetail
                ? [...buildConnectionBadges(connection), badgeSpec("live details", "good", "Click to inspect the running request, including its chat history and current partial response.")]
                : buildConnectionBadges(connection),
            );
            syncInlineElements(
              parts.metrics,
              metrics.length > 0
                ? metrics
                : [{ text: "No token metrics available yet.", className: "hint" }],
            );
            syncInlineElements(parts.error, connection.error ? [badgeSpec(connection.error, "bad")] : []);
          },
          "There are no active connections right now.",
        );
      }

      function statusBadge(backend) {
        if (!backend.enabled) {
          return '<span class="badge warn">disabled</span>';
        }

        if (backend.healthy) {
          return '<span class="badge good">healthy</span>';
        }

        return '<span class="badge bad">unhealthy</span>';
      }

      function renderBackends(backends) {
        syncKeyedChildren(
          backendTableBody,
          backends,
          (backend) => backend.id,
          () => document.createElement("tr"),
          (row, backend) => {
            const parts = getBackendRowParts(row);
            setElementText(parts.backendName, backend.name);
            setElementText(parts.baseUrl, backend.baseUrl);
            setElementText(parts.lastCheck, "Last check: " + formatDate(backend.lastCheckedAt));
            setElementTooltip(parts.lastCheck, "Timestamp of the most recent health check run for this backend.");
            syncInlineElements(parts.status, [
              !backend.enabled
                ? badgeSpec("disabled", "warn", "This backend is disabled and will not receive routed traffic.")
                : (backend.healthy
                  ? badgeSpec("healthy", "good", "This enabled backend passed its most recent health check.")
                  : badgeSpec("unhealthy", "bad", "This enabled backend failed its most recent health check and is skipped for routing.")),
            ]);
            setElementText(parts.loadValue, backend.activeRequests + " / " + backend.maxConcurrency);
            setElementText(parts.available, "available: " + backend.availableSlots);
            setElementTooltip(parts.loadValue, "Current backend load: active requests versus configured max concurrency.");
            setElementTooltip(parts.available, "Routing slots still free on this backend before new requests must wait.");
            renderModelList(parts.models, backend.configuredModels, backend.discoveredModels);
            setElementText(parts.avgLatency, "avg " + formatDuration(backend.avgLatencyMs));
            setElementText(parts.lastLatency, "last " + formatDuration(backend.lastLatencyMs));
            setElementTooltip(parts.avgLatency, "Rolling average latency observed for requests served by this backend.");
            setElementTooltip(parts.lastLatency, "Latency of the most recent completed request served by this backend.");
            setElementText(
              parts.totals,
              backend.successfulRequests + " ok / " + backend.failedRequests + " fail / " + backend.cancelledRequests + " cancel",
            );
            setElementTooltip(parts.totals, "Cumulative backend outcomes observed since this llmproxy process started.");

            if (backend.lastError) {
              setElementClass(parts.error, "mono");
              setElementText(parts.error, backend.lastError);
              setElementTooltip(parts.error, "Most recent backend error captured by llmproxy for this backend.");
            } else {
              setElementClass(parts.error, "empty");
              setElementText(parts.error, "No error");
              setElementTooltip(parts.error, "No backend error has been captured for this backend in the current process.");
            }

            parts.enabledInput.dataset.enabled = backend.id;
            parts.maxConcurrencyInput.dataset.maxConcurrency = backend.id;
            parts.saveButton.dataset.save = backend.id;

            if (parts.enabledInput.dataset.dirty !== "true") {
              parts.enabledInput.checked = backend.enabled;
            }

            if (parts.maxConcurrencyInput.dataset.dirty !== "true" && document.activeElement !== parts.maxConcurrencyInput) {
              parts.maxConcurrencyInput.value = String(backend.maxConcurrency);
            }
          },
        );
      }

      function renderRecentRequests(entries) {
        syncKeyedChildren(
          recentRequests,
          entries,
          (entry, index) => buildRecentRequestKey(entry, index),
          () => {
            const article = document.createElement("article");
            article.className = "request-item";
            return article;
          },
          (article, entry) => {
            const parts = getRecentRequestParts(article);
            article.dataset.requestId = entry.hasDetail ? entry.id : "";
            article.tabIndex = entry.hasDetail ? 0 : -1;
            article.setAttribute("role", entry.hasDetail ? "button" : "article");
            article.classList.toggle("interactive", Boolean(entry.hasDetail));
            setElementTooltip(
              article,
              entry.hasDetail
                ? "Open full request details, conversation history, tools, and stored response."
                : "",
            );
            setElementText(parts.path, entry.method + " " + entry.path);

            const primaryMeta = [];
            if (entry.model) {
              primaryMeta.push(inlineSpec("model " + entry.model, "Requested model used for backend selection."));
            }
            if (entry.backendName) {
              primaryMeta.push(inlineSpec("backend " + entry.backendName, "Backend that served this request."));
            }
            primaryMeta.push(inlineSpec(formatDate(entry.time), "Time when this request finished and was added to recent history."));
            syncInlineElements(parts.primaryMeta, primaryMeta);

            const outcome =
              entry.outcome === "success"
                ? badgeSpec("ok", "good", "The request completed successfully.")
                : (entry.outcome === "queued_timeout"
                  ? badgeSpec("queue timeout", "warn", "The request waited too long for a free backend slot and timed out in the queue.")
                  : (entry.outcome === "cancelled"
                    ? badgeSpec("cancelled", "warn", "The request was cancelled before successful completion.")
                    : badgeSpec("error", "bad", "The request ended with an upstream or proxy error.")));
            syncInlineElements(
              parts.outcome,
              entry.hasDetail
                ? [outcome, badgeSpec("details", "good", "Click to inspect messages, tools, request parameters, and stored response JSON.")]
                : [outcome],
            );

            const details = [
              inlineSpec("Latency " + formatDuration(entry.latencyMs), "End-to-end request latency as observed by llmproxy."),
              inlineSpec("Queue " + formatDuration(entry.queuedMs), "Time this request spent waiting for a free backend slot before dispatch."),
            ];

            if (entry.statusCode) {
              details.push(inlineSpec("HTTP " + entry.statusCode, "HTTP status returned to the client for this request."));
            }

            if (entry.error) {
              details.push(inlineSpec(entry.error, "Error message captured for this request."));
            }

            const metrics = formatRecentRequestMetrics(entry);
            for (const metric of metrics) {
              details.push(metric);
            }

            syncInlineElements(parts.details, details);
          },
          "No requests seen yet.",
        );
      }

      async function saveBackend(backendId) {
        const maxConcurrencyInput = document.querySelector('[data-max-concurrency="' + backendId + '"]');
        const enabledInput = document.querySelector('[data-enabled="' + backendId + '"]');
        const trigger = document.querySelector('[data-save="' + backendId + '"]');

        if (!(maxConcurrencyInput instanceof HTMLInputElement) ||
          !(enabledInput instanceof HTMLInputElement) ||
          !(trigger instanceof HTMLButtonElement)) {
          return;
        }

        trigger.disabled = true;

        try {
          const response = await fetch("/api/backends/" + encodeURIComponent(backendId), {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              enabled: enabledInput.checked,
              maxConcurrency: Number(maxConcurrencyInput.value),
            }),
          });

          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error?.error?.message ?? "Backend could not be updated.");
          }

          delete enabledInput.dataset.dirty;
          delete maxConcurrencyInput.dataset.dirty;
        } catch (error) {
          alert(error instanceof Error ? error.message : String(error));
        } finally {
          trigger.disabled = false;
        }
      }

      backendTableBody.addEventListener("input", (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.dataset.maxConcurrency) {
          target.dataset.dirty = "true";
        }
      });

      backendTableBody.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.dataset.enabled) {
          target.dataset.dirty = "true";
        }
      });

      backendTableBody.addEventListener("click", (event) => {
        const target = event.target;

        if (!(target instanceof HTMLElement)) {
          return;
        }

        const backendId = target.dataset.save;
        if (backendId) {
          void saveBackend(backendId);
        }
      });

      recentRequests.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        const article = target.closest('.request-item.interactive[data-request-id]');
        if (!(article instanceof HTMLElement) || !article.dataset.requestId) {
          return;
        }

        if (target.closest("button, a, input, textarea, select, label")) {
          return;
        }

        void openRequestDetail(article.dataset.requestId);
      });

      activeConnections.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        const article = target.closest('.request-item.interactive[data-request-id]');
        if (!(article instanceof HTMLElement) || !article.dataset.requestId) {
          return;
        }

        if (target.closest("button, a, input, textarea, select, label")) {
          return;
        }

        void openRequestDetail(article.dataset.requestId);
      });

      recentRequests.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.classList.contains("interactive") || !target.dataset.requestId) {
          return;
        }

        event.preventDefault();
        void openRequestDetail(target.dataset.requestId);
      });

      activeConnections.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.classList.contains("interactive") || !target.dataset.requestId) {
          return;
        }

        event.preventDefault();
        void openRequestDetail(target.dataset.requestId);
      });

      requestDetailClose?.addEventListener("click", () => {
        closeRequestDetail();
      });

      requestDetailOverlay?.addEventListener("click", (event) => {
        if (event.target === requestDetailOverlay) {
          closeRequestDetail();
        }
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && state.requestDetail.open) {
          closeRequestDetail();
        }
      });

      debugRefreshModels.addEventListener("click", () => {
        void loadModels(true);
      });

      debugClearChat.addEventListener("click", () => {
        stopDebugMetricsTicker();
        state.debug.transcript = [];
        state.debug.error = "";
        state.debug.usage = "";
        state.debug.backend = "";
        state.debug.status = "";
        state.debug.rawRequest = "";
        state.debug.rawResponse = "";
        resetDebugMetrics();
        renderDebug();
      });

      debugSendChat.addEventListener("click", () => {
        void sendDebugChat();
      });

      debugStopChat.addEventListener("click", () => {
        state.debug.abortController?.abort(new Error("Request cancelled from dashboard."));
      });

      function collectSnapshotModels(snapshot) {
        const models = new Map();

        for (const backend of snapshot.backends) {
          const combined = [...(backend.configuredModels ?? []), ...(backend.discoveredModels ?? [])];

          for (const model of combined) {
            if (!model || model.includes("*")) {
              continue;
            }

            models.set(model, {
              id: model,
              ownedBy: backend.name,
            });
          }
        }

        return Array.from(models.values());
      }

      function mergeModels(nextModels) {
        const merged = new Map();

        for (const model of state.models) {
          merged.set(model.id, model);
        }

        for (const model of nextModels) {
          merged.set(model.id, model);
        }

        state.models = Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));

        if (!state.debug.model && state.models.length > 0) {
          state.debug.model = state.models[0].id;
        }
      }

      async function loadModels(force) {
        if (!force && state.models.length > 0) {
          return;
        }

        try {
          const response = await fetch("/v1/models", {
            headers: {},
          });

          if (!response.ok) {
            throw new Error("Could not load models.");
          }

          const payload = await response.json();
          const models = Array.isArray(payload.data)
            ? payload.data
                .filter((entry) => entry && typeof entry.id === "string")
                .map((entry) => ({
                  id: entry.id,
                  ownedBy: typeof entry.owned_by === "string" ? entry.owned_by : "proxy",
                }))
            : [];

          mergeModels(models);
          renderDebug();
        } catch (error) {
          state.debug.error = error instanceof Error ? error.message : String(error);
          renderDebug();
        }
      }

      function renderDebugModelOptions() {
        if (state.models.length === 0) {
          debugModel.innerHTML = '<option value="">No models found</option>';
          debugModel.value = "";
          return;
        }

        debugModel.innerHTML = state.models
          .map((model) => '<option value="' + escapeClientHtml(model.id) + '">' + escapeClientHtml(model.id + " - " + model.ownedBy) + "</option>")
          .join("");

        if (!state.debug.model || !state.models.some((model) => model.id === state.debug.model)) {
          state.debug.model = state.models[0].id;
        }

        debugModel.value = state.debug.model;
      }

      function renderDebugTranscript() {
        if (state.debug.transcript.length === 0) {
          debugTranscript.innerHTML = '<div class="empty">No chat yet. Send your first debug request below.</div>';
          return;
        }

        debugTranscript.innerHTML = state.debug.transcript.map((entry) => (
          '<article class="turn ' + escapeClientHtml(entry.role) + '">' +
            '<div class="turn-head">' +
              '<span class="turn-role">' + escapeClientHtml(entry.role) + '</span>' +
              (entry.backend ? '<span class="badge good">' + escapeClientHtml(entry.backend) + '</span>' : '') +
            '</div>' +
            renderCodeBlockHtml(entry.content || "", "turn-content") +
            (entry.reasoningContent
              ? '<div class="reasoning"><strong>Reasoning</strong>' + renderCodeBlockHtml(entry.reasoningContent, "turn-content") + '</div>'
              : '') +
          '</article>'
        )).join("");
      }

      function renderDebugMeta() {
        const bits = [];

        if (state.debug.sending) {
          bits.push('<span class="badge warn">running</span>');
        }

        if (state.debug.status) {
          bits.push('<span class="badge good">' + escapeClientHtml(state.debug.status) + '</span>');
        }

        if (state.debug.backend) {
          bits.push('<span class="badge good">Backend ' + escapeClientHtml(state.debug.backend) + '</span>');
        }

        const liveUsage = formatLiveUsage();
        if (liveUsage) {
          bits.push('<span class="hint">' + escapeClientHtml(liveUsage) + '</span>');
        }

        if (state.debug.usage) {
          bits.push('<span class="hint">' + escapeClientHtml(state.debug.usage) + '</span>');
        }

        if (state.debug.error) {
          bits.push('<span class="badge bad">' + escapeClientHtml(state.debug.error) + '</span>');
        }

        if (bits.length === 0) {
          bits.push('<span class="hint">Send debug requests to /v1/chat/completions here and inspect responses, live tokens, sampler parameters, and routing.</span>');
        }

        debugMeta.innerHTML = bits.join(" ");
      }

      function renderDebug() {
        renderDebugModelOptions();
        renderDebugTranscript();
        renderDebugMeta();
        setCodeBlockContent(debugRequest, state.debug.rawRequest || "// request appears here");
        setCodeBlockContent(debugResponse, state.debug.rawResponse || "// response appears here");
        debugSendChat.disabled = state.debug.sending;
        debugStopChat.disabled = !state.debug.sending;
      }

      function formatUsage(usage, timings, finishReason) {
        const parts = [];
        const promptTokens = typeof usage?.prompt_tokens === "number"
          ? usage.prompt_tokens
          : (typeof timings?.prompt_n === "number" ? timings.prompt_n : null);
        const completionTokens = typeof usage?.completion_tokens === "number"
          ? usage.completion_tokens
          : (typeof timings?.predicted_n === "number" ? timings.predicted_n : null);
        const totalTokens = typeof usage?.total_tokens === "number"
          ? usage.total_tokens
          : (typeof promptTokens === "number" && typeof completionTokens === "number"
            ? promptTokens + completionTokens
            : null);

        if (finishReason) {
          parts.push("finish " + finishReason);
        }

        if (typeof promptTokens === "number") {
          parts.push(promptTokens + " prompt");
        }

        if (typeof completionTokens === "number") {
          parts.push(completionTokens + " completion");
        }

        if (typeof totalTokens === "number") {
          parts.push(totalTokens + " total");
        }

        if (timings && typeof timings.predicted_ms === "number") {
          parts.push("gen " + Math.round(timings.predicted_ms) + "ms");
        }

        if (timings && typeof timings.prompt_ms === "number") {
          parts.push("prompt " + Math.round(timings.prompt_ms) + "ms");
        }

        const completionRate = formatTokenRate(timings?.predicted_per_second);
        if (completionRate) {
          parts.push(completionRate);
        }

        return parts.join(" | ");
      }

      async function readErrorResponse(response) {
        const text = await response.text();

        try {
          const payload = JSON.parse(text);
          if (payload?.error?.message) {
            return payload.error.message;
          }
        } catch {
          return text || ("HTTP " + response.status);
        }

        return text || ("HTTP " + response.status);
      }

      function applyNonStreamingResponse(payload, assistantTurn) {
        const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
        const message = choice?.message;

        assistantTurn.content = typeof message?.content === "string" ? message.content : "";
        assistantTurn.reasoningContent = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
        assistantTurn.backend = state.debug.backend;
        applyUsageMetrics(payload.usage, payload.timings, choice?.finish_reason);
        state.debug.usage = formatUsage(payload.usage, payload.timings, choice?.finish_reason);
        state.debug.rawResponse = JSON.stringify(payload, null, 2);
      }

      function applyStreamingPayload(payload, assistantTurn) {
        const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
        const delta = choice?.delta ?? choice?.message ?? {};

        if (typeof delta.content === "string") {
          assistantTurn.content += delta.content;
        }

        if (typeof delta.reasoning_content === "string") {
          assistantTurn.reasoningContent = (assistantTurn.reasoningContent ?? "") + delta.reasoning_content;
        }

        assistantTurn.backend = state.debug.backend;
        noteStreamingTokenActivity(delta);
        applyUsageMetrics(payload.usage, payload.timings, choice?.finish_reason);
        state.debug.usage = formatUsage(payload.usage, payload.timings, choice?.finish_reason);
      }

      function processStreamBlock(block, rawEvents, assistantTurn) {
        const dataLines = block
          .split(/\\r?\\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());

        if (dataLines.length === 0) {
          return;
        }

        const payloadText = dataLines.join("\\n");
        if (!payloadText || payloadText === "[DONE]") {
          return;
        }

        rawEvents.push(payloadText);

        try {
          const payload = JSON.parse(payloadText);
          applyStreamingPayload(payload, assistantTurn);
          state.debug.rawResponse = rawEvents.join("\\n\\n");
          renderDebug();
        } catch {
          state.debug.rawResponse = rawEvents.join("\\n\\n");
        }
      }

      function processStreamBuffer(buffer, rawEvents, assistantTurn, flush) {
        let working = buffer;

        while (true) {
          const windowsBreak = working.indexOf("\\r\\n\\r\\n");
          const unixBreak = working.indexOf("\\n\\n");
          let breakIndex = -1;
          let breakLength = 0;

          if (windowsBreak >= 0 && (unixBreak === -1 || windowsBreak < unixBreak)) {
            breakIndex = windowsBreak;
            breakLength = 4;
          } else if (unixBreak >= 0) {
            breakIndex = unixBreak;
            breakLength = 2;
          }

          if (breakIndex === -1) {
            break;
          }

          const block = working.slice(0, breakIndex);
          working = working.slice(breakIndex + breakLength);
          processStreamBlock(block, rawEvents, assistantTurn);
        }

        if (flush && working.trim()) {
          processStreamBlock(working, rawEvents, assistantTurn);
          return "";
        }

        return working;
      }

      async function consumeStreamingResponse(response, assistantTurn) {
        if (!response.body) {
          throw new Error("Streaming response had no body.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const rawEvents = [];
        let buffer = "";

        while (true) {
          const next = await reader.read();
          if (next.done) {
            break;
          }

          buffer += decoder.decode(next.value, { stream: true });
          buffer = processStreamBuffer(buffer, rawEvents, assistantTurn, false);
        }

        buffer += decoder.decode();
        processStreamBuffer(buffer, rawEvents, assistantTurn, true);
        state.debug.rawResponse = rawEvents.join("\\n\\n");
      }

      async function sendDebugChat() {
        if (state.debug.sending) {
          return;
        }

        const prompt = state.debug.prompt.trim();

        if (!state.debug.model) {
          state.debug.error = "Please select a model first.";
          renderDebug();
          return;
        }

        if (!prompt) {
          state.debug.error = "Please enter a user message.";
          renderDebug();
          return;
        }

        const history = state.debug.transcript
          .filter((entry) => typeof entry.content === "string" && entry.content.trim().length > 0)
          .map((entry) => ({
            role: entry.role,
            content: entry.content,
          }));

        history.push({
          role: "user",
          content: prompt,
        });

        const payload = {
          model: state.debug.model,
          messages: [
            ...(state.debug.systemPrompt.trim()
              ? [{
                  role: "system",
                  content: state.debug.systemPrompt.trim(),
                }]
              : []),
            ...history,
          ],
          stream: state.debug.stream,
          temperature: state.debug.params.temperature,
          top_p: state.debug.params.top_p,
          top_k: Math.round(state.debug.params.top_k),
          min_p: state.debug.params.min_p,
          repeat_penalty: state.debug.params.repeat_penalty,
          max_tokens: Math.max(1, Math.round(state.debug.params.max_tokens)),
        };

        const userTurn = {
          role: "user",
          content: prompt,
        };
        const assistantTurn = {
          role: "assistant",
          content: "",
          reasoningContent: "",
          backend: "",
        };

        state.debug.transcript.push(userTurn, assistantTurn);
        state.debug.error = "";
        state.debug.backend = "";
        state.debug.status = "";
        state.debug.usage = "";
        resetDebugMetrics();
        state.debug.metrics.startedAt = Date.now();
        state.debug.rawRequest = JSON.stringify(payload, null, 2);
        state.debug.rawResponse = "";
        state.debug.prompt = "";
        debugPrompt.value = "";
        state.debug.sending = true;
        state.debug.abortController = new AbortController();
        startDebugMetricsTicker();
        renderDebug();

        try {
          const response = await fetch("/v1/chat/completions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: state.debug.abortController.signal,
          });

          state.debug.backend = response.headers.get("x-llmproxy-backend") || "";
          state.debug.status = "HTTP " + response.status;
          assistantTurn.backend = state.debug.backend;

          if (!response.ok) {
            throw new Error(await readErrorResponse(response));
          }

          if (payload.stream) {
            await consumeStreamingResponse(response, assistantTurn);
          } else {
            const responseJson = await response.json();
            applyNonStreamingResponse(responseJson, assistantTurn);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          state.debug.error = message;

          if (!assistantTurn.content && !assistantTurn.reasoningContent) {
            state.debug.transcript.pop();
          }
        } finally {
          state.debug.sending = false;
          state.debug.abortController = null;
          stopDebugMetricsTicker();
          renderDebug();
        }
      }

      function render(snapshot) {
        state.snapshot = snapshot;
        mergeModels(collectSnapshotModels(snapshot));

        const healthyCount = snapshot.backends.filter((backend) => backend.healthy && backend.enabled).length;
        const enabledCount = snapshot.backends.filter((backend) => backend.enabled).length;
        const uptime = Math.max(0, Date.now() - new Date(snapshot.startedAt).getTime());

        renderSummaryCards([
          {
            key: "live-connections",
            label: "Live Connections",
            value: snapshot.activeConnections.length,
            note: snapshot.totals.activeRequests + " currently occupy backend slots, " + snapshot.queueDepth + " are queued",
            title: "Requests currently active inside llmproxy. This includes in-flight requests on a backend and requests still waiting in the queue.",
          },
          {
            key: "healthy-backends",
            label: "Healthy Backends",
            value: healthyCount + " / " + enabledCount,
            note: snapshot.backends.length + " configured in total",
            title: "Enabled backends that passed their most recent health check. Unhealthy or disabled backends are excluded from normal routing.",
          },
          {
            key: "successful-requests",
            label: "Successful Requests",
            value: snapshot.totals.successfulRequests,
            note:
              snapshot.totals.failedRequests + " failed, " +
              snapshot.totals.cancelledRequests + " cancelled, " +
              snapshot.totals.rejectedRequests + " rejected",
            title: "Requests completed successfully. The note shows the breakdown of failed, cancelled, and rejected requests observed by the proxy.",
          },
          {
            key: "uptime",
            label: "Uptime",
            value: formatDuration(uptime),
            note: "Started: " + formatDate(snapshot.startedAt),
            title: "How long the current llmproxy process has been running since the last start.",
          },
        ]);

        renderActiveConnections(snapshot);
        renderBackends(snapshot.backends);
        renderRecentRequests(snapshot.recentRequests);

        renderRequestDetail();
        renderDebug();
      }

      function setConnectionStatus(mode, text) {
        connectionText.textContent = text;
        connectionDot.className = "status-dot " + mode;
      }

      if (pageNav instanceof HTMLElement) {
        pageNav.addEventListener("click", (event) => {
          const target = event.target;

          if (!(target instanceof Element)) {
            return;
          }

          const link = target.closest(".page-link");
          if (!(link instanceof HTMLAnchorElement)) {
            return;
          }

          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
          }

          const nextPage = link.dataset.routePage;
          if (!nextPage || !dashboardPages[nextPage]) {
            return;
          }

          event.preventDefault();
          setCurrentPage(nextPage);
        });
      }

      window.addEventListener("popstate", () => {
        setCurrentPage(getPageFromPath(window.location.pathname), { updateHistory: false });
      });

      const initialPage = getPageFromPath(window.location.pathname);
      const initialPath = normalizePagePath(window.location.pathname);
      setCurrentPage(initialPage, {
        replaceHistory: initialPath !== dashboardPages[initialPage].path,
      });
      render(state.snapshot);
      setConnectionStatus("online", "Live feed connected");
      void loadModels(false);

      const events = new EventSource("/api/events");
      events.addEventListener("snapshot", (event) => {
        setConnectionStatus("online", "Live feed connected");
        render(JSON.parse(event.data));
      });
      events.onerror = () => {
        setConnectionStatus("offline", "Reconnecting live feed...");
      };
    </script>
  </body>
</html>`;
}
