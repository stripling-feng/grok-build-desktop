export type StreamItem =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "thought"; text: string }
  | {
      kind: "tool";
      id: string;
      title: string;
      status: string;
      toolKind?: string;
      detail?: string;
      path?: string;
    }
  | { kind: "plan"; entries: { content: string; status?: string }[] }
  | { kind: "status"; text: string };

export type ThreadInfo = {
  id: string;
  cwd: string;
  title: string;
  summary?: string;
  model?: string;
  updatedAt: string;
  createdAt: string;
  lastTurnSummary?: string;
  gitRoot?: string;
  projectCwd: string;
  worktree?: boolean;
};

export type ProjectInfo = {
  cwd: string;
  name: string;
  gitRoot?: string | null;
  addedAt: number;
};

export type PermissionRequest = {
  requestId: string;
  sessionId: string;
  title: string;
  toolCall?: unknown;
  options: { optionId: string; name: string; kind: string }[];
};

export type GrokStatus = {
  ok: boolean;
  path: string | null;
  version: string | null;
  error?: string;
};

export type PermissionMode = "ask" | "auto" | "always-approve";

export type SkillInfo = {
  name: string;
  description: string;
  source: string;
  path: string;
  disabled: boolean;
};

export type AppSettings = {
  model: string;
  permissionMode: PermissionMode;
  models: { id: string; name: string }[];
  skills: SkillInfo[];
};

export type GitFile = {
  path: string;
  status: string;
  untracked: boolean;
  staged: boolean;
};

export type GitStatus = {
  branch: string | null;
  isRepo: boolean;
  isWorktree: boolean;
  mainRoot: string | null;
  files: GitFile[];
};

export type AcpUpdatePayload = {
  sessionId: string;
  update: Record<string, unknown>;
  method?: string;
};

function pushText(
  items: StreamItem[],
  kind: "user" | "agent" | "thought",
  text: string,
) {
  if (!text) return;
  const last = items[items.length - 1];
  if (last && last.kind === kind) {
    last.text += text;
    return;
  }
  items.push({ kind, text });
}

function extractToolPath(update: Record<string, unknown>): string | undefined {
  const locations = update.locations;
  if (Array.isArray(locations) && locations[0] && typeof locations[0] === "object") {
    const p = (locations[0] as { path?: unknown }).path;
    if (typeof p === "string" && p.trim()) return p;
  }
  const input = update.rawInput;
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    for (const key of ["path", "file_path", "filePath", "target_file", "targetFile"]) {
      const p = o[key];
      if (typeof p === "string" && p.trim()) return p;
    }
  }
  return undefined;
}

function toolDetail(update: Record<string, unknown>): string | undefined {
  if (typeof update.content === "string") return update.content.slice(0, 4000);
  if (Array.isArray(update.content)) {
    return update.content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && "text" in (c as object)) {
          return String((c as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000);
  }
  if (update.rawInput && typeof update.rawInput === "object") {
    try {
      return JSON.stringify(update.rawInput, null, 2).slice(0, 2000);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function applyUpdateToItems(
  items: StreamItem[],
  tools: Map<string, Extract<StreamItem, { kind: "tool" }>>,
  kind: string,
  update: Record<string, unknown>,
) {
  if (
    kind === "user_message_chunk" ||
    kind === "agent_message_chunk" ||
    kind === "agent_thought_chunk"
  ) {
    const content = update.content as { type?: string; text?: string } | undefined;
    const text = content?.text ?? "";
    const mapped =
      kind === "user_message_chunk"
        ? "user"
        : kind === "agent_thought_chunk"
          ? "thought"
          : "agent";
    pushText(items, mapped, text);
    return;
  }

  if (kind === "tool_call") {
    const id = String(update.toolCallId ?? update.tool_call_id ?? `tool-${items.length}`);
    const item: Extract<StreamItem, { kind: "tool" }> = {
      kind: "tool",
      id,
      title: String(update.title ?? "工具"),
      status: String(update.status ?? "pending"),
      toolKind: update.kind ? String(update.kind) : undefined,
      detail: toolDetail(update),
      path: extractToolPath(update),
    };
    tools.set(id, item);
    items.push(item);
    return;
  }

  if (kind === "tool_call_update") {
    const id = String(update.toolCallId ?? update.tool_call_id ?? "");
    const existing = tools.get(id);
    if (existing) {
      if (update.status) existing.status = String(update.status);
      if (update.title) existing.title = String(update.title);
      const detail = toolDetail(update);
      if (detail) existing.detail = detail;
      const toolPath = extractToolPath(update);
      if (toolPath) existing.path = toolPath;
    }
    return;
  }

  if (kind === "plan") {
    const entries = Array.isArray(update.entries)
      ? (update.entries as { content?: string; status?: string }[]).map((e) => ({
          content: String(e.content ?? ""),
          status: e.status,
        }))
      : [];
    const last = items[items.length - 1];
    if (last?.kind === "plan") {
      last.entries = entries;
    } else {
      items.push({ kind: "plan", entries });
    }
  }
}
