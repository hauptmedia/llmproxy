<script setup lang="ts">
import { computed } from "vue";
import { renderCodeBlockHtml } from "../dashboard-core";

const props = withDefaults(defineProps<{
  value?: any;
  placeholder?: string;
}>(), {
  placeholder: "",
});

const html = computed(() => renderCodeBlockHtml(
  props.value === undefined || props.value === null || props.value === ""
    ? props.placeholder
    : props.value,
  "turn-content",
));
</script>

<template>
  <div class="code-view-host" v-html="html"></div>
</template>
