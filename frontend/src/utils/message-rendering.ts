import type { RenderMessageOptions, UiBadge } from "../types/dashboard";
import { buildModelIdentityBadge, describeFinishReason, badgeSpec } from "./dashboard-badges";
import { formatUiValue, prettyJson } from "./formatters";
import { isClientRecord } from "./guards";
import { escapeHtml, renderCodeBlockHtml, renderCodeInnerBlock } from "./code-rendering";
import {
  encodeJsonAcePayload,
  normalizeInlineAceLanguage,
  serializeCodeAceValue,
} from "./json-ace";

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

  let html = String(markdown ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  html = html.replace(
    new RegExp(String.fromCharCode(96) + "([^" + String.fromCharCode(96) + "\\n]+)" + String.fromCharCode(96), "g"),
    (_match, code) => store(`<code>${code}</code>`),
  );
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, href) => (
    store(`<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${label}</a>`)
  ));
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/(^|[\s(])\*([^*]+)\*(?=[$\s).,!?:;]|$)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[\s(])_([^_]+)_(?=[$\s).,!?:;]|$)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_match, prefix, href) => (
    prefix + store(`<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(href)}</a>`)
  ));

  for (const placeholder of placeholders) {
    html = html.replaceAll(placeholder.token, placeholder.html);
  }

  return html;
}

function isMarkdownFence(line: string): boolean {
  const fence = String.fromCharCode(96).repeat(3);
  return line.trimStart().startsWith(fence);
}

function getMarkdownFenceLanguage(line: string): string {
  return line.trimStart().slice(3).trim().toLowerCase();
}

function isMarkdownBlockBoundary(line: string): boolean {
  return (
    isMarkdownFence(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^>\s?/.test(line)
  );
}

type MarkdownTableAlignment = "left" | "center" | "right" | "";

function splitMarkdownTableRow(line: string): string[] {
  let normalized = line.trim();

  if (normalized.startsWith("|")) {
    normalized = normalized.slice(1);
  }

  if (normalized.endsWith("|")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized.split("|").map((cell) => cell.trim());
}

function parseMarkdownTableAlignments(line: string): MarkdownTableAlignment[] | null {
  const cells = splitMarkdownTableRow(line);
  if (cells.length === 0) {
    return null;
  }

  const alignments: MarkdownTableAlignment[] = [];

  for (const cell of cells) {
    if (!/^:?-{3,}:?$/.test(cell)) {
      return null;
    }

    const startsWithColon = cell.startsWith(":");
    const endsWithColon = cell.endsWith(":");

    if (startsWithColon && endsWithColon) {
      alignments.push("center");
    } else if (endsWithColon) {
      alignments.push("right");
    } else if (startsWithColon) {
      alignments.push("left");
    } else {
      alignments.push("");
    }
  }

  return alignments;
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) {
    return false;
  }

  if (!lines[index].includes("|")) {
    return false;
  }

  const headerCells = splitMarkdownTableRow(lines[index]);
  const alignments = parseMarkdownTableAlignments(lines[index + 1]);

  return headerCells.length > 1 && alignments !== null && alignments.length === headerCells.length;
}

function renderMarkdownTableHtml(
  headerCells: string[],
  alignments: MarkdownTableAlignment[],
  bodyRows: string[][],
): string {
  const normalizedRows = bodyRows.map((row) => {
    const nextRow = [...row];

    while (nextRow.length < headerCells.length) {
      nextRow.push("");
    }

    return nextRow.slice(0, headerCells.length);
  });

  const renderAlignedCell = (tag: "th" | "td", cell: string, index: number) => {
    const alignment = alignments[index];
    const alignAttr = alignment ? ` style="text-align:${alignment}"` : "";
    return `<${tag}${alignAttr}>${renderMarkdownInline(cell)}</${tag}>`;
  };

  return (
    `<div class="markdown-table-wrap">` +
      `<table class="markdown-table">` +
        `<thead><tr>${headerCells.map((cell, index) => renderAlignedCell("th", cell, index)).join("")}</tr></thead>` +
        `<tbody>${normalizedRows.map((row) => `<tr>${row.map((cell, index) => renderAlignedCell("td", cell, index)).join("")}</tr>`).join("")}</tbody>` +
      `</table>` +
    `</div>`
  );
}

function renderMarkdownToHtml(markdown: unknown): string {
  const normalized = String(markdown ?? "").replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    return "";
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

    if (isMarkdownFence(line)) {
      const codeLines: string[] = [];
      const language = getMarkdownFenceLanguage(line);
      index += 1;

      while (index < lines.length && !isMarkdownFence(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && isMarkdownFence(lines[index])) {
        index += 1;
      }

      const codeValue = codeLines.join("\n");
      const aceLanguage = normalizeInlineAceLanguage(language);
      if (aceLanguage) {
        blocks.push(renderEmbeddedContentBubble(aceLanguage, codeValue));
        continue;
      }

      const rendered = renderCodeInnerBlock(codeValue);
      const codeClass = "turn-content" + (rendered.isJson || language === "json" ? " json-view" : "");
      blocks.push(`<pre class="${escapeHtml(codeClass)}"><code>${rendered.html}</code></pre>`);
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const headerCells = splitMarkdownTableRow(lines[index]);
      const alignments = parseMarkdownTableAlignments(lines[index + 1]) ?? headerCells.map(() => "");
      index += 2;

      const bodyRows: string[][] = [];

      while (index < lines.length) {
        const rowLine = lines[index];
        if (!rowLine.trim()) {
          break;
        }

        if (isMarkdownBlockBoundary(rowLine) || !rowLine.includes("|")) {
          break;
        }

        const rowCells = splitMarkdownTableRow(rowLine);
        if (rowCells.length < 2) {
          break;
        }

        bodyRows.push(rowCells);
        index += 1;
      }

      blocks.push(renderMarkdownTableHtml(headerCells, alignments, bodyRows));
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
  const rendered = renderCodeInnerBlock(value);
  if (rendered.isJson) {
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
      `<div class="detail-block-label">${escapeHtml(label)}</div>` +
      renderCodeBlockHtml(value, "turn-content") +
    `</div>`
  );
}

function renderParameterIconHtml(count?: number): string {
  if (typeof count === "number") {
    const countTitle = `${count} ${count === 1 ? "parameter" : "parameters"}`;
    return `<span class="tool-inline-count-icon" aria-hidden="true" title="${escapeHtml(countTitle)}">${count}</span>`;
  }

  return (
    `<span class="tool-inline-icon tool-inline-icon-parameter" aria-hidden="true">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="M9.5 6.75h8"></path>` +
        `<path d="M9.5 12h8"></path>` +
        `<path d="M9.5 17.25h5.5"></path>` +
        `<circle cx="6" cy="6.75" r="1.25"></circle>` +
        `<circle cx="6" cy="12" r="1.25"></circle>` +
        `<circle cx="6" cy="17.25" r="1.25"></circle>` +
      `</svg>` +
    `</span>`
  );
}

function renderToolTitleMarkerHtml(): string {
  return `<span class="tool-title-marker" aria-hidden="true">&lt;/&gt;</span>`;
}

function renderTypeIconHtml(typeLabel: string): string {
  const normalized = typeLabel.trim().toLowerCase();

  if (normalized === "boolean") {
    return (
      `<span class="tool-type-icon" aria-hidden="true">` +
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
          `<rect x="4" y="7" width="16" height="10" rx="5"></rect>` +
          `<circle cx="9" cy="12" r="2.5"></circle>` +
        `</svg>` +
      `</span>`
    );
  }

  if (normalized === "integer" || normalized === "number") {
    return `<span class="tool-type-icon tool-type-icon-text" aria-hidden="true">#</span>`;
  }

  if (normalized === "string") {
    return `<span class="tool-type-icon tool-type-icon-text" aria-hidden="true">"</span>`;
  }

  if (normalized === "array") {
    return `<span class="tool-type-icon tool-type-icon-text" aria-hidden="true">[]</span>`;
  }

  if (normalized === "object") {
    return `<span class="tool-type-icon tool-type-icon-text" aria-hidden="true">{}</span>`;
  }

  if (normalized === "null") {
    return `<span class="tool-type-icon tool-type-icon-text" aria-hidden="true">0</span>`;
  }

  if (normalized === "enum") {
    return `<span class="tool-type-icon tool-type-icon-text" aria-hidden="true">≡</span>`;
  }

  return `<span class="tool-type-icon tool-type-icon-text" aria-hidden="true">•</span>`;
}

function renderTypeBadgeHtml(typeLabel: string, includeIcon = true): string {
  return (
    `<span class="badge neutral tool-type-badge">` +
      (includeIcon ? renderTypeIconHtml(typeLabel) : "") +
      `<span>${escapeHtml(typeLabel)}</span>` +
    `</span>`
  );
}

function renderToolDisclosureHtml(
  label: string,
  bodyHtml: string,
  count: number,
): string {
  if (!bodyHtml) {
    return "";
  }

  return (
      `<details class="tool-disclosure">` +
      `<summary class="tool-disclosure-summary">` +
        `<span class="tool-disclosure-summary-main">` +
          renderParameterIconHtml(count) +
          `<span>${escapeHtml(label)}</span>` +
        `</span>` +
      `</summary>` +
      `<div class="tool-disclosure-body">` +
        `<div class="tool-parameter-panel">` +
          bodyHtml +
        `</div>` +
      `</div>` +
    `</details>`
  );
}

export function hasVisibleMessageContent(content: unknown): boolean {
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

function buildMessageRoleBadgeSpec(message: Record<string, any>, role: string): UiBadge {
  const tooltipParts = [describeMessageRole(role)];

  if (role === "tool" && typeof message.tool_call_id === "string" && message.tool_call_id.length > 0) {
    tooltipParts.push(`tool_call_id: ${message.tool_call_id}`);
  }

  return badgeSpec(`${getMessageRoleEmoji(role)} ${role}`, roleTone(role), tooltipParts.join("\n"));
}

function renderReasoningPanel(reasoningContent: unknown, collapsed: boolean): string {
  if (typeof reasoningContent !== "string" || reasoningContent.length === 0) {
    return "";
  }

  return (
    `<details class="compact-bubble-panel compact-bubble-panel-reasoning"${collapsed ? "" : " open"}>` +
      `<summary class="compact-bubble-summary" title="${escapeHtml(
        collapsed
          ? "Model reasoning captured for this message. Expand it to inspect the reasoning output."
          : "Model reasoning captured for this message. Collapse it to focus on the final content.",
      )}">` +
        `<span aria-hidden="true">🧠</span>` +
        `<span class="compact-bubble-chevron" aria-hidden="true">▼</span>` +
      `</summary>` +
      `<div class="reasoning-content">` +
        renderMessageStringHtml(reasoningContent) +
      `</div>` +
    `</details>`
  );
}

function renderReasoningPanelLive(reasoningContent: unknown, collapsed: boolean, live: boolean): string {
  if (typeof reasoningContent !== "string" || reasoningContent.length === 0) {
    return "";
  }

  return (
    `<details class="compact-bubble-panel compact-bubble-panel-reasoning${live ? " reasoning-live" : ""}"${collapsed ? "" : " open"}>` +
      `<summary class="compact-bubble-summary" title="${escapeHtml(
        collapsed
          ? "Model reasoning captured for this message. Expand it to inspect the reasoning output."
          : "Model reasoning captured for this message. Collapse it to focus on the final content.",
      )}">` +
        `<span class="reasoning-icon" aria-hidden="true">` +
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
            `<path d="M9 7.5a3 3 0 0 1 5.2-2.05A3.2 3.2 0 0 1 19 8.1c0 1.08-.44 2.06-1.16 2.77.75.58 1.23 1.49 1.23 2.51A3.12 3.12 0 0 1 15.95 16.5H15.5a2.5 2.5 0 0 1-4.78.72A2.8 2.8 0 0 1 8.5 18a3 3 0 0 1-2.96-3.43 3.02 3.02 0 0 1-1.54-2.63c0-1.03.5-1.94 1.27-2.52A3.17 3.17 0 0 1 5 8.1a3.2 3.2 0 0 1 4-3.09"></path>` +
            `<path d="M10.5 8.75v6.5"></path>` +
            `<path d="M13.5 8.75v6.5"></path>` +
            `<path d="M8.5 10.5h2"></path>` +
            `<path d="M13.5 10.5h2"></path>` +
          `</svg>` +
        `</span>` +
        `<span class="compact-bubble-chevron" aria-hidden="true">â–¼</span>` +
      `</summary>` +
      `<div class="reasoning-content">` +
        renderMessageStringHtml(reasoningContent) +
      `</div>` +
    `</details>`
  );
}

function renderInlineAceHtml(
  content: unknown,
  language = "json",
  wrapperClass = "inline-ace",
): string {
  if (content === null || content === undefined || content === "") {
    return "";
  }

  const aceLanguage = normalizeInlineAceLanguage(language) ?? "json";
  const serialized = serializeCodeAceValue(content, aceLanguage, "");
  if (!serialized) {
    return "";
  }

  return (
    `<div class="${escapeHtml(wrapperClass)}" data-inline-ace="true" data-ace-language="${escapeHtml(aceLanguage)}">` +
      `<script type="application/json">${encodeJsonAcePayload(serialized)}</script>` +
      `<div class="inline-ace-host"></div>` +
    `</div>`
  );
}

function renderEmbeddedContentIconHtml(): string {
  return (
    `<span class="embedded-content-icon" aria-hidden="true">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="M8 4.75h6l4 4v10.5a1.75 1.75 0 0 1-1.75 1.75H8A1.75 1.75 0 0 1 6.25 19.25V6.5A1.75 1.75 0 0 1 8 4.75Z"></path>` +
        `<path d="M14 4.75V9h4"></path>` +
        `<path d="m9.5 14 1.8-1.8-1.8-1.8"></path>` +
        `<path d="m14.5 14-1.8-1.8 1.8-1.8"></path>` +
      `</svg>` +
    `</span>`
  );
}

function renderToolResponsePanel(content: unknown, collapsed: boolean): string {
  const bodyHtml = renderInlineAceHtml(content, "json");
  if (!bodyHtml) {
    return "";
  }

  return (
    `<details class="compact-bubble-panel compact-bubble-panel-tool"${collapsed ? "" : " open"}>` +
      `<summary class="compact-bubble-summary" title="${escapeHtml(
        collapsed
          ? "Tool response captured for this message. Expand it to inspect the returned payload."
          : "Tool response captured for this message. Collapse it to focus on the conversation flow.",
      )}">` +
        `<span class="tool-response-icon" aria-hidden="true">` +
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
            `<path d="M9 7V6a3 3 0 0 1 6 0v1"></path>` +
            `<path d="M4.75 8.5h14.5"></path>` +
            `<path d="M6.25 8.5h11.5a1.5 1.5 0 0 1 1.5 1.5v6.75a2 2 0 0 1-2 2H6.75a2 2 0 0 1-2-2V10a1.5 1.5 0 0 1 1.5-1.5Z"></path>` +
            `<path d="M10 12h4"></path>` +
            `<path d="M12 10v4"></path>` +
          `</svg>` +
        `</span>` +
        `<span class="compact-bubble-chevron" aria-hidden="true">▼</span>` +
      `</summary>` +
      `<div class="tool-response-content">` +
        bodyHtml +
      `</div>` +
    `</details>`
  );
}

type CompactBubbleDisclosureOptions = {
  kindClass: string;
  contentClass: string;
  iconClass: string;
  iconHtml: string;
  labelText?: string;
  labelTitle?: string;
  bodyHtml: string;
  collapsed: boolean;
  collapsedTitle: string;
  expandedTitle: string;
  extraRootClasses?: string[];
  allowEmptyBody?: boolean;
};

type CompactBubbleStaticOptions = {
  kindClass: string;
  iconClass: string;
  iconHtml: string;
  labelText?: string;
  labelTitle?: string;
  trailingHtml?: string;
  extraRootClasses?: string[];
};

function renderCompactBubbleIconHtml(iconClass: string, iconHtml: string): string {
  if (!iconHtml.trim()) {
    return "";
  }

  return (
    `<span class="compact-bubble-icon ${escapeHtml(iconClass)}" aria-hidden="true">` +
      iconHtml +
    `</span>`
  );
}

function renderCompactBubbleDisclosure(options: CompactBubbleDisclosureOptions): string {
  if (!options.bodyHtml && !options.allowEmptyBody) {
    return "";
  }

  const rootClasses = [
    "compact-bubble-panel",
    options.kindClass,
    ...(options.extraRootClasses ?? []),
  ].filter(Boolean).join(" ");

  return (
    `<details class="${escapeHtml(rootClasses)}"${options.collapsed ? "" : " open"}>` +
      `<summary class="compact-bubble-summary" title="${escapeHtml(
        options.collapsed ? options.collapsedTitle : options.expandedTitle,
      )}">` +
        renderCompactBubbleIconHtml(options.iconClass, options.iconHtml) +
        (options.labelText
          ? `<span class="compact-bubble-label"${options.labelTitle ? ` title="${escapeHtml(options.labelTitle)}"` : ""}>${escapeHtml(options.labelText)}</span>`
          : "") +
        `<span class="compact-bubble-chevron" aria-hidden="true"></span>` +
      `</summary>` +
      (options.bodyHtml
        ? (
          `<div class="compact-bubble-content ${escapeHtml(options.contentClass)}">` +
            options.bodyHtml +
          `</div>`
        )
        : "") +
    `</details>`
  );
}

function renderLiveReasoningContentHtml(reasoningContent: string): string {
  return (
    `<div class="reasoning-stream-content">` +
      escapeHtml(reasoningContent).replace(/\n/g, "<br />") +
    `</div>`
  );
}

function renderCompactBubbleStatic(options: CompactBubbleStaticOptions): string {
  const rootClasses = [
    "compact-bubble-panel",
    options.kindClass,
    "compact-bubble-static",
    ...(options.extraRootClasses ?? []),
  ].filter(Boolean).join(" ");

  return (
    `<div class="${escapeHtml(rootClasses)}">` +
      `<div class="compact-bubble-summary compact-bubble-summary-static">` +
        renderCompactBubbleIconHtml(options.iconClass, options.iconHtml) +
        (options.labelText
          ? `<span class="compact-bubble-label"${options.labelTitle ? ` title="${escapeHtml(options.labelTitle)}"` : ""}>${escapeHtml(options.labelText)}</span>`
          : "") +
        (options.trailingHtml ?? "") +
      `</div>` +
    `</div>`
  );
}

function renderReasoningBubble(reasoningContent: unknown, collapsed: boolean, live: boolean): string {
  if (typeof reasoningContent !== "string" || reasoningContent.length === 0) {
    return "";
  }

  const bodyHtml = collapsed
    ? ""
    : (live ? renderLiveReasoningContentHtml(reasoningContent) : renderMessageStringHtml(reasoningContent));

  return (
    `<div class="compact-bubble-panel compact-bubble-panel-reasoning${live ? " reasoning-live" : ""}${collapsed ? "" : " is-open"}">` +
      `<button type="button" class="compact-bubble-summary compact-bubble-summary-button" title="${escapeHtml(
        collapsed
          ? "Model reasoning captured for this message. Expand it to inspect the reasoning output."
          : "Model reasoning captured for this message. Collapse it to focus on the final content.",
      )}">` +
        `<span class="compact-bubble-icon reasoning-icon" aria-hidden="true">` +
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
            `<path d="M9 7.5a3 3 0 0 1 5.2-2.05A3.2 3.2 0 0 1 19 8.1c0 1.08-.44 2.06-1.16 2.77.75.58 1.23 1.49 1.23 2.51A3.12 3.12 0 0 1 15.95 16.5H15.5a2.5 2.5 0 0 1-4.78.72A2.8 2.8 0 0 1 8.5 18a3 3 0 0 1-2.96-3.43 3.02 3.02 0 0 1-1.54-2.63c0-1.03.5-1.94 1.27-2.52A3.17 3.17 0 0 1 5 8.1a3.2 3.2 0 0 1 4-3.09"></path>` +
            `<path d="M10.5 8.75v6.5"></path>` +
            `<path d="M13.5 8.75v6.5"></path>` +
            `<path d="M8.5 10.5h2"></path>` +
            `<path d="M13.5 10.5h2"></path>` +
          `</svg>` +
        `</span>` +
        `<span class="compact-bubble-chevron" aria-hidden="true">▼</span>` +
      `</button>` +
      (bodyHtml
        ? (
          `<div class="compact-bubble-content reasoning-content">` +
            bodyHtml +
          `</div>`
        )
        : "") +
    `</div>`
  );
}

function renderToolCallIconHtml(): string {
  return (
    `<span class="tool-flow-icon" aria-hidden="true">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="M14.8 4.9a3.5 3.5 0 0 0 4.3 4.3l-4.9 4.9a2.3 2.3 0 0 1-3.25 0l-.85-.85a2.3 2.3 0 0 1 0-3.25Z"></path>` +
        `<path d="m9.9 14.1-3.7 3.7"></path>` +
        `<path d="M5.5 18.4 4.4 19.5"></path>` +
        `<path d="M15.1 8.9 18.8 5.2"></path>` +
        `<circle cx="8.35" cy="15.65" r="0.85" fill="currentColor" stroke="none"></circle>` +
      `</svg>` +
    `</span>`
  );
}

function renderToolReturnIconHtml(): string {
  return "";
}

function renderToolPayloadBubble(options: {
  bodyHtml: string;
  collapsed: boolean;
  labelText: string;
  labelTitle?: string;
  iconHtml: string;
  collapsedTitle: string;
  expandedTitle: string;
  kindClass?: string;
  contentClass?: string;
  iconClass?: string;
  extraRootClasses?: string[];
}): string {
  if (!options.bodyHtml) {
    return renderCompactBubbleStatic({
      kindClass: options.kindClass ?? "compact-bubble-panel-tool",
      iconClass: options.iconClass ?? "tool-response-icon",
      iconHtml: options.iconHtml,
      labelText: options.labelText,
      labelTitle: options.labelTitle,
      extraRootClasses: options.extraRootClasses ?? ["compact-bubble-static-tool"],
    });
  }

  return renderCompactBubbleDisclosure({
    kindClass: options.kindClass ?? "compact-bubble-panel-tool",
    contentClass: options.contentClass ?? "tool-response-content",
    iconClass: options.iconClass ?? "tool-response-icon",
    iconHtml: options.iconHtml,
    labelText: options.labelText,
    labelTitle: options.labelTitle,
    bodyHtml: options.bodyHtml,
    collapsed: options.collapsed,
    collapsedTitle: options.collapsedTitle,
    expandedTitle: options.expandedTitle,
    extraRootClasses: options.extraRootClasses,
  });
}

function renderToolResponseBubble(content: unknown, collapsed: boolean, toolName: string, toolCallId: string): string {
  return renderToolPayloadBubble({
    bodyHtml: renderInlineAceHtml(content, "json"),
    collapsed,
    labelText: toolName || "Tool response",
    labelTitle: toolCallId ? `Tool call id: ${toolCallId}` : "",
    iconHtml: renderToolReturnIconHtml(),
    collapsedTitle: "Tool response captured for this message. Expand it to inspect the returned payload.",
    expandedTitle: "Tool response captured for this message. Collapse it to focus on the conversation flow.",
  });
}

function renderPendingAssistantIndicator(title: string): string {
  return (
    `<div class="chat-loading-indicator"${title ? ` title="${escapeHtml(title)}"` : ""}>` +
      `<span class="chat-loading-spinner" aria-hidden="true"></span>` +
    `</div>`
  );
}

function renderEmbeddedContentBubble(language: string, content: unknown): string {
  const aceLanguage = normalizeInlineAceLanguage(language);
  if (!aceLanguage) {
    return "";
  }

  return renderToolPayloadBubble({
    bodyHtml: renderInlineAceHtml(content, aceLanguage, "inline-ace embedded-inline-ace"),
    collapsed: true,
    labelText: aceLanguage,
    iconHtml: renderEmbeddedContentIconHtml(),
    kindClass: "compact-bubble-panel-embedded",
    contentClass: "embedded-content",
    iconClass: "embedded-content-icon-shell",
    extraRootClasses: ["compact-bubble-static-embedded"],
    collapsedTitle: `Embedded ${aceLanguage} block. Expand it to inspect the content.`,
    expandedTitle: `Embedded ${aceLanguage} block. Collapse it to focus on the surrounding message.`,
  });
}

function renderPendingToolBubble(toolName: string, toolCallId: string, title: string): string {
    return renderCompactBubbleStatic({
      kindClass: "compact-bubble-panel-tool",
      iconClass: "tool-response-icon",
      iconHtml: renderToolReturnIconHtml(),
      labelText: toolName || "Tool response",
      labelTitle: toolCallId ? `Tool call id: ${toolCallId}` : undefined,
      trailingHtml: `<span class="chat-loading-spinner compact-bubble-inline-spinner compact-bubble-trailing-spinner" aria-hidden="true"></span>`,
      extraRootClasses: ["compact-bubble-static-tool", "compact-bubble-pending-tool"],
    }).replace(
    '<div class="compact-bubble-summary compact-bubble-summary-static">',
    `<div class="compact-bubble-summary compact-bubble-summary-static"${title ? ` title="${escapeHtml(title)}"` : ""}>`,
  );
}

function renderMessageContentHtml(content: unknown): string {
  if (typeof content === "string") {
    return renderMessageStringHtml(content);
  }

  if (Array.isArray(content)) {
    if (content.length === 0) {
      return "";
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
              `<div class="message-part-type">${escapeHtml(partType)}</div>` +
              renderMessageStringHtml(displayValue) +
            `</div>`
          );
        }).join("") +
      `</div>`
    );
  }

  if (content === null) {
    return "";
  }

  if (content === undefined) {
    return "";
  }

  return renderDetailBlock("Content", content);
}

export function renderMessageHtml(message: Record<string, any>, index: number, options: RenderMessageOptions = {}): string {
  const role = typeof message?.role === "string" ? message.role : (options.role ?? "unknown");
  const reasoningLive =
    typeof message?.reasoning_content === "string" &&
    message.reasoning_content.length > 0 &&
    !(typeof options.finishReason === "string" && options.finishReason.length > 0);
  const reasoningOnly =
    typeof message?.reasoning_content === "string" &&
    message.reasoning_content.length > 0 &&
    !hasVisibleMessageContent(message?.content) &&
    !(typeof message?.refusal === "string" && message.refusal.length > 0) &&
    !isClientRecord(message?.function_call) &&
    !Array.isArray(message?.tool_calls);
  const toolResponseOnly =
    role === "tool" &&
    hasVisibleMessageContent(message?.content) &&
    !(typeof message?.refusal === "string" && message.refusal.length > 0) &&
    !isClientRecord(message?.function_call) &&
    !Array.isArray(message?.tool_calls) &&
    !(typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0);
  const toolCallOnly =
    role === "assistant" &&
    Array.isArray(message?.tool_calls) &&
    message.tool_calls.length > 0 &&
    !hasVisibleMessageContent(message?.content) &&
    !(typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0) &&
    !(typeof message?.refusal === "string" && message.refusal.length > 0) &&
    !isClientRecord(message?.function_call) &&
    !(typeof message?.audio === "object" && message.audio !== null);
  const pendingAssistantOnly =
    role === "assistant" &&
    message?.pending === true &&
    !hasVisibleMessageContent(message?.content) &&
    !(typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0) &&
    !(typeof message?.refusal === "string" && message.refusal.length > 0) &&
    !isClientRecord(message?.function_call) &&
    !Array.isArray(message?.tool_calls);
  const pendingToolOnly =
    role === "tool" &&
    message?.pending === true &&
    !hasVisibleMessageContent(message?.content) &&
    !(typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0) &&
    !(typeof message?.refusal === "string" && message.refusal.length > 0) &&
    !isClientRecord(message?.function_call) &&
    !Array.isArray(message?.tool_calls);
  const metaBits: UiBadge[] = [];

  if (!options.hideRoleBadge && role !== "user" && role !== "assistant") {
    metaBits.push(buildMessageRoleBadgeSpec(message, role));
  }

  if (!options.hideModelBadge && role === "assistant" && typeof message?.model === "string" && message.model.length > 0) {
    metaBits.push(buildModelIdentityBadge(message.model));
  }

  if (!options.hideToolMetaBadges && role === "tool" && typeof message?.name === "string" && message.name.length > 0) {
    metaBits.push(badgeSpec(`tool ${message.name}`, "warn", "Tool name associated with this tool response."));
  } else if (role !== "tool" && typeof message?.name === "string" && message.name.length > 0) {
    metaBits.push(badgeSpec(`name ${message.name}`, "warn", "Optional message name field."));
  }

  if (!options.hideToolMetaBadges && role === "tool" && typeof message?.tool_call_id === "string" && message.tool_call_id.length > 0) {
    metaBits.push(badgeSpec(`call ${message.tool_call_id}`, "neutral", "Tool call id that this tool response belongs to."));
  }

  if (!options.hideFinishBadge && typeof options.finishReason === "string" && options.finishReason.length > 0) {
    metaBits.push(badgeSpec(`finish ${options.finishReason}`, "good", describeFinishReason(options.finishReason)));
  }

  if (Array.isArray(options.extraBadges) && options.extraBadges.length > 0) {
    metaBits.push(...options.extraBadges);
  }

  const hasHead = Boolean(options.heading) || metaBits.length > 0;

  return (
    `<article class="turn ${escapeHtml(role)}${(reasoningOnly || toolResponseOnly || toolCallOnly || pendingToolOnly) ? " compact-bubble-only" : ""}${reasoningOnly ? " reasoning-only" : ""}${(toolResponseOnly || pendingToolOnly) ? " tool-response-only" : ""}${toolCallOnly ? " tool-call-only" : ""}${(pendingAssistantOnly || pendingToolOnly) ? " pending-only" : ""}">` +
      (hasHead
        ? (
          `<div class="turn-head">` +
            (options.heading
              ? `<span class="turn-role">${escapeHtml(options.heading)}</span>`
              : "") +
            `<div class="message-meta">` +
              metaBits.map((bit) => (
                `<span class="badge ${escapeHtml(bit.tone ?? "neutral")}" title="${escapeHtml(bit.title ?? "")}">${escapeHtml(bit.text)}</span>`
              )).join("") +
            `</div>` +
          `</div>`
        )
        : "") +
      renderReasoningBubble(message?.reasoning_content, options.reasoningCollapsed ?? true, reasoningLive) +
      (pendingAssistantOnly
        ? renderPendingAssistantIndicator(typeof message?.pending_title === "string" ? message.pending_title : "")
        : pendingToolOnly
        ? renderPendingToolBubble(
            typeof message?.name === "string" ? message.name : "",
            typeof message?.tool_call_id === "string" ? message.tool_call_id : "",
            typeof message?.pending_title === "string" ? message.pending_title : "",
          )
        : ((hasVisibleMessageContent(message?.content) || !message?.reasoning_content)
        ? (role === "tool"
          ? renderToolResponseBubble(
              message?.content,
              true,
              typeof message?.name === "string" ? message.name : "",
              typeof message?.tool_call_id === "string" ? message.tool_call_id : "",
            )
          : renderMessageContentHtml(message?.content))
        : "")) +
      (typeof message?.refusal === "string" && message.refusal.length > 0
        ? renderDetailBlock("Refusal", message.refusal)
        : "") +
      (isClientRecord(message?.function_call)
        ? renderFunctionInvocationHtml("Function Call", message.function_call, { note: "Legacy function call" })
        : (message?.function_call ? renderDetailBlock("Function Call", message.function_call) : "")) +
      (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0
        ? message.tool_calls.map((toolCall: unknown, toolIndex: number) => {
            if (isClientRecord(toolCall) && isClientRecord(toolCall.function)) {
              return renderFunctionInvocationHtml(`Tool Call ${toolIndex + 1}`, toolCall.function, {
                id: typeof toolCall.id === "string" ? toolCall.id : "",
                type: typeof toolCall.type === "string" ? toolCall.type : "",
              });
            }

            return renderDetailBlock(`Tool Call ${toolIndex + 1}`, toolCall);
          }).join("")
        : "") +
      (typeof message?.audio === "object" && message.audio !== null
        ? renderDetailBlock("Audio", message.audio)
        : "") +
    `</article>`
  );
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function schemaTypeLabel(schema: Record<string, any>): string {
  if (typeof schema.type === "string" && schema.type.trim()) {
    return schema.type.trim();
  }

  if (Array.isArray(schema.type)) {
    const labels = schema.type.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (labels.length > 0) {
      return labels.join(" | ");
    }
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return "enum";
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return pluralize(schema.oneOf.length, "variant");
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return pluralize(schema.anyOf.length, "option");
  }

  return "value";
}

function schemaNotes(schema: Record<string, any>): string[] {
  const notes: string[] = [];

  if (typeof schema.format === "string" && schema.format.trim()) {
    notes.push(`format ${schema.format.trim()}`);
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum.slice(0, 4).map((item) => formatUiValue(item)).filter(Boolean);
    if (values.length > 0) {
      const suffix = schema.enum.length > values.length ? ", ..." : "";
      notes.push(`one of ${values.join(", ")}${suffix}`);
    }
  }

  if (typeof schema.minLength === "number") {
    notes.push(`min length ${schema.minLength}`);
  }

  if (typeof schema.maxLength === "number") {
    notes.push(`max length ${schema.maxLength}`);
  }

  if (typeof schema.minimum === "number") {
    notes.push(`min ${schema.minimum}`);
  }

  if (typeof schema.maximum === "number") {
    notes.push(`max ${schema.maximum}`);
  }

  if (typeof schema.minItems === "number") {
    notes.push(`min items ${schema.minItems}`);
  }

  if (typeof schema.maxItems === "number") {
    notes.push(`max items ${schema.maxItems}`);
  }

  if (schema.type === "array" && isClientRecord(schema.items)) {
    notes.push(`items ${schemaTypeLabel(schema.items)}`);
  }

  if (schema.type === "object" && isClientRecord(schema.properties)) {
    notes.push(`${pluralize(Object.keys(schema.properties).length, "field")}`);
  }

  return notes;
}

function renderToolParameterHtml(
  name: string,
  definition: unknown,
  requiredNames: Set<string>,
): string {
  const schema = isClientRecord(definition) ? definition : null;
  const typeLabel = schema ? schemaTypeLabel(schema) : "value";
  const description =
    schema && typeof schema.description === "string" && schema.description.trim().length > 0
      ? schema.description.trim()
      : "";
  const notes = schema ? schemaNotes(schema) : [];

    return (
      `<div class="tool-parameter-row">` +
        `<div class="tool-parameter-head">` +
          `<span class="tool-parameter-name"><span class="tool-parameter-type-label">${escapeHtml(typeLabel)}</span><span>${escapeHtml(name)}</span></span>` +
          `<span class="badge ${requiredNames.has(name) ? "good" : "neutral"}">${requiredNames.has(name) ? "required" : "optional"}</span>` +
        `</div>` +
      (description ? `<div class="tool-parameter-description">${escapeHtml(description)}</div>` : "") +
      (notes.length > 0 ? `<div class="tool-parameter-note">${escapeHtml(notes.join(" • "))}</div>` : "") +
    `</div>`
  );
}

function parseStructuredArguments(value: unknown): unknown {
  let current = value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (typeof current !== "string") {
      return current;
    }

    const trimmed = current.trim();
    if (!trimmed) {
      return current;
    }

    try {
      current = JSON.parse(trimmed);
    } catch {
      return current;
    }
  }

  return current;
}

function valueTypeLabel(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  if (isClientRecord(value)) {
    return "object";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value;
  }

  return "value";
}

function renderInvocationValueHtml(value: unknown): string {
  if (typeof value === "string") {
    return renderMessageStringHtml(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return `<div class="tool-parameter-description mono">${escapeHtml(formatUiValue(value) || "null")}</div>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '<div class="tool-parameter-note">Empty array.</div>';
    }

    return (
      `<div class="tool-argument-tree">` +
        value.map((item, index) => renderInvocationNodeHtml(`[${index}]`, item)).join("") +
      `</div>`
    );
  }

  if (isClientRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '<div class="tool-parameter-note">Empty object.</div>';
    }

    return (
      `<div class="tool-argument-tree">` +
        entries.map(([key, item]) => renderInvocationNodeHtml(key, item)).join("") +
      `</div>`
    );
  }

  return `<div class="tool-parameter-description">${escapeHtml(formatUiValue(value) || "n/a")}</div>`;
}

function renderInvocationNodeHtml(name: string, value: unknown): string {
  return (
    `<div class="tool-parameter-row">` +
      `<div class="tool-parameter-head">` +
        `<span class="tool-parameter-name"><span class="tool-parameter-type-label">${escapeHtml(valueTypeLabel(value))}</span><span>${escapeHtml(name)}</span></span>` +
      `</div>` +
      renderInvocationValueHtml(value) +
    `</div>`
  );
}

function renderInvocationTableValueHtml(value: unknown): string {
  if (typeof value === "string") {
    return renderMessageStringHtml(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return `<div class="tool-parameter-description mono">${escapeHtml(formatUiValue(value) || "null")}</div>`;
  }

  if (Array.isArray(value) || isClientRecord(value)) {
    return renderInvocationValueHtml(value);
  }

  return `<div class="tool-parameter-description">${escapeHtml(formatUiValue(value) || "n/a")}</div>`;
}

function renderInvocationArgumentListHtml(value: unknown): string {
  if (isClientRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "";
    }

    return (
      `<div class="tool-parameter-list">` +
        entries.map(([key, item]) => renderInvocationNodeHtml(key, item)).join("") +
      `</div>`
    );
  }

  if (value === undefined || value === null || value === "") {
    return "";
  }

  return (
    `<div class="tool-parameter-list">` +
      renderInvocationNodeHtml("value", value) +
    `</div>`
  );
}

function hasInvocationPayload(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (isClientRecord(value)) {
    return Object.keys(value).length > 0;
  }

  return true;
}

function renderFunctionInvocationHtml(
  label: string,
  payload: Record<string, any>,
  options: { id?: string; type?: string; note?: string } = {},
): string {
  const name =
    typeof payload.name === "string" && payload.name.trim().length > 0
      ? payload.name.trim()
      : label;
  const hoverDetails = [
    options.id ? `call id: ${options.id}` : "",
    options.type && options.type !== "function" ? `type: ${options.type}` : "",
  ].filter(Boolean).join("\n");
  const argumentsValue = parseStructuredArguments(payload.arguments);
  const rawArgumentsHtml = hasInvocationPayload(argumentsValue)
    ? renderInlineAceHtml(argumentsValue, "json")
    : "";
  return renderToolPayloadBubble({
    bodyHtml: rawArgumentsHtml,
    collapsed: true,
    labelText: name,
    labelTitle: hoverDetails || undefined,
    iconHtml: renderToolCallIconHtml(),
    extraRootClasses: ["function-call-bubble"],
    collapsedTitle: "Tool call captured for this assistant message. Expand it to inspect the sent arguments.",
    expandedTitle: "Tool call captured for this assistant message. Collapse it to focus on the conversation flow.",
  });
}

function renderFunctionToolHtml(tool: Record<string, any>, index: number): string {
  const fn = isClientRecord(tool.function) ? tool.function : null;
  const name =
    fn && typeof fn.name === "string" && fn.name.trim().length > 0
      ? fn.name.trim()
      : `Tool ${index + 1}`;
  const description =
    fn && typeof fn.description === "string" && fn.description.trim().length > 0
      ? fn.description.trim()
      : "";
  const schema = fn && isClientRecord(fn.parameters) ? fn.parameters : null;
  const properties =
    schema && isClientRecord(schema.properties)
      ? Object.entries(schema.properties)
      : [];
  const requiredNames = new Set(
    schema && Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [],
  );

  const summaryBadges = [
    schema?.additionalProperties !== false
      ? `<span class="badge neutral" title="${escapeHtml("Additional undeclared fields are allowed in this tool's arguments object. The model may send keys that are not listed in the declared parameter schema.")}">extra fields allowed</span>`
      : "",
    typeof fn?.strict === "boolean" ? `<span class="badge ${fn.strict ? "good" : "neutral"}">${fn.strict ? "strict" : "non-strict"}</span>` : "",
  ].filter(Boolean).join("");
  const parametersHtml = properties
    .map(([propertyName, propertyDefinition]) => renderToolParameterHtml(propertyName, propertyDefinition, requiredNames))
    .join("");

    return (
      `<article class="tool-definition-card">` +
        `<div class="tool-definition-head">` +
          `<div>` +
            `<div class="tool-definition-title">${renderToolTitleMarkerHtml()}<span>${escapeHtml(name)}</span></div>` +
          `</div>` +
          (summaryBadges ? `<div class="message-meta">${summaryBadges}</div>` : "") +
        `</div>` +
      (description ? `<p class="tool-definition-description">${escapeHtml(description)}</p>` : "") +
      renderToolDisclosureHtml(
        "Parameters",
        properties.length > 0 ? `<div class="tool-parameter-list">${parametersHtml}</div>` : "",
        properties.length,
      ) +
    `</article>`
  );
}

function renderGenericToolHtml(tool: Record<string, any>, index: number): string {
  const toolType =
    typeof tool.type === "string" && tool.type.trim().length > 0
      ? tool.type.trim()
      : `tool-${index + 1}`;
  const fields = Object.entries(tool).filter(([key]) => key !== "type");
  const fieldsHtml = fields.map(([key, value]) => (
    `<div class="tool-parameter-row">` +
      `<div class="tool-parameter-head">` +
        `<span class="tool-parameter-name">${renderParameterIconHtml()}<span>${escapeHtml(key)}</span></span>` +
      `</div>` +
      `<div class="tool-parameter-description">${escapeHtml(formatUiValue(value) || "n/a")}</div>` +
    `</div>`
  )).join("");

    return (
      `<article class="tool-definition-card">` +
        `<div class="tool-definition-head">` +
          `<div>` +
              `<div class="tool-definition-title">${renderToolTitleMarkerHtml()}<span>${escapeHtml(toolType)}</span></div>` +
            `<div class="tool-definition-subtitle">Tool ${index + 1}</div>` +
          `</div>` +
          `<div class="message-meta"><span class="badge neutral">${escapeHtml(toolType)}</span></div>` +
        `</div>` +
        renderToolDisclosureHtml(
          "Parameters",
          fields.length > 0 ? `<div class="tool-parameter-list">${fieldsHtml}</div>` : "",
          fields.length,
        ) +
    `</article>`
  );
}

export function renderToolsHtml(tools: unknown): string {
  if (!Array.isArray(tools) || tools.length === 0) {
    return '<div class="empty">No tools were included in this request.</div>';
  }

  return (
    `<div class="tool-definition-list">` +
      tools.map((tool, index) => {
        if (!isClientRecord(tool)) {
            return (
             `<article class="tool-definition-card">` +
               `<div class="tool-definition-head">` +
                  `<div>` +
                   `<div class="tool-definition-title">${renderToolTitleMarkerHtml()}<span>Tool ${index + 1}</span></div>` +
                   `<div class="tool-definition-subtitle">Stored tool payload</div>` +
                  `</div>` +
                `</div>` +
              `<div class="tool-parameter-description">${escapeHtml(formatUiValue(tool) || "No readable tool payload was stored.")}</div>` +
            `</article>`
          );
        }

        if (tool.type === "function" && isClientRecord(tool.function)) {
          return renderFunctionToolHtml(tool, index);
        }

        return renderGenericToolHtml(tool, index);
      }).join("") +
    `</div>`
  );
}

export function renderTextValue(value: unknown): string {
  return formatUiValue(value);
}
