<script setup lang="ts">
import CodeView from "./CodeView.vue";
import MessageCard from "./MessageCard.vue";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
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
            class="button secondary small"
            type="button"
            :disabled="store.isRequestCancelling(store.state.requestDetail.requestId)"
            :title="store.isRequestCancelling(store.state.requestDetail.requestId) ? 'Ending the live connection...' : 'End this live connection after confirmation.'"
            @click="store.cancelActiveRequest(store.state.requestDetail.requestId)"
          >
            {{ store.isRequestCancelling(store.state.requestDetail.requestId) ? "Ending..." : "End" }}
          </button>
          <button
            class="button secondary small"
            type="button"
            title="Close request details"
            aria-label="Close request details"
            @click="store.closeRequestDetail()"
          >
            X
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
                :heading="'message ' + (Number(index) + 1)"
              />
            </div>
            <div v-else class="empty">No OpenAI messages were stored for this request.</div>
          </section>
        </div>

        <div class="request-detail-card">
          <section class="request-detail-section">
            <h3>Tools</h3>
            <div class="detail-stack" v-html="store.requestToolsHtml"></div>
          </section>

          <section class="request-detail-section">
            <h3>Response</h3>
            <div class="detail-stack" v-html="store.requestResponseHtml"></div>
          </section>

          <section class="request-detail-section">
            <h3>Raw Request</h3>
            <CodeView
              :value="store.state.requestDetail.detail && store.state.requestDetail.detail.requestBody"
              placeholder="No raw request payload was stored."
            />
          </section>

          <section class="request-detail-section">
            <h3>Raw Response</h3>
            <CodeView
              :value="store.state.requestDetail.detail && store.state.requestDetail.detail.responseBody"
              placeholder="No raw response payload was stored."
            />
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
