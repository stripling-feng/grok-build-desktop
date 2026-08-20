import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

let logFile = "";

export function logsDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

export function initLog() {
  fs.mkdirSync(logsDir(), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  logFile = path.join(logsDir(), `main-${stamp}.log`);
  log("app start", process.versions.electron, `packed=${app.isPackaged}`);
}

export function log(...parts: unknown[]) {
  const line = `[${new Date().toISOString()}] ${parts.map(stringify).join(" ")}\n`;
  try {
    if (logFile) fs.appendFileSync(logFile, line);
  } catch {
    /* ignore */
  }
  console.log(...parts);
}

function stringify(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function pruneLogs(keep = 14) {
  try {
    const files = fs
      .readdirSync(logsDir())
      .filter((name) => name.startsWith("main-") && name.endsWith(".log"))
      .sort()
      .reverse();
    for (const name of files.slice(keep)) {
      fs.unlinkSync(path.join(logsDir(), name));
    }
  } catch {
    /* ignore */
  }
}
