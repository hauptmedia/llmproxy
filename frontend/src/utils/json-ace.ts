import type { Ace } from "ace-builds";
import { prettyJson } from "./formatters";

type AceModule = typeof import("ace-builds");

let aceLoader: Promise<AceModule> | null = null;

export type JsonAceController = {
  destroy: () => void;
  resize: () => void;
  setReadOnly: (readOnly: boolean) => void;
  setValue: (value: unknown, placeholder?: string) => void;
};

export function serializeJsonAceValue(value: unknown, placeholder = ""): string {
  if (value === undefined || value === null || value === "") {
    return placeholder;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return placeholder;
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
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

export async function loadAce(): Promise<AceModule> {
  if (!aceLoader) {
    aceLoader = (async () => {
      const aceModule = await import("ace-builds") as unknown as { default: AceModule };
      const ace = aceModule.default;
      const [{ default: workerJsonUrl }] = await Promise.all([
        import("ace-builds/src-noconflict/worker-json?url"),
        import("ace-builds/src-noconflict/mode-json"),
        import("ace-builds/src-noconflict/theme-textmate"),
        import("ace-builds/src-noconflict/ext-searchbox"),
      ]);

      ace.config.setModuleUrl("ace/mode/json_worker", workerJsonUrl);
      return ace;
    })();
  }

  return aceLoader;
}

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
  const ace = await loadAce();
  const editor = ace.edit(host, {
    mode: "ace/mode/json",
    theme: "ace/theme/textmate",
    readOnly: options.readOnly ?? true,
    showPrintMargin: false,
    highlightActiveLine: false,
    highlightGutterLine: false,
    showGutter: true,
    useWorker: true,
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

  editor.session.setUseWorker(true);
  editor.session.setUseWrapMode(true);
  editor.session.setFoldStyle("markbeginend");
  editor.renderer.setScrollMargin(12, 12, 12, 12);
  editor.renderer.setPadding(options.padding ?? 12);
  editor.setValue(serializeJsonAceValue(options.value, options.placeholder ?? ""), -1);
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
      const nextValue = serializeJsonAceValue(value, placeholder);
      if (editor.getValue() === nextValue) {
        return;
      }

      editor.setValue(nextValue, -1);
      editor.clearSelection();
    },
  };
}
