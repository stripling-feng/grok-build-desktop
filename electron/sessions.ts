import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inferProjectRoot, isScratchPath, isUnattachedThread } from "./projects";
import { isDesktopWorktree } from "./paths";
import { planEntriesFromMarkdown } from "./plan-document";
import { readPersistedThreadActivity, resolveThreadUpdatedAt } from "./thread-activity";
import { hasPersistedConversation } from "./thread-visibility";
import {
  isPlaceholderThreadTitle,
  threadTitleForDisplay,
  threadTitleFromPrompt,
} from "../src/lib/thread-title";
import {
  applyUpdateToItems,
  extractContextUsage,
  extractUpdateTimestamp,
  mergeContextUsage,
  planDocumentWasUpdatedForTurn,
  type ContextPart,
  type ContextUsage,
  type FileLineStats,
  type StreamItem,
  type ThreadInfo,
  type ThreadSearchResult,
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

function initialTitlePath(dir: string): string {
  return path.join(dir, ".desktop-title");
}

function readInitialTitle(dir: string): string {
  try {
    return fs.readFileSync(initialTitlePath(dir), "utf8").trim();
  } catch {
    return "";
  }
}

export function initializeThreadTitle(sessionId: string, cwd: string, prompt: string): string {
  const suggested = threadTitleFromPrompt(prompt);
  if (!suggested) return "新会话";
  const dir = findSessionDir(sessionId, cwd);
  if (!dir) return suggested;
  const summaryPath = path.join(dir, "summary.json");
  const raw = readJson(summaryPath);
  const current = raw ? titleFromSummary(raw) : "新会话";
  if (raw && (raw.title_is_manual || !isPlaceholderThreadTitle(current))) return current;
  try {
    fs.writeFileSync(initialTitlePath(dir), suggested, "utf8");
    return suggested;
  } catch {
    return current;
  }
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
  const summaryTitle = titleFromSummary(raw);
  const current = threadTitleForDisplay(summaryTitle, readInitialTitle(dir));
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
      if (!hasPersistedConversation(raw)) continue;
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
        updatedAt: resolveThreadUpdatedAt(raw, readPersistedThreadActivity(path.join(groupDir, id))),
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
    updatedAt: resolveThreadUpdatedAt(raw, readPersistedThreadActivity(dir)),
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

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif"]);

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

function isInside(root: string, target: string) {
  const from = path.resolve(root);
  const to = path.resolve(target);
  const rel = path.relative(from, to);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function stripImageSrc(src: string) {
  let raw = src.trim().replace(/[?#].*$/, "");
  if (!raw.startsWith("file:")) {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  try {
    raw = decodeURIComponent(new URL(raw).pathname);
    if (process.platform === "win32" && /^\/[A-Za-z]:/.test(raw)) raw = raw.slice(1);
  } catch {
    raw = raw.replace(/^file:\/\//i, "");
  }
  return raw;
}

export function resolveChatImagePath(src: string, sessionId?: string, cwd?: string): string | null {
  const raw = stripImageSrc(src);
  if (!raw || /^(data:|https?:|blob:)/i.test(raw)) return null;
  const session = sessionId ? findSessionDir(sessionId, cwd) : null;
  const abs = path.isAbsolute(raw)
    ? path.resolve(raw)
    : session
      ? path.resolve(session, raw)
      : null;
  if (!abs) return null;
  if (!IMAGE_EXTS.has(path.extname(abs).toLowerCase())) return null;
  const roots = [session, sessionsRoot(), path.join(os.tmpdir(), "grok-pasted")].filter(Boolean) as string[];
  if (!roots.some((root) => isInside(root, abs))) return null;
  try {
    if (!fs.statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  return abs;
}

export function readChatImage(
  src: string,
  sessionId?: string,
  cwd?: string,
): { path: string; dataUrl: string } | null {
  const file = resolveChatImagePath(src, sessionId, cwd);
  if (!file) return null;
  try {
    const buf = fs.readFileSync(file);
    if (buf.length > 16 * 1024 * 1024) return null;
    const mime = IMAGE_MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    return { path: file, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
  } catch {
    return null;
  }
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

export type TurnFilesRecord = {
  startedAt: number;
  completedAt: number;
  files: string[];
  stats?: Record<string, FileLineStats>;
};

export type TurnAttachmentsRecord = {
  startedAt: number;
  files: string[];
};

function turnFilesPath(dir: string): string {
  return path.join(dir, ".desktop-turn-files.json");
}

function turnAttachmentsPath(dir: string): string {
  return path.join(dir, ".desktop-turn-attachments.json");
}

function readTurnAttachments(sessionId: string, cwd?: string): TurnAttachmentsRecord[] {
  const dir = findSessionDir(sessionId, cwd);
  if (!dir) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(turnAttachmentsPath(dir), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is TurnAttachmentsRecord =>
        Boolean(row && typeof row.startedAt === "number" && Array.isArray(row.files)),
      )
      .map((row) => ({
        startedAt: row.startedAt,
        files: [...new Set(row.files.filter((file): file is string => typeof file === "string" && Boolean(file)))],
      }))
      .filter((row) => row.files.length > 0)
      .sort((a, b) => a.startedAt - b.startedAt);
  } catch {
    return [];
  }
}

export function saveTurnAttachments(
  sessionId: string,
  cwd: string,
  record: TurnAttachmentsRecord,
): void {
  if (!record.files.length) return;
  const dir = findSessionDir(sessionId, cwd);
  if (!dir) return;
  const records = readTurnAttachments(sessionId, cwd).filter((row) => row.startedAt !== record.startedAt);
  records.push({
    startedAt: record.startedAt,
    files: [...new Set(record.files.filter(Boolean))],
  });
  records.sort((a, b) => a.startedAt - b.startedAt);
  const target = turnAttachmentsPath(dir);
  const temporary = `${target}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(records.slice(-200), null, 2), "utf8");
    fs.renameSync(temporary, target);
  } catch {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      /* persistence is best effort */
    }
  }
}

function readTurnFiles(sessionId: string, cwd?: string): TurnFilesRecord[] {
  const dir = findSessionDir(sessionId, cwd);
  if (!dir) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(turnFilesPath(dir), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is TurnFilesRecord =>
        Boolean(
          row &&
          typeof row.startedAt === "number" &&
          typeof row.completedAt === "number" &&
          Array.isArray(row.files),
        ),
      )
      .map((row) => ({
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        files: [...new Set(row.files.filter((file): file is string => typeof file === "string" && Boolean(file)))],
        stats:
          row.stats && typeof row.stats === "object"
            ? Object.fromEntries(
                Object.entries(row.stats).filter(
                  ([, value]) =>
                    Boolean(
                      value &&
                        typeof value === "object" &&
                        typeof value.added === "number" &&
                        typeof value.removed === "number",
                    ),
                ),
              )
            : undefined,
      }))
      .filter((row) => row.files.length > 0)
      .sort((a, b) => a.startedAt - b.startedAt);
  } catch {
    return [];
  }
}

export function saveTurnFiles(sessionId: string, cwd: string, record: TurnFilesRecord): void {
  if (!record.files.length) return;
  const dir = findSessionDir(sessionId, cwd);
  if (!dir) return;
  const records = readTurnFiles(sessionId, cwd).filter((row) => row.startedAt !== record.startedAt);
  records.push({
    ...record,
    files: [...new Set(record.files.map((file) => file.replace(/\\/g, "/")))].sort((a, b) => a.localeCompare(b)),
    stats: record.stats
      ? Object.fromEntries(
          Object.entries(record.stats).map(([filePath, stats]) => [filePath.replace(/\\/g, "/"), stats]),
        )
      : undefined,
  });
  records.sort((a, b) => a.startedAt - b.startedAt);
  const target = turnFilesPath(dir);
  const temporary = `${target}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(records.slice(-200), null, 2), "utf8");
    fs.renameSync(temporary, target);
  } catch {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      /* persistence is best effort */
    }
  }
}

function attachTurnFiles(items: StreamItem[], records: TurnFilesRecord[]): StreamItem[] {
  if (!records.length) return items;
  const userIndexes = items
    .map((item, index) => ({ item, index }))
    .filter((row): row is { item: Extract<StreamItem, { kind: "user" }>; index: number } => row.item.kind === "user");
  if (!userIndexes.length) return items;

  const assigned = new Set<number>();
  const filesByUser = new Map<number, Set<string>>();
  const statsByUser = new Map<number, TurnFilesRecord["stats"]>();
  const fallback = userIndexes.slice(-records.length);
  records.forEach((record, recordIndex) => {
    let best: { index: number; distance: number } | null = null;
    for (const user of userIndexes) {
      if (assigned.has(user.index) || typeof user.item.startedAt !== "number") continue;
      const distance = Math.abs(user.item.startedAt - record.startedAt);
      if (distance <= 5 * 60_000 && (!best || distance < best.distance)) {
        best = { index: user.index, distance };
      }
    }
    const userIndex = best?.index ?? fallback[recordIndex]?.index;
    if (userIndex == null || assigned.has(userIndex)) return;
    assigned.add(userIndex);
    filesByUser.set(userIndex, new Set(record.files));
    statsByUser.set(userIndex, record.stats);
  });
  if (!filesByUser.size) return items;

  const result: StreamItem[] = [];
  let currentUser = -1;
  const flushFiles = () => {
    const files = filesByUser.get(currentUser);
    if (files?.size) {
      result.push({ kind: "changes", files: [...files], stats: statsByUser.get(currentUser) });
    }
  };
  items.forEach((item, index) => {
    if (item.kind === "user") {
      flushFiles();
      currentUser = index;
    }
    result.push(item);
  });
  flushFiles();
  return result;
}

function stripGeneratedAttachmentReferences(text: string, files: string[]): string {
  const marker = "请同时参考这些路径：";
  const markerIndex = text.lastIndexOf(marker);
  let cleaned = text;
  if (markerIndex >= 0) {
    const referenced = text
      .slice(markerIndex + marker.length)
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^-\s*@/, ""))
      .filter(Boolean);
    if (!referenced.length) return text;
    const normalizedFiles = new Set(files.map((file) => file.replace(/\\/g, "/").toLowerCase()));
    if (!referenced.every((file) => normalizedFiles.has(file.replace(/\\/g, "/").toLowerCase()))) return text;
    cleaned = text.slice(0, markerIndex).trimEnd();
  }
  if (cleaned.startsWith("请以计划模式协助我梳理这个任务")) {
    const request = cleaned.match(/用户需求：\s*([\s\S]*)$/)?.[1]?.trim();
    if (request === "请根据我附带的内容规划这个任务。" || request === "请参考我附带的图片。") return "";
    return request ?? cleaned;
  }
  if (cleaned === "请参考我附带的图片。") return "";
  return cleaned;
}

function attachTurnAttachments(items: StreamItem[], records: TurnAttachmentsRecord[]): StreamItem[] {
  if (!records.length) return items;
  const userIndexes = items
    .map((item, index) => ({ item, index }))
    .filter((row): row is { item: Extract<StreamItem, { kind: "user" }>; index: number } => row.item.kind === "user");
  if (!userIndexes.length) return items;

  const assigned = new Set<number>();
  const attachmentsByUser = new Map<number, string[]>();
  const fallback = userIndexes.slice(-records.length);
  records.forEach((record, recordIndex) => {
    let best: { index: number; distance: number } | null = null;
    for (const user of userIndexes) {
      if (assigned.has(user.index) || typeof user.item.startedAt !== "number") continue;
      const distance = Math.abs(user.item.startedAt - record.startedAt);
      if (distance <= 5 * 60_000 && (!best || distance < best.distance)) {
        best = { index: user.index, distance };
      }
    }
    const userIndex = best?.index ?? fallback[recordIndex]?.index;
    if (userIndex == null || assigned.has(userIndex)) return;
    assigned.add(userIndex);
    attachmentsByUser.set(userIndex, record.files);
  });
  if (!attachmentsByUser.size) return items;

  return items.map((item, index) => {
    const files = attachmentsByUser.get(index);
    if (item.kind !== "user" || !files?.length) return item;
    return {
      ...item,
      text: stripGeneratedAttachmentReferences(item.text, files),
      attachments: files,
    };
  });
}

export function readSessionPlanDocument(
  sessionId: string,
  cwd?: string,
): { markdown: string; entries: { content: string; status: "pending" }[]; modifiedAt: number } | null {
  const dir = findSessionDir(sessionId, cwd);
  if (!dir) return null;
  const file = path.join(dir, "plan.md");
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0 || stat.size > 512 * 1024) return null;
    const markdown = fs.readFileSync(file, "utf8").trim();
    if (!markdown) return null;
    return { markdown, entries: planEntriesFromMarkdown(markdown), modifiedAt: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function readSessionPlanEntries(
  sessionId: string,
  cwd?: string,
): { content: string; status: "pending" }[] {
  return readSessionPlanDocument(sessionId, cwd)?.entries ?? [];
}

function isAwaitingPlanApproval(dir: string | null): boolean {
  if (!dir) return false;
  const state = readJson(path.join(dir, "plan_mode.json"));
  return state?.awaiting_plan_approval === true;
}

function searchTextFromValue(value: unknown): string {
  if (typeof value === "string") {
    if (value.startsWith("data:") || value.length > 200_000) return "";
    return value;
  }
  if (Array.isArray(value)) return value.map(searchTextFromValue).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const rec = value as Record<string, unknown>;
  const preferred = ["content", "text", "message", "update", "title", "detail"]
    .filter((key) => rec[key] != null)
    .map((key) => searchTextFromValue(rec[key]))
    .filter(Boolean);
  if (preferred.length) return preferred.join("\n");
  return "";
}

function sessionSearchText(dir: string): string {
  const chunks: string[] = [];
  for (const name of ["chat_history.jsonl", "updates.jsonl"]) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    let raw = "";
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const text = searchTextFromValue(JSON.parse(line));
        if (text) chunks.push(text);
      } catch {
        /* ignore a partial JSONL line */
      }
    }
  }
  return chunks.join("\n");
}

function countMatches(text: string, query: string): number {
  let count = 0;
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(query, from);
    if (at < 0) break;
    count += 1;
    from = at + Math.max(1, query.length);
  }
  return count;
}

function matchSnippet(text: string, query: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  const at = compact.toLocaleLowerCase().indexOf(query);
  if (at < 0) return compact.slice(0, 180);
  const start = Math.max(0, at - 70);
  const end = Math.min(compact.length, at + query.length + 120);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

export function searchThreads(
  rawQuery: string,
  source: ThreadInfo[] = listThreads(),
  limit = 100,
): ThreadSearchResult[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return [];
  const results: ThreadSearchResult[] = [];
  for (const thread of source) {
    const dir = findSessionDir(thread.id, thread.cwd);
    const content = dir ? sessionSearchText(dir) : "";
    const searchable = [thread.title, thread.summary, thread.lastTurnSummary, content]
      .filter((part): part is string => Boolean(part))
      .join("\n");
    const normalized = searchable.toLocaleLowerCase();
    const matchCount = countMatches(normalized, query);
    if (!matchCount) continue;
    results.push({ thread, snippet: matchSnippet(searchable, query), matchCount });
  }
  return results
    .sort((a, b) => b.matchCount - a.matchCount || b.thread.updatedAt.localeCompare(a.thread.updatedAt))
    .slice(0, limit);
}

export function touchThreadActivity(sessionId: string, cwd?: string): boolean {
  const dir = findSessionDir(sessionId, cwd);
  if (!dir) return false;
  const summaryPath = path.join(dir, "summary.json");
  const raw = readJson(summaryPath);
  if (!raw) return false;
  const now = new Date().toISOString();
  raw.last_active_at = now;
  raw.updated_at = now;
  try {
    fs.writeFileSync(summaryPath, JSON.stringify(raw, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
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
): {
  items: StreamItem[];
  contextUsed: number | null;
  contextUsage: ContextUsage | null;
  planAwaiting: boolean;
  planModifiedAt: number | null;
} {
  const dir = findSessionDir(sessionId, cwd);
  const file = dir ? path.join(dir, "updates.jsonl") : "";
  const planAwaiting = isAwaitingPlanApproval(dir);
  if (!file || !fs.existsSync(file)) {
    return { items: [], contextUsed: null, contextUsage: null, planAwaiting, planModifiedAt: null };
  }

  const items: StreamItem[] = [];
  const tools = new Map<string, Extract<StreamItem, { kind: "tool" }>>();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { items: [], contextUsed: null, contextUsage: null, planAwaiting, planModifiedAt: null };
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
  const planDocument = readSessionPlanDocument(sessionId, cwd);
  if (planDocument) {
    let planIndex = -1;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i]?.kind === "plan") {
        planIndex = i;
        break;
      }
    }
    if (planIndex >= 0) {
      const previous = items[planIndex] as Extract<StreamItem, { kind: "plan" }>;
      const enriched: Extract<StreamItem, { kind: "plan" }> = {
        ...previous,
        entries: planDocument.entries,
        markdown: planDocument.markdown,
      };
      const hasNewerUserTurn = items
        .slice(planIndex + 1)
        .some((item) => item.kind === "user");
      const latestNewerUserStartedAt = [...items]
        .slice(planIndex + 1)
        .reverse()
        .find((item): item is Extract<StreamItem, { kind: "user" }> => item.kind === "user")
        ?.startedAt;
      if (
        planAwaiting &&
        hasNewerUserTurn &&
        planDocumentWasUpdatedForTurn(planDocument.modifiedAt, latestNewerUserStartedAt)
      ) {
        items.push({
          ...enriched,
          revision: items.filter((item) => item.kind === "plan").length + 1,
        });
      } else {
        items[planIndex] = enriched;
      }
    } else if (planAwaiting) {
      items.push({
        kind: "plan",
        revision: 1,
        entries: planDocument.entries,
        markdown: planDocument.markdown,
      });
    }
  }
  const restoredItems = attachTurnFiles(
    attachTurnAttachments(items, readTurnAttachments(sessionId, cwd)),
    readTurnFiles(sessionId, cwd),
  );
  return {
    items: restoredItems.filter((item) => item.kind !== "thought" && item.kind !== "tool"),
    contextUsed: contextUsage?.used ?? null,
    contextUsage,
    planAwaiting,
    planModifiedAt: planDocument?.modifiedAt ?? null,
  };
}
