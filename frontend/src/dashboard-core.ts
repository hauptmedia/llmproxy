import { computed, reactive } from "vue";

export type DashboardPage = "overview" | "chat" | "backends";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface DashboardBootstrap {
  dashboardPath: string;
  page: DashboardPage;
  snapshot: ProxySnapshot;
}

export interface ProxySnapshot {
  startedAt: string;
  queueDepth: number;
  totals: {
    activeRequests: number;
    successfulRequests: number;
    failedRequests: number;
    cancelledRequests: number;
    rejectedRequests: number;
  };
  backends: BackendSnapshot[];
  activeConnections: ActiveConnectionSnapshot[];
  recentRequests: RequestLogEntry[];
}

export interface BackendSnapshot {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  healthy: boolean;
  maxConcurrency: number;
  activeRequests: number;
  availableSlots: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cancelledRequests: number;
  lastLatencyMs?: number;
  avgLatencyMs?: number;
  lastCheckedAt?: string;
  lastError?: string;
  configuredModels: string[];
  discoveredModels: string[];
  discoveredModelDetails: Array<{ id: string; metadata?: JsonValue }>;
}

export interface ActiveConnectionSnapshot {
  id: string;
  kind: string;
  method: string;
  path: string;
  model?: string;
  clientStream: boolean;
  upstreamStream: boolean;
  phase: "queued" | "connected" | "streaming";
  startedAt: string;
  elapsedMs: number;
  queueMs: number;
  backendId?: string;
  backendName?: string;
  statusCode?: number;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contentTokens: number;
  reasoningTokens: number;
  textTokens: number;
  promptMs?: number;
  generationMs?: number;
  promptTokensPerSecond?: number;
  completionTokensPerSecond?: number;
  timeToFirstTokenMs?: number;
  finishReason?: string;
  metricsExact: boolean;
  hasDetail?: boolean;
}

export interface RequestLogEntry {
  id: string;
  time: string;
  method: string;
  path: string;
  model?: string;
  backendId?: string;
  backendName?: string;
  outcome: "success" | "error" | "cancelled" | "queued_timeout";
  latencyMs: number;
  queuedMs: number;
  statusCode?: number;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contentTokens?: number;
  reasoningTokens?: number;
  textTokens?: number;
  promptMs?: number;
  generationMs?: number;
  promptTokensPerSecond?: number;
  completionTokensPerSecond?: number;
  timeToFirstTokenMs?: number;
  finishReason?: string;
  metricsExact?: boolean;
  hasDetail?: boolean;
}

export interface RequestLogDetail {
  entry: RequestLogEntry;
  requestBody?: JsonValue;
  responseBody?: JsonValue;
  live?: boolean;
}

export interface KnownModel {
  id: string;
  ownedBy: string;
}

export interface UiBadge {
  text: string;
  tone?: "good" | "warn" | "bad" | "neutral";
  title?: string;
  className?: string;
}

export interface DebugTranscriptEntry {
  role: string;
  content?: JsonValue;
  reasoning_content?: string;
  refusal?: string;
  function_call?: JsonValue;
  tool_calls?: JsonValue[];
  audio?: JsonValue;
  name?: string;
  tool_call_id?: string;
  backend?: string;
  finish_reason?: string;
}

export interface BackendDraft {
  enabled: boolean;
  maxConcurrency: number;
  saving: boolean;
  error: string;
}

const dashboardWindow = window as Window & {
  __LLMPROXY_DASHBOARD_BOOTSTRAP__?: DashboardBootstrap;
};

const bootstrapCandidate = dashboardWindow.__LLMPROXY_DASHBOARD_BOOTSTRAP__;
if (!bootstrapCandidate) {
  throw new Error("Dashboard bootstrap payload is missing.");
}

export const dashboardBootstrap: DashboardBootstrap = bootstrapCandidate;

function normalizeDashboardPath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/dashboard";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function normalizeDashboardSubPath(pathname: string): string {
  return pathname !== "/" && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

export function getPageTitle(page: DashboardPage): string {
  if (page === "chat") {
    return "Chat Debugger";
  }

  if (page === "backends") {
    return "Backends";
  }

  return "Overview";
}

function buildDashboardPath(page: DashboardPage, dashboardPath: string): string {
  if (page === "chat") {
    return `${dashboardPath}/chat`;
  }

  if (page === "backends") {
    return `${dashboardPath}/backends`;
  }

  return dashboardPath;
}

function pageFromPath(pathname: string, dashboardPath: string): DashboardPage {
  const normalized = normalizeDashboardSubPath(pathname);

  if (normalized === `${dashboardPath}/chat`) {
    return "chat";
  }

  if (normalized === `${dashboardPath}/backends` || normalized === `${dashboardPath}/config`) {
    return "backends";
  }

  return "overview";
}

function isClientRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prettyJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatUiValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return formatCompactValue(value);
}

function escapeClientHtml(value: unknown): string {
  return formatUiValue(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeCodeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function tryParseJsonString(value: unknown): unknown {
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

function tryParseJsonSequence(value: string): unknown[] | null {
  const blocks = value
    .split(/\n\s*\n/)
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

function getJsonDocuments(value: unknown): unknown[] | null {
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

function syntaxHighlightJson(jsonText: string): string {
  return escapeCodeHtml(jsonText).replace(
    /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let className = "json-number";

      if (match[0] === '"') {
        className = match.endsWith(":") ? "json-key" : "json-string";
      } else if (match === "true" || match === "false") {
        className = "json-boolean";
      } else if (match === "null") {
        className = "json-null";
      }

      return `<span class="${className}">${match}</span>`;
    },
  );
}

function renderCodeInnerHtml(value: unknown): { html: string; isJson: boolean } {
  const docs = getJsonDocuments(value);
  if (docs) {
    return {
      html: docs.map((doc) => syntaxHighlightJson(prettyJson(doc))).join("\n\n"),
      isJson: true,
    };
  }

  return {
    html: escapeClientHtml(value ?? ""),
    isJson: false,
  };
}

export function renderCodeBlockHtml(value: unknown, baseClass = "turn-content"): string {
  const rendered = renderCodeInnerHtml(value);
  const className = rendered.isJson ? `${baseClass} json-view` : baseClass;
  return `<pre class="${escapeClientHtml(className)}">${rendered.html}</pre>`;
}

function renderMarkdownInline(markdown: unknown): string {
  const placeholders: Array<{ token: string; html: string }> = [];
  const store = (html: string) => {
    const token = `@@MDTOKEN${placeholders.length}@@`;
    placeholders.push({
      token,
      html,
    });
    return token;
  };

  let html = escapeCodeHtml(markdown ?? "");
  html = html.replace(
    new RegExp(String.fromCharCode(96) + "([^" + String.fromCharCode(96) + "\\n]+)" + String.fromCharCode(96), "g"),
    (_match, code) => store(`<code>${code}</code>`),
  );
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, href) => (
    store(`<a href="${escapeClientHtml(href)}" target="_blank" rel="noreferrer noopener">${label}</a>`)
  ));
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/(^|[\s(])\*([^*]+)\*(?=[$\s).,!?:;]|$)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[\s(])_([^_]+)_(?=[$\s).,!?:;]|$)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_match, prefix, href) => (
    prefix + store(`<a href="${escapeClientHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeClientHtml(href)}</a>`)
  ));

  for (const placeholder of placeholders) {
    html = html.replaceAll(placeholder.token, placeholder.html);
  }

  return html;
}

function isMarkdownBlockBoundary(line: string): boolean {
  const fence = String.fromCharCode(96).repeat(3);
  return (
    line.startsWith(fence) ||
    /^(#{1,6})\s+/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^>\s?/.test(line)
  );
}

function renderMarkdownToHtml(markdown: unknown): string {
  const fence = String.fromCharCode(96).repeat(3);
  const normalized = String(markdown ?? "").replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    return '<div class="empty">No message content.</div>';
  }

  const lines = normalized.split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith(fence)) {
      const codeLines: string[] = [];
      const language = line.slice(3).trim().toLowerCase();
      index += 1;

      while (index < lines.length && !lines[index].startsWith(fence)) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && lines[index].startsWith(fence)) {
        index += 1;
      }

      const codeValue = codeLines.join("\n");
      const rendered = renderCodeInnerHtml(codeValue);
      const codeClass = "turn-content" + (rendered.isJson || language === "json" ? " json-view" : "");
      blocks.push(`<pre class="${escapeClientHtml(codeClass)}"><code>${rendered.html}</code></pre>`);
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length);
      blocks.push(`<h${level}>${renderMarkdownInline(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push(`<blockquote><p>${renderMarkdownInline(quoteLines.join("\n")).replace(/\n/g, "<br />")}</p></blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, ""));
        index += 1;
      }

      blocks.push(`<ul>${items.map((item) => `<li>${renderMarkdownInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(`<ol>${items.map((item) => `<li>${renderMarkdownInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockBoundary(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push(`<p>${renderMarkdownInline(paragraphLines.join("\n")).replace(/\n/g, "<br />")}</p>`);
  }

  return blocks.join("");
}

function renderMessageStringHtml(value: unknown): string {
  if (getJsonDocuments(value)) {
    return renderCodeBlockHtml(value, "turn-content");
  }

  return `<div class="markdown-content">${renderMarkdownToHtml(value)}</div>`;
}

function renderDetailBlock(label: string, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  return (
    `<div class="detail-block">` +
      `<div class="detail-block-label">${escapeClientHtml(label)}</div>` +
      renderCodeBlockHtml(value, "turn-content") +
    `</div>`
  );
}

function hasVisibleMessageContent(content: unknown): boolean {
  if (typeof content === "string") {
    return content.length > 0;
  }

  if (Array.isArray(content)) {
    return content.length > 0;
  }

  return content !== undefined && content !== null;
}

function roleTone(role: string): "good" | "warn" | "bad" {
  if (role === "assistant") {
    return "good";
  }

  if (role === "tool" || role === "user" || role === "system" || role === "developer") {
    return "warn";
  }

  return "bad";
}

function getMessageRoleEmoji(role: string): string {
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

  return "❔";
}

function describeMessageRole(role: string): string {
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

function describeFinishReason(reason: string): string {
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

function badgeSpec(text: string, tone: "good" | "warn" | "bad" | "neutral", title = ""): UiBadge {
  return { text, tone, title };
}

function buildMessageRoleBadgeSpec(message: any, role: string): UiBadge {
  const tooltipParts = [describeMessageRole(role)];

  if (role === "tool" && typeof message?.tool_call_id === "string" && message.tool_call_id.length > 0) {
    tooltipParts.push(`tool_call_id: ${message.tool_call_id}`);
  }

  return badgeSpec(`${getMessageRoleEmoji(role)} ${role}`, roleTone(role), tooltipParts.join("\n"));
}

function renderReasoningHtml(reasoningContent: unknown): string {
  if (typeof reasoningContent !== "string" || reasoningContent.length === 0) {
    return "";
  }

  return (
    `<details class="reasoning-panel" open>` +
      `<summary class="reasoning-summary" title="Model reasoning captured for this message. Collapse it to focus on the final content.">` +
        `<span aria-hidden="true">🧠</span>` +
        `<span>Reasoning</span>` +
        `<span class="reasoning-chevron" aria-hidden="true">▶</span>` +
      `</summary>` +
      `<div class="reasoning-content">` +
        renderMessageStringHtml(reasoningContent) +
      `</div>` +
    `</details>`
  );
}

function renderCollapsedReasoningHtml(reasoningContent: unknown): string {
  if (typeof reasoningContent !== "string" || reasoningContent.length === 0) {
    return "";
  }

  return (
    `<details class="reasoning-panel">` +
      `<summary class="reasoning-summary" title="Model reasoning captured for this message. Expand it to inspect the reasoning output.">` +
        `<span aria-hidden="true">🧠</span>` +
        `<span>Reasoning</span>` +
        `<span class="reasoning-chevron" aria-hidden="true">▶</span>` +
      `</summary>` +
      `<div class="reasoning-content">` +
        renderMessageStringHtml(reasoningContent) +
      `</div>` +
    `</details>`
  );
}

function renderMessageContentHtml(content: unknown): string {
  if (typeof content === "string") {
    return renderMessageStringHtml(content);
  }

  if (Array.isArray(content)) {
    if (content.length === 0) {
      return '<div class="empty">No message content.</div>';
    }

    return (
      `<div class="message-part-list">` +
        content.map((part, index) => {
          const partType = isClientRecord(part) && typeof part.type === "string"
            ? part.type
            : `part ${index + 1}`;
          const displayValue =
            isClientRecord(part) && typeof part.text === "string"
              ? part.text
              : prettyJson(part);

          return (
            `<div class="message-part">` +
              `<div class="message-part-type">${escapeClientHtml(partType)}</div>` +
              renderMessageStringHtml(displayValue) +
            `</div>`
          );
        }).join("") +
      `</div>`
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

export function renderMessageHtml(message: any, index: number, options: any = {}): string {
  const role = typeof message?.role === "string" ? message.role : (options.role ?? "unknown");
  const metaBits: UiBadge[] = [
    buildMessageRoleBadgeSpec(message, role),
  ];

  if (typeof message?.name === "string" && message.name.length > 0) {
    metaBits.push(badgeSpec(`name ${message.name}`, "warn", "Optional message name field."));
  }

  if (typeof options.finishReason === "string" && options.finishReason.length > 0) {
    metaBits.push(badgeSpec(`finish ${options.finishReason}`, "good", describeFinishReason(options.finishReason)));
  }

  if (Array.isArray(options.extraBadges) && options.extraBadges.length > 0) {
    metaBits.push(...options.extraBadges);
  }

  return (
    `<article class="turn ${escapeClientHtml(role)}">` +
      `<div class="turn-head">` +
        `<span class="turn-role">${escapeClientHtml(options.heading ?? `message ${index + 1}`)}</span>` +
        `<div class="message-meta">` +
          metaBits.map((bit) => (
            `<span class="badge ${escapeClientHtml(bit.tone ?? "neutral")}" title="${escapeClientHtml(bit.title ?? "")}">${escapeClientHtml(bit.text)}</span>`
          )).join("") +
        `</div>` +
      `</div>` +
      (options.reasoningCollapsed
        ? renderCollapsedReasoningHtml(message?.reasoning_content)
        : renderReasoningHtml(message?.reasoning_content)) +
      ((hasVisibleMessageContent(message?.content) || !message?.reasoning_content)
        ? renderMessageContentHtml(message?.content)
        : "") +
      (typeof message?.refusal === "string" && message.refusal.length > 0
        ? renderDetailBlock("Refusal", message.refusal)
        : "") +
      (message?.function_call ? renderDetailBlock("Function Call", message.function_call) : "") +
      (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0
        ? message.tool_calls.map((toolCall: unknown, toolIndex: number) => renderDetailBlock(`Tool Call ${toolIndex + 1}`, toolCall)).join("")
        : "") +
      (typeof message?.audio === "object" && message.audio !== null
        ? renderDetailBlock("Audio", message.audio)
        : "") +
    `</article>`
  );
}

function renderToolsHtml(tools: unknown): string {
  if (!Array.isArray(tools) || tools.length === 0) {
    return '<div class="empty">No tools were included in this request.</div>';
  }

  return tools
    .map((tool, index) => renderDetailBlock(`Tool ${index + 1}`, tool))
    .join("");
}

function renderResponseChoicesHtml(responseBody: unknown): string {
  if (!isClientRecord(responseBody) || !Array.isArray(responseBody.choices) || responseBody.choices.length === 0) {
    return '<div class="empty">No structured response payload was stored for this request.</div>';
  }

  return responseBody.choices
    .map((choice: any, index: number) => {
      if (isClientRecord(choice) && isClientRecord(choice.message)) {
        return renderMessageHtml(choice.message, index, {
          heading: `choice ${index + 1}`,
          role: typeof choice.message.role === "string" ? choice.message.role : "assistant",
          finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
        });
      }

      if (isClientRecord(choice) && typeof choice.text === "string") {
        return renderDetailBlock(`Choice ${index + 1}`, {
          finish_reason: choice.finish_reason ?? null,
          text: choice.text,
        });
      }

      return renderDetailBlock(`Choice ${index + 1}`, choice);
    })
    .join("");
}

function formatCompactValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.length > 140 ? `${value.slice(0, 137)}...` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  const json = prettyJson(value).replace(/\s+/g, " ").trim();
  return json.length > 140 ? `${json.slice(0, 137)}...` : json;
}

export function formatDuration(ms: unknown): string {
  if (typeof ms !== "number" || Number.isNaN(ms)) {
    return "n/a";
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  return `${(seconds / 60).toFixed(1)}m`;
}

export function formatDate(value: unknown): string {
  if (!value) {
    return "n/a";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

export function shortId(value: unknown): string {
  return typeof value === "string" && value.length > 8 ? value.slice(0, 8) : String(value ?? "");
}

function formatTokenRate(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "";
  }

  return `${value.toFixed(1)} tok/s`;
}

function matchesModelPattern(pattern: string, value: string): boolean {
  if (pattern === "*") {
    return true;
  }

  if (pattern.includes("*")) {
    const escaped = pattern
      .replaceAll("\\", "\\\\")
      .replaceAll(".", "\\.")
      .replaceAll("+", "\\+")
      .replaceAll("?", "\\?")
      .replaceAll("^", "\\^")
      .replaceAll("$", "\\$")
      .replaceAll("(", "\\(")
      .replaceAll(")", "\\)")
      .replaceAll("{", "\\{")
      .replaceAll("}", "\\}")
      .replaceAll("|", "\\|")
      .replaceAll("[", "\\[")
      .replaceAll("]", "\\]")
      .replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`).test(value);
  }

  return pattern === value;
}

function uniqueStrings(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.length > 0))];
}

function formatModelMetadataScalar(key: string, value: unknown): string {
  if (typeof value === "number") {
    if (key === "created" && value >= 1_000_000_000 && value < 10_000_000_000) {
      try {
        return `${formatDate(new Date(value * 1000).toISOString())} (${new Intl.NumberFormat("en-US").format(value)})`;
      } catch {
        return new Intl.NumberFormat("en-US").format(value);
      }
    }

    return new Intl.NumberFormat("en-US").format(value);
  }

  return String(value);
}

function appendModelMetadataLines(lines: string[], key: string, value: unknown): void {
  if (lines.length >= 18 || value === undefined || value === null || value === "") {
    return;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((entry) => (
        typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
          ? String(entry).trim()
          : ""
      ))
      .filter(Boolean);

    if (items.length > 0) {
      lines.push(`${key}: ${items.join(", ")}`);
    }
    return;
  }

  if (isClientRecord(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childKey === "id" || childValue === undefined || childValue === null || childValue === "") {
        continue;
      }

      appendModelMetadataLines(lines, key ? `${key}.${childKey}` : childKey, childValue);
      if (lines.length >= 18) {
        return;
      }
    }
    return;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    lines.push(`${key}: ${formatModelMetadataScalar(key, value)}`);
  }
}

function buildModelMetadataTooltip(modelName: string, metadata: unknown): string {
  if (!isClientRecord(metadata)) {
    return "";
  }

  const lines: string[] = [];
  const primaryKeys = [
    "owned_by",
    "created",
    "aliases",
    "tags",
    "capabilities",
    "description",
    "type",
    "object",
    "parameters",
    "modified_at",
    "size",
    "digest",
  ];
  const handledKeys = new Set(["id", "name", "model", ...primaryKeys]);

  for (const key of primaryKeys) {
    appendModelMetadataLines(lines, key, metadata[key]);
  }

  appendModelMetadataLines(lines, "details", metadata.details);
  handledKeys.add("details");
  appendModelMetadataLines(lines, "meta", metadata.meta);
  handledKeys.add("meta");

  for (const [key, value] of Object.entries(metadata)) {
    if (handledKeys.has(key)) {
      continue;
    }

    appendModelMetadataLines(lines, key, value);
    if (lines.length >= 18) {
      break;
    }
  }

  if (lines.length === 0) {
    return "";
  }

  return `Model info for ${modelName}:\n${lines.join("\n")}`;
}

function buildDiscoveredModelDetailMap(discoveredModelDetails: unknown): Map<string, any> {
  const entries = Array.isArray(discoveredModelDetails) ? discoveredModelDetails : [];
  const map = new Map<string, any>();

  for (const entry of entries) {
    if (!isClientRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
      continue;
    }

    map.set(entry.id, entry);
  }

  return map;
}

export function buildModelSpecs(configuredModels: unknown, discoveredModels: unknown, discoveredModelDetails: unknown): Array<{ text: string; className: string; title: string }> {
  const configured = uniqueStrings(configuredModels);
  const discovered = uniqueStrings(discoveredModels);
  const discoveredDetailMap = buildDiscoveredModelDetailMap(discoveredModelDetails);
  const explicitConfigured = configured.filter((pattern) => pattern !== "*");
  const hasWildcard = configured.includes("*");
  const specs: Array<{ text: string; className: string; title: string }> = [];

  if (discovered.length > 0) {
    for (const model of discovered) {
      const allowed = configured.length === 0 || configured.some((pattern) => matchesModelPattern(pattern, model));
      let title = "Discovered from /v1/models.";
      const metadataTooltip = buildModelMetadataTooltip(model, discoveredDetailMap.get(model)?.metadata);

      if (allowed) {
        if (configured.length === 0) {
          title += " Routable because no explicit model allowlist is configured.";
        } else if (hasWildcard) {
          title += ' Routable because this backend whitelist includes "*".';
        } else {
          title += " Routable because this model matches the backend whitelist.";
        }
      } else {
        title += " Not routable here because it is not whitelisted by this backend config.";
      }

      if (metadataTooltip) {
        title += `\n\n${metadataTooltip}`;
      }

      specs.push({
        text: model,
        className: `chip ${allowed ? "good" : "bad"}`,
        title,
      });
    }

    for (const model of explicitConfigured) {
      if (discovered.includes(model)) {
        continue;
      }

      specs.push({
        text: model,
        className: "chip good",
        title: "Explicitly whitelisted in config. llmproxy will route this exact configured model here even though it was not returned by /v1/models.",
      });
    }

    return specs;
  }

  for (const model of explicitConfigured) {
    specs.push({
      text: model,
      className: "chip good",
      title: "Explicitly whitelisted in config. The backend did not return a model list, so availability could not be validated via /v1/models.",
    });
  }

  const anyAllowed = hasWildcard || configured.length === 0;
  specs.push({
    text: "any",
    className: `chip ${anyAllowed ? "good" : "bad"}`,
    title: anyAllowed
      ? (hasWildcard
        ? 'No models were returned by /v1/models. Because "*" is configured, llmproxy treats any model name as routable for this backend.'
        : "No models were returned by /v1/models and no explicit whitelist is configured, so llmproxy currently treats any model name as routable here.")
      : "No models were returned by /v1/models. Arbitrary model names are not whitelisted for this backend, so only explicitly configured models will be routed here.",
  });

  return specs;
}

function createEmptyDebugMetrics(): any {
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

function estimateTokenCount(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) {
    return 0;
  }

  return Math.max(1, value.trim().split(/\s+/).filter(Boolean).length);
}

function readPayloadCounts(payload: any): any {
  const usage = isClientRecord(payload?.usage) ? payload.usage : null;
  const timings = isClientRecord(payload?.timings) ? payload.timings : null;

  return {
    promptTokens: typeof usage?.prompt_tokens === "number"
      ? usage.prompt_tokens
      : (typeof timings?.prompt_n === "number" ? timings.prompt_n : null),
    completionTokens: typeof usage?.completion_tokens === "number"
      ? usage.completion_tokens
      : (typeof timings?.predicted_n === "number" ? timings.predicted_n : null),
    totalTokens: typeof usage?.total_tokens === "number"
      ? usage.total_tokens
      : null,
    promptMs: typeof timings?.prompt_ms === "number" ? timings.prompt_ms : null,
    generationMs: typeof timings?.predicted_ms === "number" ? timings.predicted_ms : null,
    promptPerSecond: typeof timings?.prompt_per_second === "number" ? timings.prompt_per_second : null,
    completionPerSecond: typeof timings?.predicted_per_second === "number" ? timings.predicted_per_second : null,
  };
}

function collectSnapshotModels(snapshot: ProxySnapshot): KnownModel[] {
  const models = new Map<string, KnownModel>();

  for (const backend of snapshot.backends) {
    for (const model of backend.discoveredModels) {
      if (!models.has(model)) {
        models.set(model, {
          id: model,
          ownedBy: backend.name,
        });
      }
    }

    for (const model of backend.configuredModels) {
      if (model.includes("*") || models.has(model)) {
        continue;
      }

      models.set(model, {
        id: model,
        ownedBy: backend.name,
      });
    }
  }

  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function createDashboardStoreInternal() {
    const state: any = reactive({
      snapshot: dashboardBootstrap.snapshot,
      connectionStatus: "connecting",
      connectionText: "Connecting to live feed",
      models: collectSnapshotModels(dashboardBootstrap.snapshot) as KnownModel[],
      requestDetail: {
        open: false,
        loading: false,
        requestId: "",
        error: "",
        detail: null as RequestLogDetail | null,
        cache: {} as Record<string, RequestLogDetail>,
        lastFetchedAt: 0,
      },
      backendDrafts: {} as Record<string, BackendDraft>,
      debug: {
        model: "",
        systemPrompt: "",
        prompt: "Say hello briefly and mention the model you are using.",
        stream: true,
        sending: false,
        abortController: null as AbortController | null,
        backend: "",
        status: "",
        usage: "",
        error: "",
        rawRequest: "",
        rawResponse: "",
        transcript: [] as DebugTranscriptEntry[],
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
    });

    let eventSource: EventSource | null = null;
    let metricsTicker: number | undefined;
    let detailRefreshTimer: number | undefined;

    function syncBackendDrafts(backends: BackendSnapshot[]): void {
      const activeIds = new Set<string>();

      for (const backend of backends) {
        activeIds.add(backend.id);

        if (!state.backendDrafts[backend.id]) {
          state.backendDrafts[backend.id] = {
            enabled: backend.enabled,
            maxConcurrency: backend.maxConcurrency,
            saving: false,
            error: "",
          };
          continue;
        }

        const draft = state.backendDrafts[backend.id];
        if (!draft.saving) {
          draft.enabled = backend.enabled;
          draft.maxConcurrency = backend.maxConcurrency;
        }
      }

      for (const backendId of Object.keys(state.backendDrafts)) {
        if (!activeIds.has(backendId)) {
          delete state.backendDrafts[backendId];
        }
      }
    }

    function ensureDebugModel(): void {
      if (state.models.length === 0) {
        state.debug.model = "";
        return;
      }

      if (!state.debug.model || !state.models.some((model: KnownModel) => model.id === state.debug.model)) {
        state.debug.model = state.models[0].id;
      }
    }

    function mergeModels(models: KnownModel[]): void {
      const merged = new Map<string, KnownModel>();

      for (const model of state.models) {
        merged.set(model.id, model);
      }

      for (const model of models) {
        if (!merged.has(model.id)) {
          merged.set(model.id, model);
        }
      }

      state.models = Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));
      ensureDebugModel();
    }

    function applySnapshot(snapshot: ProxySnapshot): void {
      state.snapshot = snapshot;
      syncBackendDrafts(snapshot.backends);
      mergeModels(collectSnapshotModels(snapshot));
      scheduleOpenDetailRefresh();
    }

    async function refreshModels(): Promise<void> {
      try {
        const response = await fetch("/v1/models", { method: "GET" });
        if (!response.ok) {
          throw new Error(await readErrorResponse(response));
        }

        const payload = await response.json();
        const models = Array.isArray(payload?.data)
          ? payload.data
            .filter((entry: any) => typeof entry?.id === "string")
            .map((entry: any) => ({
              id: entry.id,
              ownedBy: typeof entry.owned_by === "string" ? entry.owned_by : "backend",
            }))
          : [];
        mergeModels(models);
      } catch {
        mergeModels(collectSnapshotModels(state.snapshot));
      }
    }

    function connectLiveFeed(): void {
      if (eventSource) {
        eventSource.close();
      }

      state.connectionStatus = "connecting";
      state.connectionText = "Connecting to live feed";
      eventSource = new EventSource("/api/events");

      eventSource.addEventListener("snapshot", (event: MessageEvent) => {
        try {
          applySnapshot(JSON.parse(event.data) as ProxySnapshot);
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

    function isActiveRequestId(requestId: string): boolean {
      return state.snapshot.activeConnections.some((connection: ActiveConnectionSnapshot) => connection.id === requestId);
    }

    async function readErrorResponse(response: Response): Promise<string> {
      const text = await response.text();

      try {
        const payload = JSON.parse(text);
        if (payload?.error?.message) {
          return payload.error.message;
        }
      } catch {
        return text || `HTTP ${response.status}`;
      }

      return text || `HTTP ${response.status}`;
    }

    async function loadRequestDetail(requestId: string, useCache = true): Promise<void> {
      if (useCache && !isActiveRequestId(requestId) && state.requestDetail.cache[requestId]) {
        state.requestDetail.detail = state.requestDetail.cache[requestId];
        state.requestDetail.loading = false;
        return;
      }

      state.requestDetail.loading = true;
      state.requestDetail.error = "";

      try {
        const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}`, { method: "GET" });
        if (!response.ok) {
          throw new Error(await readErrorResponse(response));
        }

        const detail = await response.json() as RequestLogDetail;
        if (state.requestDetail.requestId !== requestId) {
          return;
        }

        state.requestDetail.detail = detail;
        state.requestDetail.loading = false;
        state.requestDetail.lastFetchedAt = Date.now();

        if (!detail.live) {
          state.requestDetail.cache[requestId] = detail;
        }
      } catch (error) {
        if (state.requestDetail.requestId !== requestId) {
          return;
        }

        state.requestDetail.loading = false;
        state.requestDetail.error = error instanceof Error ? error.message : String(error);
      }
    }

    async function openRequestDetail(requestId: string): Promise<void> {
      state.requestDetail.open = true;
      state.requestDetail.requestId = requestId;
      state.requestDetail.error = "";
      await loadRequestDetail(requestId);
    }

    function closeRequestDetail(): void {
      state.requestDetail.open = false;
      state.requestDetail.loading = false;
      state.requestDetail.requestId = "";
      state.requestDetail.error = "";
    }

    function scheduleOpenDetailRefresh(): void {
      if (!state.requestDetail.open || !state.requestDetail.requestId || !isActiveRequestId(state.requestDetail.requestId)) {
        return;
      }

      const elapsed = Date.now() - state.requestDetail.lastFetchedAt;
      if (elapsed < 600) {
        if (detailRefreshTimer !== undefined) {
          return;
        }

        detailRefreshTimer = window.setTimeout(() => {
          detailRefreshTimer = undefined;
          scheduleOpenDetailRefresh();
        }, Math.max(100, 600 - elapsed));
        return;
      }

      void loadRequestDetail(state.requestDetail.requestId, false);
    }

    async function saveBackend(backendId: string): Promise<void> {
      const draft = state.backendDrafts[backendId];
      if (!draft) {
        return;
      }

      draft.saving = true;
      draft.error = "";

      try {
        const response = await fetch(`/api/backends/${encodeURIComponent(backendId)}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            enabled: draft.enabled,
            maxConcurrency: Math.max(1, Math.round(draft.maxConcurrency || 1)),
          }),
        });

        if (!response.ok) {
          throw new Error(await readErrorResponse(response));
        }
      } catch (error) {
        draft.error = error instanceof Error ? error.message : String(error);
      } finally {
        draft.saving = false;
      }
    }

    function resetDebugMetrics(): void {
      state.debug.metrics = createEmptyDebugMetrics();
    }

    function stopDebugMetricsTicker(): void {
      if (metricsTicker !== undefined) {
        window.clearInterval(metricsTicker);
        metricsTicker = undefined;
      }
    }

    function startDebugMetricsTicker(): void {
      stopDebugMetricsTicker();
      metricsTicker = window.setInterval(() => {
        const metrics = state.debug.metrics;
        if (!metrics.startedAt) {
          return;
        }

        if (!metrics.firstTokenAt || metrics.completionPerSecond || metrics.completionTokens === 0) {
          return;
        }

        const seconds = Math.max(0.001, (Date.now() - metrics.firstTokenAt) / 1000);
        metrics.completionPerSecond = metrics.completionTokens / seconds;
      }, 200);
    }

    function noteStreamingTokenActivity(delta: any): void {
      const metrics = state.debug.metrics;
      const now = Date.now();

      const addedContentTokens = estimateTokenCount(delta?.content);
      const addedReasoningTokens = estimateTokenCount(delta?.reasoning_content);
      const addedCompletionTokens = addedContentTokens + addedReasoningTokens;

      if (addedCompletionTokens > 0) {
        if (!metrics.firstTokenAt) {
          metrics.firstTokenAt = now;
        }

        metrics.lastTokenAt = now;
        metrics.completionTokens += addedCompletionTokens;
        metrics.contentTokens += addedContentTokens;
        metrics.reasoningTokens += addedReasoningTokens;

        if (typeof metrics.promptTokens === "number") {
          metrics.totalTokens = metrics.promptTokens + metrics.completionTokens;
        }

        if (metrics.firstTokenAt) {
          metrics.completionPerSecond = metrics.completionTokens / Math.max(0.001, (now - metrics.firstTokenAt) / 1000);
        }
      }
    }

    function applyUsageMetrics(usage: unknown, timings: unknown, finishReason: unknown): void {
      const counts = readPayloadCounts({ usage, timings });
      const metrics = state.debug.metrics;

      if (typeof counts.promptTokens === "number") {
        metrics.promptTokens = counts.promptTokens;
      }

      if (typeof counts.completionTokens === "number") {
        metrics.completionTokens = counts.completionTokens;
      }

      if (typeof counts.totalTokens === "number") {
        metrics.totalTokens = counts.totalTokens;
      } else if (typeof metrics.promptTokens === "number") {
        metrics.totalTokens = metrics.promptTokens + metrics.completionTokens;
      }

      if (typeof counts.promptMs === "number") {
        metrics.promptMs = counts.promptMs;
      }

      if (typeof counts.generationMs === "number") {
        metrics.generationMs = counts.generationMs;
      }

      if (typeof counts.promptPerSecond === "number") {
        metrics.promptPerSecond = counts.promptPerSecond;
      }

      if (typeof counts.completionPerSecond === "number") {
        metrics.completionPerSecond = counts.completionPerSecond;
      }

      if (typeof finishReason === "string") {
        metrics.finishReason = finishReason;
      }
    }

    function formatUsage(usage: unknown, timings: unknown, finishReason: unknown): string {
      const counts = readPayloadCounts({ usage, timings });
      const parts: string[] = [];

      if (typeof finishReason === "string" && finishReason.length > 0) {
        parts.push(`finish ${finishReason}`);
      }

      if (typeof counts.promptTokens === "number") {
        parts.push(`${counts.promptTokens} prompt`);
      }

      if (typeof counts.completionTokens === "number") {
        parts.push(`${counts.completionTokens} completion`);
      }

      if (typeof counts.totalTokens === "number") {
        parts.push(`${counts.totalTokens} total`);
      }

      const rate = formatTokenRate(counts.completionPerSecond);
      if (rate) {
        parts.push(rate);
      }

      return parts.join(" | ");
    }

    function formatLiveUsage(): string {
      const metrics = state.debug.metrics;
      const parts: string[] = [];

      if (metrics.completionTokens > 0) {
        parts.push(`${metrics.completionTokens} live tok`);
      }

      if (metrics.reasoningTokens > 0) {
        parts.push(`${metrics.reasoningTokens} reasoning`);
      }

      const elapsedFromTokens = metrics.firstTokenAt
        ? formatDuration(Date.now() - metrics.firstTokenAt)
        : "";
      if (elapsedFromTokens && elapsedFromTokens !== "n/a") {
        parts.push(`elapsed ${elapsedFromTokens}`);
      }

      const rate = formatTokenRate(metrics.completionPerSecond);
      if (rate) {
        parts.push(rate);
      }

      return parts.join(" | ");
    }

    function mergeDebugFunctionCall(target: any, value: unknown): void {
      if (!isClientRecord(value)) {
        return;
      }

      const nextFunctionCall = isClientRecord(target.function_call)
        ? { ...target.function_call }
        : { arguments: "" };

      if (typeof value.name === "string" && value.name.length > 0) {
        nextFunctionCall.name = value.name;
      }

      if (typeof value.arguments === "string") {
        nextFunctionCall.arguments = String(nextFunctionCall.arguments ?? "") + value.arguments;
      }

      target.function_call = nextFunctionCall;
    }

    function mergeDebugToolCalls(target: any, value: unknown): void {
      if (!Array.isArray(value)) {
        return;
      }

      const nextToolCalls = Array.isArray(target.tool_calls)
        ? target.tool_calls.filter((toolCall: any) => isClientRecord(toolCall)).map((toolCall: any) => ({ ...toolCall }))
        : [];

      for (let index = 0; index < value.length; index += 1) {
        const rawToolCall = value[index];
        if (!isClientRecord(rawToolCall)) {
          continue;
        }

        const toolCallIndex = typeof rawToolCall.index === "number" ? rawToolCall.index : index;
        const existingIndex = nextToolCalls.findIndex((toolCall: any) => toolCall.index === toolCallIndex);
        const existingToolCall: any = existingIndex >= 0 && isClientRecord(nextToolCalls[existingIndex])
          ? { ...nextToolCalls[existingIndex] }
          : { index: toolCallIndex };

        if (typeof rawToolCall.id === "string" && rawToolCall.id.length > 0) {
          existingToolCall.id = rawToolCall.id;
        }

        if (typeof rawToolCall.type === "string" && rawToolCall.type.length > 0) {
          existingToolCall.type = rawToolCall.type;
        }

        if (isClientRecord(rawToolCall.function)) {
          const nextFunction = isClientRecord(existingToolCall.function)
            ? { ...existingToolCall.function }
            : { arguments: "" };

          if (typeof rawToolCall.function.name === "string" && rawToolCall.function.name.length > 0) {
            nextFunction.name = rawToolCall.function.name;
          }

          if (typeof rawToolCall.function.arguments === "string") {
            nextFunction.arguments = String(nextFunction.arguments ?? "") + rawToolCall.function.arguments;
          }

          existingToolCall.function = nextFunction;
        }

        if (existingIndex >= 0) {
          nextToolCalls[existingIndex] = existingToolCall;
        } else {
          nextToolCalls.push(existingToolCall);
        }
      }

      target.tool_calls = nextToolCalls.sort((left: any, right: any) => left.index - right.index);
    }

    function buildDebugHistoryMessage(entry: DebugTranscriptEntry): any {
      if (!isClientRecord(entry) || typeof entry.role !== "string") {
        return null;
      }

      const message: any = {
        role: entry.role,
      };

      if (Object.prototype.hasOwnProperty.call(entry, "content")) {
        message.content = entry.content ?? null;
      }

      if (typeof entry.name === "string" && entry.name.length > 0) {
        message.name = entry.name;
      }

      if (typeof entry.tool_call_id === "string" && entry.tool_call_id.length > 0) {
        message.tool_call_id = entry.tool_call_id;
      }

      if (isClientRecord(entry.function_call)) {
        message.function_call = entry.function_call;
      }

      if (Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0) {
        message.tool_calls = entry.tool_calls;
      }

      if (typeof entry.refusal === "string" && entry.refusal.length > 0) {
        message.refusal = entry.refusal;
      }

      return message;
    }

    function hasReplayableDebugMessage(message: any): boolean {
      if (!isClientRecord(message) || typeof message.role !== "string") {
        return false;
      }

      if (hasVisibleMessageContent(message.content)) {
        return true;
      }

      if (typeof message.refusal === "string" && message.refusal.length > 0) {
        return true;
      }

      if (isClientRecord(message.function_call)) {
        return true;
      }

      return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    }

    function applyNonStreamingResponse(payload: any, assistantTurn: DebugTranscriptEntry): void {
      const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
      const message = choice?.message;

      if (typeof message?.role === "string" && message.role.length > 0) {
        assistantTurn.role = message.role;
      }

      assistantTurn.content =
        message && Object.prototype.hasOwnProperty.call(message, "content")
          ? (message.content ?? null)
          : "";
      assistantTurn.reasoning_content = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
      assistantTurn.refusal = typeof message?.refusal === "string" ? message.refusal : "";
      assistantTurn.function_call = isClientRecord(message?.function_call) ? message.function_call : undefined;
      assistantTurn.tool_calls = Array.isArray(message?.tool_calls) ? message.tool_calls : undefined;
      assistantTurn.audio = isClientRecord(message?.audio) ? message.audio : undefined;
      assistantTurn.name = typeof message?.name === "string" ? message.name : "";
      assistantTurn.backend = state.debug.backend;
      assistantTurn.finish_reason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "";
      applyUsageMetrics(payload?.usage, payload?.timings, choice?.finish_reason);
      state.debug.usage = formatUsage(payload?.usage, payload?.timings, choice?.finish_reason);
      state.debug.rawResponse = JSON.stringify(payload, null, 2);
    }

    function applyStreamingPayload(payload: any, assistantTurn: DebugTranscriptEntry): void {
      const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
      const delta = choice?.delta ?? choice?.message ?? {};

      if (typeof delta?.role === "string" && delta.role.length > 0) {
        assistantTurn.role = delta.role;
      }

      if (typeof delta?.content === "string") {
        assistantTurn.content = String(assistantTurn.content ?? "") + delta.content;
      }

      if (typeof delta?.reasoning_content === "string") {
        assistantTurn.reasoning_content = String(assistantTurn.reasoning_content ?? "") + delta.reasoning_content;
      }

      if (typeof delta?.refusal === "string") {
        assistantTurn.refusal = String(assistantTurn.refusal ?? "") + delta.refusal;
      }

      mergeDebugFunctionCall(assistantTurn, delta?.function_call);
      mergeDebugToolCalls(assistantTurn, delta?.tool_calls);

      if (typeof choice?.finish_reason === "string" && choice.finish_reason.length > 0) {
        assistantTurn.finish_reason = choice.finish_reason;
      }

      assistantTurn.backend = state.debug.backend;
      noteStreamingTokenActivity(delta);
      applyUsageMetrics(payload?.usage, payload?.timings, choice?.finish_reason);
      state.debug.usage = formatUsage(payload?.usage, payload?.timings, choice?.finish_reason);
    }

    function processStreamBlock(block: string, rawEvents: string[], assistantTurn: DebugTranscriptEntry): void {
      const dataLines = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());

      if (dataLines.length === 0) {
        return;
      }

      const payloadText = dataLines.join("\n");
      if (!payloadText || payloadText === "[DONE]") {
        return;
      }

      rawEvents.push(payloadText);

      try {
        applyStreamingPayload(JSON.parse(payloadText), assistantTurn);
        state.debug.rawResponse = rawEvents.join("\n\n");
      } catch {
        state.debug.rawResponse = rawEvents.join("\n\n");
      }
    }

    function processStreamBuffer(buffer: string, rawEvents: string[], assistantTurn: DebugTranscriptEntry, flush: boolean): string {
      let working = buffer;

      while (true) {
        const windowsBreak = working.indexOf("\r\n\r\n");
        const unixBreak = working.indexOf("\n\n");
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

    async function consumeStreamingResponse(response: Response, assistantTurn: DebugTranscriptEntry): Promise<void> {
      if (!response.body) {
        throw new Error("Streaming response had no body.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const rawEvents: string[] = [];
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
      state.debug.rawResponse = rawEvents.join("\n\n");
    }

    async function sendDebugChat(): Promise<void> {
      if (state.debug.sending) {
        return;
      }

      const prompt = state.debug.prompt.trim();

      if (!state.debug.model) {
        state.debug.error = "Please select a model first.";
        return;
      }

      if (!prompt) {
        state.debug.error = "Please enter a user message.";
        return;
      }

      const history = state.debug.transcript
        .map((entry: DebugTranscriptEntry) => buildDebugHistoryMessage(entry))
        .filter((entry: any) => hasReplayableDebugMessage(entry));

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

      const userTurn: DebugTranscriptEntry = {
        role: "user",
        content: prompt,
      };
      const assistantTurn: DebugTranscriptEntry = {
        role: "assistant",
        content: "",
        reasoning_content: "",
        backend: "",
        finish_reason: "",
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
      state.debug.sending = true;
      state.debug.abortController = new AbortController();
      startDebugMetricsTicker();

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
        state.debug.status = `HTTP ${response.status}`;
        assistantTurn.backend = state.debug.backend;

        if (!response.ok) {
          throw new Error(await readErrorResponse(response));
        }

        if (payload.stream) {
          await consumeStreamingResponse(response, assistantTurn);
        } else {
          applyNonStreamingResponse(await response.json(), assistantTurn);
        }
      } catch (error) {
        state.debug.error = error instanceof Error ? error.message : String(error);

        if (
          !hasVisibleMessageContent(assistantTurn.content) &&
          !assistantTurn.reasoning_content &&
          !(typeof assistantTurn.refusal === "string" && assistantTurn.refusal.length > 0) &&
          !isClientRecord(assistantTurn.function_call) &&
          !(Array.isArray(assistantTurn.tool_calls) && assistantTurn.tool_calls.length > 0)
        ) {
          state.debug.transcript.pop();
        }
      } finally {
        state.debug.sending = false;
        state.debug.abortController = null;
        stopDebugMetricsTicker();
      }
    }

    function stopDebugChat(): void {
      state.debug.abortController?.abort(new Error("Request cancelled from dashboard."));
    }

    function clearDebugChat(): void {
      state.debug.transcript = [];
      state.debug.rawRequest = "";
      state.debug.rawResponse = "";
      state.debug.status = "";
      state.debug.usage = "";
      state.debug.error = "";
      state.debug.backend = "";
      resetDebugMetrics();
    }

    const healthyCount = computed(() => state.snapshot.backends.filter((backend: BackendSnapshot) => backend.healthy && backend.enabled).length);
    const enabledCount = computed(() => state.snapshot.backends.filter((backend: BackendSnapshot) => backend.enabled).length);

    const summaryCards = computed(() => {
      const uptimeMs = Math.max(0, Date.now() - new Date(state.snapshot.startedAt).getTime());

      return [
        {
          key: "live-connections",
          label: "Live Connections",
          value: state.snapshot.activeConnections.length,
          note: `${state.snapshot.totals.activeRequests} currently occupy backend slots, ${state.snapshot.queueDepth} are queued`,
          title: "Requests currently active inside llmproxy. This includes in-flight requests on a backend and requests waiting in the queue.",
        },
        {
          key: "healthy-backends",
          label: "Healthy Backends",
          value: `${healthyCount.value} / ${enabledCount.value}`,
          note: `${state.snapshot.backends.length} configured in total`,
          title: "Enabled backends that passed their most recent health check.",
        },
        {
          key: "successful-requests",
          label: "Successful Requests",
          value: state.snapshot.totals.successfulRequests,
          note: `${state.snapshot.totals.rejectedRequests} rejected, ${state.snapshot.totals.failedRequests} failed`,
          title: "Successfully completed requests observed since this llmproxy instance started.",
        },
        {
          key: "uptime",
          label: "Uptime",
          value: formatDuration(uptimeMs),
          note: `Started: ${formatDate(state.snapshot.startedAt)}`,
          title: "How long the current llmproxy process has been running.",
        },
      ];
    });

    const requestDetailTitle = computed(() => {
      const entry = state.requestDetail.detail?.entry;
      return entry ? `${entry.method} ${entry.path}` : "Request Details";
    });

    const requestDetailSubtitle = computed(() => {
      const detail = state.requestDetail.detail;
      const entry = detail?.entry;

      if (!entry) {
        return "Inspect the original request payload, messages, tools, and final response.";
      }

      return (
        `${detail?.live ? "Live request" : `req ${shortId(entry.id)}`}` +
        `${entry.model ? ` · model ${entry.model}` : ""}` +
        `${entry.backendName ? ` · backend ${entry.backendName}` : ""}` +
        ` · ${formatDate(entry.time)}` +
        `${detail?.live ? " · still running" : ""}`
      );
    });

    const requestMessages = computed(() => {
      const requestBody = isClientRecord(state.requestDetail.detail?.requestBody)
        ? state.requestDetail.detail?.requestBody
        : null;
      return Array.isArray(requestBody?.messages) ? requestBody.messages : [];
    });

    const requestSummaryBadges = computed(() => {
      const entry = state.requestDetail.detail?.entry;
      if (!entry) {
        return [] as UiBadge[];
      }

      const items: UiBadge[] = [
        badgeSpec(formatDate(entry.time), "neutral", "Time when this request was recorded."),
      ];

      if (entry.backendName) {
        items.push(badgeSpec(`backend ${entry.backendName}`, "good", "Backend chosen for this request."));
      }

      if (entry.statusCode !== undefined) {
        items.push(badgeSpec(`HTTP ${entry.statusCode}`, entry.statusCode >= 500 ? "bad" : "good", "Final upstream status code."));
      }

      items.push(badgeSpec(`latency ${formatDuration(entry.latencyMs)}`, "neutral", "End-to-end request latency."));
      items.push(badgeSpec(`queued ${formatDuration(entry.queuedMs)}`, "neutral", "Time spent waiting for a free backend slot."));

      if (entry.finishReason) {
        items.push(badgeSpec(`finish ${entry.finishReason}`, "good", describeFinishReason(entry.finishReason)));
      }

      return items;
    });

    const requestParamBadges = computed(() => {
      const requestBody = isClientRecord(state.requestDetail.detail?.requestBody)
        ? state.requestDetail.detail?.requestBody
        : null;

      if (!requestBody) {
        return [] as UiBadge[];
      }

      return Object.entries(requestBody)
        .filter(([key, value]) => key !== "messages" && key !== "tools" && value !== undefined)
        .map(([key, value]) => badgeSpec(`${key} ${formatCompactValue(value)}`, "neutral", `Top-level OpenAI request field "${key}".`));
    });

    const requestToolsHtml = computed(() => renderToolsHtml(
      isClientRecord(state.requestDetail.detail?.requestBody)
        ? state.requestDetail.detail?.requestBody.tools
        : undefined,
    ));

    const requestResponseHtml = computed(() => renderResponseChoicesHtml(state.requestDetail.detail?.responseBody));

    const debugMetaBadges = computed(() => {
      const bits: UiBadge[] = [];

      if (state.debug.sending) {
        bits.push(badgeSpec("running", "warn", "A debug request is currently in flight."));
      }

      if (state.debug.status) {
        bits.push(badgeSpec(state.debug.status, "good", "HTTP status returned by the proxied debug request."));
      }

      if (state.debug.backend) {
        bits.push(badgeSpec(`backend ${state.debug.backend}`, "good", "Backend chosen for the current debug session."));
      }

      const liveUsage = formatLiveUsage();
      if (liveUsage) {
        bits.push(badgeSpec(liveUsage, "neutral", "Live token metrics estimated from the streaming response."));
      }

      if (state.debug.usage) {
        bits.push(badgeSpec(state.debug.usage, "neutral", "Final usage/timing metrics returned by the backend."));
      }

      if (state.debug.error) {
        bits.push(badgeSpec(state.debug.error, "bad", "Current debug request error."));
      }

      return bits;
    });

    const pageLinks = computed(() => [
      { page: "overview" as DashboardPage, label: "📊 Overview" },
      { page: "chat" as DashboardPage, label: "💬 Chat Debugger" },
      { page: "backends" as DashboardPage, label: "🧩 Backends" },
    ]);

    function badgeClass(badge: UiBadge): string {
      return badge.className || `badge ${badge.tone ?? "neutral"}`;
    }

    function connectionCardBadges(connection: ActiveConnectionSnapshot): UiBadge[] {
      const items: UiBadge[] = [
        badgeSpec(connection.phase, connection.phase === "queued" ? "warn" : "good", "Current request phase inside llmproxy."),
        badgeSpec(connection.clientStream ? "client stream" : "client json", "neutral", "Whether the downstream client requested streaming."),
        badgeSpec(connection.upstreamStream ? "upstream stream" : "upstream json", "neutral", "llmproxy forces upstream streaming for generation routes to collect live metrics."),
        badgeSpec(`queued ${formatDuration(connection.queueMs)}`, "neutral", "Time spent waiting for a free backend slot before this request started upstream."),
      ];

      if (connection.backendName) {
        items.push(badgeSpec(`backend ${connection.backendName}`, "good", "Backend currently serving this request."));
      }

      if (connection.statusCode !== undefined) {
        items.push(badgeSpec(`HTTP ${connection.statusCode}`, connection.statusCode >= 500 ? "bad" : "good", "Current upstream status code."));
      }

      if (connection.model) {
        items.push(badgeSpec(`model ${connection.model}`, "neutral", "Requested model name."));
      }

      if (connection.finishReason) {
        items.push(badgeSpec(`finish ${connection.finishReason}`, "good", describeFinishReason(connection.finishReason)));
      }

      if (connection.error) {
        items.push(badgeSpec(connection.error, "bad", "Current proxy or upstream error for this live request."));
      }

      return items;
    }

    function connectionMetricBadges(connection: ActiveConnectionSnapshot): UiBadge[] {
      const items: UiBadge[] = [
        badgeSpec(`elapsed ${formatDuration(connection.elapsedMs)}`, "neutral", "How long this request has been active."),
      ];

      if (typeof connection.promptTokens === "number") {
        items.push(badgeSpec(`prompt ${connection.promptTokens}`, "neutral", "Prompt tokens reported or inferred for this request."));
      }

      if (typeof connection.completionTokens === "number") {
        items.push(badgeSpec(`completion ${connection.completionTokens}`, "neutral", "Completion tokens reported or inferred for this request."));
      }

      if (typeof connection.totalTokens === "number") {
        items.push(badgeSpec(`total ${connection.totalTokens}`, "neutral", "Total tokens reported or inferred for this request."));
      }

      if (typeof connection.contentTokens === "number" && connection.contentTokens > 0) {
        items.push(badgeSpec(`content ${connection.contentTokens}`, "neutral", "Completion tokens attributed to normal visible content."));
      }

      if (typeof connection.reasoningTokens === "number" && connection.reasoningTokens > 0) {
        items.push(badgeSpec(`reasoning ${connection.reasoningTokens}`, "neutral", "Completion tokens attributed to reasoning content."));
      }

      if (typeof connection.textTokens === "number" && connection.textTokens > 0) {
        items.push(badgeSpec(`text ${connection.textTokens}`, "neutral", "Completion tokens attributed to legacy text completions."));
      }

      if (typeof connection.timeToFirstTokenMs === "number") {
        items.push(badgeSpec(`ttfb ${formatDuration(connection.timeToFirstTokenMs)}`, "neutral", "Time to first generated token."));
      }

      if (typeof connection.generationMs === "number") {
        items.push(badgeSpec(`gen ${formatDuration(connection.generationMs)}`, "neutral", "Generation phase duration."));
      }

      const tokenRate = formatTokenRate(connection.completionTokensPerSecond);
      if (tokenRate) {
        items.push(badgeSpec(tokenRate, "good", "Completion tokens generated per second."));
      }

      return items;
    }

    function requestOutcomeBadge(entry: RequestLogEntry): UiBadge {
      if (entry.outcome === "success") {
        return badgeSpec("ok", "good", "The request completed successfully.");
      }

      if (entry.outcome === "queued_timeout") {
        return badgeSpec("queue timeout", "warn", "The request timed out while waiting in the queue.");
      }

      if (entry.outcome === "cancelled") {
        return badgeSpec("cancelled", "warn", "The request was cancelled before completion.");
      }

      return badgeSpec("error", "bad", "The request failed while being proxied or upstream.");
    }

    function recentRequestBadges(entry: RequestLogEntry): UiBadge[] {
      const items: UiBadge[] = [
        requestOutcomeBadge(entry),
        badgeSpec(formatDate(entry.time), "neutral", "Time when this request finished and was added to recent history."),
        badgeSpec(`latency ${formatDuration(entry.latencyMs)}`, "neutral", "End-to-end request latency."),
        badgeSpec(`queued ${formatDuration(entry.queuedMs)}`, "neutral", "Time spent waiting for a free backend slot."),
      ];

      if (entry.backendName) {
        items.push(badgeSpec(`backend ${entry.backendName}`, "good", "Backend that served this request."));
      }

      if (entry.model) {
        items.push(badgeSpec(`model ${entry.model}`, "neutral", "Requested model name."));
      }

      if (entry.statusCode !== undefined) {
        items.push(badgeSpec(`HTTP ${entry.statusCode}`, entry.statusCode >= 500 ? "bad" : "good", "Final upstream status code."));
      }

      if (entry.finishReason) {
        items.push(badgeSpec(`finish ${entry.finishReason}`, "good", describeFinishReason(entry.finishReason)));
      }

      if (entry.hasDetail) {
        items.push(badgeSpec("details", "neutral", "Open the full request/response inspector for this request."));
      }

      if (entry.error) {
        items.push(badgeSpec(entry.error, "bad", "Stored error message for this request."));
      }

      return items;
    }

    function recentRequestMetrics(entry: RequestLogEntry): UiBadge[] {
      const items: UiBadge[] = [];

      if (typeof entry.promptTokens === "number") {
        items.push(badgeSpec(`prompt ${entry.promptTokens}`, "neutral", "Prompt tokens reported or inferred for this request."));
      }

      if (typeof entry.completionTokens === "number") {
        items.push(badgeSpec(`completion ${entry.completionTokens}`, "neutral", "Completion tokens reported or inferred for this request."));
      }

      if (typeof entry.totalTokens === "number") {
        items.push(badgeSpec(`total ${entry.totalTokens}`, "neutral", "Total tokens reported or inferred for this request."));
      }

      if (typeof entry.contentTokens === "number" && entry.contentTokens > 0) {
        items.push(badgeSpec(`content ${entry.contentTokens}`, "neutral", "Completion tokens attributed to normal visible content."));
      }

      if (typeof entry.reasoningTokens === "number" && entry.reasoningTokens > 0) {
        items.push(badgeSpec(`reasoning ${entry.reasoningTokens}`, "neutral", "Completion tokens attributed to reasoning content."));
      }

      if (typeof entry.textTokens === "number" && entry.textTokens > 0) {
        items.push(badgeSpec(`text ${entry.textTokens}`, "neutral", "Completion tokens attributed to legacy text completions."));
      }

      if (typeof entry.timeToFirstTokenMs === "number") {
        items.push(badgeSpec(`ttfb ${formatDuration(entry.timeToFirstTokenMs)}`, "neutral", "Time to first generated token."));
      }

      if (typeof entry.generationMs === "number") {
        items.push(badgeSpec(`gen ${formatDuration(entry.generationMs)}`, "neutral", "Generation phase duration."));
      }

      const tokenRate = formatTokenRate(entry.completionTokensPerSecond);
      if (tokenRate) {
        items.push(badgeSpec(tokenRate, "good", "Completion tokens generated per second."));
      }

      return items;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && state.requestDetail.open) {
        closeRequestDetail();
      }
    }

    let started = false;

    function start(): void {
      if (started) {
        return;
      }

      started = true;
      syncBackendDrafts(state.snapshot.backends);
      ensureDebugModel();
      connectLiveFeed();
      void refreshModels();
      window.addEventListener("keydown", handleKeyDown);
    }

    function stop(): void {
      if (!started) {
        return;
      }

      started = false;
      stopLiveFeed();
      stopDebugMetricsTicker();

      if (detailRefreshTimer !== undefined) {
        window.clearTimeout(detailRefreshTimer);
        detailRefreshTimer = undefined;
      }

      window.removeEventListener("keydown", handleKeyDown);
    }

    return reactive({
      state,
      summaryCards,
      requestDetailTitle,
      requestDetailSubtitle,
      requestMessages,
      requestSummaryBadges,
      requestParamBadges,
      requestToolsHtml,
      requestResponseHtml,
      debugMetaBadges,
      badgeClass,
      connectionCardBadges,
      connectionMetricBadges,
      openRequestDetail,
      closeRequestDetail,
      refreshModels,
      saveBackend,
      sendDebugChat,
      stopDebugChat,
      clearDebugChat,
      shortId,
      recentRequestBadges,
      recentRequestMetrics,
      start,
      stop,
    });
}

export type DashboardStore = ReturnType<typeof createDashboardStoreInternal>;

let dashboardStore: DashboardStore | null = null;

export function useDashboardStore(): DashboardStore {
  if (!dashboardStore) {
    dashboardStore = createDashboardStoreInternal();
  }

  return dashboardStore;
}
