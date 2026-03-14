<script setup lang="ts">
import { computed } from "vue";
import { renderToolsHtml } from "../utils/message-rendering";

const props = defineProps<{
  tools: unknown;
}>();

const toolsHtml = computed(() => renderToolsHtml(props.tools));
</script>

<template>
  <div class="detail-stack" v-html="toolsHtml"></div>
</template>
