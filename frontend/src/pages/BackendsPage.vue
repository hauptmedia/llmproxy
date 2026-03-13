<script setup lang="ts">
import { computed } from "vue";
import BackendEditorDialog from "../components/BackendEditorDialog.vue";
import BackendTable from "../components/BackendTable.vue";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
const currentBackendConfig = computed(() => {
  const backendId = store.state.backendEditor.originalId || store.state.backendEditor.fields.id;
  return backendId ? store.state.backendConfigs[backendId] ?? null : null;
});
</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Backends</h2>
          <p v-if="store.state.backendEditor.error && !store.state.backendEditor.open" class="hint inline-error">
            {{ store.state.backendEditor.error }}
          </p>
        </div>
        <button
          class="icon-button compact"
          type="button"
          title="Add backend configuration"
          aria-label="Add backend configuration"
          @click="store.openCreateBackend"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14"></path>
            <path d="M5 12h14"></path>
          </svg>
        </button>
      </div>
      <BackendTable
        :backends="store.state.snapshot.backends"
        @edit-backend="store.openEditBackend"
      />
    </div>
    <BackendEditorDialog
      :state="store.state.backendEditor"
      :current-config="currentBackendConfig"
      @close="store.closeBackendEditor"
      @save="store.saveBackendEditor"
    />
  </section>
</template>
