<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from "vue";

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
let conversationObserver: MutationObserver | null = null;

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

function bindConversationObserver(): void {
  conversationObserver?.disconnect();
  conversationObserver = null;

  const viewport = conversationViewport.value;
  if (!viewport || typeof MutationObserver === "undefined") {
    return;
  }

  conversationObserver = new MutationObserver(() => {
    if (!autoFollowConversation.value) {
      return;
    }

    scheduleConversationScrollToBottom();
  });

  conversationObserver.observe(viewport, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

onMounted(() => {
  bindConversationObserver();
  scheduleConversationScrollToBottom();
});

onBeforeUnmount(() => {
  conversationObserver?.disconnect();
  conversationObserver = null;
});

watch(
  () => props.resetKey,
  () => {
    autoFollowConversation.value = true;
    scheduleConversationScrollToBottom();
  },
  { flush: "post" },
);

watch(
  () => props.scrollSignature,
  () => {
    scheduleConversationScrollToBottom();
  },
  { flush: "post" },
);

watch(
  conversationViewport,
  () => {
    bindConversationObserver();
    scheduleConversationScrollToBottom();
  },
  { flush: "post" },
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
