import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import type { GitFile, GitStatus } from "./shared";
import { grokHome } from "./sessions";

const execFileAsync = promisify(execFile);

export type GitWorktreeSnapshot = {
  root: string | null;
  head: string | null;
  files: Record<string, string>;
};

async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), ok: true };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return {
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? String(err),
      ok: false,
    };
  }
}

export async function findGitRoot(cwd: string): Promise<string | null> {
  const res = await git(["rev-parse", "--show-toplevel"], cwd);
  if (!res.ok) return null;
  return res.stdout.trim().replace(/\//g, path.sep) || null;
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const root = await findGitRoot(cwd);
  if (!root) {
    return {
      branch: null,
      remote: null,
      isRepo: false,
      isWorktree: false,
      mainRoot: null,
      added: 0,
      removed: 0,
      files: [],
    };
  }
  const [branchRes, porcelain, common, remoteRes, unstagedStat, stagedStat] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    git(["status", "--porcelain=v1", "-uall"], cwd),
    git(["rev-parse", "--git-common-dir"], cwd),
    git(["remote", "get-url", "origin"], cwd),
    git(["diff", "--numstat"], cwd),
    git(["diff", "--numstat", "--cached"], cwd),
  ]);
  const gitDir = common.stdout.trim();
  const isWorktree = Boolean(gitDir) && path.resolve(cwd) !== path.resolve(root);
  let mainRoot = root;
  const normalizedGitDir = gitDir.replace(/[/\\]+$/, "");
  if (isWorktree && /(^|[\\/])\.git$/i.test(normalizedGitDir)) {
    mainRoot = path.dirname(normalizedGitDir);
  }
  let remote = remoteRes.ok ? remoteRes.stdout.trim() || null : null;
  if (!remote) {
    const all = await git(["remote", "-v"], cwd);
    const line = all.stdout.split(/\r?\n/).find((item) => /\s\(fetch\)\s*$/.test(item) || item.trim());
    if (line) remote = line.trim().split(/\s+/)[1] || null;
  }
  const files = parsePorcelain(porcelain.stdout).slice(0, 300);
  const counts = parseNumstat(unstagedStat.stdout, stagedStat.stdout, files);
  return {
    branch: branchRes.stdout.trim() || null,
    remote,
    isRepo: true,
    isWorktree,
    mainRoot,
    added: counts.added,
    removed: counts.removed,
    files,
  };
}

function snapshotFingerprint(root: string, file: GitFile): string {
  const full = assertInside(root, file.path);
  const prefix = `${file.status}:${file.staged ? "staged" : "unstaged"}`;
  try {
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      return `${prefix}:link:${fs.readlinkSync(full)}`;
    }
    if (!stat.isFile()) return `${prefix}:other:${stat.size}:${stat.mtimeMs}`;
    if (stat.size > 16 * 1024 * 1024) {
      return `${prefix}:large:${stat.size}:${stat.mtimeMs}`;
    }
    const digest = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    return `${prefix}:file:${digest}`;
  } catch {
    return `${prefix}:missing`;
  }
}

/** Capture the net Git-visible workspace state so one prompt can be compared
 * with the next state without confusing pre-existing dirty files for new work. */
export async function gitWorktreeSnapshot(cwd: string): Promise<GitWorktreeSnapshot> {
  const root = await findGitRoot(cwd);
  if (!root) return { root: null, head: null, files: {} };
  const [headResult, statusResult] = await Promise.all([
    git(["rev-parse", "HEAD"], root),
    git(["status", "--porcelain=v1", "-uall"], root),
  ]);
  const files: Record<string, string> = {};
  for (const file of parsePorcelain(statusResult.stdout)) {
    files[file.path] = snapshotFingerprint(root, file);
  }
  return {
    root,
    head: headResult.ok ? headResult.stdout.trim() || null : null,
    files,
  };
}

export async function gitFilesChangedSince(
  cwd: string,
  before: GitWorktreeSnapshot | null,
): Promise<string[]> {
  if (!before?.root) return [];
  const after = await gitWorktreeSnapshot(cwd);
  if (!after.root || path.resolve(after.root) !== path.resolve(before.root)) return [];

  const changed = new Set<string>();
  for (const filePath of new Set([...Object.keys(before.files), ...Object.keys(after.files)])) {
    if (before.files[filePath] !== after.files[filePath]) changed.add(filePath);
  }
  if (before.head && after.head && before.head !== after.head) {
    const committed = await git(["diff", "--name-only", "-z", before.head, after.head], after.root);
    if (committed.ok) {
      for (const filePath of committed.stdout.split("\0")) {
        if (filePath) changed.add(filePath.replace(/\\/g, "/"));
      }
    }
  }
  return [...changed].sort((a, b) => a.localeCompare(b));
}

function parseNumstat(
  unstaged: string,
  staged: string,
  files: GitFile[],
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const text of [unstaged, staged]) {
    for (const raw of text.split(/\r?\n/)) {
      const match = raw.match(/^(\d+|-)\t(\d+|-)\t/);
      if (!match) continue;
      if (match[1] !== "-") added += Number(match[1]);
      if (match[2] !== "-") removed += Number(match[2]);
    }
  }
  for (const file of files) {
    if (file.untracked) added += 1;
  }
  return { added, removed };
}

function parsePorcelain(text: string): GitFile[] {
  const files: GitFile[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    let rest = line.slice(3).replace(/^"/, "").replace(/"$/, "");
    if (rest.includes(" -> ")) rest = rest.split(" -> ").pop() || rest;
    const untracked = xy === "??";
    const staged = !untracked && xy[0] !== " " && xy[0] !== "?";
    let status = untracked ? "?" : xy[1] !== " " && xy[1] !== "?" ? xy[1] : xy[0];
    if (status === " ") status = "M";
    files.push({ path: rest.replace(/\\/g, "/"), status, untracked, staged });
  }
  return files;
}

function assertInside(cwd: string, filePath: string): string {
  const root = path.resolve(cwd);
  const full = path.resolve(root, filePath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new Error("路径超出项目目录");
  }
  return full;
}

export async function gitFileDiff(cwd: string, filePath: string): Promise<string> {
  const root = await findGitRoot(cwd);
  if (!root) return "";
  const rel = filePath.replace(/\\/g, "/");
  const full = assertInside(root, rel);
  const status = await git(["status", "--porcelain=v1", "--", rel], cwd);
  if (status.stdout.startsWith("??")) {
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return "";
    if (fs.statSync(full).size > 512 * 1024) return `文件过大，未展开 diff（${rel}）`;
    const body = fs.readFileSync(full, "utf8");
    const lines = body.split("\n");
    return [
      `--- /dev/null`,
      `+++ b/${rel}`,
      `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
      ...lines.map((l) => `+${l}`),
    ].join("\n");
  }
  if (status.stdout.startsWith(" D") || status.stdout.startsWith("D ")) {
    const deleted = await git(["diff", "--no-color", "HEAD", "--", rel], cwd);
    return deleted.stdout;
  }
  const vsHead = await git(["diff", "--no-color", "HEAD", "--", rel], cwd);
  if (vsHead.stdout.trim()) return vsHead.stdout;
  const cached = await git(["diff", "--no-color", "--cached", "--", rel], cwd);
  return cached.stdout;
}

export async function gitDiscard(cwd: string, filePath: string): Promise<void> {
  const root = await findGitRoot(cwd);
  if (!root) throw new Error("当前目录不是 Git 仓库");
  const rel = filePath.replace(/\\/g, "/");
  const full = assertInside(root, rel);
  const status = await git(["status", "--porcelain=v1", "--", rel], cwd);
  if (status.stdout.startsWith("??")) {
    if (fs.existsSync(full) && fs.statSync(full).isFile()) fs.unlinkSync(full);
    return;
  }
  const restore = await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", rel], cwd);
  if (!restore.ok) {
    const checkout = await git(["checkout", "HEAD", "--", rel], cwd);
    if (!checkout.ok) throw new Error(checkout.stderr || "丢弃失败");
  }
}

export async function gitStage(cwd: string, filePath: string): Promise<void> {
  const rel = filePath.replace(/\\/g, "/");
  assertInside(cwd, rel);
  const res = await git(["add", "--", rel], cwd);
  if (!res.ok) throw new Error(res.stderr || "暂存失败");
}

export async function gitUnstage(cwd: string, filePath: string): Promise<void> {
  const rel = filePath.replace(/\\/g, "/");
  assertInside(cwd, rel);
  const res = await git(["restore", "--staged", "--", rel], cwd);
  if (!res.ok) throw new Error(res.stderr || "取消暂存失败");
}

export async function createWorktree(cwd: string): Promise<{ cwd: string; branch: string }> {
  const root = await findGitRoot(cwd);
  if (!root) throw new Error("当前目录不是 Git 仓库");
  const short = randomUUID().slice(0, 8);
  const branch = `grok/${short}`;
  const dest = path.join(
    grokHome(),
    "desktop-worktrees",
    `${path.basename(root)}-${short}`,
  );
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await git(["worktree", "add", "-b", branch, dest], root);
  if (!res.ok) throw new Error(res.stderr || "创建工作树失败");
  return { cwd: dest, branch };
}

export async function gitCommit(cwd: string, message: string): Promise<string> {
  const root = await findGitRoot(cwd);
  if (!root) throw new Error("当前目录不是 Git 仓库");
  const msg = message.trim();
  if (!msg) throw new Error("提交说明不能为空");
  const staged = await git(["diff", "--cached", "--name-only"], cwd);
  if (!staged.ok) throw new Error(staged.stderr || "无法读取暂存区");
  if (!staged.stdout.trim()) {
    const add = await git(["add", "-A"], cwd);
    if (!add.ok) throw new Error(add.stderr || "暂存失败");
  }
  const res = await git(["commit", "-m", msg], cwd);
  if (!res.ok) throw new Error(res.stderr || "提交失败");
  return res.stdout.trim() || "已提交";
}

export async function gitPush(cwd: string): Promise<string> {
  const root = await findGitRoot(cwd);
  if (!root) throw new Error("当前目录不是 Git 仓库");
  const branchRes = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const branch = branchRes.stdout.trim();
  if (!branch || branch === "HEAD") throw new Error("当前不在已命名分支上");
  const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd);
  const args = upstream.ok ? ["push"] : ["push", "-u", "origin", branch];
  const res = await git(args, cwd);
  if (!res.ok) throw new Error(res.stderr || "推送失败");
  return res.stdout.trim() || res.stderr.trim() || "已推送";
}

export async function applyWorktree(worktreeCwd: string, destCwd: string): Promise<string> {
  const diff = await git(["diff", "HEAD"], worktreeCwd);
  if (!diff.ok) throw new Error(diff.stderr || "没有可应用的差异");
  if (!diff.stdout.trim()) return "工作树没有本地改动";
  const tmp = path.join(os.tmpdir(), `grok-apply-${randomUUID()}.patch`);
  fs.writeFileSync(tmp, diff.stdout, "utf8");
  const apply = await git(["apply", "--3way", tmp], destCwd);
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  if (!apply.ok) throw new Error(apply.stderr || "应用补丁失败");
  return "已将工作树改动应用到项目";
}
