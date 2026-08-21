import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

export class ProjectTerminal extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  cwd: string | null = null;

  start(cwd: string) {
    this.kill();
    this.cwd = cwd;
    const isWin = process.platform === "win32";
    const cmd = isWin ? "powershell.exe" : process.env.SHELL || "/bin/bash";
    const args = isWin ? ["-NoLogo", "-NoExit", "-Command", "-"] : ["-i"];
    try {
      this.proc = spawn(cmd, args, {
        cwd,
        windowsHide: false,
        env: {
          ...process.env,
          TERM: "dumb",
          PS1: "$ ",
        },
      });
    } catch (err) {
      this.emit(
        "data",
        `\n[无法启动终端：${err instanceof Error ? err.message : String(err)}]\n`,
      );
      return;
    }
    this.proc.on("error", (err) => {
      this.emit("data", `\n[终端错误：${err.message}]\n`);
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.emit("data", chunk));
    this.proc.stderr.on("data", (chunk: string) => this.emit("data", chunk));
    this.proc.on("exit", (code) => {
      this.proc = null;
      this.emit("data", `\n[终端已退出 ${code ?? ""}]\n`);
      this.emit("exit", code);
    });
  }

  write(text: string) {
    if (!this.proc?.stdin.writable) return false;
    this.proc.stdin.write(text.endsWith("\n") ? text : text + "\n");
    return true;
  }

  kill() {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
    this.cwd = null;
  }
}
