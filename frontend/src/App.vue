<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import BrandLogo from "./components/BrandLogo.vue";
import RequestDetailDialog from "./components/RequestDetailDialog.vue";
import { useDashboardStore } from "./composables/useDashboardStore";
import { getPageTitle } from "./dashboard-bootstrap";
import type { DashboardPage } from "./types/dashboard";

const store = useDashboardStore();
const route = useRoute();

const pageLinks: Array<{ page: DashboardPage; label: string }> = [
  { page: "overview", label: "📊 Overview" },
  { page: "logs", label: "🧾 Logs" },
  { page: "chat", label: "💬 Chat Debugger" },
  { page: "backends", label: "🧩 Backends" },
];

const currentPage = computed(() => {
  const routeName = route.name;
  if (routeName === "chat" || routeName === "backends" || routeName === "overview" || routeName === "logs") {
    return routeName;
  }

  return "overview";
});

onMounted(() => {
  store.start();
});

onBeforeUnmount(() => {
  store.stop();
});

watch(
  currentPage,
  (page) => {
    document.title = `llmproxy - ${getPageTitle(page)}`;
  },
  { immediate: true },
);
</script>

<template>
  <div class="shell">
    <div class="hero-sticky">
      <header class="hero">
        <div class="hero-bar">
          <div class="hero-nav-group">
            <div class="brand-link" aria-label="llmproxy brand">
              <BrandLogo compact />
            </div>
            <nav class="page-nav" aria-label="Dashboard pages">
              <RouterLink
                v-for="link in pageLinks"
                :key="link.page"
                :to="{ name: link.page }"
                class="page-link"
                :class="{ active: currentPage === link.page }"
              >
                {{ link.label }}
              </RouterLink>
            </nav>
          </div>
          <div :class="['meta', store.state.connectionStatus]" :title="store.state.connectionText">
            <span class="connection-dot" aria-hidden="true"></span>
          </div>
        </div>
      </header>
    </div>

    <RouterView />
    <RequestDetailDialog />
  </div>
</template>
