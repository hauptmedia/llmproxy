<script setup lang="ts">
import BackendTable from "../components/BackendTable.vue";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
</script>

<template>
  <section class="page-section">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Backends</h2>
          <p class="hint">Adjust enabled state and concurrency while keeping model discovery and routing visibility in one place.</p>
        </div>
      </div>
      <BackendTable
        :backends="store.state.snapshot.backends"
        :drafts="store.state.backendDrafts"
        @save-backend="store.saveBackend"
      />
    </div>
  </section>
</template>
