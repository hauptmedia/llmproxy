import type { ProxySnapshot, RequestLogDetail } from "./types";

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpPromptArgumentDefinition {
  name: string;
  description: string;
  required: boolean;
}

export interface McpPromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: McpPromptArgumentDefinition[];
}

export interface McpPromptMessage {
  role: "system" | "user";
  text: string;
}

export interface McpPromptPayload {
  name: string;
  description: string;
  messages: McpPromptMessage[];
}

export interface McpHelperRouteDefinition {
  method: "GET" | "POST";
  path: string;
  title: string;
  description: string;
}

export interface McpServiceDefinition {
  id: string;
  title: string;
  description: string;
  helperRoutes: McpHelperRouteDefinition[];
  tools: McpToolDefinition[];
  prompts: McpPromptDefinition[];
}

export interface McpManifest {
  endpoint: string;
  services: McpServiceDefinition[];
  helperRoutes: McpHelperRouteDefinition[];
  tools: McpToolDefinition[];
  prompts: McpPromptDefinition[];
}

export interface McpContext {
  snapshot: ProxySnapshot;
  getRequestDetail: (requestId: string) => RequestLogDetail | undefined;
  listModelsPayload: () => Record<string, unknown>;
  runChatCompletion: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface McpToolCallResult {
  content: Array<{ type: "text" | "json"; text?: string; json?: unknown }>;
  structuredContent: unknown;
}

export interface McpService {
  definition: McpServiceDefinition;
  callTool?: (toolName: string, args: Record<string, unknown>) => McpToolCallResult | Promise<McpToolCallResult>;
  getPrompt?: (promptName: string, args: Record<string, unknown>) => McpPromptPayload | Promise<McpPromptPayload>;
}
