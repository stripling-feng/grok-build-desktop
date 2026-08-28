import fs from "node:fs";
import path from "node:path";
import type { McpAddInput } from "./shared";
import { grokHome } from "./sessions";

const ADVANCED_KEYS = [
  "cwd",
  "bearer_token_env_var",
  "oauth_client_id",
  "oauth_client_secret_env_var",
  "oauth_scopes",
  "startup_timeout_sec",
  "tool_timeout_sec",
  "tool_timeouts",
  "expose_image_base64",
] as const;

function decodeTomlKey(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function tableBounds(text: string, serverName: string): { start: number; bodyStart: number; end: number } | null {
  const re = /^\s*\[\s*mcp_servers\.(.+?)\s*\]\s*(?:#.*)?$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (decodeTomlKey(match[1]) !== serverName) continue;
    const bodyStart = match.index + match[0].length;
    const tail = text.slice(bodyStart);
    const next = /^\s*\[\[?.+?\]\]?\s*(?:#.*)?$/m.exec(tail);
    return { start: match.index, bodyStart, end: next ? bodyStart + next.index : text.length };
  }
  return null;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlInlineTimeouts(values: Record<string, number>): string {
  return `{ ${Object.entries(values).map(([name, seconds]) => `${tomlString(name)} = ${seconds}`).join(", ")} }`;
}

function advancedValues(input: McpAddInput): Partial<Record<(typeof ADVANCED_KEYS)[number], string>> {
  const result: Partial<Record<(typeof ADVANCED_KEYS)[number], string>> = {};
  if (input.transport === "stdio" && input.serverCwd?.trim()) result.cwd = tomlString(input.serverCwd.trim());
  if (input.transport !== "stdio") {
    if (input.bearerTokenEnvVar?.trim()) result.bearer_token_env_var = tomlString(input.bearerTokenEnvVar.trim());
    if (input.oauthClientId?.trim()) result.oauth_client_id = tomlString(input.oauthClientId.trim());
    if (input.oauthClientSecretEnvVar?.trim()) {
      result.oauth_client_secret_env_var = tomlString(input.oauthClientSecretEnvVar.trim());
    }
    const scopes = (input.oauthScopes ?? []).map((value) => value.trim()).filter(Boolean);
    if (scopes.length) result.oauth_scopes = tomlStringArray(scopes);
  }
  if (input.startupTimeoutSec) result.startup_timeout_sec = String(input.startupTimeoutSec);
  if (input.toolTimeoutSec) result.tool_timeout_sec = String(input.toolTimeoutSec);
  if (Object.keys(input.toolTimeouts ?? {}).length) result.tool_timeouts = tomlInlineTimeouts(input.toolTimeouts!);
  if (input.exposeImageBase64) result.expose_image_base64 = "true";
  return result;
}

export function patchMcpAdvancedConfig(text: string, serverName: string, input: McpAddInput): string {
  const bounds = tableBounds(text, serverName);
  if (!bounds) throw new Error(`没有在 config.toml 中找到 MCP：${serverName}`);
  const values = advancedValues(input);
  const header = text.slice(bounds.start, bounds.bodyStart);
  let body = text.slice(bounds.bodyStart, bounds.end);
  for (const key of ADVANCED_KEYS) {
    const line = new RegExp(`^\\s*${key}\\s*=.*(?:\\r?\\n|$)`, "m");
    body = body.replace(line, "");
  }
  const lines = ADVANCED_KEYS.flatMap((key) => values[key] === undefined ? [] : [`${key} = ${values[key]}`]);
  if (lines.length) body = `${body.replace(/^\r?\n/, "").trimEnd()}${body.trim() ? "\n" : ""}${lines.join("\n")}\n`;
  else body = body.replace(/^\r?\n/, "");
  return `${text.slice(0, bounds.start)}${header}\n${body}${text.slice(bounds.end)}`;
}

export function mcpConfigPath(scope: "user" | "project", cwd?: string | null): string {
  if (scope === "user") return path.join(grokHome(), "config.toml");
  if (!cwd?.trim()) throw new Error("项目级 MCP 需要先选择项目");
  return path.join(path.resolve(cwd), ".grok", "config.toml");
}

export function applyMcpAdvancedConfig(input: McpAddInput, cwd?: string | null): string {
  const file = mcpConfigPath(input.scope, cwd);
  if (!fs.existsSync(file)) throw new Error(`MCP 配置文件不存在：${file}`);
  const before = fs.readFileSync(file, "utf8");
  const after = patchMcpAdvancedConfig(before, input.name, input);
  if (after !== before) fs.writeFileSync(file, after.endsWith("\n") ? after : `${after}\n`, "utf8");
  return file;
}
