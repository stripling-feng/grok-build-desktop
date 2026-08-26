import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { grokBin } from "./grok-bin";
import {
  managedMarketplaceMetadata,
  managedMarketplaceName,
  managedMarketplacePath,
  marketplaceSourceIdentity,
  prepareMarketplaceSource,
  removeManagedMarketplaceFiles,
} from "./marketplace-mirror";
import { grokHome } from "./sessions";
import { currentGrokTarget, proxyEnvironmentForTarget } from "./network-settings";
import type {
  AvailablePluginInfo,
  HookInfo,
  MarketplaceInfo,
  McpServerInfo,
  PluginInfo,
  SkillInfo,
} from "./shared";

const execFileAsync = promisify(execFile);

export type GrokInspect = {
  projectTrusted: boolean;
  skills: SkillInfo[];
  mcpServers: McpServerInfo[];
  plugins: PluginInfo[];
  marketplaces: MarketplaceInfo[];
  hooks: HookInfo[];
};

export class GrokCliError extends Error {
  constructor(
    message: string,
    readonly detail = "",
  ) {
    super(message);
    this.name = "GrokCliError";
  }
}

function bin(): string {
  const found = grokBin();
  if (!found) throw new GrokCliError("未找到 Grok CLI");
  return found;
}

function extractJson(text: string): unknown {
  const start = text.search(/[\[{]/);
  if (start < 0) throw new GrokCliError("CLI 没有返回 JSON", text.trim());
  try {
    return JSON.parse(text.slice(start));
  } catch {
    throw new GrokCliError("无法解析 CLI JSON", text.trim().slice(0, 2000));
  }
}

async function run(
  args: string[],
  opts?: { cwd?: string | null; timeout?: number; json?: boolean; failOnMarketplaceSyncError?: boolean },
): Promise<string> {
  const grok = bin();
  try {
    const env = await proxyEnvironmentForTarget(currentGrokTarget());
    const { stdout, stderr } = await execFileAsync(grok, args, {
      cwd: opts?.cwd || undefined,
      windowsHide: true,
      timeout: opts?.timeout ?? 20_000,
      maxBuffer: 8 * 1024 * 1024,
      env,
    });
    const out = `${stdout ?? ""}`;
    const err = `${stderr ?? ""}`.trim();
    if (opts?.json) {
      if (
        opts.failOnMarketplaceSyncError &&
        /^\s*\[\s*\]\s*$/.test(out) &&
        /failed to sync marketplace/i.test(err)
      ) {
        throw marketplaceSyncError(err);
      }
      return out;
    }
    return err ? `${out}${out ? "\n" : ""}${err}` : out;
  } catch (err) {
    if (err instanceof GrokCliError) throw err;
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = `${e.stderr || ""} ${e.stdout || ""}`.trim() || e.message || String(err);
    throw new GrokCliError(detail.slice(0, 2000), detail);
  }
}

function marketplaceSyncError(stderr: string): GrokCliError {
  const invalidPath = stderr.match(/invalid path '([^']+)'/i)?.[1];
  if (invalidPath) {
    return new GrokCliError(
      `市场源与 Windows 不兼容：仓库包含 Windows 不允许的文件名（${invalidPath}）`,
      stderr,
    );
  }
  if (/git clone timed out/i.test(stderr)) {
    return new GrokCliError("市场源同步超时。请检查 GitHub 连接或代理后重试。", stderr);
  }
  if (/failed to connect|couldn't connect|unable to access/i.test(stderr)) {
    return new GrokCliError("无法连接市场源。请检查 GitHub 连接或代理后重试。", stderr);
  }
  const warning = stderr.match(/failed to sync marketplace[^\r\n]*/i)?.[0];
  return new GrokCliError(`市场源同步失败${warning ? `：${warning}` : ""}`, stderr);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function skillSourceLabel(source: Record<string, unknown>): string {
  const type = str(source.type).toLowerCase();
  if (type === "project" || type === "repo" || type === "local") return "项目";
  if (type === "user") return "用户";
  if (type === "plugin") return "插件";
  if (type === "bundled") return "内置";
  if (type === "claude") return "Claude";
  if (type === "cursor") return "Cursor";
  if (str(source.path)) return type || "额外";
  return type || "未知";
}

function mcpSourceLabel(server: Record<string, unknown>): string {
  const source = asRecord(server.source);
  const type = str(source.type).toLowerCase();
  const vendor = str(server.vendor).toLowerCase();
  if (type.includes("project") || type === "projecttoml") return "项目";
  if (type.includes("user") || type === "configtoml" || type === "toml") return "用户";
  if (type.includes("plugin")) return "插件";
  if (vendor === "claude" || type.includes("claude")) return "Claude";
  if (vendor === "cursor" || type.includes("cursor") || type === "mcpjson") return "Cursor";
  if (vendor) return vendor;
  return type || "未知";
}

function mapSkill(raw: unknown): SkillInfo | null {
  const o = asRecord(raw);
  const source = asRecord(o.source);
  const name = str(o.name);
  if (!name) return null;
  const filePath = str(o.path) || str(source.path);
  const invocableAs = str(o.invocableAs) || str(o.invocable_as) || `/${name}`;
  const userInvocable = o.userInvocable === undefined && o.user_invocable === undefined
    ? true
    : bool(o.userInvocable ?? o.user_invocable, true);
  return {
    name,
    description: str(o.description),
    source: skillSourceLabel(source),
    path: filePath,
    disabled: bool(o.disabled),
    userInvocable,
    invocableAs,
  };
}

function mapMcp(raw: unknown): McpServerInfo | null {
  const o = asRecord(raw);
  const name = str(o.name);
  if (!name) return null;
  const status = str(o.compatibilityStatus || o.status || o.enabled);
  const enabled = status
    ? !/disabled|off|false|skipped|blocked/i.test(status)
    : o.enabled === undefined
      ? true
      : bool(o.enabled, true);
  const transport = (str(o.transport) || "stdio").toLowerCase();
  const sourceLabel = mcpSourceLabel(o);
  const sourceType = str(asRecord(o.source).type).toLowerCase();
  const vendor = str(o.vendor).toLowerCase();
  const compat = /claude|cursor|plugin|mcpjson/.test(`${sourceType} ${vendor} ${sourceLabel}`);
  return {
    name,
    transport: transport === "http" || transport === "sse" ? transport : "stdio",
    target: str(o.target || o.command || o.url),
    source: sourceLabel,
    path: str(asRecord(o.source).path),
    vendor: str(o.vendor),
    enabled,
    status: status || (enabled ? "enabled" : "disabled"),
    native: !compat,
  };
}

function mapPlugin(raw: unknown): PluginInfo | null {
  const o = asRecord(raw);
  const name = str(o.name);
  if (!name) return null;
  const provides = asRecord(o.provides);
  return {
    name,
    scope: str(o.scope, "user"),
    path: str(o.path),
    enabled: o.enabled === undefined ? true : bool(o.enabled, true),
    skills: num(provides.skills),
    agents: num(provides.agents),
    hooks: bool(provides.hooks),
    mcpServers: num(provides.mcpServers ?? provides.mcp_servers),
  };
}

function mapMarketplace(raw: unknown): MarketplaceInfo | null {
  const o = asRecord(raw);
  const name = str(o.name);
  if (!name) return null;
  const source = asRecord(o.source);
  const registeredSource = str(source.url) || str(source.path) || str(o.url) || str(o.source);
  const managed = managedMarketplaceMetadata(registeredSource);
  return {
    name: managed?.marketplaceName || name,
    kind: managed ? "Windows 兼容镜像" : str(o.kind, "git"),
    url: managed?.originalSource || registeredSource,
    registeredSource,
  };
}

function mapAvailable(raw: unknown): AvailablePluginInfo | null {
  const o = asRecord(raw);
  const name = str(o.name);
  if (!name) return null;
  return {
    name,
    version: str(o.version) || undefined,
    description: str(o.description),
    marketplace: managedMarketplaceName(str(o.marketplace)) || str(o.marketplace),
    status: str(o.status, "available"),
    skillCount: num(o.skill_count ?? o.skillCount),
    hasHooks: bool(o.has_hooks ?? o.hasHooks),
    hasAgents: bool(o.has_agents ?? o.hasAgents),
    hasMcp: bool(o.has_mcp ?? o.hasMcp),
  };
}

function mapHook(raw: unknown): HookInfo | null {
  const o = asRecord(raw);
  const event = str(o.event || o.name || o.kind);
  const source = asRecord(o.source);
  const hooks = Array.isArray(o.hooks) ? o.hooks : [];
  const first = asRecord(hooks[0]);
  const command = str(o.command) || str(first.command) || str(first.url);
  const type = str(o.type) || str(first.type) || (command.startsWith("http") ? "http" : "command");
  if (!event && !command) return null;
  return {
    event: event || "Hook",
    matcher: str(o.matcher),
    source: str(source.type) || str(o.scope) || str(o.origin) || "未知",
    path: str(source.path) || str(o.path),
    command,
    type,
    trusted: o.trusted === undefined ? true : bool(o.trusted, true),
  };
}

function flattenHooks(raw: unknown): HookInfo[] {
  if (Array.isArray(raw)) {
    return raw.map(mapHook).filter((h): h is HookInfo => Boolean(h));
  }
  const o = asRecord(raw);
  const out: HookInfo[] = [];
  for (const [event, entries] of Object.entries(o)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const row = asRecord(entry);
      const mapped = mapHook({ ...row, event });
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

export async function inspectGrok(cwd?: string | null): Promise<GrokInspect> {
  const stdout = await run(["inspect", "--json"], { cwd, timeout: 25_000, json: true });
  const data = asRecord(extractJson(stdout));
  return {
    projectTrusted: bool(data.projectTrusted, true),
    skills: Array.isArray(data.skills)
      ? data.skills.map(mapSkill).filter((s): s is SkillInfo => Boolean(s))
      : [],
    mcpServers: Array.isArray(data.mcpServers)
      ? data.mcpServers.map(mapMcp).filter((s): s is McpServerInfo => Boolean(s))
      : [],
    plugins: Array.isArray(data.plugins)
      ? data.plugins.map(mapPlugin).filter((s): s is PluginInfo => Boolean(s))
      : [],
    marketplaces: Array.isArray(data.marketplaces)
      ? data.marketplaces.map(mapMarketplace).filter((s): s is MarketplaceInfo => Boolean(s))
      : [],
    hooks: flattenHooks(data.hooks),
  };
}

export async function listMarketplaces(): Promise<MarketplaceInfo[]> {
  const stdout = await run(["plugin", "marketplace", "list", "--json"], { json: true, timeout: 20_000 });
  const data = extractJson(stdout);
  return Array.isArray(data) ? data.map(mapMarketplace).filter((s): s is MarketplaceInfo => Boolean(s)) : [];
}

export async function listAvailablePlugins(): Promise<AvailablePluginInfo[]> {
  const stdout = await run(["plugin", "list", "--json", "--available"], {
    json: true,
    timeout: 30_000,
    failOnMarketplaceSyncError: true,
  });
  const data = extractJson(stdout);
  return Array.isArray(data)
    ? data.map(mapAvailable).filter((s): s is AvailablePluginInfo => Boolean(s))
    : [];
}

export type McpAddInput = {
  name: string;
  transport: "stdio" | "http" | "sse";
  scope: "user" | "project";
  commandOrUrl: string;
  args?: string[];
  env?: string[];
  headers?: string[];
};

export async function mcpAdd(input: McpAddInput, cwd?: string | null) {
  const args = ["mcp", "add", "--transport", input.transport, "--scope", input.scope];
  for (const env of input.env ?? []) args.push("-e", env);
  for (const header of input.headers ?? []) args.push("--header", header);
  args.push(input.name);
  if (input.transport === "stdio") {
    args.push("--", input.commandOrUrl, ...(input.args ?? []));
  } else {
    args.push(input.commandOrUrl);
  }
  await run(args, { cwd, timeout: 30_000 });
}

export async function mcpRemove(name: string, scope?: "user" | "project", cwd?: string | null) {
  const args = ["mcp", "remove", name];
  if (scope) args.splice(2, 0, "--scope", scope);
  await run(args, { cwd });
}

export async function mcpEnable(name: string, cwd?: string | null) {
  await run(["mcp", "enable", name], { cwd });
}

export async function mcpDisable(name: string, cwd?: string | null) {
  await run(["mcp", "disable", name], { cwd });
}

export async function mcpDoctor(name?: string, cwd?: string | null): Promise<string> {
  const args = ["mcp", "doctor"];
  if (name) args.push(name);
  return (await run(args, { cwd, timeout: 45_000 })).trim();
}

export async function pluginEnable(name: string, cwd?: string | null) {
  await run(["plugin", "enable", name], { cwd });
}

export async function pluginDisable(name: string, cwd?: string | null) {
  await run(["plugin", "disable", name], { cwd });
}

export async function pluginInstall(source: string, trust: boolean, cwd?: string | null) {
  const args = ["plugin", "install"];
  if (trust) args.push("--trust");
  args.push(source);
  await run(args, { cwd, timeout: 120_000 });
}

export async function pluginUninstall(name: string, cwd?: string | null) {
  await run(["plugin", "uninstall", "--confirm", name], { cwd, timeout: 60_000 });
}

export async function marketplaceAdd(url: string, cwd?: string | null) {
  const prepared = await prepareMarketplaceSource(url, cwd);
  if (prepared.kind === "local") {
    await run(["plugin", "marketplace", "add", prepared.path], { cwd, timeout: 60_000 });
    return;
  }

  const current = await listMarketplaces();
  const registered = current.find((item) => {
    try {
      return marketplaceSourceIdentity(item.url, cwd) === prepared.value.sourceIdentity;
    } catch {
      return item.url === url;
    }
  });

  const mirrorAlreadyRegistered = current.some(
    (item) => item.registeredSource && path.resolve(item.registeredSource) === path.resolve(prepared.value.localPath),
  );
  if (mirrorAlreadyRegistered) return;

  let removedSource: string | null = null;
  if (registered) {
    removedSource = registered.registeredSource || registered.url;
    await run(["plugin", "marketplace", "remove", removedSource], { cwd, timeout: 30_000 });
  }
  try {
    await run(["plugin", "marketplace", "add", prepared.value.localPath], { cwd, timeout: 60_000 });
  } catch (err) {
    if (removedSource) {
      try {
        await run(["plugin", "marketplace", "add", removedSource], { cwd, timeout: 60_000 });
      } catch {
        /* preserve the original registration when possible; report the primary error */
      }
    }
    throw err;
  }
}

export async function marketplaceRemove(url: string, cwd?: string | null) {
  const managed = managedMarketplacePath(url);
  const source = managed || url;
  await run(["plugin", "marketplace", "remove", source], { cwd, timeout: 30_000 });
  if (managed) removeManagedMarketplaceFiles(managed);
}

export function skillsDir(): string {
  return path.join(grokHome(), "skills");
}

export function hooksDir(): string {
  return path.join(grokHome(), "hooks");
}

export function agentsDir(): string {
  return path.join(grokHome(), "agents");
}

export function ensureUserSkillsDir() {
  fs.mkdirSync(skillsDir(), { recursive: true });
  return skillsDir();
}

export function ensureUserHooksDir() {
  fs.mkdirSync(hooksDir(), { recursive: true });
  return hooksDir();
}

export function ensureUserAgentsDir() {
  fs.mkdirSync(agentsDir(), { recursive: true });
  return agentsDir();
}

export function isProjectTrusted(cwd?: string | null): boolean {
  if (!cwd) return true;
  const file = path.join(grokHome(), "trusted_folders.toml");
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  const resolved = path.resolve(cwd);
  const variants = [resolved, resolved.replace(/\\/g, "/"), cwd];
  return variants.some((p) => {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\[folders\\.'${escaped}'\\][\\s\\S]*?trusted\\s*=\\s*true`, "i");
    return re.test(text);
  });
}

export function trustProject(cwd: string) {
  const file = path.join(grokHome(), "trusted_folders.toml");
  const resolved = path.resolve(cwd);
  if (isProjectTrusted(resolved)) return;
  const stamp = Math.floor(Date.now() / 1000);
  const block = `[folders.'${resolved}']\ntrusted = true\ndecided_at = ${stamp}\n`;
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trimEnd() : "";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${prev}${prev ? "\n\n" : ""}${block}\n`, "utf8");
}

export function writeUserHook(input: { name: string; event: string; matcher?: string; command: string }) {
  const dir = ensureUserHooksDir();
  const slug = input.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "") || "hook";
  const file = path.join(dir, `${slug}.json`);
  const entry: Record<string, unknown> = {
    hooks: [{ type: "command", command: input.command }],
  };
  if (input.matcher?.trim()) entry.matcher = input.matcher.trim();
  const body = {
    hooks: {
      [input.event]: [entry],
    },
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n", "utf8");
  return file;
}
