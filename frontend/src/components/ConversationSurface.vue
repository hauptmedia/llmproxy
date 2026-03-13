<script setup lang="ts">
import { nextTick, ref, useSlots, watch } from "vue";

const props = withDefaults(defineProps<{
  title?: string;
  cardClass?: string;
  viewportClass?: string;
  resetKey?: string | number;
  scrollSignature?: string | number;
}>(), {
  title: "",
  cardClass: "",
  viewportClass: "",
  resetKey: "",
  scrollSignature: "",
});

const slots = useSlots();
const conversationViewport = ref<HTMLElement | null>(null);
const autoFollowConversation = ref(true);

function hasSlot(name: "headerMeta" | "headerActions" | "footer"): boolean {
  return Boolean(slots[name]);
}

function isConversationNearBottom(): boolean {
  const viewport = conversationViewport.value;
  if (!viewport) {
    return true;
  }

  return viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 28;
}

function scrollConversationToBottom(): void {
  const viewport = conversationViewport.value;
  if (!viewport) {
    return;
  }

  viewport.scrollTop = viewport.scrollHeight;
}

function scheduleConversationScrollToBottom(): void {
  void nextTick(() => {
    if (!autoFollowConversation.value) {
      return;
    }

    window.requestAnimationFrame(() => {
      scrollConversationToBottom();
    });
  });
}

function handleConversationScroll(): void {
  autoFollowConversation.value = isConversationNearBottom();
}

watch(
  () => props.resetKey,
  () => {
    autoFollowConversation.value = true;
    scheduleConversationScrollToBottom();
  },
);

watch(
  () => props.scrollSignature,
  () => {
    scheduleConversationScrollToBottom();
  },
);
</script>

<template>
  <div class="request-detail-card conversation-surface-card" :class="cardClass">
    <div
      v-if="title || hasSlot('headerMeta') || hasSlot('headerActions')"
      class="conversation-surface-header"
    >
      <div class="conversation-surface-heading">
        <h3 v-if="title" class="conversation-surface-title">{{ title }}</h3>
        <slot name="headerMeta"></slot>
      </div>
      <div v-if="hasSlot('headerActions')" class="conversation-surface-actions">
        <slot name="headerActions"></slot>
      </div>
    </div>

    <div
      ref="conversationViewport"
      class="conversation-viewport"
      :class="viewportClass"
      @scroll="handleConversationScroll"
    >
      <slot></slot>
    </div>

    <div v-if="hasSlot('footer')" class="conversation-surface-footer">
      <slot name="footer"></slot>
    </div>
  </div>
</template>
