<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Ace } from "ace-builds";
import { prettyJson } from "../utils/formatters";

type AceModule = typeof import("ace-builds");

let aceLoader: Promise<AceModule> | null = null;

async function loadAce(): Promise<AceModule> {
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

const props = withDefaults(defineProps<{
  value?: unknown;
  placeholder?: string;
  readOnly?: boolean;
}>(), {
  placeholder: "",
  readOnly: true,
});

const editorHost = ref<HTMLElement | null>(null);
let editor: Ace.Editor | null = null;
let resizeObserver: ResizeObserver | null = null;
let disposed = false;

const serializedValue = computed(() => {
  const value = props.value;
  if (value === undefined || value === null || value === "") {
    return props.placeholder;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return props.placeholder;
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
});

function syncEditorValue(): void {
  if (!editor) {
    return;
  }

  const nextValue = serializedValue.value;
  if (editor.getValue() === nextValue) {
    return;
  }

  editor.setValue(nextValue, -1);
  editor.clearSelection();
}

async function initializeEditor(): Promise<void> {
  if (!editorHost.value) {
    return;
  }

  try {
    const ace = await loadAce();

    if (disposed || !editorHost.value) {
      return;
    }

    editor = ace.edit(editorHost.value, {
      mode: "ace/mode/json",
      theme: "ace/theme/textmate",
      readOnly: props.readOnly,
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
      scrollPastEnd: 0.25,
      fixedWidthGutter: true,
      showFoldWidgets: true,
    });

    editor.session.setUseWorker(true);
    editor.session.setUseWrapMode(true);
    editor.session.setFoldStyle("markbeginend");
    editor.renderer.setScrollMargin(12, 12, 12, 12);
    editor.renderer.setPadding(12);
    editor.setValue(serializedValue.value, -1);
    editor.clearSelection();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        editor?.resize();
      });
      resizeObserver.observe(editorHost.value);
    }

    window.requestAnimationFrame(() => {
      editor?.resize();
    });
  } catch (error) {
    console.error("Failed to initialize the JSON editor.", error);
  }
}

onMounted(() => {
  void initializeEditor();
});

onBeforeUnmount(() => {
  disposed = true;
  resizeObserver?.disconnect();
  resizeObserver = null;
  editor?.destroy();
  editor = null;
});

watch(serializedValue, () => {
  syncEditorValue();
});

watch(
  () => props.readOnly,
  (readOnly) => {
    editor?.setReadOnly(readOnly);
  },
);
</script>

<template>
  <div class="json-ace-viewer">
    <div ref="editorHost" class="json-ace-editor"></div>
  </div>
</template>

<style scoped>
.json-ace-viewer {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(120, 53, 15, 0.12);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.9);
}

.json-ace-editor {
  flex: 1 1 auto;
  min-height: 0;
}

.json-ace-editor :deep(.ace_editor),
.json-ace-editor :deep(.ace_scroller),
.json-ace-editor :deep(.ace_content) {
  font-family: "IBM Plex Mono", "Consolas", monospace;
}

.json-ace-editor :deep(.ace_gutter) {
  background: rgba(245, 245, 244, 0.92);
}

.json-ace-editor :deep(.ace_fold-widget) {
  cursor: pointer;
}
</style>
