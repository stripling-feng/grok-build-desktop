import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GrokStatus, PermissionRequest } from "./shared";
import { grokBin } from "./grok-bin";
import { AcpTerminals } from "./acp-terminals";
import { getDefaultReasoningEffort, sessionMeta } from "./config";
import type { FollowUpImage } from "./follow-ups";
import { encodeCwd, findSessionDir, grokHome } from "./sessions";
import { resolveReasoningEffortValue } from "./reasoning-effort";
import { currentGrokTarget, proxyEnvironmentForTarget } from "./network-settings";
import {
  grokExtensionMethodCandidates,
  grokExtensionNotificationMethod,
  isMethodNotFoundError,
} from "./acp-extensions";

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

type AcpModelState = {
  currentModelId?: string;
  availableModels?: Array<{
    modelId?: string;
    _meta?: {
      supportsReasoningEffort?: boolean;
      reasoningEffort?: string;
      reasoningEfforts?: Array<{ value?: string }>;
    };
  }>;
};

export type AcpEvents = {
  update: { sessionId: string; update: Record<string, unknown>; method?: string; meta?: Record<string, unknown> };
  fileWrite: { sessionId: string; path: string };
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
  private sessionCwds = new Map<string, string>();
  private sessionModels = new Map<string, AcpModelState>();
  private terminals = new AcpTerminals();
  private permissionWaiters = new Map<
    string,
    { resolve: (optionId: string) => void; reject: (err: Error) => void }
  >();
  private autoSessions = new Set<string>();
  private stderrHistory: { at: number; text: string }[] = [];

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

  cwdForSession(sessionId: string): string | null {
    return this.sessionCwds.get(sessionId) ?? null;
  }

  private allowSessionRoot(sessionId: string, cwd: string) {
    const expected = path.join(grokHome(), "sessions", encodeCwd(cwd), sessionId);
    this.allowRoot(expected);
    const existing = findSessionDir(sessionId, cwd);
    if (existing) this.allowRoot(existing);
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
    const env = await proxyEnvironmentForTarget(currentGrokTarget());
    this.proc = spawn(grok, ["agent", "stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env,
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.on("data", (chunk: string) => {
      const at = Date.now();
      for (const line of chunk.split(/\r?\n/)) {
        const text = line.trim();
        if (text) this.stderrHistory.push({ at, text });
      }
      this.stderrHistory = this.stderrHistory.slice(-120);
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
        terminal: true,
      },
    });
    this.initialized = true;
    this.emit("status", { connected: true, message: "connected" });
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    this.initialized = false;
    this.terminals.killAll();
    this.sessionModels.clear();
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
    // ACP requires mcpServers. An empty array keeps servers from config.toml /
    // Cursor / Claude / plugin discovery — it does not wipe them.
    const result = (await this.request("session/new", {
      cwd,
      mcpServers: [],
      ...(extra ?? {}),
    })) as { sessionId?: string; models?: AcpModelState };
    if (!result?.sessionId) throw new Error("创建会话失败：未返回 sessionId");
    this.rememberModels(result.sessionId, result.models);
    this.sessionCwds.set(result.sessionId, path.resolve(cwd));
    this.allowRoot(cwd);
    this.allowSessionRoot(result.sessionId, cwd);
    return result.sessionId;
  }

  async loadSession(sessionId: string, cwd: string): Promise<void> {
    await this.ensureStarted();
    const extra = sessionMeta();
    const result = (await this.request("session/load", {
      sessionId,
      cwd,
      mcpServers: [],
      ...extra,
    })) as { models?: AcpModelState };
    this.rememberModels(sessionId, result?.models);
    this.sessionCwds.set(sessionId, path.resolve(cwd));
    this.allowRoot(cwd);
    this.allowSessionRoot(sessionId, cwd);
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.ensureStarted();
    await this.request("session/set_mode", { sessionId, modeId });
  }

  async setModel(
    sessionId: string,
    modelId: string,
    reasoningEffort = getDefaultReasoningEffort(),
  ): Promise<void> {
    await this.ensureStarted();
    await this.request("session/set_model", {
      sessionId,
      modelId,
      _meta: { reasoningEffort },
    });
    const state = this.sessionModels.get(sessionId);
    if (state) {
      state.currentModelId = modelId;
      const model = state.availableModels?.find((item) => item.modelId === modelId);
      if (model?._meta) model._meta.reasoningEffort = reasoningEffort;
    }
  }

  async setReasoningEffort(sessionId: string, effort: string): Promise<void> {
    await this.ensureStarted();
    const state = this.sessionModels.get(sessionId);
    const modelId = state?.currentModelId;
    const model = state?.availableModels?.find((item) => item.modelId === modelId);
    const available = (model?._meta?.reasoningEfforts ?? [])
      .map((item) => item.value)
      .filter((value): value is string => typeof value === "string");
    if (!modelId || model?._meta?.supportsReasoningEffort !== true || available.length === 0) {
      throw new Error("当前 API 模型没有提供推理强度选项");
    }
    const value = resolveReasoningEffortValue(effort, available);
    if (!value) throw new Error(`当前 API 模型不支持推理强度 ${effort}`);
    await this.setModel(sessionId, modelId, value);
  }

  private rememberModels(sessionId: string, models?: AcpModelState) {
    if (models) this.sessionModels.set(sessionId, models);
  }

  async forkSession(sessionId: string, cwd: string): Promise<string> {
    await this.ensureStarted();
    const params = { sessionId, cwd, mcpServers: [] };
    const methods = ["x.ai/session/fork", "_x.ai/session/fork", "session/fork"];
    let lastError: Error | null = null;
    for (const method of methods) {
      try {
        const result = (await this.request(method, params)) as Record<string, unknown>;
        const id =
          (typeof result?.sessionId === "string" && result.sessionId) ||
          (typeof result?.session_id === "string" && result.session_id) ||
          (result?.session && typeof result.session === "object"
            ? String((result.session as { sessionId?: string }).sessionId ?? "")
            : "");
        if (id) {
          this.sessionCwds.set(id, path.resolve(cwd));
          this.allowRoot(cwd);
          this.allowSessionRoot(id, cwd);
          return id;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!/not found|unknown method|Method not found/i.test(lastError.message)) throw lastError;
      }
    }
    throw lastError ?? new Error("当前代理不支持分叉会话");
  }

  async prompt(
    sessionId: string,
    text: string,
    images?: FollowUpImage[],
  ): Promise<unknown> {
    const startedAt = Date.now();
    await this.ensureStarted();
    const prompt = this.contentBlocks(text, images);
    if (!prompt.length) throw new Error("没有可发送的内容");
    try {
      return await this.request("session/prompt", { sessionId, prompt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!images?.length || !/invalid|unsupported|unknown|schema|type/i.test(message)) {
        throw this.enrichPromptError(err, startedAt);
      }
      const fallback = text.trim()
        ? `${text.trim()}\n\n请同时参考这些图片：\n${images.map((img) => `- @${img.path}`).join("\n")}`
        : `请查看这些图片：\n${images.map((img) => `- @${img.path}`).join("\n")}`;
      try {
        return await this.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: fallback }],
        });
      } catch (fallbackErr) {
        throw this.enrichPromptError(fallbackErr, startedAt);
      }
    }
  }

  async interject(
    sessionId: string,
    text: string,
    images?: FollowUpImage[],
  ): Promise<"ok" | "unsupported"> {
    await this.ensureStarted();
    const content = this.contentBlocks(text, images);
    if (!content.length) throw new Error("没有可发送的内容");
    const visibleText = text.trim() || (images?.length ? "请参考附图并据此调整当前任务。" : "");
    const params: Record<string, unknown> = { sessionId, text: visibleText };
    if (images?.length) params.content = content;
    try {
      await this.request("_x.ai/interject", params);
      return "ok";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/method not found|unknown method|not found.*_x\.ai\/interject/i.test(message)) {
        return "unsupported";
      }
      throw err;
    }
  }

  async extensionRequest(method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> {
    const candidates = grokExtensionMethodCandidates(method);
    await this.ensureStarted();
    let lastError: Error | null = null;
    for (const candidate of candidates) {
      try {
        return await this.request(candidate, params, timeoutMs);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!isMethodNotFoundError(lastError)) throw lastError;
      }
    }
    throw lastError ?? new Error(`Grok 不支持扩展方法：${method}`);
  }

  private contentBlocks(text: string, images?: FollowUpImage[]): Record<string, unknown>[] {
    const prompt: Record<string, unknown>[] = [];
    if (text.trim()) prompt.push({ type: "text", text });
    for (const image of images ?? []) {
      let data = "";
      try {
        data = fs.readFileSync(image.path).toString("base64");
      } catch {
        continue;
      }
      if (!data) continue;
      prompt.push({
        type: "image",
        mimeType: image.mimeType || "image/png",
        data,
      });
    }
    return prompt;
  }

  private enrichPromptError(err: unknown, startedAt: number): Error {
    const original = err instanceof Error ? err.message : String(err);
    const diagnosticLines = this.stderrHistory
      .filter((row) => row.at >= startedAt - 1_000 && /error|failed|rate_limit|limit exceeded|serialization/i.test(row.text))
      .map((row) => row.text)
      .slice(-16);
    const diagnostics = diagnosticLines.join("\n");
    const rateLimited = /rate_limit_exceeded|concurrency limit exceeded/i.test(diagnostics);
    const heading = rateLimited
      ? "Grok 服务拒绝了请求：账户并发数已达到上限，请稍后重试。"
      : original;
    if (!diagnostics || diagnostics.includes(original) && diagnostics.trim() === original.trim()) {
      return new Error(heading);
    }
    return new Error(`${heading}\n\n原始错误：${original}\n\nGrok CLI 诊断：\n${diagnostics}`);
  }

  cancel(sessionId: string) {
    if (!this.proc) return;
    this.notify("session/cancel", { sessionId });
  }

  markAutoSession(sessionId: string) {
    if (sessionId) this.autoSessions.add(sessionId);
  }

  unmarkAutoSession(sessionId: string) {
    if (sessionId) this.autoSessions.delete(sessionId);
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
      const meta = p._meta && typeof p._meta === "object" ? (p._meta as Record<string, unknown>) : undefined;
      this.emit("update", { sessionId, update, method, meta });
      return;
    }
    const extensionMethod = grokExtensionNotificationMethod(method);
    if (extensionMethod) this.emit("extension", { method: extensionMethod, params });
  }

  private async handleRequest(method: string, params: unknown, rpcId: string): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === "session/request_permission" || method === "session/requestPermission") {
      const options = Array.isArray(p.options)
        ? (p.options as { optionId: string; name: string; kind: string }[])
        : [];
      const sessionId = String(p.sessionId ?? "");
      if (this.autoSessions.has(sessionId)) {
        const blob = (opt: { optionId: string; name: string; kind: string }) =>
          `${opt.kind} ${opt.name} ${opt.optionId}`.toLowerCase();
        const allow =
          options.find((opt) => /always|session|forever/.test(blob(opt)) && /allow|approve|accept/.test(blob(opt))) ||
          options.find((opt) => /allow|approve|accept/.test(blob(opt))) ||
          options[0];
        if (allow?.optionId) {
          return { outcome: { outcome: "selected", optionId: allow.optionId } };
        }
      }
      const toolCall = p.toolCall as { title?: string } | undefined;
      const request: PermissionRequest = {
        requestId: rpcId,
        sessionId,
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
      this.emit("fileWrite", { sessionId: String(p.sessionId ?? ""), path: filePath });
      return {};
    }

    const terminalMethod = method.replace(/^x\.ai\//, "");
    if (terminalMethod === "terminal/create") {
      const sessionId = String(p.sessionId ?? "");
      const sessionCwd = this.sessionCwds.get(sessionId);
      const cwd = p.cwd ? this.assertAllowed(String(p.cwd)) : sessionCwd;
      return this.terminals.create({
        command: String(p.command ?? ""),
        args: Array.isArray(p.args) ? (p.args as string[]) : undefined,
        env: Array.isArray(p.env) ? (p.env as { name?: string; value?: string }[]) : undefined,
        cwd,
        outputByteLimit: typeof p.outputByteLimit === "number" ? p.outputByteLimit : undefined,
        sessionCwd,
      });
    }
    if (terminalMethod === "terminal/output") {
      return this.terminals.output(String(p.terminalId ?? ""));
    }
    if (terminalMethod === "terminal/wait_for_exit") {
      return this.terminals.waitForExit(String(p.terminalId ?? ""));
    }
    if (terminalMethod === "terminal/kill") {
      return this.terminals.kill(String(p.terminalId ?? ""));
    }
    if (terminalMethod === "terminal/release") {
      return this.terminals.release(String(p.terminalId ?? ""));
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

  private request(method: string, params: unknown, requestedTimeoutMs?: number): Promise<unknown> {
    if (!this.proc) return Promise.reject(new Error("Grok 代理未运行"));
    const id = this.nextId++;
    const timeoutMs = requestedTimeoutMs ?? (method === "session/prompt" ? 15 * 60_000 : 60_000);
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
