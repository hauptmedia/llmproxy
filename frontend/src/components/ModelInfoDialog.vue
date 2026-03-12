<script setup lang="ts">
import CodeView from "./CodeView.vue";
import type { ModelDetailView } from "../types/dashboard";

defineProps<{
  detail: ModelDetailView | null;
}>();

const emit = defineEmits<{
  (event: "close"): void;
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="detail"
      class="request-detail-overlay"
      @click.self="emit('close')"
    >
      <div class="request-detail-dialog model-info-dialog" role="dialog" aria-modal="true" aria-labelledby="model-info-title">
        <div class="panel-header">
          <div>
            <h2 id="model-info-title" class="panel-title">{{ detail.title }}</h2>
            <p class="hint">{{ detail.subtitle }}</p>
          </div>
          <button
            class="button secondary small"
            type="button"
            title="Close model details"
            aria-label="Close model details"
            @click="emit('close')"
          >
            X
          </button>
        </div>

        <div class="request-detail-grid">
          <div class="request-detail-card">
            <section class="request-detail-section">
              <h3>Overview</h3>
              <div class="model-detail-grid">
                <article
                  v-for="field in detail.summary"
                  :key="field.label + field.value"
                  class="model-detail-card"
                >
                  <div class="model-detail-label">{{ field.label }}</div>
                  <div class="model-detail-value">{{ field.value }}</div>
                </article>
              </div>
            </section>

            <section
              v-for="section in detail.sections"
              :key="section.title"
              class="request-detail-section"
            >
              <h3>{{ section.title }}</h3>
              <div class="model-field-list">
                <div
                  v-for="field in section.fields"
                  :key="section.title + field.label + field.value"
                  class="model-field-row"
                >
                  <div class="model-field-label">{{ field.label }}</div>
                  <div class="model-field-value">{{ field.value }}</div>
                </div>
              </div>
            </section>
          </div>

          <div class="request-detail-card">
            <section class="request-detail-section">
              <h3>Raw Metadata</h3>
              <CodeView
                :value="detail.rawMetadata"
                placeholder="No raw model metadata was stored."
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
