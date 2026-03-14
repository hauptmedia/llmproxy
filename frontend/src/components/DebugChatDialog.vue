<script setup lang="ts">
import DebugChatWorkspace from "./DebugChatWorkspace.vue";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
</script>

<template>
  <div
    v-if="store.state.debug.dialogOpen"
    class="debug-chat-overlay"
    @click.self="store.closeDebugChatDialog()"
  >
    <div class="debug-chat-dialog" role="dialog" aria-modal="true" aria-labelledby="debug-chat-dialog-title">
      <DebugChatWorkspace
        show-close-button
        heading-id="debug-chat-dialog-title"
        @close="store.closeDebugChatDialog()"
      />
    </div>
  </div>
</template>
