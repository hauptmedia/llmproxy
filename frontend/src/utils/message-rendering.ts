import type { RenderMessageOptions, UiBadge } from "../types/dashboard";
import { describeFinishReason, badgeSpec } from "./dashboard-badges";
import { formatUiValue, prettyJson } from "./formatters";
import { isClientRecord } from "./guards";
import { escapeHtml, renderCodeBlockHtml, renderCodeInnerBlock } from "./code-rendering";

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
      const rendered = renderCodeInnerBlock(codeValue);
      const codeClass = "turn-content" + (rendered.isJson || language === "json" ? " json-view" : "");
      blocks.push(`<pre class="${escapeHtml(codeClass)}"><code>${rendered.html}</code></pre>`);
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
    `<details class="reasoning-panel"${collapsed ? "" : " open"}>` +
      `<summary class="reasoning-summary" title="${escapeHtml(
        collapsed
          ? "Model reasoning captured for this message. Expand it to inspect the reasoning output."
          : "Model reasoning captured for this message. Collapse it to focus on the final content.",
      )}">` +
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
              `<div class="message-part-type">${escapeHtml(partType)}</div>` +
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

export function renderMessageHtml(message: Record<string, any>, index: number, options: RenderMessageOptions = {}): string {
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
    `<article class="turn ${escapeHtml(role)}">` +
      `<div class="turn-head">` +
        `<span class="turn-role">${escapeHtml(options.heading ?? `message ${index + 1}`)}</span>` +
        `<div class="message-meta">` +
          metaBits.map((bit) => (
            `<span class="badge ${escapeHtml(bit.tone ?? "neutral")}" title="${escapeHtml(bit.title ?? "")}">${escapeHtml(bit.text)}</span>`
          )).join("") +
        `</div>` +
      `</div>` +
      renderReasoningPanel(message?.reasoning_content, options.reasoningCollapsed ?? false) +
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

export function renderToolsHtml(tools: unknown): string {
  if (!Array.isArray(tools) || tools.length === 0) {
    return '<div class="empty">No tools were included in this request.</div>';
  }

  return tools
    .map((tool, index) => renderDetailBlock(`Tool ${index + 1}`, tool))
    .join("");
}

export function renderResponseChoicesHtml(responseBody: unknown): string {
  if (!isClientRecord(responseBody) || !Array.isArray(responseBody.choices) || responseBody.choices.length === 0) {
    return '<div class="empty">No structured response payload was stored for this request.</div>';
  }

  return responseBody.choices
    .map((choice: Record<string, any>, index: number) => {
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

export function renderTextValue(value: unknown): string {
  return formatUiValue(value);
}
