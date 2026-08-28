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
import {
  marketplaceAddArgs,
  marketplaceUpdateArgs,
  pluginDetailsArgs,
  pluginInstallArgs,
  pluginTagArgs,
  pluginUninstallArgs,
  pluginUpdateArgs,
  pluginValidateArgs,
} from "./plugin-commands";
import { applyMcpAdvancedConfig } from "./mcp-config";
import { mcpAddArgs, validateMcpAddInput } from "./mcp-commands";
import type {
  AvailablePluginInfo,
  HookInfo,
  MarketplaceInfo,
  McpAddInput,
  McpServerInfo,
  PluginInfo,
  PluginTagInput,
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

export type McpDoctorReport = {
  servers: Array<{
    name: string;
    healthy: boolean;
    checks: Array<{ label: string; passed: boolean; detail: string }>;
  }>;
  healthyCount: number;
  failingCount: number;
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
  if (type === "plugin") {
    const plugin = str(source.pluginName || source.plugin_name || source.name);
    return plugin ? `插件 · ${plugin}` : "插件";
  }
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
  const sourceLabel = skillSourceLabel(source);
  const pluginName = str(o.pluginName || o.plugin_name || source.pluginName || source.plugin_name);
  const userInvocable = o.userInvocable === undefined && o.user_invocable === undefined
    ? true
    : bool(o.userInvocable ?? o.user_invocable, true);
  return {
    id: `${pluginName || sourceLabel}:${filePath || name}:${name}`,
    name,
    displayName: str(o.displayName || o.display_name) || undefined,
    description: str(o.description),
    source: sourceLabel,
    scope: str(o.scope || source.type) || undefined,
    path: filePath,
    disabled: bool(o.disabled),
    userInvocable,
    invocableAs,
    collidesWith: str(o.collidesWith || o.collides_with) || undefined,
    pluginName: pluginName || undefined,
  };
}

export function mapRuntimeSkill(raw: unknown): SkillInfo | null {
  const o = asRecord(raw);
  const name = str(o.name);
  if (!name) return null;
  const scope = str(o.scope).toLowerCase();
  const pluginName = str(o.pluginName || o.plugin_name);
  const filePath = str(o.path);
  const source = pluginName
    ? `插件 · ${pluginName}`
    : ({ local: "当前目录", repo: "仓库", user: "用户", server: "托管", bundled: "内置", plugin: "插件" } as Record<string, string>)[scope]
      || scope
      || "未知";
  const metadataRaw = asRecord(o.metadata);
  const metadata = Object.fromEntries(
    Object.entries(metadataRaw).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const enabled = o.enabled === undefined ? true : bool(o.enabled, true);
  const allowedToolsRaw = o.allowedTools ?? o.allowed_tools;
  return {
    id: `${pluginName || scope || source}:${filePath || name}:${name}`,
    name,
    displayName: str(o.displayName || o.display_name) || undefined,
    description: str(o.description),
    source,
    scope: scope || undefined,
    path: filePath,
    disabled: !enabled,
    userInvocable: o.userInvocable === undefined && o.user_invocable === undefined
      ? true
      : bool(o.userInvocable ?? o.user_invocable, true),
    invocableAs: `/${name}`,
    whenToUse: str(o.whenToUse || o.when_to_use) || undefined,
    shortDescription: str(o.shortDescription || o.short_description) || undefined,
    author: str(o.author) || undefined,
    argumentHint: str(o.argumentHint || o.argument_hint) || undefined,
    license: str(o.license) || undefined,
    compatibility: str(o.compatibility) || undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined,
    allowedTools: Array.isArray(allowedToolsRaw)
      ? allowedToolsRaw.filter((value): value is string => typeof value === "string")
      : undefined,
    model: str(o.model) || undefined,
    effort: str(o.effort) || undefined,
    disableModelInvocation: bool(o.disableModelInvocation ?? o.disable_model_invocation),
    pluginName: pluginName || undefined,
    pluginVersion: str(o.pluginVersion || o.plugin_version) || undefined,
    paths: Array.isArray(o.paths) ? o.paths.filter((value): value is string => typeof value === "string") : undefined,
  };
}

function sameSkill(left: SkillInfo, right: SkillInfo): boolean {
  if (left.path && right.path) {
    return path.resolve(left.path).toLowerCase() === path.resolve(right.path).toLowerCase();
  }
  return left.name.toLowerCase() === right.name.toLowerCase()
    && (left.pluginName || left.source).toLowerCase() === (right.pluginName || right.source).toLowerCase();
}

export function mergeSkillCatalog(runtime: SkillInfo[], inspected: SkillInfo[]): SkillInfo[] {
  const merged = runtime.map((skill) => {
    const detail = inspected.find((item) => sameSkill(skill, item));
    return detail
      ? {
          ...skill,
          disabled: skill.disabled || detail.disabled,
          collidesWith: detail.collidesWith,
          invocableAs: detail.invocableAs || skill.invocableAs,
          source: detail.source || skill.source,
        }
      : skill;
  });
  for (const skill of inspected) {
    if (!merged.some((item) => sameSkill(item, skill))) merged.push(skill);
  }
  return merged;
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

export function mapMcpCatalog(raw: unknown, fallback: McpServerInfo[] = []): McpServerInfo[] {
  const envelope = asRecord(raw);
  const nestedResult = asRecord(envelope.result);
  const data = Array.isArray(nestedResult.servers) ? nestedResult : envelope;
  const rows = Array.isArray(data.servers) ? data.servers : [];
  const mapped: McpServerInfo[] = [];
  for (const entry of rows) {
    const o = asRecord(entry);
    const name = str(o.name);
    if (!name) continue;
    const session = asRecord(o.session);
    const existing = fallback.find((item) => item.name === name);
    const type = str(o.type).toLowerCase();
    const sourceLabel = str(o.sourceLabel || o.source_label);
    const rawSource = str(o.source);
    const source = sourceLabel
      ? sourceLabel.replace(/^plugin:\s*/i, "插件 · ")
      : rawSource === "managed" ? "托管" : existing?.source || "用户";
    const tools: NonNullable<McpServerInfo["tools"]> = [];
    for (const tool of Array.isArray(session.tools) ? session.tools : []) {
      const row = asRecord(tool);
      const toolName = str(row.name);
      if (!toolName) continue;
      tools.push({
        name: toolName,
        displayName: str(row.displayName || row.display_name) || undefined,
        description: str(row.description) || undefined,
        enabled: row.enabled === undefined ? true : bool(row.enabled, true),
      });
    }
    const reportedStatus = str(session.status || session.state);
    const reportedError = str(
      session.error_message ||
      session.errorMessage ||
      asRecord(session.error).message ||
      session.error ||
      o.error_message ||
      o.errorMessage ||
      asRecord(o.error).message ||
      o.error,
    );
    const authRequired = bool(session.authRequired ?? session.auth_required) ||
      /(?:oauth|authorization|authentication|auth).{0,24}(?:required|needed)|needs?.{0,12}(?:oauth|auth)|unauthorized|需要认证|未认证|\b401\b/i
        .test(`${reportedStatus} ${reportedError}`);
    const status = reportedStatus || (authRequired ? "needs auth" : existing?.status || "unavailable");
    const transport = type === "http"
      ? existing?.transport === "sse" ? "sse" : "http"
      : type === "stdio" ? "stdio" : existing?.transport || type || "http";
    const env: { name: string; value: string }[] = [];
    for (const value of Array.isArray(o.env) ? o.env : []) {
      const row = asRecord(value);
      const envName = str(row.name);
      if (envName) env.push({ name: envName, value: str(row.value) });
    }
    const setupRaw = asRecord(o.setup);
    const setupFields: NonNullable<McpServerInfo["setup"]>["fields"] = [];
    for (const field of Array.isArray(setupRaw.fields) ? setupRaw.fields : []) {
      const row = asRecord(field);
      const id = str(row.id);
      if (!id) continue;
      const options: { label: string; value: string }[] = [];
      for (const option of Array.isArray(row.options) ? row.options : []) {
        const value = asRecord(option);
        const optionValue = str(value.value);
        if (optionValue) options.push({ label: str(value.label) || optionValue, value: optionValue });
      }
      setupFields.push({
        id,
        label: str(row.label) || id,
        type: str(row.type) || "select",
        required: bool(row.required),
        default: str(row.default) || undefined,
        options,
      });
    }
    const setupValues = Object.fromEntries(
      Object.entries(asRecord(o.setupValues || o.setup_values))
        .filter((item): item is [string, string] => typeof item[1] === "string"),
    );
    mapped.push({
      name,
      displayName: str(o.displayName || o.display_name) || undefined,
      transport,
      target: str(o.command || o.url) || existing?.target || "",
      source,
      path: existing?.path || "",
      vendor: existing?.vendor || "",
      enabled: session.enabled === undefined ? existing?.enabled ?? true : bool(session.enabled, true),
      status,
      native: existing?.native ?? !/^插件|托管/i.test(source),
      live: Boolean(o.session),
      toolCount: tools.length,
      tools,
      authRequired,
      setupRequired: bool(session.setupRequired ?? session.setup_required),
      setup: setupFields.length ? { fields: setupFields } : undefined,
      setupValues,
      args: Array.isArray(o.args) ? o.args.filter((value): value is string => typeof value === "string") : undefined,
      env: env.length ? env : undefined,
    });
  }
  for (const item of fallback) {
    if (!mapped.some((row) => row.name === item.name)) mapped.push(item);
  }
  return mapped;
}

function mapPlugin(raw: unknown): PluginInfo | null {
  const o = asRecord(raw);
  const name = str(o.name);
  if (!name) return null;
  const provides = asRecord(o.provides);
  const pluginPath = str(o.path);
  return {
    name,
    version: str(o.version) || undefined,
    description: str(o.description) || readInstalledPluginDescription(pluginPath) || undefined,
    scope: str(o.scope, "user"),
    path: pluginPath,
    enabled: o.enabled === undefined ? true : bool(o.enabled, true),
    skills: num(provides.skills),
    agents: num(provides.agents),
    hooks: bool(provides.hooks),
    mcpServers: num(provides.mcpServers ?? provides.mcp_servers),
    commands: num(provides.commands ?? provides.slashCommands ?? provides.slash_commands),
    lspServers: num(provides.lspServers ?? provides.lsp_servers ?? provides.lsps),
  };
}

function readInstalledPluginDescription(pluginPath: string): string {
  if (!pluginPath) return "";
  const manifests = [
    path.join(pluginPath, ".grok-plugin", "plugin.json"),
    path.join(pluginPath, ".claude-plugin", "plugin.json"),
    path.join(pluginPath, ".codex-plugin", "plugin.json"),
    path.join(pluginPath, ".cursor-plugin", "plugin.json"),
    path.join(pluginPath, ".github", "plugin", "plugin.json"),
    path.join(pluginPath, "plugin.json"),
    path.join(pluginPath, "package.json"),
  ];
  for (const manifest of manifests) {
    try {
      if (!fs.existsSync(manifest)) continue;
      const data = asRecord(JSON.parse(fs.readFileSync(manifest, "utf8")));
      const description = str(data.description);
      if (description) return description;
    } catch {
      /* Try the next supported plugin manifest. */
    }
  }
  return "";
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
    commandCount: num(o.command_count ?? o.commandCount),
    hasLsp: bool(o.has_lsp ?? o.hasLsp),
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

export async function mcpAdd(input: McpAddInput, cwd?: string | null) {
  const checked = validateMcpAddInput(input, cwd);
  await run(mcpAddArgs(checked), { cwd, timeout: 30_000 });
  applyMcpAdvancedConfig(checked, cwd);
}

export async function mcpRemove(name: string, scope?: "user" | "project", cwd?: string | null) {
  if (scope === "project" && !cwd?.trim()) throw new GrokCliError("删除项目级 MCP 前请先选择项目");
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

export function parseMcpDoctorReport(raw: unknown): McpDoctorReport {
  const data = asRecord(raw);
  const servers = (Array.isArray(data.servers) ? data.servers : []).flatMap((value) => {
    const server = asRecord(value);
    const name = str(server.name);
    if (!name) return [];
    const checks = (Array.isArray(server.checks) ? server.checks : []).flatMap((item) => {
      const check = asRecord(item);
      const label = str(check.label);
      return label ? [{ label, passed: bool(check.passed), detail: str(check.detail) }] : [];
    });
    return [{ name, healthy: bool(server.healthy), checks }];
  });
  return {
    servers,
    healthyCount: num(data.healthy_count ?? data.healthyCount),
    failingCount: num(data.failing_count ?? data.failingCount),
  };
}

export async function mcpDoctorReport(name?: string, cwd?: string | null): Promise<McpDoctorReport> {
  const args = ["mcp", "doctor"];
  if (name) args.push(name);
  args.push("--json");
  try {
    const stdout = await run(args, { cwd, timeout: 120_000, json: true });
    return parseMcpDoctorReport(extractJson(stdout));
  } catch (err) {
    if (!(err instanceof GrokCliError) || !err.detail) throw err;
    try {
      return parseMcpDoctorReport(extractJson(err.detail));
    } catch {
      throw err;
    }
  }
}

export async function pluginEnable(name: string, cwd?: string | null) {
  await run(["plugin", "enable", name], { cwd });
}

export async function pluginDisable(name: string, cwd?: string | null) {
  await run(["plugin", "disable", name], { cwd });
}

export async function pluginInstall(source: string, trust: boolean, cwd?: string | null) {
  await run(pluginInstallArgs(source, trust), { cwd, timeout: 120_000 });
}

export async function pluginUninstall(name: string, keepData: boolean, cwd?: string | null) {
  await run(pluginUninstallArgs(name, keepData), { cwd, timeout: 60_000 });
}

export async function pluginUpdate(name?: string, cwd?: string | null) {
  await run(pluginUpdateArgs(name), { cwd, timeout: 180_000 });
}

export async function pluginDetails(name: string, cwd?: string | null): Promise<string> {
  return (await run(pluginDetailsArgs(name), { cwd, timeout: 30_000 })).trim();
}

export async function pluginValidate(targetPath?: string, cwd?: string | null): Promise<string> {
  return (await run(pluginValidateArgs(targetPath), { cwd, timeout: 60_000 })).trim();
}

export async function pluginTag(input: PluginTagInput, cwd?: string | null): Promise<string> {
  return (await run(pluginTagArgs(input), { cwd, timeout: input.push ? 120_000 : 60_000 })).trim();
}

export async function marketplaceAdd(url: string, cwd?: string | null, force = false) {
  const prepared = await prepareMarketplaceSource(url, cwd);
  if (prepared.kind === "local") {
    await run(marketplaceAddArgs(prepared.path, force), { cwd, timeout: 60_000 });
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
    await run(marketplaceAddArgs(prepared.value.localPath, force), { cwd, timeout: 60_000 });
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

export async function marketplaceUpdate(source?: string, cwd?: string | null) {
  const current = await listMarketplaces();
  if (!source?.trim()) {
    for (const item of current) {
      const registered = item.registeredSource || item.url || item.name;
      if (managedMarketplaceMetadata(registered)) await marketplaceAdd(item.url, cwd);
    }
    await run(marketplaceUpdateArgs(), { cwd, timeout: 180_000 });
    return;
  }

  const targets = source?.trim()
    ? current.filter((item) => {
        const value = source.trim();
        return item.name === value || item.url === value || item.registeredSource === value;
      })
    : current;

  if (source?.trim() && targets.length === 0) {
    await run(marketplaceUpdateArgs(source), { cwd, timeout: 180_000 });
    return;
  }

  for (const item of targets) {
    const registered = item.registeredSource || item.url || item.name;
    if (managedMarketplaceMetadata(registered)) {
      await marketplaceAdd(item.url, cwd);
    } else {
      await run(marketplaceUpdateArgs(item.name), { cwd, timeout: 180_000 });
    }
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
