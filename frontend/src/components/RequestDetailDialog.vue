<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import CodeView from "./CodeView.vue";
import ConversationSurface from "./ConversationSurface.vue";
import DialogCloseButton from "./DialogCloseButton.vue";
import MessageCard from "./MessageCard.vue";
import { useDashboardStore } from "../composables/useDashboardStore";

const store = useDashboardStore();
const router = useRouter();
const showRawRequest = ref(false);
const showRawResponse = ref(false);
let previousDocumentOverflow = "";
let previousBodyOverflow = "";
let scrollLockApplied = false;

function setBackgroundScrollLocked(locked: boolean): void {
  if (typeof document === "undefined") {
    return;
  }

  const { documentElement, body } = document;
  if (locked) {
    if (!scrollLockApplied) {
      previousDocumentOverflow = documentElement.style.overflow;
      previousBodyOverflow = body.style.overflow;
      scrollLockApplied = true;
    }

    documentElement.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return;
  }

  if (!scrollLockApplied) {
    return;
  }

  documentElement.style.overflow = previousDocumentOverflow;
  body.style.overflow = previousBodyOverflow;
  scrollLockApplied = false;
}

const requestConversationSignature = computed(() => [
  store.state.requestDetail.open ? "open" : "closed",
  store.state.requestDetail.requestId,
  store.requestMessages.length,
  store.requestResponseHtml,
].join("|"));

watch(
  () => [store.state.requestDetail.open, store.state.requestDetail.requestId],
  () => {
    showRawRequest.value = false;
    showRawResponse.value = false;
  },
);

watch(
  () => store.state.requestDetail.open,
  (open) => {
    setBackgroundScrollLocked(open);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  setBackgroundScrollLocked(false);
});

async function openDiagnosticsForCurrentRequest(): Promise<void> {
  const requestId = store.state.requestDetail.requestId;
  if (!requestId) {
    return;
  }

  store.closeRequestDetail();
  await router.push({
    name: "diagnostics",
    query: {
      requestId,
    },
  });
}
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
          <div class="mt-1.5 flex flex-wrap items-center gap-2">
            <p class="hint m-0">{{ store.requestDetailSubtitle }}</p>
          </div>
        </div>
        <div class="request-actions">
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
          <button
            v-if="store.state.requestDetail.requestId"
            class="icon-button compact"
            type="button"
            title="Open this request in diagnostics"
            aria-label="Open this request in diagnostics"
            @click="openDiagnosticsForCurrentRequest()"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9.25 4.25h5.5"></path>
              <path d="M10.5 7V4.5"></path>
              <path d="M13.5 7V4.5"></path>
              <path d="M8.2 10a3.8 3.8 0 1 1 7.6 0v4.15a3.8 3.8 0 0 1-7.6 0z"></path>
              <path d="M3.75 12h3.5"></path>
              <path d="M16.75 12h3.5"></path>
              <path d="M5.25 7.75 8 9.5"></path>
              <path d="M18.75 7.75 16 9.5"></path>
              <path d="M5.25 16.25 8 14.5"></path>
              <path d="M18.75 16.25 16 14.5"></path>
            </svg>
          </button>
          <DialogCloseButton
            compact
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

        <ConversationSurface
          title="Conversation"
          :reset-key="store.state.requestDetail.requestId"
          :scroll-signature="requestConversationSignature"
          follow-mode="latest-turn-start"
          :follow-anchor-active="Boolean(store.state.requestDetail.detail?.live)"
        >
          <section class="request-detail-section">
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

          <section class="request-detail-section request-detail-response-section">
            <div class="detail-stack" v-html="store.requestResponseHtml"></div>
          </section>
        </ConversationSurface>
      </div>
    </div>
  </div>
</template>
