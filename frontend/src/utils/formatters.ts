export function prettyJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatCompactValue(value: unknown): string {
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

export function formatUiValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return formatCompactValue(value);
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

export function formatTokenRate(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "";
  }

  return `${value.toFixed(1)} tok/s`;
}
