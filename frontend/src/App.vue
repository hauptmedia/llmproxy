<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import BrandLogo from "./components/BrandLogo.vue";
import DebugChatDialog from "./components/DebugChatDialog.vue";
import RequestDetailDialog from "./components/RequestDetailDialog.vue";
import ServerConfigEditorDialog from "./components/ServerConfigEditorDialog.vue";
import { useDashboardStore } from "./composables/useDashboardStore";
import { getPageTitle } from "./dashboard-bootstrap";
import type { DashboardPage } from "./types/dashboard";

const store = useDashboardStore();
const route = useRoute();

const pageLinks: Array<{ page: DashboardPage; label: string; icon: string[] }> = [
  {
    page: "overview",
    label: "Dashboard",
    icon: [
      "M4 5.5h6v6H4z",
      "M14 5.5h6v9h-6z",
      "M4 15.5h6v4H4z",
      "M14 17.5h6v2h-6z",
    ],
  },
  {
    page: "logs",
    label: "Requests",
    icon: [
      "M6 5.5h12",
      "M6 10.5h12",
      "M6 15.5h12",
      "M4 5.5h.01",
      "M4 10.5h.01",
      "M4 15.5h.01",
    ],
  },
  {
    page: "playground",
    label: "Playground",
    icon: [
      "M5.5 7.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H11l-3.5 3v-3H7.5a2 2 0 0 1-2-2z",
    ],
  },
];

const currentPage = computed(() => {
  const routeName = route.name;
  if (routeName === "playground" || routeName === "config" || routeName === "overview" || routeName === "logs") {
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
  <div class="shell" :class="{ 'shell-playground': currentPage === 'playground' }">
    <div class="hero-sticky">
      <header class="hero">
        <div class="hero-bar">
          <div class="hero-nav-group">
            <div class="page-nav">
              <div class="brand-status-shell">
                <RouterLink class="brand-link page-nav-brand" :to="{ name: 'config' }" aria-label="Open llmproxy config" title="Open llmproxy config">
                  <BrandLogo compact title="Open llmproxy config" />
                </RouterLink>
                <span
                  :class="['brand-connection-indicator', store.state.connectionStatus]"
                  :title="store.state.connectionText"
                  aria-hidden="true"
                >
                  <span class="connection-dot"></span>
                </span>
              </div>
              <nav class="page-nav-links" aria-label="Dashboard pages">
              <RouterLink
                v-for="link in pageLinks"
                :key="link.page"
                :to="{ name: link.page }"
                class="page-link"
                :class="[{ active: currentPage === link.page }, `page-link-${link.page}`]"
              >
                <svg class="page-link-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
                  <path v-for="pathDef in link.icon" :key="pathDef" :d="pathDef"></path>
                </svg>
                <span>{{ link.label }}</span>
              </RouterLink>
              </nav>
            </div>
          </div>
        </div>
      </header>
    </div>

    <main class="shell-content">
      <RouterView />
    </main>
    <div v-if="store.state.toasts.length" class="toast-stack" aria-live="polite" aria-atomic="true">
      <div
        v-for="toast in store.state.toasts"
        :key="toast.id"
        class="toast-card"
        :class="toast.tone"
      >
        <div class="toast-body">
          <div v-if="toast.title" class="toast-title">{{ toast.title }}</div>
          <div class="toast-message">{{ toast.message }}</div>
        </div>
        <button
          class="toast-dismiss"
          type="button"
          aria-label="Dismiss notification"
          title="Dismiss notification"
          @click="store.dismissToast(toast.id)"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
            <path d="M6 6 18 18"></path>
            <path d="M18 6 6 18"></path>
          </svg>
        </button>
      </div>
    </div>
    <DebugChatDialog />
    <RequestDetailDialog />
    <ServerConfigEditorDialog
      :state="store.state.serverEditor"
      :current-config="store.state.serverConfig"
      @close="store.closeServerEditor"
      @save="store.saveServerEditor"
    />
  </div>
</template>
