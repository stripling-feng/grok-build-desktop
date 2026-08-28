import { EventEmitter } from "node:events";
import * as pty from "node-pty";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function validDimension(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(2, Math.floor(value as number));
}

export class ProjectTerminal extends EventEmitter {
  private proc: pty.IPty | null = null;
  cwd: string | null = null;

  start(cwd: string, cols?: number, rows?: number) {
    this.kill();
    this.cwd = cwd;

    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : process.env.SHELL || "/bin/bash";
    const args = isWin ? ["-NoLogo"] : ["-l"];

    try {
      const proc = pty.spawn(shell, args, {
        name: "xterm-256color",
        cols: validDimension(cols, DEFAULT_COLS),
        rows: validDimension(rows, DEFAULT_ROWS),
        cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
        ...(isWin ? { useConpty: true } : {}),
      });
      this.proc = proc;

      proc.onData((data) => this.emit("data", data));
      proc.onExit(({ exitCode }) => {
        if (this.proc !== proc) return;
        this.proc = null;
        this.cwd = null;
        this.emit("data", `\r\n\x1b[90m[终端已退出 ${exitCode}]\x1b[0m\r\n`);
        this.emit("exit", exitCode);
      });
    } catch (err) {
      this.proc = null;
      this.cwd = null;
      throw err;
    }
  }

  write(data: string) {
    if (!this.proc) return false;
    try {
      this.proc.write(data);
      return true;
    } catch {
      return false;
    }
  }

  resize(cols: number, rows: number) {
    if (!this.proc) return false;
    try {
      this.proc.resize(validDimension(cols, DEFAULT_COLS), validDimension(rows, DEFAULT_ROWS));
      return true;
    } catch {
      return false;
    }
  }

  kill() {
    const proc = this.proc;
    this.proc = null;
    this.cwd = null;
    if (!proc) return;
    try {
      proc.kill();
    } catch {
      // The shell may already have exited between the check and kill call.
    }
  }
}
