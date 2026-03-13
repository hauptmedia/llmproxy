<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import BrandLogo from "./components/BrandLogo.vue";
import RequestDetailDialog from "./components/RequestDetailDialog.vue";
import ServerConfigEditorDialog from "./components/ServerConfigEditorDialog.vue";
import { useDashboardStore } from "./composables/useDashboardStore";
import { getPageTitle } from "./dashboard-bootstrap";
import type { DashboardPage } from "./types/dashboard";

const store = useDashboardStore();
const route = useRoute();

const pageLinks: Array<{ page: DashboardPage; label: string }> = [
  { page: "overview", label: "Dashboard" },
  { page: "logs", label: "Requests" },
  { page: "backends", label: "Config" },
  { page: "chat", label: "Chat" },
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
          <div class="hero-actions">
            <button
              class="icon-button compact"
              type="button"
              title="Edit llmproxy config"
              aria-label="Edit llmproxy config"
              @click="store.openServerEditor"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"></path>
              </svg>
            </button>
            <div :class="['meta', store.state.connectionStatus]" :title="store.state.connectionText">
              <span class="connection-dot" aria-hidden="true"></span>
            </div>
          </div>
        </div>
      </header>
    </div>

    <RouterView />
    <RequestDetailDialog />
    <ServerConfigEditorDialog
      :state="store.state.serverEditor"
      @close="store.closeServerEditor"
      @save="store.saveServerEditor"
    />
  </div>
</template>
