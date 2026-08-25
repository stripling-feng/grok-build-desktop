import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { grokBin, INSTALL_COMMAND, INSTALL_DOCS } from "./grok-bin";

const execFileAsync = promisify(execFile);

export type InstallLogTone = "info" | "ok" | "warn" | "error";

export type InstallLogLine = {
  ts: number;
  text: string;
  tone: InstallLogTone;
};

export type InstallResult = {
  ok: boolean;
  launched: boolean;
  error?: string;
};

type LogFn = (line: InstallLogLine) => void;

let child: ChildProcessWithoutNullStreams | null = null;
let running: Promise<InstallResult> | null = null;

export function isInstalling() {
  return Boolean(child || running);
}

export function stopGrokInstall() {
  if (!child) return;
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  child = null;
}

function emit(onLog: LogFn, text: string, tone: InstallLogTone = "info") {
  onLog({ ts: Date.now(), text, tone });
}

function attachLines(stream: NodeJS.ReadableStream, onLine: (text: string) => void) {
  let buf = "";
  stream.on("data", (chunk: Buffer | string) => {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    buf = buf.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const text = part.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (text) onLine(text);
    }
  });
  stream.on("end", () => {
    const text = buf.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (text) onLine(text);
  });
}

function classify(text: string): InstallLogTone {
  if (/error|failed|fatal|拒绝|失败|无法|未找到|denied/i.test(text)) return "error";
  if (/complete|success|ready|通过|完成|已就绪|ok\b/i.test(text)) return "ok";
  if (/wait|请勿|warning|warn|pending/i.test(text)) return "warn";
  return "info";
}

async function executionPolicy(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-ExecutionPolicy"],
      { windowsHide: true, timeout: 8000 },
    );
    return stdout.toString().trim() || "Unknown";
  } catch {
    return "Unknown";
  }
}

async function grokVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], {
      windowsHide: true,
      timeout: 8000,
    });
    return stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

function spawnInstaller(): ChildProcessWithoutNullStreams {
  if (process.platform === "win32") {
    const command = [
      "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new();",
      "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new();",
      "$ProgressPreference = 'SilentlyContinue';",
      `& { ${INSTALL_COMMAND} } *>&1 | ForEach-Object { $_.ToString() }`,
    ].join(" ");
    return spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1" },
      },
    );
  }
  return spawn("bash", ["-lc", INSTALL_COMMAND], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function startGrokInstall(onLog: LogFn): Promise<InstallResult> {
  if (running) return running;

  running = (async () => {
    if (process.platform !== "win32" && process.platform !== "darwin" && process.platform !== "linux") {
      emit(onLog, `当前系统暂不支持应用内安装，请打开 ${INSTALL_DOCS}`, "warn");
      return { ok: false, launched: false, error: "unsupported platform" };
    }

    emit(onLog, process.platform === "win32" ? "PowerShell 已启动..." : "安装进程已启动...", "info");

    if (process.platform === "win32") {
      emit(onLog, "Checking execution policy...", "info");
      const policy = await executionPolicy();
      emit(onLog, `执行策略检查通过 (${policy})`, "ok");
    }

    emit(onLog, "正在下载并执行官方安装脚本...", "info");
    emit(onLog, "等待安装完成，请勿关闭应用。", "warn");

    const result = await new Promise<InstallResult>((resolve) => {
      const proc = spawnInstaller();
      child = proc;
      let settled = false;

      const finish = (value: InstallResult) => {
        if (settled) return;
        settled = true;
        if (child === proc) child = null;
        resolve(value);
      };

      attachLines(proc.stdout, (text) => emit(onLog, text, classify(text)));
      attachLines(proc.stderr, (text) => emit(onLog, text, classify(text)));

      proc.on("error", (err) => {
        emit(onLog, `无法启动安装进程：${err.message}`, "error");
        finish({ ok: false, launched: false, error: err.message });
      });

      proc.on("close", (code) => {
        finish({
          ok: code === 0,
          launched: true,
          error: code === 0 ? undefined : `安装进程退出码 ${code ?? "unknown"}`,
        });
      });
    });

    if (!result.launched) return result;

    const found = grokBin();
    if (found) {
      emit(onLog, `Running: grok --version`, "info");
      const version = await grokVersion(found);
      if (version) emit(onLog, version, "ok");
      emit(onLog, `已安装到 ${found}`, "ok");
      emit(onLog, "安装完成。", "ok");
      return { ok: true, launched: true };
    }

    if (result.ok) {
      emit(onLog, "安装脚本已结束，但仍未找到 grok，请点击「重新检测」。", "warn");
    } else {
      emit(onLog, result.error || "安装失败。", "error");
    }
    return { ...result, ok: false };
  })().finally(() => {
    running = null;
    child = null;
  });

  return running;
}
