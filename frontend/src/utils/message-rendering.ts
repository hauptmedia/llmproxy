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
  const metaBits: UiBadge[] = [
    buildMessageRoleBadgeSpec(message, role),
  ];

  if (role === "tool" && typeof message?.name === "string" && message.name.length > 0) {
    metaBits.push(badgeSpec(`tool ${message.name}`, "warn", "Tool name associated with this tool response."));
  } else if (typeof message?.name === "string" && message.name.length > 0) {
    metaBits.push(badgeSpec(`name ${message.name}`, "warn", "Optional message name field."));
  }

  if (role === "tool" && typeof message?.tool_call_id === "string" && message.tool_call_id.length > 0) {
    metaBits.push(badgeSpec(`call ${message.tool_call_id}`, "neutral", "Tool call id that this tool response belongs to."));
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
        (options.heading
          ? `<span class="turn-role">${escapeHtml(options.heading)}</span>`
          : "") +
        `<div class="message-meta">` +
          metaBits.map((bit) => (
            `<span class="badge ${escapeHtml(bit.tone ?? "neutral")}" title="${escapeHtml(bit.title ?? "")}">${escapeHtml(bit.text)}</span>`
          )).join("") +
        `</div>` +
      `</div>` +
      renderReasoningPanel(message?.reasoning_content, options.reasoningCollapsed ?? true) +
      ((hasVisibleMessageContent(message?.content) || !message?.reasoning_content)
        ? renderMessageContentHtml(message?.content)
        : "") +
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
        `<span class="tool-parameter-name">${escapeHtml(name)}</span>` +
        `<span class="badge ${requiredNames.has(name) ? "good" : "neutral"}">${requiredNames.has(name) ? "required" : "optional"}</span>` +
        `<span class="badge neutral">${escapeHtml(typeLabel)}</span>` +
      `</div>` +
      (description ? `<div class="tool-parameter-description">${escapeHtml(description)}</div>` : "") +
      (notes.length > 0 ? `<div class="tool-parameter-note">${escapeHtml(notes.join(" • "))}</div>` : "") +
    `</div>`
  );
}

function parseStructuredArguments(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
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
        `<span class="tool-parameter-name">${escapeHtml(name)}</span>` +
        `<span class="badge neutral">${escapeHtml(valueTypeLabel(value))}</span>` +
      `</div>` +
      renderInvocationValueHtml(value) +
    `</div>`
  );
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
  const summaryBadges = [
    options.id ? `<span class="badge neutral">id ${escapeHtml(options.id)}</span>` : "",
    options.type && options.type !== "function" ? `<span class="badge neutral">${escapeHtml(options.type)}</span>` : "",
  ].filter(Boolean).join("");
  const argumentsValue = parseStructuredArguments(payload.arguments);
  const argumentRows = isClientRecord(argumentsValue)
    ? Object.entries(argumentsValue).map(([key, value]) => renderInvocationNodeHtml(key, value)).join("")
    : renderInvocationNodeHtml("value", argumentsValue);

  return (
    `<article class="tool-definition-card">` +
      `<div class="tool-definition-head">` +
        `<div>` +
          `<div class="tool-definition-title">${escapeHtml(name)}</div>` +
          (options.note ? `<div class="tool-definition-subtitle">${escapeHtml(options.note)}</div>` : "") +
        `</div>` +
        (summaryBadges ? `<div class="message-meta">${summaryBadges}</div>` : "") +
      `</div>` +
      `<div class="tool-parameter-list">` +
        argumentRows +
      `</div>` +
    `</article>`
  );
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
    schema?.additionalProperties === false ? `<span class="badge warn">no extra fields</span>` : "",
    typeof fn?.strict === "boolean" ? `<span class="badge ${fn.strict ? "good" : "neutral"}">${fn.strict ? "strict" : "non-strict"}</span>` : "",
  ].filter(Boolean).join("");

  return (
    `<article class="tool-definition-card">` +
      `<div class="tool-definition-head">` +
        `<div>` +
          `<div class="tool-definition-title">${escapeHtml(name)}</div>` +
        `</div>` +
        (summaryBadges ? `<div class="message-meta">${summaryBadges}</div>` : "") +
      `</div>` +
      (description ? `<p class="tool-definition-description">${escapeHtml(description)}</p>` : "") +
      (properties.length > 0
        ? (
            `<div class="tool-parameter-list">` +
              properties.map(([propertyName, propertyDefinition]) => renderToolParameterHtml(propertyName, propertyDefinition, requiredNames)).join("") +
            `</div>`
          )
        : '<div class="empty">This tool did not declare any top-level JSON schema properties.</div>') +
    `</article>`
  );
}

function renderGenericToolHtml(tool: Record<string, any>, index: number): string {
  const toolType =
    typeof tool.type === "string" && tool.type.trim().length > 0
      ? tool.type.trim()
      : `tool-${index + 1}`;
  const fields = Object.entries(tool).filter(([key]) => key !== "type");

  return (
    `<article class="tool-definition-card">` +
      `<div class="tool-definition-head">` +
        `<div>` +
          `<div class="tool-definition-title">${escapeHtml(toolType)}</div>` +
          `<div class="tool-definition-subtitle">Tool ${index + 1}</div>` +
        `</div>` +
        `<div class="message-meta"><span class="badge neutral">${escapeHtml(toolType)}</span></div>` +
      `</div>` +
      (fields.length > 0
        ? (
            `<div class="tool-parameter-list">` +
              fields.map(([key, value]) => (
                `<div class="tool-parameter-row">` +
                  `<div class="tool-parameter-head">` +
                    `<span class="tool-parameter-name">${escapeHtml(key)}</span>` +
                  `</div>` +
                  `<div class="tool-parameter-description">${escapeHtml(formatUiValue(value) || "n/a")}</div>` +
                `</div>`
              )).join("") +
            `</div>`
          )
        : '<div class="empty">No additional configuration fields were stored for this tool.</div>') +
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
                  `<div class="tool-definition-title">Tool ${index + 1}</div>` +
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

function isStreamingReasoning(reasoningContent: unknown, finishReason: unknown, live: boolean): boolean {
  return (
    live &&
    typeof reasoningContent === "string" &&
    reasoningContent.length > 0 &&
    !(typeof finishReason === "string" && finishReason.length > 0)
  );
}

export function renderResponseChoicesHtml(responseBody: unknown, live = false): string {
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
          reasoningCollapsed: !isStreamingReasoning(choice.message.reasoning_content, choice.finish_reason, live),
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
