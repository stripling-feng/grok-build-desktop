import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { normalizePath } from "./paths";

function file(): string {
  return path.join(app.getPath("userData"), "goals.json");
}

function readAll(): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function getGoal(cwd: string): string {
  return readAll()[normalizePath(cwd)] || "";
}

export function setGoal(cwd: string, text: string) {
  const all = readAll();
  const key = normalizePath(cwd);
  const next = text.trim();
  if (next) all[key] = next;
  else delete all[key];
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(all, null, 2), "utf8");
  return next;
}
