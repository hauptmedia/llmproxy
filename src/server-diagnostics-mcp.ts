import {
  buildDiagnosticPrompt,
  buildDiagnosticReport,
  DiagnosticPromptDefinition,
  DiagnosticPromptName,
  listDiagnosticPrompts,
} from "./diagnostics";
import { ProxySnapshot, RequestLogDetail } from "./types";

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface DiagnosticsMcpContext {
  snapshot: ProxySnapshot;
  getRequestDetail: (requestId: string) => RequestLogDetail | undefined;
}

export function handleDiagnosticsMcpRequest(
  payload: unknown,
  context: DiagnosticsMcpContext,
): JsonRpcResponse {
  const request = parseJsonRpcRequest(payload);

  if (request.kind === "error") {
    return request.error;
  }

  const { id, method, params } = request.value;

  try {
    if (method === "initialize") {
      return success(id, {
        protocolVersion: "2025-03-26",
        serverInfo: {
          name: "llmproxy-diagnostics",
          version: "1.0.0",
        },
        capabilities: {
          tools: {},
          prompts: {},
        },
      });
    }

    if (method === "tools/list") {
      return success(id, {
        tools: buildToolDefinitions(),
      });
    }

    if (method === "tools/call") {
      const parsedParams = asObject(params, "tools/call requires an object params payload.");
      const toolName = asString(parsedParams.name, 'tools/call requires a string "name".');
      const toolArgs = parsedParams.arguments === undefined
        ? {}
        : asObject(parsedParams.arguments, 'tools/call "arguments" must be an object.');

      return success(id, callTool(toolName, toolArgs, context));
    }

    if (method === "prompts/list") {
      return success(id, {
        prompts: listDiagnosticPrompts().map((prompt) => ({
          name: prompt.name,
          title: prompt.title,
          description: prompt.description,
          arguments: prompt.arguments,
        })),
      });
    }

    if (method === "prompts/get") {
      const parsedParams = asObject(params, "prompts/get requires an object params payload.");
      const promptName = asDiagnosticPromptName(parsedParams.name);
      const argumentsRecord = parsedParams.arguments === undefined
        ? {}
        : asObject(parsedParams.arguments, 'prompts/get "arguments" must be an object.');
      const requestId = asString(argumentsRecord.request_id, 'prompts/get requires a string "request_id".');
      const detail = context.getRequestDetail(requestId);

      if (!detail) {
        return failure(id, -32004, `Recent request "${requestId}" was not found.`);
      }

      const prompt = buildDiagnosticPrompt(promptName, detail, context.snapshot);
      return success(id, {
        name: prompt.name,
        description: prompt.description,
        messages: prompt.messages.map((message) => ({
          role: message.role,
          content: {
            type: "text",
            text: message.text,
          },
        })),
      });
    }

    return failure(id, -32601, `Method "${method}" is not supported by the diagnostics MCP endpoint.`);
  } catch (error) {
    return failure(id, -32602, error instanceof Error ? error.message : String(error));
  }
}

function buildToolDefinitions(): Array<{
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
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

function callTool(
  toolName: string,
  args: Record<string, unknown>,
  context: DiagnosticsMcpContext,
): {
  content: Array<{ type: "text" | "json"; text?: string; json?: unknown }>;
  structuredContent: unknown;
} {
  if (toolName === "list_requests") {
    const limit = coerceInteger(args.limit, 20, 1, 100);
    const includeLive = args.include_live !== false;
    const onlyWithDetail = args.only_with_detail !== false;
    const requests = buildRequestList(context.snapshot, includeLive, onlyWithDetail).slice(0, limit);

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

function buildRequestList(snapshot: ProxySnapshot, includeLive: boolean, onlyWithDetail: boolean): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  if (includeLive) {
    for (const connection of snapshot.activeConnections) {
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

  for (const entry of snapshot.recentRequests) {
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

function parseJsonRpcRequest(payload: unknown):
  | { kind: "ok"; value: { id: unknown; method: string; params: unknown } }
  | { kind: "error"; error: JsonRpcResponse } {
  if (!isRecord(payload)) {
    return {
      kind: "error",
      error: failure(null, -32600, "Expected a JSON-RPC request object."),
    };
  }

  if (payload.jsonrpc !== "2.0") {
    return {
      kind: "error",
      error: failure(payload.id ?? null, -32600, 'The diagnostics endpoint expects jsonrpc="2.0".'),
    };
  }

  if (typeof payload.method !== "string" || payload.method.trim().length === 0) {
    return {
      kind: "error",
      error: failure(payload.id ?? null, -32600, "The JSON-RPC request is missing a valid method."),
    };
  }

  return {
    kind: "ok",
    value: {
      id: payload.id ?? null,
      method: payload.method,
      params: payload.params,
    },
  };
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }

  return value;
}

function asString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }

  return value.trim();
}

function asDiagnosticPromptName(value: unknown): DiagnosticPromptName {
  const name = asString(value, 'prompts/get requires a string "name".');
  if (!listDiagnosticPrompts().some((prompt: DiagnosticPromptDefinition) => prompt.name === name)) {
    throw new Error(`Unknown diagnostics prompt "${name}".`);
  }

  return name as DiagnosticPromptName;
}

function coerceInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function success(id: unknown, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function failure(id: unknown, code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
