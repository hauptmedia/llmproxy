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
  finishReason?: string;
  reasoningCollapsed?: boolean;
  extraBadges?: UiBadge[];
}>(), {
  heading: "",
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
}));

const hostClass = computed(() => {
  const role = typeof props.message.role === "string" && props.message.role.trim().length > 0
    ? props.message.role.trim().toLowerCase()
    : "unknown";

  return [
    "message-card-host",
    `role-${role}`,
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
  <div ref="hostEl" :class="hostClass" v-html="html"></div>
</template>
