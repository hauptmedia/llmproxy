<script setup lang="ts">
import { computed } from "vue";
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

const html = computed(() => renderMessageHtml(props.message, props.index, {
  heading: props.heading || undefined,
  finishReason: props.finishReason || "",
  reasoningCollapsed: props.reasoningCollapsed,
  extraBadges: props.extraBadges,
}));
</script>

<template>
  <div class="message-card-host" v-html="html"></div>
</template>
