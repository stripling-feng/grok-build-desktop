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

function hiddenPath(): string {
  return path.join(app.getPath("userData"), "hidden-projects.json");
}

function readHidden(): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(hiddenPath(), "utf8"));
    return Array.isArray(raw) ? raw.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function writeHidden(paths: string[]) {
  fs.mkdirSync(path.dirname(hiddenPath()), { recursive: true });
  fs.writeFileSync(hiddenPath(), JSON.stringify(paths, null, 2), "utf8");
}

function isHidden(cwd: string, hidden: string[]): boolean {
  return hidden.some((p) => samePath(p, cwd));
}

let scratchDir: string | null = null;

export function scratchCwd(): string {
  if (!scratchDir) {
    scratchDir = path.join(app.getPath("userData"), "scratch");
    fs.mkdirSync(scratchDir, { recursive: true });
  }
  return scratchDir;
}

export function isScratchPath(p?: string | null): boolean {
  if (!p) return false;
  try {
    return samePath(p, path.join(app.getPath("userData"), "scratch"));
  } catch {
    return false;
  }
}

function isNoiseRoot(root: string): boolean {
  if (isDesktopWorktree(root)) return true;
  if (isScratchPath(root)) return true;
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
  if (!projectCwd || isScratchPath(projectCwd)) {
    unbindSession(sessionId);
    return;
  }
  const index = readIndex();
  index[sessionId] = path.resolve(projectCwd);
  writeIndex(index);
}

export function unbindSession(sessionId: string) {
  const index = readIndex();
  if (!(sessionId in index)) return;
  delete index[sessionId];
  writeIndex(index);
}

export function sessionProjectCwd(sessionId: string): string | undefined {
  return readIndex()[sessionId];
}

export function inferProjectRoot(thread: Pick<ThreadInfo, "cwd" | "gitRoot" | "id">): string {
  const bound = sessionProjectCwd(thread.id);
  if (bound && !isScratchPath(bound)) return path.resolve(bound);
  if (thread.gitRoot && !isDesktopWorktree(thread.gitRoot) && !isScratchPath(thread.gitRoot)) {
    return path.resolve(thread.gitRoot.replace(/\//g, path.sep));
  }
  if (!isDesktopWorktree(thread.cwd) && !isScratchPath(thread.cwd)) return path.resolve(thread.cwd);
  return path.resolve(thread.cwd);
}

export function isUnattachedThread(thread: Pick<ThreadInfo, "cwd" | "gitRoot" | "id" | "projectCwd" | "unattached">): boolean {
  const bound = sessionProjectCwd(thread.id);
  if (bound && !isScratchPath(bound)) return false;
  return (
    isScratchPath(bound) ||
    isScratchPath(thread.cwd) ||
    isScratchPath(thread.gitRoot) ||
    isScratchPath(thread.projectCwd)
  );
}

export function threadBelongsToProject(thread: ThreadInfo, project: ProjectInfo): boolean {
  if (isScratchPath(thread.cwd) || isScratchPath(thread.projectCwd) || isScratchPath(thread.gitRoot)) {
    const bound = sessionProjectCwd(thread.id);
    if (!bound || isScratchPath(bound)) return false;
  }
  const roots = [project.cwd, project.gitRoot].filter(Boolean) as string[];
  if (thread.projectCwd && roots.some((r) => samePath(thread.projectCwd, r))) return true;
  const bound = sessionProjectCwd(thread.id);
  if (bound && roots.some((r) => samePath(bound, r))) return true;
  const candidates = [thread.cwd, thread.gitRoot].filter(Boolean) as string[];
  return candidates.some((c) => roots.some((r) => isSubPath(c, r)));
}

export function listProjects(_threads: ThreadInfo[] = []): ProjectInfo[] {
  const stored = readStore();
  const hidden = readHidden();
  const byKey = new Map<string, ProjectInfo>();
  for (const p of stored) {
    const cwd = path.resolve(p.cwd);
    if (isHidden(cwd, hidden) || isNoiseRoot(cwd) || isScratchPath(cwd)) continue;
    byKey.set(normalizePath(cwd), { ...p, cwd });
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.addedAt !== b.addedAt) return b.addedAt - a.addedAt;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

export function addProject(cwd: string, gitRoot?: string | null): ProjectInfo {
  const resolved = path.resolve(cwd);
  writeHidden(readHidden().filter((p) => !samePath(p, resolved)));
  const projects = readStore();
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
  const resolved = path.resolve(cwd);
  writeStore(readStore().filter((p) => !samePath(p.cwd, resolved)));
  const hidden = readHidden().filter((p) => !samePath(p, resolved));
  hidden.push(resolved);
  writeHidden(hidden);
}

export function renameProject(cwd: string, name: string): ProjectInfo {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("项目名称不能为空");
  const resolved = path.resolve(cwd);
  writeHidden(readHidden().filter((p) => !samePath(p, resolved)));
  const projects = readStore();
  const existing = projects.find((p) => samePath(p.cwd, resolved));
  if (existing) {
    existing.name = trimmed;
    writeStore(projects);
    return existing;
  }
  const project: ProjectInfo = {
    cwd: resolved,
    name: trimmed,
    gitRoot: null,
    addedAt: Date.now(),
  };
  projects.unshift(project);
  writeStore(projects);
  return project;
}
