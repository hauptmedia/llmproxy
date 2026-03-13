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
  { page: "chat", label: "Chat" },
];

const currentPage = computed(() => {
  const routeName = route.name;
  if (routeName === "chat" || routeName === "config" || routeName === "overview" || routeName === "logs") {
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
            <div class="brand-status-shell">
              <RouterLink class="brand-link" :to="{ name: 'config' }" aria-label="Open config" title="Open config">
                <BrandLogo compact title="Open config" />
              </RouterLink>
              <span
                :class="['brand-connection-indicator', store.state.connectionStatus]"
                :title="store.state.connectionText"
                aria-hidden="true"
              >
                <span class="connection-dot"></span>
              </span>
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
        </div>
      </header>
    </div>

    <RouterView />
    <RequestDetailDialog />
    <ServerConfigEditorDialog
      :state="store.state.serverEditor"
      :current-config="store.state.serverConfig"
      @close="store.closeServerEditor"
      @save="store.saveServerEditor"
    />
  </div>
</template>
