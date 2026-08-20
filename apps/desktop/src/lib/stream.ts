import { applyUpdateToItems, type StreamItem } from "../../electron/shared";

function cloneItems(items: StreamItem[]): StreamItem[] {
  return items.map((item) => {
    if (item.kind === "tool") return { ...item };
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
      if (idx === next.length - 1) item.text += text;
      else item.text = text;
    } else {
      next.splice(thoughtInsertAt(next), 0, { kind: "thought", text });
    }
    return next;
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const id = String(update.toolCallId ?? update.tool_call_id ?? "");
    const existingIdx = indexInTurn(next, "tool");
    if (kind === "tool_call_update") {
      if (existingIdx >= 0) applyUpdateToItems(next, tools, kind, update);
      return next;
    }
    const insertAt = existingIdx >= 0 ? existingIdx : toolInsertAt(next);
    if (existingIdx >= 0) {
      const old = next[existingIdx];
      if (old.kind === "tool") tools.delete(old.id);
      next.splice(existingIdx, 1);
    }
    applyUpdateToItems(next, tools, "tool_call", {
      ...update,
      toolCallId: id || `tool-${next.length}`,
    });
    const created = next.pop();
    if (created) next.splice(Math.min(insertAt, next.length), 0, created);
    return next;
  }
  applyUpdateToItems(next, tools, kind, update);
  return next;
}

export function stripEphemeral(items: StreamItem[]): StreamItem[] {
  return items.filter((item) => item.kind !== "thought" && item.kind !== "tool");
}
