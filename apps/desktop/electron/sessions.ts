import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inferProjectRoot } from "./projects";
import { isDesktopWorktree } from "./paths";
import { applyUpdateToItems, type StreamItem, type ThreadInfo } from "./shared";

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
      threads.push({
        id: idValue,
        cwd: sessionCwd,
        title: titleFromSummary(raw),
        summary: raw.session_summary as string | undefined,
        model: raw.current_model_id as string | undefined,
        updatedAt:
          (raw.last_active_at as string) ||
          (raw.updated_at as string) ||
          new Date(0).toISOString(),
        createdAt: (raw.created_at as string) || new Date(0).toISOString(),
        lastTurnSummary: raw.last_turn_summary as string | undefined,
        gitRoot,
        projectCwd: inferProjectRoot(draft),
        worktree: isDesktopWorktree(sessionCwd),
      });
    }
  }

  threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return threads;
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

export function loadTranscript(sessionId: string, cwd: string): StreamItem[] {
  const dir = findSessionDir(sessionId, cwd);
  const file = dir ? path.join(dir, "updates.jsonl") : "";
  if (!file || !fs.existsSync(file)) return [];

  const items: StreamItem[] = [];
  const tools = new Map<string, Extract<StreamItem, { kind: "tool" }>>();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }

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
    const kind = String(update.sessionUpdate ?? "");
    applyUpdateToItems(items, tools, kind, update);
  }
  return items.filter((item) => item.kind !== "thought" && item.kind !== "tool");
}
