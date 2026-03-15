<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { AceViewerController } from "../utils/json-ace";
import { createCodeAceEditor } from "../utils/json-ace";

const props = withDefaults(defineProps<{
  value?: unknown;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: string;
}>(), {
  placeholder: "",
  readOnly: true,
  minHeight: "320px",
});

const editorHost = ref<HTMLElement | null>(null);
let controller: AceViewerController | null = null;
let disposed = false;

async function initializeEditor(): Promise<void> {
  if (!editorHost.value) {
    return;
  }

  try {
    controller = await createCodeAceEditor(editorHost.value, {
      value: props.value,
      language: "json",
      placeholder: props.placeholder,
      readOnly: props.readOnly,
    });

    if (disposed) {
      controller.destroy();
      controller = null;
    }
  } catch (error) {
    console.error("Failed to initialize the JSON editor.", error);
  }
}

onMounted(() => {
  void initializeEditor();
});

onBeforeUnmount(() => {
  disposed = true;
  controller?.destroy();
  controller = null;
});

function resize(): void {
  controller?.resize();
}

defineExpose({
  resize,
});

watch(() => [props.value, props.placeholder] as const, ([value, placeholder]) => {
  controller?.setValue(value, placeholder);
  controller?.resize();
});

watch(
  () => props.readOnly,
  (readOnly) => {
    controller?.setReadOnly(readOnly);
  },
);
</script>

<template>
  <div class="json-ace-viewer" :style="{ '--json-ace-min-height': props.minHeight }">
    <div ref="editorHost" class="json-ace-editor"></div>
  </div>
</template>

<style scoped>
.json-ace-viewer {
  display: flex;
  flex: 1 1 auto;
  width: 100%;
  min-height: var(--json-ace-min-height, 320px);
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(120, 53, 15, 0.12);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.9);
}

.json-ace-editor {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: var(--json-ace-min-height, 320px);
  overflow: hidden;
}

:deep(.json-ace-editor.ace_editor),
.json-ace-editor :deep(.ace_editor),
.json-ace-editor :deep(.ace_scroller),
.json-ace-editor :deep(.ace_content) {
  font-family: "IBM Plex Mono", "Consolas", monospace;
}

:deep(.json-ace-editor.ace_editor),
.json-ace-editor :deep(.ace_editor) {
  width: 100%;
  height: 100%;
  min-height: var(--json-ace-min-height, 320px);
}

:deep(.json-ace-editor.ace_editor .ace_gutter),
.json-ace-editor :deep(.ace_gutter) {
  background: rgba(245, 245, 244, 0.92);
}

:deep(.json-ace-editor.ace_editor .ace_fold-widget),
.json-ace-editor :deep(.ace_fold-widget) {
  cursor: pointer;
}
</style>
