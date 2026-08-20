import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { ProjectInfo, ThreadInfo } from "./shared";
import { isDesktopWorktree, isSubPath, normalizePath, samePath } from "./paths";

function storePath(): string {
  return path.join(app.getPath("userData"), "projects.json");
}

function indexPath(): string {
  return path.join(app.getPath("userData"), "session-projects.json");
}

function readStore(): ProjectInfo[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return Array.isArray(raw) ? (raw as ProjectInfo[]) : [];
  } catch {
    return [];
  }
}

function writeStore(projects: ProjectInfo[]) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(projects, null, 2), "utf8");
}

let indexCache: { mtime: number; data: Record<string, string> } | null = null;

function readIndex(): Record<string, string> {
  try {
    const file = indexPath();
    const mtime = fs.statSync(file).mtimeMs;
    if (indexCache && indexCache.mtime === mtime) return indexCache.data;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const data = raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
    indexCache = { mtime, data };
    return data;
  } catch {
    indexCache = { mtime: 0, data: {} };
    return {};
  }
}

function writeIndex(index: Record<string, string>) {
  fs.mkdirSync(path.dirname(indexPath()), { recursive: true });
  fs.writeFileSync(indexPath(), JSON.stringify(index, null, 2), "utf8");
  try {
    indexCache = { mtime: fs.statSync(indexPath()).mtimeMs, data: index };
  } catch {
    indexCache = { mtime: Date.now(), data: index };
  }
}

function isNoiseRoot(root: string): boolean {
  if (isDesktopWorktree(root)) return true;
  const n = normalizePath(root);
  if (n === normalizePath(os.homedir())) return true;
  if (/^[a-z]:\\?$/.test(n)) return true;
  const base = path.basename(root).toLowerCase();
  if (base === "desktop" || base === "documents" || base === "downloads") return true;
  return false;
}

export function projectName(cwd: string): string {
  const cleaned = cwd.replace(/[\\/]+$/, "");
  return path.basename(cleaned) || cwd;
}

export function bindSessionToProject(sessionId: string, projectCwd: string) {
  const index = readIndex();
  index[sessionId] = path.resolve(projectCwd);
  writeIndex(index);
}

export function sessionProjectCwd(sessionId: string): string | undefined {
  return readIndex()[sessionId];
}

export function inferProjectRoot(thread: Pick<ThreadInfo, "cwd" | "gitRoot" | "id">): string {
  const bound = sessionProjectCwd(thread.id);
  if (bound) return path.resolve(bound);
  if (thread.gitRoot && !isDesktopWorktree(thread.gitRoot)) {
    return path.resolve(thread.gitRoot.replace(/\//g, path.sep));
  }
  if (!isDesktopWorktree(thread.cwd)) return path.resolve(thread.cwd);
  return path.resolve(thread.cwd);
}

export function threadBelongsToProject(thread: ThreadInfo, project: ProjectInfo): boolean {
  const roots = [project.cwd, project.gitRoot].filter(Boolean) as string[];
  if (thread.projectCwd && roots.some((r) => samePath(thread.projectCwd, r))) return true;
  const bound = sessionProjectCwd(thread.id);
  if (bound && roots.some((r) => samePath(bound, r))) return true;
  const candidates = [thread.cwd, thread.gitRoot].filter(Boolean) as string[];
  return candidates.some((c) => roots.some((r) => isSubPath(c, r)));
}

export function listProjects(threads: ThreadInfo[] = []): ProjectInfo[] {
  const stored = readStore();
  const byKey = new Map<string, ProjectInfo>();
  for (const p of stored) {
    const cwd = path.resolve(p.cwd);
    byKey.set(normalizePath(cwd), { ...p, cwd });
  }
  for (const t of threads) {
    const root = inferProjectRoot(t);
    if (isNoiseRoot(root)) continue;
    const key = normalizePath(root);
    if ([...byKey.values()].some((p) => isSubPath(root, p.cwd))) continue;
    if (!byKey.has(key)) {
      byKey.set(key, {
        cwd: path.resolve(root),
        name: projectName(root),
        gitRoot: t.gitRoot ? path.resolve(t.gitRoot.replace(/\//g, path.sep)) : null,
        addedAt: 0,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.addedAt !== b.addedAt) return b.addedAt - a.addedAt;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

export function addProject(cwd: string, gitRoot?: string | null): ProjectInfo {
  const projects = readStore();
  const resolved = path.resolve(cwd);
  const existing = projects.find((p) => samePath(p.cwd, resolved));
  if (existing) {
    if (gitRoot && !existing.gitRoot) existing.gitRoot = gitRoot;
    writeStore(projects);
    return existing;
  }
  const project: ProjectInfo = {
    cwd: resolved,
    name: projectName(resolved),
    gitRoot: gitRoot ?? null,
    addedAt: Date.now(),
  };
  projects.unshift(project);
  writeStore(projects);
  return project;
}

export function removeProject(cwd: string) {
  writeStore(readStore().filter((p) => !samePath(p.cwd, cwd)));
}
