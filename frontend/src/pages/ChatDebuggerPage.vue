<script setup lang="ts">
import { useRouter } from "vue-router";
import DebugChatFrame from "../components/DebugChatFrame.vue";

const router = useRouter();

function closeChatbox(): void {
  void router.push({ name: "overview" });
}
</script>

<template>
  <DebugChatFrame
    :open="true"
    :close-on-backdrop="false"
    show-close-button
    heading-id="chatbox-dialog-title"
    @close="closeChatbox"
  />
</template>
