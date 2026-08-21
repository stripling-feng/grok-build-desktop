import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inferProjectRoot, isScratchPath, isUnattachedThread } from "./projects";
import { isDesktopWorktree } from "./paths";
import {
  applyUpdateToItems,
  extractContextUsage,
  extractUpdateTimestamp,
  mergeContextUsage,
  type ContextPart,
  type ContextUsage,
  type StreamItem,
  type ThreadInfo,
} from "./shared";

export function grokHome(): string {
  return process.env.GROK_HOME || path.join(os.homedir(), ".grok");
}

export function encodeCwd(cwd: string): string {
  return encodeURIComponent(path.resolve(cwd));
}

export function decodeCwd(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function sessionsRoot(): string {
  return path.join(grokHome(), "sessions");
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function titleFromSummary(raw: Record<string, unknown>): string {
  return (
    (raw.generated_title as string) ||
    (raw.session_summary as string) ||
    "未命名会话"
  );
}

function isLatinTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/[\u4e00-\u9fff]/.test(t)) return false;
  if (/^(新会话|未命名会话|分叉会话|定时任务)/.test(t)) return false;
  return /[A-Za-z]/.test(t);
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    if (rec.content != null) return flattenText(rec.content);
  }
  return "";
}

function firstUserQuery(dir: string): string {
  const file = path.join(dir, "chat_history.jsonl");
  if (!fs.existsSync(file)) return "";
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (String(parsed.type ?? "") !== "user") continue;
    if (parsed.synthetic_reason) continue;
    const text = flattenText(parsed.content);
    if (!text || text.includes("<user_info>") || text.includes("<environment_details>")) continue;
    const tagged = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
    const query = (tagged?.[1] || text).trim();
    if (query) return query;
  }
  return "";
}

function chineseTitleFromPrompt(prompt: string): string {
  let s = prompt
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, " ")
    .replace(/(?:密码|口令|token|secret)\s*[:=]?\s*\S+/gi, " ")
    .replace(/(?:账号|用户名|username)\s*[:=]?\s*\S+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[`*_#>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = s
    .split(/[，。；;!！？?\n]/)
    .map((part) => part.trim())
    .filter((part) => /[\u4e00-\u9fff]/.test(part));
  const pick = parts[parts.length - 1] || ( /[\u4e00-\u9fff]/.test(s) ? s : "");
  if (pick.length < 2) return "";
  return pick.length > 28 ? `${pick.slice(0, 28)}…` : pick;
}

function localizeTitle(dir: string, raw: Record<string, unknown>): string {
  const current = titleFromSummary(raw);
  if (raw.title_is_manual) return current;
  if (!isLatinTitle(current)) return current;
  const next = chineseTitleFromPrompt(firstUserQuery(dir));
  if (!next || next === current) return current;
  raw.generated_title = next;
  try {
    fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(raw, null, 2), "utf8");
  } catch {
    return current;
  }
  return next;
}

export function listThreads(cwd?: string): ThreadInfo[] {
  const root = sessionsRoot();
  if (!fs.existsSync(root)) return [];

  const threads: ThreadInfo[] = [];
  const groups = cwd ? [encodeCwd(cwd)] : fs.readdirSync(root);

  for (const group of groups) {
    if (group.startsWith(".") || group.endsWith(".sqlite")) continue;
    const groupDir = path.join(root, group);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(groupDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const cwdFile = path.join(groupDir, ".cwd");
    let groupCwd = decodeCwd(group);
    if (fs.existsSync(cwdFile)) {
      try {
        groupCwd = fs.readFileSync(cwdFile, "utf8").trim() || groupCwd;
      } catch {
        /* ignore */
      }
    }

    let sessionIds: string[] = [];
    try {
      sessionIds = fs.readdirSync(groupDir);
    } catch {
      continue;
    }

    for (const id of sessionIds) {
      const summaryPath = path.join(groupDir, id, "summary.json");
      if (!fs.existsSync(summaryPath)) continue;
      const raw = readJson(summaryPath);
      if (!raw) continue;
      const info = (raw.info as Record<string, unknown> | undefined) ?? {};
      const sessionCwd = path.resolve((info.cwd as string) || groupCwd);
      const gitRoot = raw.git_root_dir
        ? path.resolve(String(raw.git_root_dir).replace(/\//g, path.sep))
        : undefined;
      const idValue = (info.id as string) || id;
      const draft = {
        id: idValue,
        cwd: sessionCwd,
        gitRoot,
      };
      const unattached = isUnattachedThread(draft);
      threads.push({
        id: idValue,
        cwd: sessionCwd,
        title: localizeTitle(path.join(groupDir, id), raw),
        summary: raw.session_summary as string | undefined,
        model: raw.current_model_id as string | undefined,
        updatedAt:
          (raw.last_active_at as string) ||
          (raw.updated_at as string) ||
          new Date(0).toISOString(),
        createdAt: (raw.created_at as string) || new Date(0).toISOString(),
        lastTurnSummary: raw.last_turn_summary as string | undefined,
        gitRoot,
        projectCwd: unattached ? "" : inferProjectRoot(draft),
        worktree: isDesktopWorktree(sessionCwd),
        unattached,
      });
    }
  }

  const byId = new Map<string, ThreadInfo>();
  for (const thread of threads) {
    const existing = byId.get(thread.id);
    if (!existing) {
      byId.set(thread.id, thread);
      continue;
    }
    if (existing.unattached && !thread.unattached) byId.set(thread.id, thread);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function renameThread(sessionId: string, cwd: string, title: string): ThreadInfo {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("会话名称不能为空");
  const dir = findSessionDir(sessionId, cwd);
  if (!dir) throw new Error("找不到会话");
  const summaryPath = path.join(dir, "summary.json");
  const raw = readJson(summaryPath);
  if (!raw) throw new Error("找不到会话摘要");
  raw.generated_title = trimmed;
  raw.title_is_manual = true;
  fs.writeFileSync(summaryPath, JSON.stringify(raw, null, 2), "utf8");
  const info = (raw.info as Record<string, unknown> | undefined) ?? {};
  const sessionCwd = path.resolve((info.cwd as string) || cwd);
  const gitRoot = raw.git_root_dir
    ? path.resolve(String(raw.git_root_dir).replace(/\//g, path.sep))
    : undefined;
  const draft = { id: sessionId, cwd: sessionCwd, gitRoot };
  const unattached = isUnattachedThread(draft);
  return {
    id: sessionId,
    cwd: sessionCwd,
    title: trimmed,
    summary: raw.session_summary as string | undefined,
    model: raw.current_model_id as string | undefined,
    updatedAt:
      (raw.last_active_at as string) ||
      (raw.updated_at as string) ||
      new Date().toISOString(),
    createdAt: (raw.created_at as string) || new Date(0).toISOString(),
    lastTurnSummary: raw.last_turn_summary as string | undefined,
    gitRoot,
    projectCwd: unattached ? "" : inferProjectRoot(draft),
    worktree: isDesktopWorktree(sessionCwd),
    unattached,
  };
}

export function copySession(sessionId: string, cwd: string): { id: string; cwd: string; title: string } {
  const src = findSessionDir(sessionId, cwd);
  if (!src) throw new Error("找不到会话");
  const id = randomUUID();
  const dest = path.join(path.dirname(src), id);
  fs.cpSync(src, dest, { recursive: true });
  const summaryPath = path.join(dest, "summary.json");
  const raw = readJson(summaryPath) ?? {};
  const info = { ...((raw.info as Record<string, unknown> | undefined) ?? {}), id };
  raw.info = info;
  raw.parent_session_id = sessionId;
  const title = titleFromSummary(raw);
  raw.generated_title = /分叉/.test(title) ? title : `${title} · 分叉`;
  const now = new Date().toISOString();
  raw.created_at = now;
  raw.updated_at = now;
  raw.last_active_at = now;
  fs.writeFileSync(summaryPath, JSON.stringify(raw, null, 2), "utf8");
  return {
    id,
    cwd: path.resolve(String(info.cwd || cwd)),
    title: String(raw.generated_title),
  };
}

export function removeThread(sessionId: string, cwd?: string): boolean {
  const dir = findSessionDir(sessionId, cwd);
  if (!dir) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function findSessionDir(sessionId: string, cwd?: string): string | null {
  const root = sessionsRoot();
  if (cwd) {
    const direct = path.join(root, encodeCwd(cwd), sessionId);
    if (fs.existsSync(path.join(direct, "summary.json")) || fs.existsSync(path.join(direct, "updates.jsonl"))) {
      return direct;
    }
  }
  if (!fs.existsSync(root)) return null;
  let groups: string[] = [];
  try {
    groups = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const group of groups) {
    const dir = path.join(root, group, sessionId);
    if (fs.existsSync(path.join(dir, "updates.jsonl")) || fs.existsSync(path.join(dir, "summary.json"))) {
      return dir;
    }
  }
  return null;
}

function charsOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce<number>((sum, part) => sum + charsOf(part), 0);
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text.length;
    if (rec.content != null) return charsOf(rec.content);
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }
  return 0;
}

function classifyHistoryChars(dir: string): ContextPart[] | undefined {
  const file = path.join(dir, "chat_history.jsonl");
  if (!fs.existsSync(file)) return undefined;
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }

  const counts = {
    messages: 0,
    tools: 0,
    mcp: 0,
    skills: 0,
    system: 0,
    other: 0,
  };
  const callKind = new Map<string, "tools" | "mcp">();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = String(parsed.type ?? "");
    const reason = String(parsed.synthetic_reason ?? "");
    const text =
      typeof parsed.content === "string"
        ? parsed.content
        : charsOf(parsed.content) > 0
          ? JSON.stringify(parsed.content)
          : "";
    const n = Math.max(charsOf(parsed.content), text.length);
    if (!n) continue;

    if (type === "system") counts.system += n;
    else if (type === "tool_result" || type === "tool_use") {
      const id = String(parsed.tool_call_id ?? parsed.id ?? "");
      const bucket = callKind.get(id) || "tools";
      counts[bucket] += n;
    } else if (type === "assistant") {
      counts.messages += charsOf(parsed.content);
      const calls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
      for (const call of calls) {
        const rec = call && typeof call === "object" ? (call as Record<string, unknown>) : {};
        const size = charsOf(call);
        const name = String(rec.name ?? "");
        const id = String(rec.id ?? "");
        const mcp = /mcp/i.test(name);
        const bucket = mcp ? "mcp" : "tools";
        if (id) callKind.set(id, bucket);
        counts[bucket] += size;
      }
    } else if (type === "user") {
      if (reason === "system_reminder") {
        if (text.includes("skills are available") || text.includes("<skill") || text.includes("SKILL.md")) {
          counts.skills += n;
        } else if (text.toLowerCase().includes("mcp")) {
          counts.mcp += n;
        } else {
          counts.other += n;
        }
      } else if (text.includes("<user_info>") || text.includes("<environment_details>")) {
        counts.other += n;
      } else {
        counts.messages += n;
      }
    } else if (type === "reasoning") {
      counts.messages += n;
    } else {
      counts.other += n;
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  const labels: { id: keyof typeof counts; label: string }[] = [
    { id: "messages", label: "消息" },
    { id: "tools", label: "系统工具" },
    { id: "mcp", label: "MCP 工具" },
    { id: "skills", label: "技能" },
    { id: "system", label: "系统提示词" },
    { id: "other", label: "其他" },
  ];
  return labels.map((row) => ({ id: row.id, label: row.label, tokens: counts[row.id] / total }));
}

export function loadTranscript(
  sessionId: string,
  cwd: string,
): { items: StreamItem[]; contextUsed: number | null; contextUsage: ContextUsage | null } {
  const dir = findSessionDir(sessionId, cwd);
  const file = dir ? path.join(dir, "updates.jsonl") : "";
  if (!file || !fs.existsSync(file)) return { items: [], contextUsed: null, contextUsage: null };

  const items: StreamItem[] = [];
  const tools = new Map<string, Extract<StreamItem, { kind: "tool" }>>();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { items: [], contextUsed: null, contextUsage: null };
  }

  let contextUsage: ContextUsage | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const params = (parsed.params ?? parsed) as Record<string, unknown>;
    const update = (params.update ?? params) as Record<string, unknown>;
    const meta = params._meta && typeof params._meta === "object" ? (params._meta as Record<string, unknown>) : undefined;
    contextUsage = mergeContextUsage(contextUsage, extractContextUsage(update, meta));
    const kind = String(update.sessionUpdate ?? "");
    applyUpdateToItems(items, tools, kind, update);
    if (kind === "user_message_chunk") {
      const last = items[items.length - 1];
      const ts = extractUpdateTimestamp(parsed, update);
      if (last?.kind === "user" && ts && !last.startedAt) last.startedAt = ts;
    }
  }
  const parts = dir ? classifyHistoryChars(dir) : undefined;
  if (contextUsage && parts) contextUsage = { ...contextUsage, parts };
  else if (!contextUsage && parts) contextUsage = { used: null, parts };
  return {
    items: items.filter((item) => item.kind !== "thought" && item.kind !== "tool"),
    contextUsed: contextUsage?.used ?? null,
    contextUsage,
  };
}
