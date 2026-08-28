import type { McpAddInput, McpServerInfo } from "./shared";

const MCP_FAILED_STATUS = /failed|error|unavailable|not found|missing|blocked|timeout|disconnected|启动失败|连接失败|不可用/i;
const MCP_TRANSITIONAL_STATUS = /initializing|connecting|starting|loading|pending|authenticating|初始化|连接中|启动中|认证中/i;
const MCP_READY_STATUS = /ready|connected|enabled|configured|available|running|initialized|就绪|已连接|可用|运行中/i;

function required(value: string, label: string): string {
  const next = value.trim();
  if (!next) throw new Error(`${label}不能为空`);
  return next;
}

export function validateMcpAddInput(input: McpAddInput, cwd?: string | null): McpAddInput {
  const name = required(input.name, "MCP 名称");
  const commandOrUrl = required(input.commandOrUrl, input.transport === "stdio" ? "命令" : "URL");
  if (input.scope === "project" && !cwd?.trim()) throw new Error("添加项目级 MCP 前请先选择项目");
  if (input.transport !== "stdio") {
    let parsed: URL;
    try {
      parsed = new URL(commandOrUrl);
    } catch {
      throw new Error("远程 MCP URL 无效");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("远程 MCP URL 只支持 http 或 https");
    }
  }
  for (const value of input.env ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) throw new Error(`环境变量格式无效：${value}`);
  }
  for (const value of input.headers ?? []) {
    if (!/^[^:\s][^:]*:\s*.+$/.test(value)) throw new Error(`请求头格式无效：${value}`);
  }
  for (const [tool, seconds] of Object.entries(input.toolTimeouts ?? {})) {
    if (!tool.trim() || !Number.isInteger(seconds) || seconds <= 0) {
      throw new Error(`工具超时格式无效：${tool}=${seconds}`);
    }
  }
  for (const [label, value] of [
    ["启动超时", input.startupTimeoutSec],
    ["工具超时", input.toolTimeoutSec],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new Error(`${label}必须是正整数秒数`);
    }
  }
  return { ...input, name, commandOrUrl };
}

export function mcpAddArgs(input: McpAddInput): string[] {
  const args = ["mcp", "add", "--transport", input.transport, "--scope", input.scope];
  for (const env of input.env ?? []) args.push("-e", env);
  for (const header of input.headers ?? []) args.push("--header", header);
  args.push(input.name);
  if (input.transport === "stdio") args.push("--", input.commandOrUrl, ...(input.args ?? []));
  else args.push(input.commandOrUrl);
  return args;
}

function assignmentMap(lines: string[], separator: "=" | ":"): Record<string, string> {
  return Object.fromEntries(lines.map((line) => {
    const at = line.indexOf(separator);
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }));
}

/** Grok's management extension currently uses snake_case for toggle/auth/upsert/delete. */
export function mcpToggleParams(sessionId: string, serverName: string, enabled: boolean) {
  return { session_id: sessionId, server_name: serverName, enabled };
}

export function mcpToggleToolParams(sessionId: string, serverName: string, toolName: string, enabled: boolean) {
  return { session_id: sessionId, server_name: serverName, tool_name: toolName, enabled };
}

export function mcpAuthTriggerParams(sessionId: string, serverName: string) {
  return { session_id: sessionId, server_name: serverName };
}

export function mcpDeleteParams(sessionId: string, serverName: string) {
  return { session_id: sessionId, server_name: serverName };
}

export function failedMcpStatus(status: string): boolean {
  return MCP_FAILED_STATUS.test(status);
}

export function mcpRuntimeReady(server?: McpServerInfo | null): boolean {
  if (!server?.live || server.authRequired || server.setupRequired) return false;
  const status = server.status?.trim() || "";
  return Boolean(status) && !MCP_FAILED_STATUS.test(status) && !MCP_TRANSITIONAL_STATUS.test(status)
    && MCP_READY_STATUS.test(status);
}

export function mcpRuntimeSettled(server?: McpServerInfo | null): boolean {
  return Boolean(server && (
    mcpRuntimeReady(server) ||
    server.authRequired ||
    server.setupRequired ||
    MCP_FAILED_STATUS.test(server.status || "")
  ));
}

export function mcpAuthenticationSettled(server?: McpServerInfo | null): boolean {
  if (!server?.live || server.authRequired) return false;
  return mcpRuntimeReady(server) || Boolean(server.setupRequired) || MCP_FAILED_STATUS.test(server.status || "");
}

export function mcpAuthResultError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const outer = result as Record<string, unknown>;
  const data = outer.result && typeof outer.result === "object"
    ? outer.result as Record<string, unknown>
    : outer;
  const status = String(data.status || data.state || "");
  if (!/failed|cancelled|canceled|error/i.test(status)) return null;
  return String(data.error || data.message || status || "MCP 认证失败");
}

export function mcpUpsertParams(sessionId: string, input: McpAddInput): Record<string, unknown> {
  const common: Record<string, unknown> = {
    session_id: sessionId,
    server_name: input.name,
    enabled: true,
  };
  if (input.startupTimeoutSec) common.startup_timeout_sec = input.startupTimeoutSec;
  if (input.toolTimeoutSec) common.tool_timeout_sec = input.toolTimeoutSec;
  if (Object.keys(input.toolTimeouts ?? {}).length) common.tool_timeouts = input.toolTimeouts;
  if (input.exposeImageBase64) common.expose_image_base64 = true;

  if (input.transport === "stdio") {
    return {
      ...common,
      command: input.commandOrUrl,
      args: input.args ?? [],
      ...(input.env?.length ? { env: assignmentMap(input.env, "=") } : {}),
      ...(input.serverCwd?.trim() ? { cwd: input.serverCwd.trim() } : {}),
    };
  }
  return {
    ...common,
    url: input.commandOrUrl,
    type: input.transport,
    ...(input.headers?.length ? { headers: assignmentMap(input.headers, ":") } : {}),
    ...(input.bearerTokenEnvVar?.trim() ? { bearer_token_env_var: input.bearerTokenEnvVar.trim() } : {}),
    ...(input.oauthClientId?.trim() ? { oauth_client_id: input.oauthClientId.trim() } : {}),
    ...(input.oauthClientSecretEnvVar?.trim()
      ? { oauth_client_secret_env_var: input.oauthClientSecretEnvVar.trim() }
      : {}),
    ...(input.oauthScopes?.length ? { oauth_scopes: input.oauthScopes } : {}),
  };
}

/** Parse argv text without losing quoted paths. Newline mode treats each line as one argument. */
export function parseMcpArguments(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (/\r?\n/.test(trimmed)) {
    return trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && (trimmed[i + 1] === quote || trimmed[i + 1] === "\\")) {
        current += trimmed[i + 1];
        i += 1;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (quote) throw new Error("MCP 参数包含未闭合的引号");
  if (current) out.push(current);
  return out;
}

export function parseMcpLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function parseMcpToolTimeouts(text: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of parseMcpLines(text)) {
    const at = line.lastIndexOf("=");
    const name = at > 0 ? line.slice(0, at).trim() : "";
    const seconds = at > 0 ? Number(line.slice(at + 1).trim()) : Number.NaN;
    if (!name || !Number.isInteger(seconds) || seconds <= 0) {
      throw new Error(`工具超时应写成 tool_name=秒数：${line}`);
    }
    result[name] = seconds;
  }
  return result;
}
