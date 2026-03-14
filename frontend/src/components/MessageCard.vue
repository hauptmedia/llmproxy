<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { UiBadge } from "../types/dashboard";
import { renderMessageHtml } from "../utils/message-rendering";

interface MessageLike extends Record<string, unknown> {
  role?: string;
}

const props = withDefaults(defineProps<{
  message: MessageLike;
  index: number;
  heading?: string;
  bubbleLayout?: boolean;
  finishReason?: string;
  reasoningCollapsed?: boolean;
  extraBadges?: UiBadge[];
}>(), {
  heading: "",
  bubbleLayout: false,
  finishReason: "",
  reasoningCollapsed: true,
  extraBadges: () => [],
});

const hostEl = ref<HTMLElement | null>(null);
const reasoningExpanded = ref(false);

function handleReasoningToggle(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement) || !target.classList.contains("reasoning-panel")) {
    return;
  }

  reasoningExpanded.value = target.open;
}

const html = computed(() => renderMessageHtml(props.message, props.index, {
  heading: props.heading || undefined,
  finishReason: props.finishReason || "",
  reasoningCollapsed: reasoningExpanded.value ? false : props.reasoningCollapsed,
  extraBadges: props.extraBadges,
  hideRoleBadge: props.bubbleLayout && role.value === "system",
}));

const role = computed(() => (
  typeof props.message.role === "string" && props.message.role.trim().length > 0
    ? props.message.role.trim().toLowerCase()
    : "unknown"
));

const showAvatar = computed(() => props.bubbleLayout && (role.value === "user" || role.value === "assistant" || role.value === "system"));

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
});

onBeforeUnmount(() => {
  hostEl.value?.removeEventListener("toggle", handleReasoningToggle, true);
});
</script>

<template>
  <div :class="hostClass">
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

    <div ref="hostEl" class="message-card-body" v-html="html"></div>

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
