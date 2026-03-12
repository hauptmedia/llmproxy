import type { KnownModel, ProxySnapshot } from "../types/dashboard";

export function collectSnapshotModels(snapshot: ProxySnapshot): KnownModel[] {
  const models = new Map<string, KnownModel>();

  for (const backend of snapshot.backends) {
    for (const model of backend.discoveredModels) {
      if (!models.has(model)) {
        models.set(model, {
          id: model,
          ownedBy: backend.name,
        });
      }
    }

    for (const model of backend.configuredModels) {
      if (model.includes("*") || models.has(model)) {
        continue;
      }

      models.set(model, {
        id: model,
        ownedBy: backend.name,
      });
    }
  }

  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
}
