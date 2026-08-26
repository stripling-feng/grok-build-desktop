import fs from "node:fs";
import path from "node:path";
import { extractUpdateTimestamp } from "./shared";

const UPDATE_TAIL_BYTES = 256 * 1024;

function parsedTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

export function latestUpdateTimestamp(raw: string): number | undefined {
  const lines = raw.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const params = (parsed.params ?? parsed) as Record<string, unknown>;
      const update = (params.update ?? params) as Record<string, unknown>;
      const timestamp = extractUpdateTimestamp(parsed, update);
      if (timestamp) return timestamp;
    } catch {
      // The first line of a tail read may be partial. Keep scanning newer lines.
    }
  }
  return undefined;
}

export function readPersistedThreadActivity(dir: string): number | undefined {
  const file = path.join(dir, "updates.jsonl");
  let handle: number | undefined;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0) return undefined;
    const length = Math.min(stat.size, UPDATE_TAIL_BYTES);
    const buffer = Buffer.allocUnsafe(length);
    handle = fs.openSync(file, "r");
    fs.readSync(handle, buffer, 0, length, stat.size - length);
    return latestUpdateTimestamp(buffer.toString("utf8")) ?? stat.mtimeMs;
  } catch {
    return undefined;
  } finally {
    if (handle != null) {
      try {
        fs.closeSync(handle);
      } catch {
        /* ignore */
      }
    }
  }
}

export function resolveThreadUpdatedAt(
  summary: Record<string, unknown>,
  persistedActivity?: number,
): string {
  const createdAt = parsedTimestamp(summary.created_at);
  if (persistedActivity != null && Number.isFinite(persistedActivity) && persistedActivity > 0) {
    return new Date(Math.max(persistedActivity, createdAt ?? 0)).toISOString();
  }

  for (const value of [summary.last_active_at, summary.updated_at, summary.created_at]) {
    const timestamp = parsedTimestamp(value);
    if (timestamp) return new Date(timestamp).toISOString();
  }
  return new Date(0).toISOString();
}
