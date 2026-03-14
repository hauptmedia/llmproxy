import {
  buildDiagnosticPrompt,
  buildDiagnosticReport,
  type DiagnosticPromptName,
  listDiagnosticPrompts,
} from "./diagnostics";
import type {
  McpContext,
  McpPromptDefinition,
  McpService,
  McpToolCallResult,
  McpToolDefinition,
} from "./server-mcp-types";

function buildToolDefinitions(): McpToolDefinition[] {
  return [
    {
      name: "list_requests",
      title: "List requests",
      description: "List recent or live llmproxy requests so an LLM can pick a request to inspect next.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximum number of requests to return.",
          },
          include_live: {
            type: "boolean",
            description: "Include currently active live requests alongside retained request history.",
          },
          only_with_detail: {
            type: "boolean",
            description: "Only return requests that still have stored request/response detail available.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_request_detail",
      title: "Get request detail",
      description: "Fetch the stored llmproxy request payload, response payload, and final metadata for one request.",
      inputSchema: {
        type: "object",
        properties: {
          request_id: {
            type: "string",
            description: "ID of the request to inspect.",
          },
        },
        required: ["request_id"],
        additionalProperties: false,
      },
    },
    {
      name: "diagnose_request",
      title: "Diagnose request",
      description: "Run llmproxy's built-in heuristics for one request and return findings plus troubleshooting guidance.",
      inputSchema: {
        type: "object",
        properties: {
          request_id: {
            type: "string",
            description: "ID of the request to diagnose.",
          },
        },
        required: ["request_id"],
        additionalProperties: false,
      },
    },
  ];
}

function buildPromptDefinitions(): McpPromptDefinition[] {
  return listDiagnosticPrompts().map((prompt) => ({
    name: prompt.name,
    title: prompt.title,
    description: prompt.description,
    arguments: prompt.arguments.map((argument) => ({
      name: argument.name,
      description: argument.description,
      required: argument.required,
    })),
  }));
}

function asString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }

  return value.trim();
}

function asDiagnosticPromptName(value: string): DiagnosticPromptName {
  if (!listDiagnosticPrompts().some((prompt) => prompt.name === value)) {
    throw new Error(`Unknown diagnostics prompt "${value}".`);
  }

  return value as DiagnosticPromptName;
}

function coerceInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function buildRequestList(
  context: McpContext,
  includeLive: boolean,
  onlyWithDetail: boolean,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  if (includeLive) {
    for (const connection of context.snapshot.activeConnections) {
      if (onlyWithDetail && !connection.hasDetail) {
        continue;
      }

      rows.push({
        id: connection.id,
        time: connection.startedAt,
        live: true,
        status: connection.phase,
        method: connection.method,
        path: connection.path,
        model: connection.model,
        backend: connection.backendName,
        finish_reason: connection.finishReason,
        has_detail: Boolean(connection.hasDetail),
      });
    }
  }

  for (const entry of context.snapshot.recentRequests) {
    if (onlyWithDetail && !entry.hasDetail) {
      continue;
    }

    if (rows.some((row) => row.id === entry.id)) {
      continue;
    }

    rows.push({
      id: entry.id,
      time: entry.time,
      live: false,
      status: entry.outcome,
      method: entry.method,
      path: entry.path,
      model: entry.model,
      backend: entry.backendName,
      finish_reason: entry.finishReason,
      has_detail: Boolean(entry.hasDetail),
    });
  }

  return rows.sort((left, right) => String(right.time).localeCompare(String(left.time)));
}

function callTool(
  toolName: string,
  args: Record<string, unknown>,
  context: McpContext,
): McpToolCallResult {
  if (toolName === "list_requests") {
    const limit = coerceInteger(args.limit, 20, 1, 100);
    const includeLive = args.include_live !== false;
    const onlyWithDetail = args.only_with_detail !== false;
    const requests = buildRequestList(context, includeLive, onlyWithDetail).slice(0, limit);

    return {
      content: [
        {
          type: "text",
          text: requests.length > 0
            ? `Returned ${requests.length} request summaries from llmproxy diagnostics.`
            : "No matching requests with stored detail are currently available.",
        },
        {
          type: "json",
          json: {
            requests,
          },
        },
      ],
      structuredContent: {
        requests,
      },
    };
  }

  if (toolName === "get_request_detail") {
    const requestId = asString(args.request_id, 'get_request_detail requires a string "request_id".');
    const detail = context.getRequestDetail(requestId);
    if (!detail) {
      throw new Error(`Recent request "${requestId}" was not found.`);
    }

    return {
      content: [
        {
          type: "text",
          text: `Loaded stored detail for request ${requestId}.`,
        },
        {
          type: "json",
          json: detail,
        },
      ],
      structuredContent: detail,
    };
  }

  if (toolName === "diagnose_request") {
    const requestId = asString(args.request_id, 'diagnose_request requires a string "request_id".');
    const detail = context.getRequestDetail(requestId);
    if (!detail) {
      throw new Error(`Recent request "${requestId}" was not found.`);
    }

    const report = buildDiagnosticReport(detail, context.snapshot);
    return {
      content: [
        {
          type: "text",
          text: report.summary,
        },
        {
          type: "json",
          json: report,
        },
      ],
      structuredContent: report,
    };
  }

  throw new Error(`Unknown diagnostics tool "${toolName}".`);
}

export function createDiagnosticsMcpService(context: McpContext): McpService {
  return {
    definition: {
      id: "diagnostics",
      title: "llmproxy functions",
      description: "llmproxy functions for inspecting retained requests, loading stored detail, and running built-in heuristic analysis.",
      helperRoutes: [],
      tools: buildToolDefinitions(),
      prompts: buildPromptDefinitions(),
    },
    callTool: (toolName, args) => callTool(toolName, args, context),
    getPrompt: (promptName, args) => {
      const requestId = asString(args.request_id, 'prompts/get requires a string "request_id".');
      const detail = context.getRequestDetail(requestId);
      if (!detail) {
        throw new Error(`Recent request "${requestId}" was not found.`);
      }

      const prompt = buildDiagnosticPrompt(asDiagnosticPromptName(promptName), detail, context.snapshot);
      return {
        name: prompt.name,
        description: prompt.description,
        messages: prompt.messages.map((message) => ({
          role: message.role,
          text: message.text,
        })),
      };
    },
  };
}
