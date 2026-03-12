<script setup lang="ts">
import { ref, watch } from "vue";
import CodeView from "./CodeView.vue";
import MessageCard from "./MessageCard.vue";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
const showRawRequest = ref(false);
const showRawResponse = ref(false);

watch(
  () => [store.state.requestDetail.open, store.state.requestDetail.requestId],
  () => {
    showRawRequest.value = false;
    showRawResponse.value = false;
  },
);
</script>

<template>
  <div
    v-if="store.state.requestDetail.open"
    class="request-detail-overlay"
    @click.self="store.closeRequestDetail()"
  >
    <div class="request-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="request-detail-title">
      <div class="panel-header">
        <div>
          <h2 id="request-detail-title" class="panel-title">{{ store.requestDetailTitle }}</h2>
          <p class="hint">{{ store.requestDetailSubtitle }}</p>
        </div>
        <div class="request-actions">
          <button
            v-if="store.canCancelRequest(store.state.requestDetail.requestId)"
            class="icon-button danger"
            type="button"
            :disabled="store.isRequestCancelling(store.state.requestDetail.requestId)"
            :aria-label="store.isRequestCancelling(store.state.requestDetail.requestId) ? 'Ending the active connection' : 'End this active connection'"
            :title="store.isRequestCancelling(store.state.requestDetail.requestId) ? 'Ending the active connection...' : 'End this active connection after confirmation.'"
            @click="store.cancelActiveRequest(store.state.requestDetail.requestId)"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3.5v7"></path>
              <path d="M7.05 6.05a7 7 0 1 0 9.9 0"></path>
            </svg>
          </button>
          <button
            class="icon-button"
            type="button"
            title="Close request details"
            aria-label="Close request details"
            @click="store.closeRequestDetail()"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M9 9l6 6"></path>
              <path d="M15 9l-6 6"></path>
            </svg>
          </button>
        </div>
      </div>

      <div v-if="store.state.requestDetail.loading && !store.state.requestDetail.detail" class="empty">
        Loading request details...
      </div>
      <div v-else-if="store.state.requestDetail.error && !store.state.requestDetail.detail" class="empty">
        {{ store.state.requestDetail.error }}
      </div>
      <div v-else class="request-detail-grid">
        <div class="request-detail-card">
          <section class="request-detail-section">
            <h3>Summary</h3>
            <div v-if="store.requestSummaryBadges.length" class="request-meta">
              <span
                v-for="badge in store.requestSummaryBadges"
                :key="badge.text + badge.title"
                :class="store.badgeClass(badge)"
                :title="badge.title"
              >
                {{ badge.text }}
              </span>
            </div>
            <div v-else class="empty">No request summary is available.</div>
          </section>

          <section class="request-detail-section">
            <h3>Request Fields</h3>
            <div v-if="store.requestParamBadges.length" class="request-meta">
              <span
                v-for="badge in store.requestParamBadges"
                :key="badge.text + badge.title"
                :class="store.badgeClass(badge)"
                :title="badge.title"
              >
                {{ badge.text }}
              </span>
            </div>
            <div v-else class="empty">No additional top-level request fields were stored.</div>
          </section>

          <section class="request-detail-section">
            <h3>Conversation</h3>
            <div v-if="store.requestMessages.length" class="transcript">
              <MessageCard
                v-for="(message, index) in store.requestMessages"
                :key="index + ':' + (message.role || 'unknown')"
                :message="message"
                :index="Number(index)"
              />
            </div>
            <div v-else class="empty">No OpenAI messages were stored for this request.</div>
          </section>
        </div>

        <div class="request-detail-card">
          <section class="request-detail-section">
            <h3>Provided Tools</h3>
            <div class="detail-stack" v-html="store.requestToolsHtml"></div>
          </section>

          <section class="request-detail-section">
            <h3>Response</h3>
            <div class="detail-stack" v-html="store.requestResponseHtml"></div>
          </section>

          <section class="request-detail-section">
            <div class="mb-3 flex items-center justify-between gap-3">
              <h3 class="mb-0">Raw Request</h3>
              <button
                class="button secondary small"
                type="button"
                @click="showRawRequest = !showRawRequest"
              >
                {{ showRawRequest ? "Hide Raw Request" : "Show Raw Request" }}
              </button>
            </div>
            <CodeView
              v-if="showRawRequest"
              :value="store.state.requestDetail.detail && store.state.requestDetail.detail.requestBody"
              placeholder="No raw request payload was stored."
            />
          </section>

          <section class="request-detail-section">
            <div class="mb-3 flex items-center justify-between gap-3">
              <h3 class="mb-0">Raw Response</h3>
              <button
                class="button secondary small"
                type="button"
                @click="showRawResponse = !showRawResponse"
              >
                {{ showRawResponse ? "Hide Raw Response" : "Show Raw Response" }}
              </button>
            </div>
            <CodeView
              v-if="showRawResponse"
              :value="store.state.requestDetail.detail && store.state.requestDetail.detail.responseBody"
              placeholder="No raw response payload was stored."
            />
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
