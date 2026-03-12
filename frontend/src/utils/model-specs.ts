import type { ModelSpec } from "../types/dashboard";
import { formatDate } from "./formatters";
import { isClientRecord } from "./guards";

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

export function buildModelSpecs(
  configuredModels: unknown,
  discoveredModels: unknown,
  discoveredModelDetails: unknown,
): ModelSpec[] {
  const configured = uniqueStrings(configuredModels);
  const discovered = uniqueStrings(discoveredModels);
  const discoveredDetailMap = buildDiscoveredModelDetailMap(discoveredModelDetails);
  const explicitConfigured = configured.filter((pattern) => pattern !== "*");
  const hasWildcard = configured.includes("*");
  const specs: ModelSpec[] = [];

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
