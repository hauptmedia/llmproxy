export interface DebugChatSuggestion {
  key: string;
  title: string;
  description: string;
  value: string;
  highlighted?: boolean;
}

export const debugChatSystemPromptSuggestions: readonly DebugChatSuggestion[] = [
  {
    key: "troubleshoot",
    title: "Troubleshooting copilot",
    description: "Focus on likely request issues, cite evidence, and suggest the next routing or parameter changes to try.",
    value: "You are a concise llmproxy troubleshooting assistant. Explain likely issues, cite the concrete evidence you see, and suggest the next parameter or routing changes to try.",
  },
  {
    key: "compare",
    title: "Model comparison guide",
    description: "Help compare multiple models and call out quality, latency, and behavioral differences.",
    value: "You are a careful model comparison assistant. Compare outputs across candidate models, point out behavior differences, and highlight the tradeoffs that matter for latency, quality, and stability.",
  },
  {
    key: "prompt-coach",
    title: "Prompt coach",
    description: "Turn rough prompts into clearer requests and suggest tighter follow-ups.",
    value: "You are a prompt design coach. Rewrite unclear prompts into sharper requests, explain why they are better, and suggest useful follow-up questions.",
  },
  {
    key: "structured-analyst",
    title: "Structured analyst",
    description: "Answer in a clean structure with assumptions, findings, and clear next steps.",
    value: "You are a structured analysis assistant. Organize answers into assumptions, findings, and next steps, and keep the response concise but actionable.",
  },
];

export const debugChatFirstMessageSuggestions: readonly DebugChatSuggestion[] = [
  {
    key: "hello",
    title: "Quick hello",
    description: "Simple sanity check that confirms which model actually answered.",
    value: "Say hello briefly and mention the model you are using.",
    highlighted: true,
  },
  {
    key: "diagnose",
    title: "Diagnose a request",
    description: "Ask the model to inspect a request end-to-end and explain what likely went wrong.",
    value: "Analyze the current request, explain the most likely issue, and suggest the next changes I should try.",
  },
  {
    key: "compare",
    title: "Compare outputs",
    description: "Use the chat as a quick A/B space for testing how different models respond.",
    value: "Answer this request, then explain how the response might differ on a smaller, faster model versus a larger reasoning model.",
  },
  {
    key: "repetition",
    title: "Play Tic Tac Toe",
    description: "Let the model play a full game against another model and report the outcome.",
    value: "Play Tic Tac Toe with another model until someone wins or the game ends in a draw, then tell me the result. Keep calling the chat function to get the other model's moves.",
  },
];

export const defaultDebugChatPrompt = debugChatFirstMessageSuggestions[0]?.value ?? "";
