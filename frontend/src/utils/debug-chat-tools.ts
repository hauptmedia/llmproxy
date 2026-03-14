import type { DebugTranscriptEntry } from "../types/dashboard";
import { callDiagnosticsTool } from "./diagnostics-mcp";
import { prettyJson } from "./formatters";
import type { DebugToolCallRequest } from "./debug-chat-transcript";

export async function executeDebugToolCalls(toolCalls: DebugToolCallRequest[]): Promise<DebugTranscriptEntry[]> {
  const responses: DebugTranscriptEntry[] = [];

  for (const toolCall of toolCalls) {
    try {
      const result = await callDiagnosticsTool(toolCall.name, toolCall.args);
      responses.push({
        role: "tool",
        name: toolCall.name,
        tool_call_id: toolCall.id,
        content: prettyJson(result.structuredContent ?? result),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      responses.push({
        role: "tool",
        name: toolCall.name,
        tool_call_id: toolCall.id,
        content: prettyJson({
          error: {
            message,
          },
        }),
      });
    }
  }

  return responses;
}
