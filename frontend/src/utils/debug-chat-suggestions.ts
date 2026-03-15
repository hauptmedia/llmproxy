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
    title: "Troubleshooting copilot 🛠️",
    description: "Spot likely request issues and suggest the next fix.",
    value: "You are a concise llmproxy troubleshooting assistant. Explain likely issues, cite the concrete evidence you see, and suggest the next parameter or routing changes to try.",
  },
  {
    key: "pirate",
    title: "Talk like a pirate 🦜",
    description: "Arrr, answer with bold pirate swagger and salty charm.",
    value: "Talk like a mighty pirate",
    highlighted: true,
  },
  {
    key: "prompt-coach",
    title: "Prompt coach ✍️",
    description: "Rewrite rough prompts and return only the improved version.",
    value: "You are a prompt rewriter, not the assistant who should solve the task. Transform the user's latest message into a clearer, sharper, more effective prompt for another model. Never answer the request, never execute it, never roleplay it, never call tools or functions, and never explain your changes. Preserve the user's intent, but improve clarity, specificity, and structure. Output exactly one optimized prompt as plain text and nothing else.",
  },
  {
    key: "compare",
    title: "Model comparison guide ⚖️",
    description: "Compare models for quality, latency, and behavior.",
    value: "You are a careful model comparison assistant. Compare outputs across candidate models, point out behavior differences, and highlight the tradeoffs that matter for latency, quality, and stability.",
  },
] as const;

export const debugChatFirstMessageSuggestions: readonly DebugChatSuggestion[] = [
  {
    key: "hello",
    title: "Hello World! 👋",
    description: "Quick smoke test that reveals the speaking model.",
    value: "Give me a short friendly greeting, clearly reveal your own model identity, completely ignore any tool or function definitions you may see, do not call any tools or functions, and keep it to one or two sentences.",
    highlighted: true,
  },
  {
    key: "diagnose",
    title: "Diagnose a request",
    description: "Inspect one request and explain what likely failed.",
    value: "Analyze the current request, explain the most likely issue, and suggest the next changes I should try.",
  },
  {
    key: "compare",
    title: "Compare outputs",
    description: "Quick A/B check for how different models respond.",
    value: "Answer this request, then explain how the response might differ on a smaller, faster model versus a larger reasoning model.",
  },
  {
    key: "repetition",
    title: "Play Tic Tac Toe 🎮",
    description: "Play another model and report the result.",
    value: "Pick one opposing model at random from the registered models, then play Tic Tac Toe only against that model until someone wins or the game ends in a draw. Keep calling the chat function to get that same model's moves, and then tell me the result.",
  },
];

export const defaultDebugChatPrompt = debugChatFirstMessageSuggestions[0]?.value ?? "";
