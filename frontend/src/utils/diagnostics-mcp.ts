import type {
  DiagnosticPromptDefinition,
  DiagnosticPromptPayload,
  DiagnosticsToolDefinition,
} from "../types/dashboard";
import { readErrorResponse } from "./http";

const diagnosticsClientInfo = {
  name: "llmproxy-dashboard",
  version: "1.0.0",
};

let diagnosticsInitialized = false;
let cachedDiagnosticsTools: DiagnosticsToolDefinition[] | null = null;
let cachedDiagnosticsPrompts: DiagnosticPromptDefinition[] | null = null;

function cloneDiagnosticTool(tool: DiagnosticsToolDefinition): DiagnosticsToolDefinition {
  return {
    ...tool,
    ...(tool.inputSchema ? { inputSchema: { ...tool.inputSchema } } : {}),
  };
}

function cloneDiagnosticPrompt(prompt: DiagnosticPromptDefinition): DiagnosticPromptDefinition {
  return {
    ...prompt,
    arguments: prompt.arguments.map((argument) => ({ ...argument })),
  };
}

function normalizePromptMessage(value: unknown): DiagnosticPromptPayload["messages"][number] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as {
    role?: unknown;
    content?: {
      type?: unknown;
      text?: unknown;
    };
  };

  if (
    (candidate.role !== "system" && candidate.role !== "user")
    || candidate.content?.type !== "text"
    || typeof candidate.content.text !== "string"
  ) {
    return undefined;
  }

  return {
    role: candidate.role,
    content: {
      type: "text",
      text: candidate.content.text,
    },
  };
}

export async function callDiagnosticsMcp(
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch("/api/diagnostics/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }

  const payload = await response.json() as {
    result?: Record<string, unknown>;
    error?: {
      message?: string;
    };
  };

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  return payload.result ?? {};
}

export async function ensureDiagnosticsMcpInitialized(): Promise<void> {
  if (diagnosticsInitialized) {
    return;
  }

  await callDiagnosticsMcp("initialize", {
    clientInfo: diagnosticsClientInfo,
  });
  diagnosticsInitialized = true;
}

export async function listDiagnosticsTools(): Promise<DiagnosticsToolDefinition[]> {
  await ensureDiagnosticsMcpInitialized();
  if (cachedDiagnosticsTools) {
    return cachedDiagnosticsTools.map(cloneDiagnosticTool);
  }

  const toolsPayload = await callDiagnosticsMcp("tools/list");
  const tools = Array.isArray(toolsPayload.tools)
    ? toolsPayload.tools
      .filter((tool): tool is Record<string, unknown> => typeof tool === "object" && tool !== null)
      .map((tool) => ({
        name: String(tool.name ?? ""),
        title: String(tool.title ?? tool.name ?? ""),
        description: String(tool.description ?? ""),
        inputSchema: typeof tool.inputSchema === "object" && tool.inputSchema !== null && !Array.isArray(tool.inputSchema)
          ? { ...tool.inputSchema as Record<string, unknown> }
          : undefined,
      }))
      .filter((tool) => tool.name.length > 0)
    : [];

  cachedDiagnosticsTools = tools;
  return tools.map(cloneDiagnosticTool);
}

export async function buildDiagnosticsChatTools(): Promise<Array<Record<string, unknown>>> {
  const tools = await listDiagnosticsTools();
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  }));
}

export async function callDiagnosticsTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return await callDiagnosticsMcp("tools/call", {
    name,
    arguments: args,
  });
}

export async function listDiagnosticPrompts(): Promise<DiagnosticPromptDefinition[]> {
  await ensureDiagnosticsMcpInitialized();
  if (cachedDiagnosticsPrompts) {
    return cachedDiagnosticsPrompts.map(cloneDiagnosticPrompt);
  }

  const promptsPayload = await callDiagnosticsMcp("prompts/list");
  const prompts = Array.isArray(promptsPayload.prompts)
    ? promptsPayload.prompts
      .filter((prompt): prompt is Record<string, unknown> => typeof prompt === "object" && prompt !== null)
      .map((prompt) => ({
        name: String(prompt.name ?? ""),
        title: String(prompt.title ?? prompt.name ?? ""),
        description: String(prompt.description ?? ""),
        arguments: Array.isArray(prompt.arguments)
          ? prompt.arguments.map((argument) => ({
            name: String((argument as { name?: unknown }).name ?? ""),
            description: String((argument as { description?: unknown }).description ?? ""),
            required: (argument as { required?: unknown }).required === true,
          }))
          : [],
      }))
      .filter((prompt) => prompt.name.length > 0)
    : [];

  cachedDiagnosticsPrompts = prompts;
  return prompts.map(cloneDiagnosticPrompt);
}

export async function getDiagnosticPrompt(
  name: string,
  requestId: string,
): Promise<DiagnosticPromptPayload> {
  const payload = await callDiagnosticsMcp("prompts/get", {
    name,
    arguments: {
      request_id: requestId,
    },
  });

  return {
    name: String(payload.name ?? name),
    description: String(payload.description ?? ""),
    messages: Array.isArray(payload.messages)
      ? payload.messages
        .map((message) => normalizePromptMessage(message))
        .filter((message): message is DiagnosticPromptPayload["messages"][number] => Boolean(message))
      : [],
  };
}
