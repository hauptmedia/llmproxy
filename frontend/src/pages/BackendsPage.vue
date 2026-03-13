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
        <button class="button secondary small" type="button" @click="store.openCreateBackend">Add backend</button>
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
