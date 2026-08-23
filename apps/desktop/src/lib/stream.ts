import { applyUpdateToItems, isSpawnSubagentUpdate, type StreamItem } from "../../electron/shared";

export type PlanEntryStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "failed"
  | "cancelled";

export type PlanEntry = { content: string; status: PlanEntryStatus };

export type PlanRevision = { revision: number; entries: PlanEntry[] };

export function latestPlan(items: StreamItem[]): PlanEntry[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "plan") return item.entries;
  }
  return [];
}

export function planRevisions(items: StreamItem[]): PlanRevision[] {
  const revisions: PlanRevision[] = [];
  for (const item of items) {
    if (item.kind !== "plan") continue;
    const last = revisions[revisions.length - 1];
    if (last && last.revision === item.revision) {
      last.entries = item.entries;
    } else {
      revisions.push({ revision: item.revision, entries: item.entries });
    }
  }
  return revisions;
}

function cloneItems(items: StreamItem[]): StreamItem[] {
  return items.map((item) => {
    if (item.kind === "tool" || item.kind === "subagent") return { ...item };
    if (item.kind === "plan") return { ...item, entries: [...item.entries] };
    if (item.kind === "user" || item.kind === "agent" || item.kind === "thought" || item.kind === "status") {
      return { ...item };
    }
    return item;
  });
}

function lastUserIndex(items: StreamItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "user") return i;
  return -1;
}

function indexInTurn(items: StreamItem[], kind: "thought" | "tool"): number {
  const start = lastUserIndex(items) + 1;
  for (let i = start; i < items.length; i++) if (items[i].kind === kind) return i;
  return -1;
}

function thoughtInsertAt(items: StreamItem[]): number {
  return lastUserIndex(items) + 1;
}

function toolInsertAt(items: StreamItem[]): number {
  const thought = indexInTurn(items, "thought");
  if (thought >= 0) return thought + 1;
  return lastUserIndex(items) + 1;
}

export function isSpawnSubagentTool(
  item: Extract<StreamItem, { kind: "tool" }> | Record<string, unknown>,
): boolean {
  if ("kind" in item && (item as StreamItem).kind === "subagent") return true;
  const rec = item as Record<string, unknown>;
  if (String(rec.title ?? "").toLowerCase().includes("spawn_subagent")) return true;
  return isSpawnSubagentUpdate(rec);
}

export function applyLiveUpdate(
  items: StreamItem[],
  update: Record<string, unknown>,
): StreamItem[] {
  const next = cloneItems(items);
  const tools = new Map<string, Extract<StreamItem, { kind: "tool" }>>();
  for (const item of next) {
    if (item.kind === "tool") tools.set(item.id, item);
  }
  const kind = String(update.sessionUpdate ?? "");
  // Local send already inserted the user turn; grok echoes it as user_message_chunk.
  if (kind === "user_message_chunk") {
    const last = next[next.length - 1];
    if (last?.kind === "user") return next;
  }
  if (kind === "agent_thought_chunk") {
    const content = update.content as { type?: string; text?: string } | undefined;
    const text = content?.text ?? "";
    if (!text) return next;
    const idx = indexInTurn(next, "thought");
    if (idx >= 0) {
      const item = next[idx] as Extract<StreamItem, { kind: "thought" }>;
      item.text += text;
    } else {
      next.splice(thoughtInsertAt(next), 0, { kind: "thought", text });
    }
    return next;
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    if (kind === "tool_call_update" || isSpawnSubagentUpdate(update)) {
      applyUpdateToItems(next, tools, kind === "tool_call_update" ? kind : "tool_call", update);
      return next;
    }
    const existingIdx = (() => {
      const start = lastUserIndex(next) + 1;
      for (let i = start; i < next.length; i++) {
        const item = next[i];
        if (item.kind === "tool") return i;
      }
      return -1;
    })();
    const insertAt = existingIdx >= 0 ? existingIdx : toolInsertAt(next);
    if (existingIdx >= 0) {
      const old = next[existingIdx];
      if (old.kind === "tool") tools.delete(old.id);
      next.splice(existingIdx, 1);
    }
    applyUpdateToItems(next, tools, "tool_call", update);
    const created = next.pop();
    if (created) next.splice(Math.min(insertAt, next.length), 0, created);
    return next;
  }
  applyUpdateToItems(next, tools, kind, update);
  return next;
}

export function stripEphemeral(items: StreamItem[]): StreamItem[] {
  return items.filter((item) => {
    if (item.kind === "thought") return false;
    if (item.kind === "tool") return false;
    return true;
  });
}

export function stampTurnDuration(items: StreamItem[]): StreamItem[] {
  const next = items.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    const item = next[i];
    if (item.kind === "user") {
      if (item.startedAt && !item.durationMs) {
        next[i] = { ...item, durationMs: Math.max(1000, Date.now() - item.startedAt) };
      }
      break;
    }
  }
  return next;
}
