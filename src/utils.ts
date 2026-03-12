import { IncomingMessage, ServerResponse } from "node:http";

export function joinUrl(baseUrl: string, pathAndSearch: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const path = pathAndSearch.startsWith("/") ? pathAndSearch : `/${pathAndSearch}`;
  return `${base}${path}`;
}

export async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export function tryParseJsonBuffer(buffer: Buffer, contentType?: string): Record<string, unknown> | undefined {
  if (buffer.length === 0) {
    return undefined;
  }

  if (!contentType || !contentType.toLowerCase().includes("application/json")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(buffer.toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const serialized = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(serialized);
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const causeMessage = readErrorCauseMessage(error);
    if (causeMessage && causeMessage !== error.message) {
      return `${error.message} (${causeMessage})`;
    }

    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

function readErrorCauseMessage(error: Error): string | undefined {
  const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;

  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "string" && cause.length > 0) {
    return cause;
  }

  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return undefined;
}

export function extractClientIp(request: IncomingMessage): string | undefined {
  const forwardedFor = firstHeaderValue(request.headers["x-forwarded-for"]);
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || undefined;
  }

  const forwarded = firstHeaderValue(request.headers.forwarded);
  const forwardedIp = parseForwardedFor(forwarded);
  if (forwardedIp) {
    return forwardedIp;
  }

  const directHeaderIp = firstNonEmptyHeaderValue(
    request.headers["cf-connecting-ip"],
    request.headers["true-client-ip"],
    request.headers["x-real-ip"],
    request.headers["x-client-ip"],
    request.headers["fastly-client-ip"],
  );
  if (directHeaderIp) {
    return directHeaderIp;
  }

  return request.socket.remoteAddress ?? undefined;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (Array.isArray(value) && value.length > 0) {
    return value[0]?.trim() || undefined;
  }

  return undefined;
}

function firstNonEmptyHeaderValue(...values: Array<string | string[] | undefined>): string | undefined {
  for (const value of values) {
    const candidate = firstHeaderValue(value);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function parseForwardedFor(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/for=(?:"?\[?)([^;\],"]+)/i);
  if (!match?.[1]) {
    return undefined;
  }

  const candidate = match[1].trim();
  if (!candidate) {
    return undefined;
  }

  if (candidate.startsWith("_")) {
    return undefined;
  }

  return candidate.replace(/\]$/, "");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
