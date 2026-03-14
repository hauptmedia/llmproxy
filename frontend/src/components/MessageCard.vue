<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { UiBadge } from "../types/dashboard";
import { renderMessageHtml } from "../utils/message-rendering";
import type { JsonAceController } from "../utils/json-ace";
import { createJsonAceEditor } from "../utils/json-ace";

interface MessageLike extends Record<string, unknown> {
  role?: string;
}

const props = withDefaults(defineProps<{
  message: MessageLike;
  index: number;
  heading?: string;
  bubbleLayout?: boolean;
  finishReason?: string;
  hideFinishBadge?: boolean;
  reasoningCollapsed?: boolean;
  extraBadges?: UiBadge[];
}>(), {
  heading: "",
  bubbleLayout: false,
  finishReason: "",
  hideFinishBadge: false,
  reasoningCollapsed: true,
  extraBadges: () => [],
});

const hostEl = ref<HTMLElement | null>(null);
const reasoningExpanded = ref(false);
const inlineJsonEditors: JsonAceController[] = [];

function destroyInlineJsonEditors(): void {
  while (inlineJsonEditors.length > 0) {
    inlineJsonEditors.pop()?.destroy();
  }
}

function handleReasoningToggle(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement) || !target.classList.contains("compact-bubble-panel-reasoning")) {
    return;
  }

  reasoningExpanded.value = target.open;
}

async function syncInlineJsonEditors(): Promise<void> {
  destroyInlineJsonEditors();
  await nextTick();

  if (!hostEl.value) {
    return;
  }

  const containers = hostEl.value.querySelectorAll<HTMLElement>(".tool-response-json-ace");

  for (const container of containers) {
    const host = container.querySelector<HTMLElement>(".tool-response-json-ace-host");
    const payload = container.querySelector<HTMLScriptElement>('script[type="application/json"]');
    if (!host || !payload) {
      continue;
    }

    try {
      const controller = await createJsonAceEditor(host, {
        value: payload.textContent ?? "",
        readOnly: true,
        minLines: 8,
        maxLines: 18,
        scrollPastEnd: 0,
        padding: 10,
      });
      inlineJsonEditors.push(controller);
    } catch (error) {
      console.error("Failed to initialize inline tool JSON viewer.", error);
    }
  }
}

const html = computed(() => renderMessageHtml(props.message, props.index, {
  heading: props.heading || undefined,
  finishReason: props.finishReason || "",
  hideFinishBadge: props.hideFinishBadge,
  reasoningCollapsed: reasoningExpanded.value ? false : props.reasoningCollapsed,
  extraBadges: props.extraBadges,
  hideRoleBadge: props.bubbleLayout && (role.value === "system" || role.value === "tool"),
  hideModelBadge: props.bubbleLayout && role.value === "assistant",
  hideToolMetaBadges: props.bubbleLayout && role.value === "tool",
}));

const role = computed(() => (
  typeof props.message.role === "string" && props.message.role.trim().length > 0
    ? props.message.role.trim().toLowerCase()
    : "unknown"
));

const showAvatar = computed(() => props.bubbleLayout && (role.value === "user" || role.value === "assistant" || role.value === "system" || role.value === "tool"));

const assistantAvatarTitle = computed(() => {
  if (role.value !== "assistant") {
    return "";
  }

  const model =
    typeof props.message.model === "string" && props.message.model.trim().length > 0
      ? props.message.model.trim()
      : "";

  return model ? `Model: ${model}` : "";
});

const toolAvatarTitle = computed(() => {
  if (role.value !== "tool") {
    return "";
  }

  const parts: string[] = [];
  const toolName =
    typeof props.message.name === "string" && props.message.name.trim().length > 0
      ? props.message.name.trim()
      : "";
  const toolCallId =
    typeof props.message.tool_call_id === "string" && props.message.tool_call_id.trim().length > 0
      ? props.message.tool_call_id.trim()
      : "";

  if (toolName) {
    parts.push(`Tool: ${toolName}`);
  }

  if (toolCallId) {
    parts.push(`Call id: ${toolCallId}`);
  }

  return parts.join("\n");
});

const hostClass = computed(() => {
  const normalizedRole = role.value;

  return [
    "message-card-host",
    `role-${normalizedRole}`,
    props.bubbleLayout ? "bubble-layout" : "",
    showAvatar.value ? "with-avatar" : "",
  ];
});

onMounted(() => {
  hostEl.value?.addEventListener("toggle", handleReasoningToggle, true);
  void syncInlineJsonEditors();
});

onBeforeUnmount(() => {
  hostEl.value?.removeEventListener("toggle", handleReasoningToggle, true);
  destroyInlineJsonEditors();
});

watch(html, () => {
  void syncInlineJsonEditors();
});
</script>

<template>
  <div :class="hostClass">
    <div
      v-if="showAvatar && role === 'system'"
      class="message-avatar"
      :class="`role-${role}`"
      title="System prompt"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="6.75"></circle>
        <path d="M12 3.75v2.5"></path>
        <path d="M12 17.75v2.5"></path>
        <path d="M3.75 12h2.5"></path>
        <path d="M17.75 12h2.5"></path>
        <path d="M6.1 6.1 7.9 7.9"></path>
        <path d="M16.1 16.1 17.9 17.9"></path>
        <path d="M16.1 7.9 17.9 6.1"></path>
        <path d="M6.1 17.9 7.9 16.1"></path>
        <path d="M12 9.1a2.9 2.9 0 0 1 2.9 2.9"></path>
      </svg>
    </div>

    <div
      v-if="showAvatar && role === 'assistant'"
      class="message-avatar"
      :class="`role-${role}`"
      :title="assistantAvatarTitle || undefined"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="6" y="8" width="12" height="9" rx="2.5"></rect>
        <path d="M12 4.5v2.5"></path>
        <path d="M9.5 17v2"></path>
        <path d="M14.5 17v2"></path>
        <path d="M6 12H4.5"></path>
        <path d="M19.5 12H18"></path>
        <circle cx="10" cy="11.5" r="0.9" fill="currentColor" stroke="none"></circle>
        <circle cx="14" cy="11.5" r="0.9" fill="currentColor" stroke="none"></circle>
        <path d="M9.5 14.2c.8.5 1.7.8 2.5.8s1.7-.3 2.5-.8"></path>
      </svg>
    </div>

    <div
      v-if="showAvatar && role === 'tool'"
      class="message-avatar"
      :class="`role-${role}`"
      :title="toolAvatarTitle || undefined"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 7V6a3 3 0 0 1 6 0v1"></path>
        <path d="M4.75 8.5h14.5"></path>
        <path d="M6.25 8.5h11.5a1.5 1.5 0 0 1 1.5 1.5v6.75a2 2 0 0 1-2 2H6.75a2 2 0 0 1-2-2V10a1.5 1.5 0 0 1 1.5-1.5Z"></path>
        <path d="M10 12h4"></path>
        <path d="M12 10v4"></path>
      </svg>
    </div>

    <div ref="hostEl" class="message-card-body" v-html="html"></div>

    <div
      v-if="showAvatar && role === 'user'"
      class="message-avatar"
      :class="`role-${role}`"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="8"></circle>
        <circle cx="9.5" cy="10.5" r="0.9" fill="currentColor" stroke="none"></circle>
        <circle cx="14.5" cy="10.5" r="0.9" fill="currentColor" stroke="none"></circle>
        <path d="M8.5 14.2c1 .9 2.2 1.3 3.5 1.3s2.5-.4 3.5-1.3"></path>
      </svg>
    </div>
  </div>
</template>
