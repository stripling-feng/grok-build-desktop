export type ModelCatalogEntry = {
  id: string;
  name: string;
  contextWindow?: number;
};

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function modelsFromCachePayload(payload: unknown): ModelCatalogEntry[] {
  if (!payload || typeof payload !== "object") return [];
  const models = (payload as Record<string, unknown>).models;
  if (!models || typeof models !== "object") return [];

  const entries = Array.isArray(models)
    ? models.map((value, index) => [String(index), value] as const)
    : Object.entries(models);
  const result: ModelCatalogEntry[] = [];
  for (const [fallbackId, value] of entries) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const info = row.info && typeof row.info === "object"
      ? (row.info as Record<string, unknown>)
      : row;
    const id = String(info.id ?? info.model ?? fallbackId).trim();
    if (!id) continue;
    const name = String(info.name ?? id).trim() || id;
    const contextWindow = positiveNumber(info.context_window ?? info.contextWindow);
    result.push({ id, name, contextWindow });
  }
  return result;
}
