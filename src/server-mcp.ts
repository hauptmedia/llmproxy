import { createDiagnosticsMcpService } from "./server-mcp-diagnostics";
import type {
  McpContext,
  McpManifest,
  McpService,
} from "./server-mcp-types";

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

export const MCP_ENDPOINT = "/mcp";
export const MCP_MANIFEST_PATH = "/mcp/manifest";
export const MCP_DISABLED_MESSAGE = "MCP server is disabled in config.";
const LLMPROXY_MCP_SERVICE_ID = "llmproxy";

function buildOpenAiCompatMcpService(context: McpContext): McpService {
  return {
    definition: {
      id: "openai-compatible-proxy",
      title: "llmproxy functions",
      description: "llmproxy functions for listing routed models and issuing OpenAI-compatible chat completions through the MCP endpoint.",
      helperRoutes: [],
      tools: [
        {
          name: "list_models",
          title: "List models",
          description: "Returns the aggregated llmproxy model list in the OpenAI-compatible /v1/models shape.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          name: "create_chat_completion",
          title: "Chat completion",
          description: "Runs a normal llmproxy chat completion with the same request body as POST /v1/chat/completions. If stream=true, llmproxy buffers the stream and returns the final synthesized completion JSON.",
          inputSchema: {
            type: "object",
            properties: {
              model: {
                type: "string",
                description: "Requested model name. Use auto or omit it to let llmproxy choose.",
              },
              messages: {
                type: "array",
                description: "Chat messages in the normal OpenAI-compatible chat format.",
              },
              stream: {
                type: "boolean",
                description: "When true, llmproxy still returns the final completion JSON after buffering the stream.",
              },
              temperature: {
                type: "number",
              },
              top_p: {
                type: "number",
              },
              max_tokens: {
                type: "integer",
              },
              tools: {
                type: "array",
              },
              tool_choice: {
                description: "Normal OpenAI-compatible tool_choice value.",
              },
            },
            required: ["messages"],
            additionalProperties: true,
          },
        },
      ],
      prompts: [],
    },
    callTool: async (toolName, args) => {
      if (toolName === "list_models") {
        const payload = context.listModelsPayload();
        return {
          content: [
            {
              type: "text",
              text: "Loaded the current llmproxy model list.",
            },
            {
              type: "json",
              json: payload,
            },
          ],
          structuredContent: payload,
        };
      }

      if (toolName === "create_chat_completion") {
        const payload = await context.runChatCompletion({ ...args });
        return {
          content: [
            {
              type: "text",
              text: "Ran a chat completion through llmproxy and returned the final completion payload.",
            },
            {
              type: "json",
              json: payload,
            },
          ],
          structuredContent: payload,
        };
      }

      throw new Error(`Unknown llmproxy MCP tool "${toolName}".`);
    },
  };
}

function buildUnifiedLlmproxyMcpService(context: McpContext): McpService {
  const sourceServices = [
    buildOpenAiCompatMcpService(context),
    createDiagnosticsMcpService(context),
  ];

  return {
    definition: {
      id: LLMPROXY_MCP_SERVICE_ID,
      title: "llmproxy functions",
      description: "Built-in llmproxy functions exposed over MCP, including request inspection, diagnosis, model listing, and OpenAI-compatible chat completions.",
      helperRoutes: sourceServices.flatMap((service) => service.definition.helperRoutes.map((route) => ({ ...route }))),
      tools: sourceServices.flatMap((service) => service.definition.tools.map((tool) => ({
        ...tool,
        inputSchema: { ...tool.inputSchema },
      }))),
      prompts: sourceServices.flatMap((service) => service.definition.prompts.map((prompt) => ({
        ...prompt,
        arguments: prompt.arguments.map((argument) => ({ ...argument })),
      }))),
    },
    callTool: async (toolName, args) => {
      const sourceService = sourceServices.find((service) => (
        service.definition.tools.some((tool) => tool.name === toolName) && service.callTool
      ));
      if (!sourceService?.callTool) {
        throw new Error(`Unknown llmproxy MCP tool "${toolName}".`);
      }

      return await sourceService.callTool(toolName, args);
    },
    getPrompt: async (promptName, args) => {
      const sourceService = sourceServices.find((service) => (
        service.definition.prompts.some((prompt) => prompt.name === promptName) && service.getPrompt
      ));
      if (!sourceService?.getPrompt) {
        throw new Error(`Unknown llmproxy MCP prompt "${promptName}".`);
      }

      return await sourceService.getPrompt(promptName, args);
    },
  };
}

export function isMcpEndpointPath(pathname: string): boolean {
  return pathname === MCP_ENDPOINT;
}

export function isMcpManifestPath(pathname: string): boolean {
  return pathname === MCP_MANIFEST_PATH;
}

function buildMcpServices(context: McpContext): McpService[] {
  return [buildUnifiedLlmproxyMcpService(context)];
}

export function buildMcpManifest(context: McpContext): McpManifest {
  const services = buildMcpServices(context).map((service) => ({
    ...service.definition,
    helperRoutes: service.definition.helperRoutes.map((route) => ({ ...route })),
    tools: service.definition.tools.map((tool) => ({
      ...tool,
      inputSchema: { ...tool.inputSchema },
    })),
    prompts: service.definition.prompts.map((prompt) => ({
      ...prompt,
      arguments: prompt.arguments.map((argument) => ({ ...argument })),
    })),
  }));

  return {
    endpoint: MCP_ENDPOINT,
    services,
    helperRoutes: services.flatMap((service) => service.helperRoutes.map((route) => ({ ...route }))),
    tools: services.flatMap((service) => service.tools.map((tool) => ({
      ...tool,
      inputSchema: { ...tool.inputSchema },
    }))),
    prompts: services.flatMap((service) => service.prompts.map((prompt) => ({
      ...prompt,
      arguments: prompt.arguments.map((argument) => ({ ...argument })),
    }))),
  };
}

export async function handleMcpRequest(
  payload: unknown,
  context: McpContext,
): Promise<JsonRpcResponse> {
  const request = parseJsonRpcRequest(payload);

  if (request.kind === "error") {
    return request.error;
  }

  const { id, method, params } = request.value;
  const services = buildMcpServices(context);

  try {
    if (method === "initialize") {
      return success(id, {
        protocolVersion: "2025-03-26",
        serverInfo: {
          name: "llmproxy-mcp",
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
        tools: services.flatMap((service) => service.definition.tools),
      });
    }

    if (method === "tools/call") {
      const parsedParams = asObject(params, "tools/call requires an object params payload.");
      const toolName = asString(parsedParams.name, 'tools/call requires a string "name".');
      const toolArgs = parsedParams.arguments === undefined
        ? {}
        : asObject(parsedParams.arguments, 'tools/call "arguments" must be an object.');

      const service = services.find((candidate) => candidate.definition.tools.some((tool) => tool.name === toolName) && candidate.callTool);
      if (!service?.callTool) {
        return failure(id, -32601, `Tool "${toolName}" is not registered on the llmproxy MCP server.`);
      }

      return success(id, await service.callTool(toolName, toolArgs));
    }

    if (method === "prompts/list") {
      return success(id, {
        prompts: services.flatMap((service) => service.definition.prompts),
      });
    }

    if (method === "prompts/get") {
      const parsedParams = asObject(params, "prompts/get requires an object params payload.");
      const promptName = asString(parsedParams.name, 'prompts/get requires a string "name".');
      const promptArgs = parsedParams.arguments === undefined
        ? {}
        : asObject(parsedParams.arguments, 'prompts/get "arguments" must be an object.');

      const service = services.find((candidate) => candidate.definition.prompts.some((prompt) => prompt.name === promptName) && candidate.getPrompt);
      if (!service?.getPrompt) {
        return failure(id, -32601, `Prompt "${promptName}" is not registered on the llmproxy MCP server.`);
      }

      const prompt = await service.getPrompt(promptName, promptArgs);
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

    if (method === "services/list") {
      return success(id, buildMcpManifest(context));
    }

    return failure(id, -32601, `Method "${method}" is not supported by the llmproxy MCP endpoint.`);
  } catch (error) {
    return failure(id, -32602, error instanceof Error ? error.message : String(error));
  }
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
      error: failure(payload.id ?? null, -32600, 'The MCP endpoint expects jsonrpc="2.0".'),
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
