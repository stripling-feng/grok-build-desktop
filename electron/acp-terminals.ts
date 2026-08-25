import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

export type AcpExitStatus = {
  exitCode: number | null;
  signal: string | null;
};

type EnvPair = { name?: string; value?: string };

type CreateInput = {
  command: string;
  args?: string[];
  env?: EnvPair[];
  cwd?: string;
  outputByteLimit?: number;
  sessionCwd?: string;
};

type Term = {
  id: string;
  proc: ChildProcessWithoutNullStreams;
  output: string;
  truncated: boolean;
  outputByteLimit: number;
  exitCode: number | null;
  signal: string | null;
  done: Promise<AcpExitStatus>;
};

function clip(text: string, limit: number): { text: string; truncated: boolean } {
  if (!limit || limit <= 0) return { text, truncated: false };
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= limit) return { text, truncated: false };
  let sliced = buf.subarray(buf.length - limit);
  while (sliced.length && (sliced[0] & 0xc0) === 0x80) sliced = sliced.subarray(1);
  return { text: sliced.toString("utf8"), truncated: true };
}

export class AcpTerminals {
  private terms = new Map<string, Term>();
  private seq = 1;

  create(input: CreateInput) {
    const command = String(input.command ?? "").trim();
    if (!command) throw new Error("缺少 command");
    const args = Array.isArray(input.args) ? input.args.map((a) => String(a)) : [];
    const cwd = path.resolve(input.cwd || input.sessionCwd || process.cwd());
    const extra: Record<string, string> = {};
    for (const pair of input.env ?? []) {
      if (pair?.name) extra[pair.name] = String(pair.value ?? "");
    }
    const outputByteLimit =
      typeof input.outputByteLimit === "number" && input.outputByteLimit > 0
        ? input.outputByteLimit
        : 1024 * 1024;
    const proc = spawn(command, args, {
      cwd,
      windowsHide: false,
      shell: process.platform === "win32",
      env: { ...process.env, TERM: process.env.TERM || "dumb", ...extra },
    });
    const id = `term_${Date.now().toString(36)}_${this.seq++}`;
    let resolveDone!: (status: AcpExitStatus) => void;
    const done = new Promise<AcpExitStatus>((resolve) => {
      resolveDone = resolve;
    });
    const term: Term = {
      id,
      proc,
      output: "",
      truncated: false,
      outputByteLimit,
      exitCode: null,
      signal: null,
      done,
    };
    const append = (chunk: string) => {
      const next = clip(term.output + chunk, term.outputByteLimit);
      term.output = next.text;
      if (next.truncated) term.truncated = true;
    };
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => append(chunk));
    proc.stderr.on("data", (chunk: string) => append(chunk));
    proc.on("error", (err) => {
      append(`\n[终端启动失败] ${err.message}\n`);
      term.exitCode = 1;
      resolveDone({ exitCode: 1, signal: null });
    });
    proc.on("exit", (code, signal) => {
      term.exitCode = code;
      term.signal = signal;
      resolveDone({ exitCode: code, signal });
    });
    this.terms.set(id, term);
    return { terminalId: id };
  }

  output(terminalId: string) {
    const term = this.require(terminalId);
    const exitStatus =
      term.exitCode != null || term.signal
        ? { exitCode: term.exitCode, signal: term.signal }
        : undefined;
    return { output: term.output, truncated: term.truncated, exitStatus };
  }

  waitForExit(terminalId: string) {
    return this.require(terminalId).done;
  }

  kill(terminalId: string) {
    const term = this.require(terminalId);
    if (term.proc.exitCode == null && term.signal == null) term.proc.kill();
    return {};
  }

  release(terminalId: string) {
    const term = this.terms.get(terminalId);
    if (!term) return {};
    if (term.proc.exitCode == null && term.signal == null) {
      try {
        term.proc.kill();
      } catch {
        /* ignore */
      }
    }
    this.terms.delete(terminalId);
    return {};
  }

  killAll() {
    for (const id of [...this.terms.keys()]) this.release(id);
  }

  private require(terminalId: string) {
    const term = this.terms.get(terminalId);
    if (!term) throw new Error(`终端不存在：${terminalId}`);
    return term;
  }
}
