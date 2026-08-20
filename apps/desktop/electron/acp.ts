import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GrokStatus, PermissionRequest } from "./shared";
import { grokBin } from "./grok-bin";

const execFileAsync = promisify(execFile);

type JsonRpc = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export type AcpEvents = {
  update: { sessionId: string; update: Record<string, unknown>; method?: string };
  permission: PermissionRequest;
  status: { connected: boolean; message?: string };
  stderr: string;
};

export class GrokAcpClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private initialized = false;
  private grokPath: string | null = null;
  private starting: Promise<void> | null = null;
  private allowedRoots = new Set<string>();
  private permissionWaiters = new Map<
    string,
    { resolve: (optionId: string) => void; reject: (err: Error) => void }
  >();

  findGrok(): string | null {
    return grokBin();
  }

  async status(): Promise<GrokStatus> {
    const found = this.findGrok();
    if (!found) {
      return {
        ok: false,
        path: null,
        version: null,
        error: "未找到 Grok CLI。请先安装，然后重新打开应用。",
      };
    }
    try {
      const { stdout } = await execFileAsync(found, ["--version"], {
        windowsHide: true,
        timeout: 8000,
      });
      return { ok: true, path: found, version: stdout.toString().trim() };
    } catch (err) {
      return { ok: false, path: found, version: null, error: String(err) };
    }
  }

  allowRoot(dir: string) {
    this.allowedRoots.add(path.resolve(dir));
  }

  async ensureStarted(): Promise<void> {
    if (this.proc && this.initialized) return;
    if (this.starting) return this.starting;
    this.starting = this.startProcess().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startProcess(): Promise<void> {
    if (this.proc && this.initialized) return;
    if (this.proc) await this.stop();
    const grok = this.findGrok();
    if (!grok) {
      throw new Error("未找到 Grok CLI（~/.grok/bin 或 GROK_PATH）");
    }
    this.grokPath = grok;
    this.proc = spawn(grok, ["agent", "stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env },
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.on("data", (chunk: string) => {
      this.emit("stderr", chunk);
    });
    this.proc.on("exit", (code) => {
      this.initialized = false;
      this.proc = null;
      const err = new Error(`Grok 代理已退出（${code ?? "?"}）`);
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
      for (const [, w] of this.permissionWaiters) w.reject(err);
      this.permissionWaiters.clear();
      this.emit("status", { connected: false, message: `agent exited (${code ?? "?"})` });
    });

    await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "grok-build-desktop", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
      },
    });
    this.initialized = true;
    this.emit("status", { connected: true, message: "connected" });
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    this.initialized = false;
    if (!proc) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      proc.kill();
    });
  }

  async newSession(cwd: string, extra?: Record<string, unknown>): Promise<string> {
    await this.ensureStarted();
    const result = (await this.request("session/new", {
      cwd,
      mcpServers: [],
      ...(extra ?? {}),
    })) as { sessionId?: string };
    if (!result?.sessionId) throw new Error("创建会话失败：未返回 sessionId");
    return result.sessionId;
  }

  async loadSession(sessionId: string, cwd: string): Promise<void> {
    await this.ensureStarted();
    await this.request("session/load", { sessionId, cwd, mcpServers: [] });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.ensureStarted();
    await this.request("session/set_mode", { sessionId, modeId });
  }

  async prompt(sessionId: string, text: string): Promise<unknown> {
    await this.ensureStarted();
    return this.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  cancel(sessionId: string) {
    if (!this.proc) return;
    this.notify("session/cancel", { sessionId });
  }

  resolvePermission(requestId: string, optionId: string) {
    const waiter = this.permissionWaiters.get(requestId);
    if (!waiter) return false;
    waiter.resolve(optionId);
    this.permissionWaiters.delete(requestId);
    return true;
  }

  private onStdout(chunk: string) {
    this.buffer += chunk;
    for (;;) {
      const idx = this.buffer.indexOf("\n");
      if (idx < 0) break;
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim() || !line.trim().startsWith("{")) continue;
      let msg: JsonRpc;
      try {
        msg = JSON.parse(line) as JsonRpc;
      } catch {
        continue;
      }
      void this.handleMessage(msg);
    }
  }

  private async handleMessage(msg: JsonRpc) {
    if (msg.id !== undefined && msg.method) {
      try {
        const result = await this.handleRequest(msg.method, msg.params, String(msg.id));
        this.send({ jsonrpc: "2.0", id: msg.id, result: result ?? {} });
      } catch (err) {
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
        });
      }
      return;
    }

    if (msg.id !== undefined && (msg.result !== undefined || msg.error)) {
      const id = Number(msg.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
      return;
    }

    if (msg.method) {
      this.handleNotification(msg.method, msg.params);
    }
  }

  private handleNotification(method: string, params: unknown) {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === "session/update" || method === "_x.ai/session/update") {
      const sessionId = String(p.sessionId ?? "");
      const update = (p.update ?? p) as Record<string, unknown>;
      this.emit("update", { sessionId, update, method });
    }
  }

  private async handleRequest(method: string, params: unknown, rpcId: string): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === "session/request_permission" || method === "session/requestPermission") {
      const options = Array.isArray(p.options)
        ? (p.options as { optionId: string; name: string; kind: string }[])
        : [];
      const toolCall = p.toolCall as { title?: string } | undefined;
      const request: PermissionRequest = {
        requestId: rpcId,
        sessionId: String(p.sessionId ?? ""),
        title: toolCall?.title || "需要授权",
        toolCall: p.toolCall,
        options,
      };
      this.emit("permission", request);
      const optionId = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.permissionWaiters.delete(rpcId);
          reject(new Error("授权超时"));
        }, 10 * 60_000);
        this.permissionWaiters.set(rpcId, {
          resolve: (id) => {
            clearTimeout(timer);
            resolve(id);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });
      });
      return {
        outcome: { outcome: "selected", optionId },
      };
    }

    if (method === "fs/read_text_file") {
      const filePath = this.assertAllowed(String(p.path ?? ""));
      const content = fs.readFileSync(filePath, "utf8");
      const limit = typeof p.limit === "number" ? p.limit : undefined;
      const line = typeof p.line === "number" ? p.line : 1;
      const lines = content.split(/\r?\n/);
      const sliced = lines.slice(Math.max(0, line - 1), limit ? line - 1 + limit : undefined);
      return { content: sliced.join("\n") };
    }

    if (method === "fs/write_text_file") {
      const filePath = this.assertAllowed(String(p.path ?? ""));
      const body = String(p.content ?? "");
      if (body.length > 8 * 1024 * 1024) throw new Error("写入内容过大");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body, "utf8");
      return {};
    }

    throw new Error(`Unsupported client method: ${method}`);
  }

  private assertAllowed(filePath: string): string {
    const full = path.resolve(filePath);
    if (this.allowedRoots.size === 0) {
      throw new Error("尚未打开项目，拒绝读写文件");
    }
    const lower = full.toLowerCase();
    for (const root of this.allowedRoots) {
      const prefix = root.toLowerCase();
      if (lower === prefix || lower.startsWith(prefix + path.sep.toLowerCase()) || lower.startsWith(prefix + "\\") || lower.startsWith(prefix + "/")) {
        return full;
      }
    }
    throw new Error("路径不在当前项目内");
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.proc) return Promise.reject(new Error("Grok 代理未运行"));
    const id = this.nextId++;
    const timeoutMs = method === "session/prompt" ? 15 * 60_000 : 60_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(msg: JsonRpc) {
    if (!this.proc?.stdin.writable) return;
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }
}
