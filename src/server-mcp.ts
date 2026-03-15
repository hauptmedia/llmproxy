import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { createDiagnosticsMcpService } from "./server-mcp-diagnostics";
import type {
  McpContext,
  McpManifest,
  McpService,
  McpToolCallResult,
  McpToolDefinition,
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
const mcpAjv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});
const mcpToolValidatorCache = new Map<string, ValidateFunction>();
const CHAT_TOOL_ALLOWED_TOP_LEVEL_KEYS = new Set([
  "model",
  "messages",
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "repeat_penalty",
  "seed",
  "stop",
  "max_tokens",
  "max_completion_tokens",
  "tools",
  "tool_choice",
]);
const CHAT_MESSAGE_ROLES = ["system", "developer", "user", "assistant", "tool"] as const;
type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

type McpToolArgumentValidationResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; result: McpToolCallResult };

function buildChatTextContentPartSchema(): Record<string, unknown> {
  return {
    type: "object",
    description: "One text content part.",
    properties: {
      type: {
        type: "string",
        enum: ["text"],
      },
      text: {
        type: "string",
        description: "Text for this content part.",
      },
    },
    required: ["type", "text"],
    additionalProperties: false,
  };
}

function buildChatImageContentPartSchema(): Record<string, unknown> {
  return {
    type: "object",
    description: "One image content part.",
    properties: {
      type: {
        type: "string",
        enum: ["image_url"],
      },
      image_url: {
        type: "object",
        description: "Image URL payload in the normal OpenAI chat-completions shape.",
        properties: {
          url: {
            type: "string",
            description: "Image URL or data URL.",
          },
          detail: {
            type: "string",
            enum: ["auto", "low", "high"],
            description: "Optional OpenAI-compatible image detail hint.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    required: ["type", "image_url"],
    additionalProperties: false,
  };
}

function buildChatContentPartArraySchema(): Record<string, unknown> {
  return {
    type: "array",
    minItems: 1,
    description: "Ordered multimodal content parts. Each part must be either text or image_url.",
    items: {
      oneOf: [
        buildChatTextContentPartSchema(),
        buildChatImageContentPartSchema(),
      ],
    },
  };
}

function buildRequiredMessageContentSchema(): Record<string, unknown> {
  return {
    oneOf: [
      {
        type: "string",
        description: "Simple string content.",
      },
      buildChatContentPartArraySchema(),
    ],
  };
}

function buildAssistantMessageContentSchema(): Record<string, unknown> {
  return {
    oneOf: [
      {
        type: "string",
        description: "Assistant text content.",
      },
      {
        type: "null",
        description: "Use null when the assistant turn only carries tool_calls.",
      },
      buildChatContentPartArraySchema(),
    ],
  };
}

function buildToolCallSchema(): Record<string, unknown> {
  return {
    type: "object",
    description: "One assistant tool call in the normal OpenAI-compatible chat shape.",
    properties: {
      id: {
        type: "string",
        description: "Unique tool call ID.",
      },
      type: {
        type: "string",
        enum: ["function"],
      },
      function: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tool function name.",
          },
          arguments: {
            type: "string",
            description: "JSON-encoded function arguments string.",
          },
        },
        required: ["name", "arguments"],
        additionalProperties: false,
      },
    },
    required: ["id", "type", "function"],
    additionalProperties: false,
  };
}

function buildPromptLikeMessageSchema(role: "system" | "developer" | "user"): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      role: {
        type: "string",
        enum: [role],
      },
      content: buildRequiredMessageContentSchema(),
      name: {
        type: "string",
        description: "Optional participant name.",
      },
    },
    required: ["role", "content"],
    additionalProperties: false,
  };
}

function buildAssistantMessageSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      role: {
        type: "string",
        enum: ["assistant"],
      },
      content: buildAssistantMessageContentSchema(),
      name: {
        type: "string",
        description: "Optional participant name.",
      },
      refusal: {
        oneOf: [
          {
            type: "string",
            description: "Optional refusal text.",
          },
          {
            type: "null",
          },
        ],
      },
      tool_calls: {
        type: "array",
        minItems: 1,
        description: "Assistant tool calls emitted in this turn.",
        items: buildToolCallSchema(),
      },
    },
    required: ["role"],
    additionalProperties: false,
  };
}

function buildToolMessageSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      role: {
        type: "string",
        enum: ["tool"],
      },
      content: {
        type: "string",
        description: "Tool result payload, usually JSON serialized as a string.",
      },
      tool_call_id: {
        type: "string",
        description: "ID of the assistant tool call this tool result answers.",
      },
      name: {
        type: "string",
        description: "Optional tool name.",
      },
    },
    required: ["role", "content", "tool_call_id"],
    additionalProperties: false,
  };
}

function buildChatMessagesSchema(): Record<string, unknown> {
  return {
    type: "array",
    minItems: 1,
    description: "Ordered chat history. Each entry must be a system, developer, user, assistant, or tool message with the normal OpenAI-compatible shape for that role.",
    items: {
      oneOf: [
        buildPromptLikeMessageSchema("system"),
        buildPromptLikeMessageSchema("developer"),
        buildPromptLikeMessageSchema("user"),
        buildAssistantMessageSchema(),
        buildToolMessageSchema(),
      ],
    },
  };
}

function buildChatToolDefinitionSchema(): Record<string, unknown> {
  return {
    type: "object",
    description: "One function tool definition in the normal OpenAI-compatible chat-completions shape.",
    properties: {
      type: {
        type: "string",
        enum: ["function"],
      },
      function: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Function name exposed to the model.",
          },
          description: {
            type: "string",
            description: "Optional human-readable function description.",
          },
          parameters: {
            type: "object",
            description: "JSON Schema object for the function arguments.",
            additionalProperties: true,
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    required: ["type", "function"],
    additionalProperties: false,
  };
}

function buildChatToolChoiceSchema(): Record<string, unknown> {
  return {
    oneOf: [
      {
        type: "string",
        enum: ["auto", "none", "required"],
        description: "Standard OpenAI-compatible tool_choice mode.",
      },
      {
        type: "object",
        description: "Force one specific function tool.",
        properties: {
          type: {
            type: "string",
            enum: ["function"],
          },
          function: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Function name to force.",
              },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
        required: ["type", "function"],
        additionalProperties: false,
      },
    ],
  };
}

function buildChatInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    description: "Arguments for one non-streaming chat request to exactly one target model. Each chat_with_model tool call must contain exactly one JSON object for exactly one model. Never concatenate multiple JSON objects, never send an array of request objects, and never bundle multiple models into one payload. If you need multiple models, emit multiple separate chat_with_model tool calls as multiple separate tool_calls entries, one entry per model.",
    properties: {
      model: {
        type: "string",
        description: "Exactly one target model id for this call. Do not pass multiple model ids here, do not pass an array, and do not concatenate multiple request objects. If you want multiple models, emit multiple separate chat_with_model tool calls as multiple tool_calls entries, one per model.",
      },
      messages: {
        ...buildChatMessagesSchema(),
        description: "Ordered chat history for this one request to this one target model. Reuse the same messages in separate tool calls when querying several models, instead of combining several request payloads into one arguments object. When comparing several models, create one tool_calls entry per target model and reuse the same messages array in each entry.",
      },
      temperature: {
        type: "number",
      },
      top_p: {
        type: "number",
      },
      top_k: {
        type: "integer",
      },
      min_p: {
        type: "number",
      },
      repeat_penalty: {
        type: "number",
      },
      seed: {
        type: "integer",
      },
      stop: {
        oneOf: [
          {
            type: "string",
            description: "One stop sequence.",
          },
          {
            type: "array",
            minItems: 1,
            items: {
              type: "string",
            },
            description: "Multiple stop sequences.",
          },
        ],
      },
      max_tokens: {
        type: "integer",
      },
      max_completion_tokens: {
        type: "integer",
      },
      tools: {
        type: "array",
        items: buildChatToolDefinitionSchema(),
      },
      tool_choice: buildChatToolChoiceSchema(),
    },
    required: ["model", "messages"],
    examples: [
      {
        model: "qwen3.5-35b-a3b",
        messages: [
          {
            role: "user",
            content: "Say hello briefly and clearly reveal your own model identity.",
          },
        ],
      },
    ],
    additionalProperties: false,
  };
}

function getMcpToolValidator(tool: McpToolDefinition): ValidateFunction {
  const cached = mcpToolValidatorCache.get(tool.name);
  if (cached) {
    return cached;
  }

  const compiled = mcpAjv.compile(tool.inputSchema);
  mcpToolValidatorCache.set(tool.name, compiled);
  return compiled;
}

function formatJsonPointerPath(pointer: string): string {
  if (!pointer) {
    return "arguments";
  }

  const parts = pointer
    .split("/")
    .slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));

  let path = "arguments";
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      path += `[${part}]`;
    } else {
      path += `.${part}`;
    }
  }

  return path;
}

function formatAjvValidationError(error: ErrorObject): string {
  const basePath = formatJsonPointerPath(error.instancePath);

  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    return `${basePath}.${error.params.missingProperty} is required.`;
  }

  if (error.keyword === "additionalProperties" && typeof error.params.additionalProperty === "string") {
    return `${basePath} includes unsupported field "${error.params.additionalProperty}".`;
  }

  if (error.keyword === "type" && typeof error.params.type === "string") {
    return `${basePath} must be ${error.params.type}.`;
  }

  if (error.keyword === "enum" && Array.isArray(error.params.allowedValues)) {
    return `${basePath} must be one of ${error.params.allowedValues.map((value) => String(value)).join(", ")}.`;
  }

  if (error.keyword === "minItems" && typeof error.params.limit === "number") {
    return `${basePath} must contain at least ${error.params.limit} item${error.params.limit === 1 ? "" : "s"}.`;
  }

  if (error.keyword === "oneOf" || error.keyword === "anyOf") {
    return `${basePath} does not match any allowed input shape.`;
  }

  return `${basePath} ${error.message ?? "is invalid"}.`;
}

function extractToolSchemaExample(tool: McpToolDefinition): unknown {
  const examples = tool.inputSchema.examples;
  if (!Array.isArray(examples) || examples.length === 0) {
    return undefined;
  }

  return examples[0];
}

function buildToolValidationInstructions(tool: McpToolDefinition, rawArgs: unknown): string[] {
  const instructions = [
    `Pass exactly one JSON object that matches the "${tool.name}" input schema.`,
  ];

  if (tool.name === "chat_with_model") {
    instructions.push("Use exactly one target model per tool call.");
  }

  if (typeof rawArgs === "string" && /}\s*{/.test(rawArgs)) {
    instructions.push("Do not concatenate JSON objects like }{ into one arguments string.");
    if (tool.name === "chat_with_model") {
      instructions.push("Emit multiple separate chat_with_model tool calls as separate tool_calls entries, one entry per model.");
    }
  } else if (Array.isArray(rawArgs)) {
    instructions.push("Do not send an array of request objects as tool arguments.");
    if (tool.name === "chat_with_model") {
      instructions.push("Emit multiple separate chat_with_model tool calls as separate tool_calls entries, one entry per model.");
    }
  } else if (!isRecord(rawArgs)) {
    instructions.push("The MCP tools/call payload should carry arguments as a JSON object, not as a string, array, or scalar value.");
  }

  return instructions;
}

function buildMcpToolErrorResult(
  tool: McpToolDefinition,
  type: "invalid_arguments" | "tool_execution_failed",
  message: string,
  rawArgs: unknown,
  details: string[] = [],
): McpToolCallResult {
  const instructions = buildToolValidationInstructions(tool, rawArgs);
  const exampleArguments = extractToolSchemaExample(tool);
  const structuredContent = {
    ok: false,
    error: {
      type,
      tool: tool.name,
      message,
      details,
      instructions,
      ...(exampleArguments !== undefined ? { exampleArguments } : {}),
    },
  };

  const textLines = [
    message,
    ...(details.length > 0 ? ["Details:", ...details.map((detail) => `- ${detail}`)] : []),
    "Instructions:",
    ...instructions.map((instruction) => `- ${instruction}`),
    ...(exampleArguments !== undefined
      ? ["Example arguments:", JSON.stringify(exampleArguments, null, 2)]
      : []),
  ];

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: textLines.join("\n"),
      },
      {
        type: "json",
        json: structuredContent,
      },
    ],
    structuredContent,
  };
}

function validateMcpToolArguments(
  tool: McpToolDefinition,
  rawArgs: unknown,
): McpToolArgumentValidationResult {
  const validator = getMcpToolValidator(tool);
  const valid = validator(rawArgs);

  if (valid && isRecord(rawArgs)) {
    return {
      ok: true,
      args: rawArgs,
    };
  }

  const details = (validator.errors ?? []).map((error) => formatAjvValidationError(error));
  const message = `The llmproxy MCP tool "${tool.name}" received invalid arguments.`;

  return {
    ok: false,
    result: buildMcpToolErrorResult(tool, "invalid_arguments", message, rawArgs, details),
  };
}

function validateAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  message: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(message.replace("{key}", key));
    }
  }
}

function validateOptionalString(value: unknown, message: string): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
}

function validateOptionalFiniteNumber(value: unknown, message: string): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(message);
  }
}

function validateOptionalInteger(value: unknown, message: string): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(message);
  }
}

function validateContentParts(value: unknown, messagePrefix: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${messagePrefix} content arrays must contain at least one part.`);
  }

  for (let partIndex = 0; partIndex < value.length; partIndex += 1) {
    const part = value[partIndex];
    if (!isRecord(part)) {
      throw new Error(`${messagePrefix} content part ${partIndex} must be an object.`);
    }

    if (part.type === "text") {
      validateAllowedKeys(
        part,
        new Set(["type", "text"]),
        `${messagePrefix} text content part ${partIndex} includes unsupported field "{key}".`,
      );
      if (typeof part.text !== "string" || part.text.length === 0) {
        throw new Error(`${messagePrefix} text content part ${partIndex} requires a non-empty "text" string.`);
      }
      continue;
    }

    if (part.type === "image_url") {
      validateAllowedKeys(
        part,
        new Set(["type", "image_url"]),
        `${messagePrefix} image content part ${partIndex} includes unsupported field "{key}".`,
      );
      if (!isRecord(part.image_url)) {
        throw new Error(`${messagePrefix} image content part ${partIndex} requires an "image_url" object.`);
      }

      validateAllowedKeys(
        part.image_url,
        new Set(["url", "detail"]),
        `${messagePrefix} image content part ${partIndex} image_url includes unsupported field "{key}".`,
      );
      if (typeof part.image_url.url !== "string" || part.image_url.url.length === 0) {
        throw new Error(`${messagePrefix} image content part ${partIndex} requires a non-empty image_url.url string.`);
      }
      if (
        part.image_url.detail !== undefined &&
        part.image_url.detail !== "auto" &&
        part.image_url.detail !== "low" &&
        part.image_url.detail !== "high"
      ) {
        throw new Error(`${messagePrefix} image content part ${partIndex} image_url.detail must be one of auto, low, or high.`);
      }
      continue;
    }

    throw new Error(`${messagePrefix} content part ${partIndex} must use type "text" or "image_url".`);
  }
}

function validateRequiredContent(
  value: unknown,
  messagePrefix: string,
): void {
  if (typeof value === "string" && value.length > 0) {
    return;
  }

  if (Array.isArray(value)) {
    validateContentParts(value, messagePrefix);
    return;
  }

  throw new Error(`${messagePrefix} content must be a non-empty string or a non-empty array of text/image_url parts.`);
}

function validateAssistantContent(value: unknown, messagePrefix: string): void {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value === "string" && value.length > 0) {
    return;
  }

  if (Array.isArray(value)) {
    validateContentParts(value, messagePrefix);
    return;
  }

  throw new Error(`${messagePrefix} content must be null, a non-empty string, or a non-empty array of text/image_url parts.`);
}

function validateToolCalls(value: unknown, messagePrefix: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${messagePrefix} tool_calls must be a non-empty array.`);
  }

  for (let toolCallIndex = 0; toolCallIndex < value.length; toolCallIndex += 1) {
    const toolCall = value[toolCallIndex];
    if (!isRecord(toolCall)) {
      throw new Error(`${messagePrefix} tool_call ${toolCallIndex} must be an object.`);
    }

    validateAllowedKeys(
      toolCall,
      new Set(["id", "type", "function"]),
      `${messagePrefix} tool_call ${toolCallIndex} includes unsupported field "{key}".`,
    );
    if (typeof toolCall.id !== "string" || toolCall.id.length === 0) {
      throw new Error(`${messagePrefix} tool_call ${toolCallIndex} requires a non-empty "id" string.`);
    }
    if (toolCall.type !== "function") {
      throw new Error(`${messagePrefix} tool_call ${toolCallIndex} must use type "function".`);
    }
    if (!isRecord(toolCall.function)) {
      throw new Error(`${messagePrefix} tool_call ${toolCallIndex} requires a "function" object.`);
    }

    validateAllowedKeys(
      toolCall.function,
      new Set(["name", "arguments"]),
      `${messagePrefix} tool_call ${toolCallIndex} function includes unsupported field "{key}".`,
    );
    if (typeof toolCall.function.name !== "string" || toolCall.function.name.length === 0) {
      throw new Error(`${messagePrefix} tool_call ${toolCallIndex} function.name must be a non-empty string.`);
    }
    if (typeof toolCall.function.arguments !== "string") {
      throw new Error(`${messagePrefix} tool_call ${toolCallIndex} function.arguments must be a JSON-encoded string.`);
    }
  }
}

function validateChatMessage(message: unknown, index: number): void {
  const prefix = `The llmproxy MCP tool "chat_with_model" message ${index}`;
  if (!isRecord(message)) {
    throw new Error(`${prefix} must be an object.`);
  }

  const role = message.role;
  if (typeof role !== "string" || !CHAT_MESSAGE_ROLES.includes(role as ChatMessageRole)) {
    throw new Error(`${prefix} role must be one of ${CHAT_MESSAGE_ROLES.join(", ")}.`);
  }

  if (role === "system" || role === "developer" || role === "user") {
    validateAllowedKeys(
      message,
      new Set(["role", "content", "name"]),
      `${prefix} includes unsupported field "{key}" for role "${role}".`,
    );
    validateRequiredContent(message.content, prefix);
    validateOptionalString(message.name, `${prefix} name must be a non-empty string when provided.`);
    return;
  }

  if (role === "assistant") {
    validateAllowedKeys(
      message,
      new Set(["role", "content", "name", "refusal", "tool_calls"]),
      `${prefix} includes unsupported field "{key}" for role "assistant".`,
    );
    validateAssistantContent(message.content, prefix);
    validateOptionalString(message.name, `${prefix} name must be a non-empty string when provided.`);
    if (message.refusal !== undefined && message.refusal !== null && typeof message.refusal !== "string") {
      throw new Error(`${prefix} refusal must be a string or null when provided.`);
    }
    if (message.tool_calls !== undefined) {
      validateToolCalls(message.tool_calls, prefix);
    }
    if (message.content === undefined && message.refusal === undefined && message.tool_calls === undefined) {
      throw new Error(`${prefix} must provide at least one of content, refusal, or tool_calls.`);
    }
    return;
  }

  validateAllowedKeys(
    message,
    new Set(["role", "content", "tool_call_id", "name"]),
    `${prefix} includes unsupported field "{key}" for role "tool".`,
  );
  if (typeof message.content !== "string") {
    throw new Error(`${prefix} content must be a string for role "tool".`);
  }
  if (typeof message.tool_call_id !== "string" || message.tool_call_id.length === 0) {
    throw new Error(`${prefix} tool_call_id must be a non-empty string for role "tool".`);
  }
  validateOptionalString(message.name, `${prefix} name must be a non-empty string when provided.`);
}

function validateChatTools(value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error('The llmproxy MCP tool "chat_with_model" argument "tools" must be an array.');
  }

  for (let index = 0; index < value.length; index += 1) {
    const tool = value[index];
    if (!isRecord(tool)) {
      throw new Error(`The llmproxy MCP tool "chat_with_model" tool ${index} must be an object.`);
    }

    validateAllowedKeys(
      tool,
      new Set(["type", "function"]),
      `The llmproxy MCP tool "chat_with_model" tool ${index} includes unsupported field "{key}".`,
    );
    if (tool.type !== "function") {
      throw new Error(`The llmproxy MCP tool "chat_with_model" tool ${index} must use type "function".`);
    }
    if (!isRecord(tool.function)) {
      throw new Error(`The llmproxy MCP tool "chat_with_model" tool ${index} requires a "function" object.`);
    }

    validateAllowedKeys(
      tool.function,
      new Set(["name", "description", "parameters"]),
      `The llmproxy MCP tool "chat_with_model" tool ${index} function includes unsupported field "{key}".`,
    );
    if (typeof tool.function.name !== "string" || tool.function.name.length === 0) {
      throw new Error(`The llmproxy MCP tool "chat_with_model" tool ${index} function.name must be a non-empty string.`);
    }
    if (tool.function.description !== undefined && typeof tool.function.description !== "string") {
      throw new Error(`The llmproxy MCP tool "chat_with_model" tool ${index} function.description must be a string when provided.`);
    }
    if (tool.function.parameters !== undefined && !isRecord(tool.function.parameters)) {
      throw new Error(`The llmproxy MCP tool "chat_with_model" tool ${index} function.parameters must be a JSON Schema object when provided.`);
    }
  }
}

function validateChatToolChoice(value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (typeof value === "string") {
    if (value !== "auto" && value !== "none" && value !== "required") {
      throw new Error('The llmproxy MCP tool "chat_with_model" argument "tool_choice" must be auto, none, required, or a function selector object.');
    }
    return;
  }

  if (!isRecord(value)) {
    throw new Error('The llmproxy MCP tool "chat_with_model" argument "tool_choice" must be auto, none, required, or a function selector object.');
  }

  validateAllowedKeys(
    value,
    new Set(["type", "function"]),
    'The llmproxy MCP tool "chat_with_model" argument "tool_choice" includes unsupported field "{key}".',
  );
  if (value.type !== "function") {
    throw new Error('The llmproxy MCP tool "chat_with_model" object "tool_choice" must use type "function".');
  }
  if (!isRecord(value.function)) {
    throw new Error('The llmproxy MCP tool "chat_with_model" object "tool_choice" requires a "function" object.');
  }

  validateAllowedKeys(
    value.function,
    new Set(["name"]),
    'The llmproxy MCP tool "chat_with_model" object "tool_choice.function" includes unsupported field "{key}".',
  );
  if (typeof value.function.name !== "string" || value.function.name.length === 0) {
    throw new Error('The llmproxy MCP tool "chat_with_model" object "tool_choice.function.name" must be a non-empty string.');
  }
}

function validateChatToolArguments(args: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(args, "stream")) {
    throw new Error('The llmproxy MCP tool "chat_with_model" does not accept "stream". It always returns one final non-streaming completion payload.');
  }

  validateAllowedKeys(
    args,
    CHAT_TOOL_ALLOWED_TOP_LEVEL_KEYS,
    'The llmproxy MCP tool "chat_with_model" received unsupported argument "{key}".',
  );
  if (typeof args.model !== "string" || args.model.trim().length === 0) {
    throw new Error('The llmproxy MCP tool "chat_with_model" argument "model" must be a non-empty string.');
  }

  if (!Array.isArray(args.messages) || args.messages.length === 0) {
    throw new Error('The llmproxy MCP tool "chat_with_model" argument "messages" must be a non-empty array.');
  }

  for (let index = 0; index < args.messages.length; index += 1) {
    validateChatMessage(args.messages[index], index);
  }

  validateOptionalFiniteNumber(args.temperature, 'The llmproxy MCP tool "chat_with_model" argument "temperature" must be a finite number.');
  validateOptionalFiniteNumber(args.top_p, 'The llmproxy MCP tool "chat_with_model" argument "top_p" must be a finite number.');
  validateOptionalInteger(args.top_k, 'The llmproxy MCP tool "chat_with_model" argument "top_k" must be an integer.');
  validateOptionalFiniteNumber(args.min_p, 'The llmproxy MCP tool "chat_with_model" argument "min_p" must be a finite number.');
  validateOptionalFiniteNumber(args.repeat_penalty, 'The llmproxy MCP tool "chat_with_model" argument "repeat_penalty" must be a finite number.');
  validateOptionalInteger(args.seed, 'The llmproxy MCP tool "chat_with_model" argument "seed" must be an integer.');
  validateOptionalInteger(args.max_tokens, 'The llmproxy MCP tool "chat_with_model" argument "max_tokens" must be an integer.');
  validateOptionalInteger(args.max_completion_tokens, 'The llmproxy MCP tool "chat_with_model" argument "max_completion_tokens" must be an integer.');

  if (args.stop !== undefined) {
    if (typeof args.stop !== "string") {
      if (!Array.isArray(args.stop) || args.stop.length === 0 || args.stop.some((entry) => typeof entry !== "string" || entry.length === 0)) {
        throw new Error('The llmproxy MCP tool "chat_with_model" argument "stop" must be a string or a non-empty array of non-empty strings.');
      }
    } else if (args.stop.length === 0) {
      throw new Error('The llmproxy MCP tool "chat_with_model" argument "stop" must not be an empty string.');
    }
  }

  validateChatTools(args.tools);
  validateChatToolChoice(args.tool_choice);
}

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
            name: "chat_with_model",
            title: "Chat with one model",
            description: "Send one OpenAI-compatible chat request to exactly one registered llmproxy model and receive one final non-streaming completion JSON payload. Use exactly one JSON object per tool call. Never concatenate multiple JSON objects, never send an array of request objects, and never combine several models into one payload. If you need multiple models, emit multiple separate chat_with_model tool calls as multiple tool_calls entries, one entry per model.",
            inputSchema: buildChatInputSchema(),
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

      if (toolName === "chat_with_model") {
        validateChatToolArguments(args);
        const normalizedArgs = { ...args };
        const payload = await context.runChatCompletion({
          ...normalizedArgs,
          stream: false,
        });
        return {
          content: [
            {
              type: "text",
              text: "Ran a non-streaming chat completion through llmproxy and returned the final completion payload.",
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
        : parsedParams.arguments;

      const service = services.find((candidate) => candidate.definition.tools.some((tool) => tool.name === toolName) && candidate.callTool);
      if (!service?.callTool) {
        return failure(id, -32601, `Tool "${toolName}" is not registered on the llmproxy MCP server.`);
      }

      const toolDefinition = service.definition.tools.find((tool) => tool.name === toolName);
      if (!toolDefinition) {
        return failure(id, -32601, `Tool "${toolName}" is not registered on the llmproxy MCP server.`);
      }

      const validationResult = validateMcpToolArguments(toolDefinition, toolArgs);
      if (!validationResult.ok) {
        return success(id, validationResult.result);
      }

      try {
        return success(id, await service.callTool(toolName, validationResult.args));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return success(
          id,
          buildMcpToolErrorResult(
            toolDefinition,
            "tool_execution_failed",
            `The llmproxy MCP tool "${toolName}" failed while executing.`,
            validationResult.args,
            [message],
          ),
        );
      }
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
