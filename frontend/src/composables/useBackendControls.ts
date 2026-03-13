import type { BackendDraft, BackendSnapshot, DashboardState, KnownModel, ProxySnapshot } from "../types/dashboard";
import { readErrorResponse } from "../utils/http";
import { collectSnapshotModels } from "../utils/model-catalog";

export function useBackendControls(state: DashboardState) {
  function syncBackendDrafts(backends: BackendSnapshot[]): void {
    const activeIds = new Set<string>();

    for (const backend of backends) {
      activeIds.add(backend.id);

      if (!state.backendDrafts[backend.id]) {
        state.backendDrafts[backend.id] = {
          enabled: backend.enabled,
          maxConcurrency: backend.maxConcurrency,
          saving: false,
          error: "",
        } satisfies BackendDraft;
        continue;
      }

      const draft = state.backendDrafts[backend.id];
      if (!draft.saving) {
        draft.enabled = backend.enabled;
        draft.maxConcurrency = backend.maxConcurrency;
      }
    }

    for (const backendId of Object.keys(state.backendDrafts)) {
      if (!activeIds.has(backendId)) {
        delete state.backendDrafts[backendId];
      }
    }
  }

  function ensureDebugModel(): void {
    if (state.models.length === 0) {
      state.debug.model = "";
      return;
    }

    if (!state.debug.model || !state.models.some((model: KnownModel) => model.id === state.debug.model)) {
      state.debug.model = state.models[0].id;
    }
  }

  function syncModels(models: KnownModel[]): void {
    state.models = [...models].sort((left, right) => left.id.localeCompare(right.id));
    ensureDebugModel();
  }

  function applySnapshot(snapshot: ProxySnapshot): void {
    state.snapshot = snapshot;
    syncBackendDrafts(snapshot.backends);
    syncModels(collectSnapshotModels(snapshot));
  }

  async function saveBackend(backendId: string): Promise<void> {
    const draft = state.backendDrafts[backendId];
    if (!draft) {
      return;
    }

    draft.saving = true;
    draft.error = "";

    try {
      const response = await fetch(`/api/backends/${encodeURIComponent(backendId)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: draft.enabled,
          maxConcurrency: Math.max(1, Math.round(draft.maxConcurrency || 1)),
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }
    } catch (error) {
      draft.error = error instanceof Error ? error.message : String(error);
    } finally {
      draft.saving = false;
    }
  }

  return {
    applySnapshot,
    ensureDebugModel,
    saveBackend,
    syncBackendDrafts,
  };
}
