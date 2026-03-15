import type { Ace } from "ace-builds";
import { prettyJson } from "./formatters";

type AceModule = typeof import("ace-builds");

let aceLoader: Promise<AceModule> | null = null;
const loadedModes = new Set<string>();

export type InlineAceLanguage =
  | "json"
  | "xml"
  | "html"
  | "javascript"
  | "typescript"
  | "yaml"
  | "markdown"
  | "python"
  | "sh";

export type AceViewerController = {
  destroy: () => void;
  resize: () => void;
  setReadOnly: (readOnly: boolean) => void;
  setValue: (value: unknown, placeholder?: string) => void;
};

export function normalizeInlineAceLanguage(value: string): InlineAceLanguage | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "json") {
    return "json";
  }

  if (normalized === "xml" || normalized === "svg") {
    return "xml";
  }

  if (normalized === "html") {
    return "html";
  }

  if (normalized === "javascript" || normalized === "js") {
    return "javascript";
  }

  if (normalized === "typescript" || normalized === "ts") {
    return "typescript";
  }

  if (normalized === "yaml" || normalized === "yml") {
    return "yaml";
  }

  if (normalized === "markdown" || normalized === "md") {
    return "markdown";
  }

  if (normalized === "python" || normalized === "py") {
    return "python";
  }

  if (normalized === "sh" || normalized === "bash" || normalized === "shell" || normalized === "zsh") {
    return "sh";
  }

  return null;
}

function shouldUseJsonFormatting(language: InlineAceLanguage): boolean {
  return language === "json";
}

export function serializeCodeAceValue(
  value: unknown,
  language: InlineAceLanguage,
  placeholder = "",
): string {
  if (value === undefined || value === null || value === "") {
    return placeholder;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return placeholder;
    }

    if (shouldUseJsonFormatting(language) && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      try {
        return prettyJson(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }

    return value;
  }

  return prettyJson(value);
}

export function encodeJsonAcePayload(value: string): string {
  return encodeURIComponent(value);
}

export function decodeJsonAcePayload(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function loadAce(): Promise<AceModule> {
  if (!aceLoader) {
    aceLoader = (async () => {
      const aceModule = await import("ace-builds") as unknown as { default: AceModule };
      const ace = aceModule.default;
      await Promise.all([
        import("ace-builds/esm-resolver"),
        import("ace-builds/src-noconflict/theme-textmate"),
        import("ace-builds/src-noconflict/ext-searchbox"),
      ]);
      return ace;
    })();
  }

  return aceLoader;
}

async function ensureAceMode(language: InlineAceLanguage): Promise<void> {
  if (loadedModes.has(language)) {
    return;
  }

  switch (language) {
    case "json":
      await import("ace-builds/src-noconflict/mode-json");
      break;
    case "xml":
      await import("ace-builds/src-noconflict/mode-xml");
      break;
    case "html":
      await import("ace-builds/src-noconflict/mode-html");
      break;
    case "javascript":
      await import("ace-builds/src-noconflict/mode-javascript");
      break;
    case "typescript":
      await import("ace-builds/src-noconflict/mode-typescript");
      break;
    case "yaml":
      await import("ace-builds/src-noconflict/mode-yaml");
      break;
    case "markdown":
      await import("ace-builds/src-noconflict/mode-markdown");
      break;
    case "python":
      await import("ace-builds/src-noconflict/mode-python");
      break;
    case "sh":
      await import("ace-builds/src-noconflict/mode-sh");
      break;
  }

  loadedModes.add(language);
}

function aceModeName(language: InlineAceLanguage): string {
  return `ace/mode/${language}`;
}

function aceShouldUseWorker(language: InlineAceLanguage): boolean {
  return language === "json";
}

export async function createCodeAceEditor(
  host: HTMLElement,
  options: {
    value?: unknown;
    language?: InlineAceLanguage;
    placeholder?: string;
    readOnly?: boolean;
    minLines?: number;
    maxLines?: number;
    scrollPastEnd?: number;
    padding?: number;
  } = {},
): Promise<AceViewerController> {
  const ace = await loadAce();
  const language = options.language ?? "json";
  await ensureAceMode(language);

  const editor = ace.edit(host, {
    mode: aceModeName(language),
    theme: "ace/theme/textmate",
    readOnly: options.readOnly ?? true,
    showPrintMargin: false,
    highlightActiveLine: false,
    highlightGutterLine: false,
    showGutter: true,
    useWorker: aceShouldUseWorker(language),
    displayIndentGuides: true,
    wrap: true,
    tabSize: 2,
    useSoftTabs: true,
    fontSize: 14,
    scrollPastEnd: options.scrollPastEnd ?? 0.25,
    fixedWidthGutter: true,
    showFoldWidgets: true,
    minLines: options.minLines,
    maxLines: options.maxLines,
  });

  editor.session.setMode(aceModeName(language));
  editor.session.setUseWorker(aceShouldUseWorker(language));
  editor.session.setUseWrapMode(true);
  editor.session.setFoldStyle("markbeginend");
  editor.renderer.setScrollMargin(0, 12, 12, 12);
  editor.renderer.setPadding(options.padding ?? 12);
  editor.setValue(serializeCodeAceValue(options.value, language, options.placeholder ?? ""), -1);
  editor.clearSelection();

  let resizeObserver: ResizeObserver | null = null;

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      editor.resize();
    });
    resizeObserver.observe(host);
  }

  window.requestAnimationFrame(() => {
    editor.resize();
  });

  return {
    destroy() {
      resizeObserver?.disconnect();
      resizeObserver = null;
      editor.destroy();
    },
    resize() {
      editor.resize();
    },
    setReadOnly(readOnly: boolean) {
      editor.setReadOnly(readOnly);
    },
    setValue(value: unknown, placeholder = "") {
      const nextValue = serializeCodeAceValue(value, language, placeholder);
      if (editor.getValue() === nextValue) {
        return;
      }

      editor.setValue(nextValue, -1);
      editor.clearSelection();
    },
  };
}

export type JsonAceController = AceViewerController;

export async function createJsonAceEditor(
  host: HTMLElement,
  options: {
    value?: unknown;
    placeholder?: string;
    readOnly?: boolean;
    minLines?: number;
    maxLines?: number;
    scrollPastEnd?: number;
    padding?: number;
  } = {},
): Promise<JsonAceController> {
  return createCodeAceEditor(host, {
    ...options,
    language: "json",
  });
}
