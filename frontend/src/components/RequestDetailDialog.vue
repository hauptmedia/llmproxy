<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import CodeView from "./CodeView.vue";
import DialogCloseButton from "./DialogCloseButton.vue";
import MessageCard from "./MessageCard.vue";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
const conversationViewport = ref<HTMLElement | null>(null);
const showRawRequest = ref(false);
const showRawResponse = ref(false);
const autoFollowConversation = ref(true);

function isConversationNearBottom(): boolean {
  const viewport = conversationViewport.value;
  if (!viewport) {
    return true;
  }

  return viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 28;
}

function scrollConversationToBottom(): void {
  const viewport = conversationViewport.value;
  if (!viewport) {
    return;
  }

  viewport.scrollTop = viewport.scrollHeight;
}

function scheduleConversationScrollToBottom(): void {
  void nextTick(() => {
    if (!autoFollowConversation.value) {
      return;
    }

    window.requestAnimationFrame(() => {
      scrollConversationToBottom();
    });
  });
}

function handleConversationScroll(): void {
  autoFollowConversation.value = isConversationNearBottom();
}

watch(
  () => [store.state.requestDetail.open, store.state.requestDetail.requestId],
  () => {
    showRawRequest.value = false;
    showRawResponse.value = false;
    autoFollowConversation.value = true;
    scheduleConversationScrollToBottom();
  },
);

watch(
  () => [store.state.requestDetail.open, store.requestMessages.length, store.requestResponseHtml],
  ([open]) => {
    if (!open) {
      return;
    }

    scheduleConversationScrollToBottom();
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
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="request-detail-title" class="panel-title">{{ store.requestDetailTitle }}</h2>
            <div
              v-if="store.requestLiveTransportBadges.length || store.requestStateBadge"
              class="request-meta"
            >
              <template v-if="store.requestLiveTransportBadges.length">
                <span
                  v-for="badge in store.requestLiveTransportBadges"
                  :key="badge.text + (badge.title || '')"
                  :class="store.badgeClass(badge)"
                  :title="badge.title"
                >
                  {{ badge.text }}
                </span>
              </template>
              <template v-else-if="store.requestStateBadge">
                <span
                  :class="store.badgeClass(store.requestStateBadge)"
                  :title="store.requestStateBadge.title"
                >
                  {{ store.requestStateBadge.text }}
                </span>
              </template>
            </div>
          </div>
          <div class="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <p class="hint m-0">{{ store.requestDetailSubtitle }}</p>
            <button
              v-if="store.canCancelRequest(store.state.requestDetail.requestId)"
              class="icon-button danger compact"
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
          </div>
        </div>
        <div class="request-actions">
          <DialogCloseButton
            title="Close request details"
            aria-label="Close request details"
            @click="store.closeRequestDetail()"
          />
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
          <div class="detail-card-viewport">
            <section class="request-detail-section">
              <h3>Request Parameters</h3>
              <div v-if="store.requestParamRows.length" class="detail-table-wrap">
                <table class="detail-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in store.requestParamRows" :key="row.key + row.value">
                      <td :title="row.title" class="detail-table-key">{{ row.key }}</td>
                      <td :title="row.title" class="detail-table-value mono">{{ row.value }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="empty">No additional top-level request fields were stored.</div>
            </section>

            <section class="request-detail-section">
              <h3>Response Metrics</h3>
              <div v-if="store.requestResponseMetricRows.length" class="detail-table-wrap">
                <table class="detail-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in store.requestResponseMetricRows" :key="row.key + row.value">
                      <td :title="row.title" class="detail-table-key">{{ row.key }}</td>
                      <td :title="row.title" class="detail-table-value mono">{{ row.value }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="empty">No response metrics have been recorded yet.</div>
            </section>

            <section class="request-detail-section">
              <h3>Provided Tools</h3>
              <div class="detail-stack" v-html="store.requestToolsHtml"></div>
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

        <div class="request-detail-card">
          <div
            ref="conversationViewport"
            class="conversation-viewport"
            @scroll="handleConversationScroll"
          >
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

            <section class="request-detail-section">
              <div class="detail-stack" v-html="store.requestResponseHtml"></div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
