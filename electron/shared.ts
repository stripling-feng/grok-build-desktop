export type StreamItem =
  | { kind: "user"; text: string; startedAt?: number; durationMs?: number }
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
  | {
      kind: "subagent";
      id: string;
      title: string;
      status: string;
      type?: string;
      detail?: string;
      durationMs?: number;
    }
  | {
      kind: "plan";
      revision: number;
      entries: { content: string; status: PlanEntryStatus }[];
      markdown?: string;
    }
  | { kind: "status"; text: string };

export type PlanEntryStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "failed"
  | "cancelled";

const PLAN_STATUS_ALIASES: Record<string, PlanEntryStatus> = {
  pending: "pending",
  todo: "pending",
  queued: "pending",
  waiting: "pending",
  in_progress: "in_progress",
  running: "in_progress",
  active: "in_progress",
  doing: "in_progress",
  working: "in_progress",
  started: "in_progress",
  done: "done",
  completed: "done",
  complete: "done",
  success: "done",
  succeeded: "done",
  finished: "done",
  failed: "failed",
  error: "failed",
  failure: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
  rejected: "cancelled",
  aborted: "cancelled",
};

export function normalizePlanStatus(raw: unknown): PlanEntryStatus {
  if (typeof raw !== "string") return "pending";
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return PLAN_STATUS_ALIASES[key] ?? "pending";
}

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
  unattached?: boolean;
};

export type ThreadSearchResult = {
  thread: ThreadInfo;
  snippet: string;
  matchCount: number;
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

export type AccountMethod = "oauth" | "api-key" | "none";

export type AccountInfo = {
  method: AccountMethod;
  name: string;
  email?: string;
};

export type AccountUsage = {
  text: string;
  percent?: number;
  used?: number;
  limit?: number;
  prepaid?: number;
  tier?: string;
  periodStart?: string;
  periodEnd?: string;
};

export type AppUpdateInfo = {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  url: string;
  notes: string;
  dev?: boolean;
  error?: string;
};

export type PermissionMode = "ask" | "auto" | "always-approve";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type SkillInfo = {
  name: string;
  description: string;
  source: string;
  path: string;
  disabled: boolean;
  userInvocable?: boolean;
  invocableAs?: string;
};

export type McpServerInfo = {
  name: string;
  transport: "stdio" | "http" | "sse" | string;
  target: string;
  source: string;
  path: string;
  vendor: string;
  enabled: boolean;
  status: string;
  native: boolean;
};

export type PluginInfo = {
  name: string;
  scope: string;
  path: string;
  enabled: boolean;
  skills: number;
  agents: number;
  hooks: boolean;
  mcpServers: number;
};

export type MarketplaceInfo = {
  name: string;
  kind: string;
  url: string;
  registeredSource?: string;
};

export type AvailablePluginInfo = {
  name: string;
  version?: string;
  description: string;
  marketplace: string;
  status: string;
  skillCount: number;
  hasHooks: boolean;
  hasAgents: boolean;
  hasMcp: boolean;
};

export type HookInfo = {
  event: string;
  matcher: string;
  source: string;
  path: string;
  command: string;
  type: string;
  trusted: boolean;
};

export type IntervalUnit = "minute" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";

export type AutomationFrequency = "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";

export type AutomationRun = {
  id: string;
  at: number;
  trigger: "schedule" | "manual";
  status: "running" | "ok" | "error";
  error?: string;
  durationMs?: number;
  sessionId?: string;
};

export type Automation = {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  enabled: boolean;
  recurring: boolean;
  delayMinutes?: number | null;
  cron?: string | null;
  interval?: number | null;
  intervalUnit?: IntervalUnit | null;
  maxRuns?: number | null;
  frequency?: AutomationFrequency | null;
  time?: string | null;
  minute?: number | null;
  weekdays?: number[] | null;
  dayOfMonth?: number | null;
  endsAt?: number | null;
  scheduleLabel: string;
  nextRunAt: number;
  lastRunAt?: number | null;
  lastStatus?: "ok" | "error" | "running" | null;
  lastError?: string;
  lastSessionId?: string | null;
  sessionCwd?: string | null;
  runCount: number;
  createdAt: number;
  runs?: AutomationRun[];
};

export type AutomationInput = {
  title: string;
  prompt: string;
  cwd?: string | null;
  enabled?: boolean;
  recurring?: boolean;
  delayMinutes?: number | null;
  cron?: string | null;
  interval?: number | null;
  intervalUnit?: IntervalUnit | null;
  maxRuns?: number | null;
  frequency?: AutomationFrequency | null;
  time?: string | null;
  minute?: number | null;
  weekdays?: number[] | null;
  dayOfMonth?: number | null;
  endsAt?: number | null;
  scheduleLabel?: string;
};

export type SubagentTypeInfo = {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  model: string | null;
  source?: string;
  path?: string;
};

export type AppSettings = {
  model: string;
  reasoningEffort: ReasoningEffort;
  permissionMode: PermissionMode;
  models: { id: string; name: string; contextWindow?: number }[];
  skills: SkillInfo[];
  mcpServers: McpServerInfo[];
  plugins: PluginInfo[];
  marketplaces: MarketplaceInfo[];
  availablePlugins: AvailablePluginInfo[];
  hooks: HookInfo[];
  projectTrusted: boolean;
  browserControl: boolean;
  computerControl: boolean;
  subagentsEnabled: boolean;
  subagentTypes: SubagentTypeInfo[];
  inspectError?: string;
};

export type GitFile = {
  path: string;
  status: string;
  untracked: boolean;
  staged: boolean;
};

export type GitStatus = {
  branch: string | null;
  remote: string | null;
  isRepo: boolean;
  isWorktree: boolean;
  mainRoot: string | null;
  added: number;
  removed: number;
  files: GitFile[];
};

export type AcpUpdatePayload = {
  sessionId: string;
  update: Record<string, unknown>;
  method?: string;
  meta?: Record<string, unknown>;
};

function asTokenCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export type ContextPartId = "messages" | "tools" | "mcp" | "skills" | "system" | "other";

export type ContextPart = {
  id: ContextPartId;
  label: string;
  tokens: number;
};

export type ContextUsage = {
  used: number | null;
  inputTokens?: number | null;
  cachedReadTokens?: number | null;
  cacheHitRate?: number | null;
  parts?: ContextPart[];
};

function usageRecord(update: Record<string, unknown>): Record<string, unknown> | undefined {
  return update.usage && typeof update.usage === "object" ? (update.usage as Record<string, unknown>) : undefined;
}

export function extractContextUsed(
  update: Record<string, unknown>,
  meta?: Record<string, unknown>,
): number | null {
  const usage = usageRecord(update);
  const nested = update._meta && typeof update._meta === "object" ? (update._meta as Record<string, unknown>) : undefined;
  return (
    asTokenCount(meta?.totalTokens) ??
    asTokenCount(nested?.totalTokens) ??
    asTokenCount(usage?.inputTokens) ??
    asTokenCount(usage?.totalTokens)
  );
}

export function extractContextUsage(
  update: Record<string, unknown>,
  meta?: Record<string, unknown>,
): ContextUsage | null {
  const usage = usageRecord(update);
  const used = extractContextUsed(update, meta);
  const inputTokens = asTokenCount(usage?.inputTokens);
  const cachedReadTokens = asTokenCount(usage?.cachedReadTokens);
  const cacheHitRate =
    inputTokens != null && inputTokens > 0 && cachedReadTokens != null
      ? Math.min(1, Math.max(0, cachedReadTokens / inputTokens))
      : null;
  if (used == null && cacheHitRate == null && inputTokens == null) return null;
  return { used, inputTokens, cachedReadTokens, cacheHitRate };
}

export function mergeContextUsage(prev: ContextUsage | null, next: ContextUsage | null): ContextUsage | null {
  if (!next) return prev;
  if (!prev) return next;
  return {
    used: next.used ?? prev.used,
    inputTokens: next.inputTokens ?? prev.inputTokens,
    cachedReadTokens: next.cachedReadTokens ?? prev.cachedReadTokens,
    cacheHitRate: next.cacheHitRate ?? prev.cacheHitRate,
    parts: next.parts ?? prev.parts,
  };
}

function pushText(
  items: StreamItem[],
  kind: "user" | "agent" | "thought",
  text: string,
  startedAt?: number,
) {
  if (!text) return;
  const last = items[items.length - 1] as (StreamItem & { text?: string; startedAt?: number }) | undefined;
  if (last && last.kind === kind) {
    last.text = (last.text ?? "") + text;
    if (kind === "user" && startedAt && !last.startedAt) {
      last.startedAt = startedAt;
    }
    return;
  }
  if (kind === "user") {
    items.push({ kind, text, startedAt });
  } else {
    items.push({ kind, text });
  }
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum > 0) return asNum < 1e12 ? asNum * 1000 : asNum;
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return undefined;
}

export function extractUpdateTimestamp(
  parsed: Record<string, unknown>,
  update: Record<string, unknown>,
): number | undefined {
  for (const source of [parsed, update, parsed.params as Record<string, unknown> | undefined]) {
    if (!source || typeof source !== "object") continue;
    for (const key of ["timestamp", "ts", "created_at", "createdAt", "time", "at"]) {
      const ms = parseTimestamp(source[key]);
      if (ms) return ms;
    }
  }
  return undefined;
}

export function planDocumentWasUpdatedForTurn(
  modifiedAt: number | null | undefined,
  turnStartedAt: number | null | undefined,
): boolean {
  return Boolean(
    typeof modifiedAt === "number" &&
      Number.isFinite(modifiedAt) &&
      typeof turnStartedAt === "number" &&
      Number.isFinite(turnStartedAt) &&
      modifiedAt >= turnStartedAt,
  );
}

export function isSpawnSubagentUpdate(update: Record<string, unknown>): boolean {
  const title = String(update.title ?? "").toLowerCase();
  const toolKind = String(update.kind ?? update.toolKind ?? "").toLowerCase();
  const meta = update._meta && typeof update._meta === "object" ? (update._meta as Record<string, unknown>) : null;
  const xai = meta && meta["x.ai/tool"] && typeof meta["x.ai/tool"] === "object"
    ? (meta["x.ai/tool"] as Record<string, unknown>)
    : null;
  const name = String(xai?.name ?? update.name ?? update.toolName ?? "").toLowerCase();
  const raw = update.rawInput && typeof update.rawInput === "object" ? (update.rawInput as Record<string, unknown>) : null;
  return (
    title.includes("spawn_subagent") ||
    name.includes("spawn_subagent") ||
    toolKind.includes("subagent") ||
    Boolean(raw && (raw.subagent_type || raw.subagentType))
  );
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
    const startedAt = mapped === "user" ? extractUpdateTimestamp(update, update) : undefined;
    pushText(items, mapped, text, startedAt);
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
    if (isSpawnSubagentUpdate(update)) {
      const raw = update.rawInput && typeof update.rawInput === "object"
        ? (update.rawInput as Record<string, unknown>)
        : null;
      const title = String(raw?.description ?? update.title ?? "子智能体");
      const existing = items.find(
        (row) =>
          row.kind === "subagent" &&
          (row.id === id || row.title === title),
      );
      if (existing && existing.kind === "subagent") {
        existing.title = title || existing.title;
        existing.status = item.status === "completed" ? "completed" : existing.status || "running";
        existing.type = raw?.subagent_type ? String(raw.subagent_type) : existing.type;
        if (item.detail) existing.detail = item.detail;
      } else {
        items.push({
          kind: "subagent",
          id,
          title,
          status: item.status === "completed" ? "completed" : "running",
          type: raw?.subagent_type ? String(raw.subagent_type) : undefined,
          detail: item.detail,
        });
      }
    }
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

  if (kind === "subagent_spawned") {
    const id = String(update.subagent_id ?? update.child_session_id ?? update.subagentId ?? `subagent-${items.length}`);
    const title = String(update.description ?? update.title ?? "子智能体");
    const existing = items.find(
      (item) =>
        item.kind === "subagent" &&
        (item.id === id || item.title === title),
    );
    if (existing && existing.kind === "subagent") {
      existing.id = id;
      existing.title = title || existing.title;
      existing.type = update.subagent_type ? String(update.subagent_type) : existing.type;
      existing.status = existing.status === "completed" ? existing.status : "running";
      return;
    }
    items.push({
      kind: "subagent",
      id,
      title,
      status: "running",
      type: update.subagent_type ? String(update.subagent_type) : undefined,
    });
    return;
  }

  if (kind === "subagent_finished") {
    const id = String(update.subagent_id ?? update.child_session_id ?? update.subagentId ?? "");
    const existing = items.find((item) => item.kind === "subagent" && item.id === id);
    const output = typeof update.output === "string" ? update.output.slice(0, 4000) : undefined;
    const durationMs = typeof update.duration_ms === "number" ? update.duration_ms : undefined;
    const status = String(update.status ?? "completed");
    if (existing && existing.kind === "subagent") {
      existing.status = status;
      if (output) existing.detail = output;
      if (durationMs) existing.durationMs = durationMs;
      if (update.subagent_type) existing.type = String(update.subagent_type);
      return;
    }
    items.push({
      kind: "subagent",
      id: id || `subagent-${items.length}`,
      title: String(update.description ?? update.title ?? "子智能体"),
      status,
      type: update.subagent_type ? String(update.subagent_type) : undefined,
      detail: output,
      durationMs,
    });
    return;
  }

  if (kind === "plan") {
    const rawRevision = update.revision;
    const parsedRevision =
      typeof rawRevision === "number" && Number.isFinite(rawRevision) && rawRevision > 0
        ? Math.floor(rawRevision)
        : undefined;
    const incoming = Array.isArray(update.entries)
      ? (update.entries as { content?: string; status?: string }[])
    : [];
    const normalized: { content: string; status: PlanEntryStatus }[] = incoming
      .map((e) => ({
        content: String(e.content ?? ""),
        status: normalizePlanStatus(e.status),
      }))
      .filter((e) => e.content.length > 0);

    const last = items[items.length - 1];
    const isSameRevision =
      last?.kind === "plan" &&
      parsedRevision !== undefined &&
      last.revision === parsedRevision;
    const isLatestRevision =
      last?.kind === "plan" &&
      parsedRevision === undefined &&
      true;

    if (isSameRevision || isLatestRevision) {
      const target = last as Extract<StreamItem, { kind: "plan" }>;
      const byContent = new Map<string, PlanEntryStatus>();
      for (const entry of target.entries) byContent.set(entry.content, entry.status);
      const merged = normalized.map((entry) => {
        const prev = byContent.get(entry.content);
        if (prev && prev !== "pending" && entry.status === "pending") {
          return { content: entry.content, status: prev };
        }
        return { content: entry.content, status: entry.status };
      });
      target.entries = merged;
      return;
    }

    const targetRevision = parsedRevision ?? 1;
    items.push({ kind: "plan", revision: targetRevision, entries: normalized });
  }
}
