import path from "node:path";

export function normalizePath(p: string): string {
  return path
    .resolve(p.replace(/\//g, path.sep))
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

export function samePath(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return normalizePath(a) === normalizePath(b);
}

export function isSubPath(child: string, parent: string): boolean {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  return c === p || c.startsWith(p + "\\") || c.startsWith(p + "/");
}

export function isDesktopWorktree(p: string): boolean {
  return /[\\/]desktop-worktrees[\\/]/i.test(p);
}
