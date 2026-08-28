import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AppSettings, PermissionMode, ReasoningEffort, SkillInfo, SubagentTypeInfo } from "./shared";
import { grokHome } from "./sessions";
import { findGitRoot } from "./git";
import { grokBin as resolveGrokBin } from "./grok-bin";
import { inspectGrok, isProjectTrusted, listMarketplaces } from "./grok-cli";
import { modelsFromCachePayload, type ModelCatalogEntry } from "./model-catalog";
import { currentGrokTarget, proxyEnvironmentForTarget } from "./network-settings";
import { attachPluginRuntimeDependencies } from "./runtime-dependencies";

const execFileAsync = promisify(execFile);

export function configPath(): string {
  return path.join(grokHome(), "config.toml");
}

export function grokBin(): string | null {
  return resolveGrokBin();
}

function readText(): string {
  const file = configPath();
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function writeText(text: string) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n", "utf8");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tableBlock(text: string, table: string): { start: number; end: number; body: string } | null {
  const re = new RegExp(`^\\[${escapeRegExp(table)}\\][ \\t]*$`, "m");
  const match = re.exec(text);
  if (!match || match.index < 0) return null;
  const start = match.index;
  const after = start + match[0].length;
  const next = text.slice(after).search(/\n\[/);
  const end = next < 0 ? text.length : after + next;
  return { start, end, body: text.slice(start, end) };
}

function keyLineRe(key: string) {
  return new RegExp(`^"?${escapeRegExp(key)}"?\\s*=\\s*.*$`, "m");
}

export function setTableKey(text: string, table: string, key: string, rawValue: string): string {
  const line = `${key} = ${rawValue}`;
  const block = tableBlock(text, table);
  if (!block) {
    const prefix = text.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}[${table}]\n${line}\n`;
  }
  const keyRe = keyLineRe(key);
  const nextBody = keyRe.test(block.body)
    ? block.body.replace(keyRe, line)
    : `${block.body.trimEnd()}\n${line}\n`;
  return text.slice(0, block.start) + nextBody + text.slice(block.end);
}

function deleteTableKey(text: string, table: string, key: string): string {
  const block = tableBlock(text, table);
  if (!block) return text;
  const nextBody = block.body.replace(keyLineRe(key), "").replace(/\n{3,}/g, "\n\n");
  return text.slice(0, block.start) + nextBody + text.slice(block.end);
}

function readKey(text: string, table: string, key: string): string | null {
  const block = tableBlock(text, table);
  if (!block) return null;
  const m = block.body.match(new RegExp(`^"?${escapeRegExp(key)}"?\\s*=\\s*(.*)$`, "m"));
  if (!m) return null;
  return m[1].trim().replace(/^"|"$/g, "");
}

function readStringArray(text: string, table: string, key: string): string[] {
  const block = tableBlock(text, table);
  if (!block) return [];
  const m = block.body.match(new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m"));
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

export function getPermissionMode(text = readText()): PermissionMode {
  const raw = (readKey(text, "ui", "permission_mode") || "ask").toLowerCase();
  if (raw === "always-approve" || raw === "bypasspermissions") return "always-approve";
  if (raw === "auto") return "auto";
  return "ask";
}

function readBool(text: string, table: string, key: string): boolean | null {
  const raw = (readKey(text, table, key) || "").toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return null;
}

export function isBrowserControlServer(name: string) {
  return /^(browser|playwright|chrome|puppeteer)$/i.test(name) || /playwright|puppeteer/i.test(name);
}

export function isComputerControlServer(name: string) {
  return /computer/i.test(name);
}

export function getBrowserControl(text = readText()): boolean | null {
  return readBool(text, "ui", "browser_control");
}

export function getComputerControl(text = readText()): boolean | null {
  return readBool(text, "ui", "computer_control");
}

export function setBrowserControl(enabled: boolean) {
  writeText(setTableKey(readText(), "ui", "browser_control", enabled ? "true" : "false"));
}

export function setComputerControl(enabled: boolean) {
  writeText(setTableKey(readText(), "ui", "computer_control", enabled ? "true" : "false"));
}

export const BUILTIN_SUBAGENT_TYPES: { id: string; name: string; description: string }[] = [
  { id: "general-purpose", name: "通用", description: "完整工具集，适合实现、改文件、跑命令" },
  { id: "explore", name: "探索", description: "只读调研：搜索、阅读、命令，不改文件" },
  { id: "plan", name: "规划", description: "产出实现计划，不改文件" },
];

export function getSubagentsEnabled(text = readText()): boolean {
  return readBool(text, "subagents", "enabled") !== false;
}

export function setSubagentsEnabled(enabled: boolean) {
  writeText(setTableKey(readText(), "subagents", "enabled", enabled ? "true" : "false"));
}

export function setSubagentTypeEnabled(id: string, enabled: boolean) {
  writeText(setTableKey(readText(), "subagents.toggle", id, enabled ? "true" : "false"));
}

export function setSubagentTypeModel(id: string, model: string | null) {
  const text = readText();
  writeText(
    model
      ? setTableKey(text, "subagents.models", id, JSON.stringify(model))
      : deleteTableKey(text, "subagents.models", id),
  );
}

function walkAgentDir(dir: string, source: string, out: SubagentTypeInfo[]) {
  if (!fs.existsSync(dir)) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const skill = path.join(full, "SKILL.md");
      const agent = path.join(full, "AGENT.md");
      const md = fs.existsSync(skill) ? skill : fs.existsSync(agent) ? agent : null;
      if (md) readAgentFile(md, source, out);
      else walkAgentDir(full, source, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!/\.(md|toml)$/i.test(ent.name)) continue;
    readAgentFile(full, source, out);
  }
}

function readAgentFile(file: string, source: string, out: SubagentTypeInfo[]) {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const base = path.basename(file).replace(/\.(md|toml)$/i, "");
  const id =
    raw.match(/^\s*name\s*[:=]\s*["']?([^"'\n]+)/m)?.[1]?.trim() ||
    base;
  if (!id) return;
  const description =
    raw.match(/^\s*description\s*[:=]\s*["']?([^"'\n]+)/m)?.[1]?.trim() || "";
  out.push({
    id,
    name: id,
    description,
    builtin: false,
    enabled: true,
    model: null,
    source,
    path: file,
  });
}

export async function listSubagentTypes(cwd?: string | null): Promise<SubagentTypeInfo[]> {
  const text = readText();
  const custom: SubagentTypeInfo[] = [];
  const gitRoot = cwd ? await findGitRoot(cwd) : null;
  const dirs: { dir: string; source: string }[] = [];
  if (cwd) dirs.push({ dir: path.join(cwd, ".grok", "agents"), source: "项目" });
  if (gitRoot && gitRoot !== cwd) dirs.push({ dir: path.join(gitRoot, ".grok", "agents"), source: "仓库" });
  dirs.push({ dir: path.join(grokHome(), "agents"), source: "用户" });
  for (const { dir, source } of dirs) walkAgentDir(dir, source, custom);

  const byId = new Map<string, SubagentTypeInfo>();
  for (const builtin of BUILTIN_SUBAGENT_TYPES) {
    byId.set(builtin.id, {
      id: builtin.id,
      name: builtin.name,
      description: builtin.description,
      builtin: true,
      enabled: readBool(text, "subagents.toggle", builtin.id) !== false,
      model: readKey(text, "subagents.models", builtin.id),
    });
  }
  for (const agent of custom) {
    const existing = byId.get(agent.id);
    byId.set(agent.id, {
      ...agent,
      name: existing?.builtin ? existing.name : agent.name,
      description: agent.description || existing?.description || "",
      builtin: existing?.builtin ?? false,
      enabled: readBool(text, "subagents.toggle", agent.id) !== false,
      model: readKey(text, "subagents.models", agent.id),
    });
  }
  return [...byId.values()];
}

export function getDefaultModel(text = readText()): string {
  return readKey(text, "models", "default") || "grok-4.6";
}

export function getDefaultReasoningEffort(text = readText()): ReasoningEffort {
  const raw = (readKey(text, "models", "default_reasoning_effort") || "high").toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh") return raw;
  if (raw === "extra-high" || raw === "extra_high" || raw === "max") return "xhigh";
  return "high";
}

export function sessionMeta(extraRules: string[] = []): Record<string, unknown> {
  const mode = getPermissionMode();
  const rules = extraRules.map((rule) => rule.trim()).filter(Boolean);
  const meta: Record<string, unknown> = {};
  if (rules.length > 0) meta.rules = rules.join("\n");
  if (mode === "always-approve") meta.yoloMode = true;
  if (mode === "auto") meta.autoMode = true;
  return Object.keys(meta).length > 0 ? { _meta: meta } : {};
}

export function getDefaultModelDisplayName(text = readText()): string {
  const id = getDefaultModel(text);
  const named = modelNamesFromConfig(text).find((m) => m.id === id);
  return named?.name || id;
}

function modelNamesFromConfig(text: string): { id: string; name: string; contextWindow?: number }[] {
  const models: { id: string; name: string; contextWindow?: number }[] = [];
  const re = /\[model\.("?)([^"\]]+)\1\]([\s\S]*?)(?=\n\[|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = m[2];
    const name = m[3].match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] || id;
    const windowRaw = m[3].match(/^\s*context_window\s*=\s*(\d+)/m)?.[1];
    const contextWindow = windowRaw ? Number(windowRaw) : undefined;
    models.push({
      id,
      name,
      contextWindow: contextWindow && Number.isFinite(contextWindow) ? contextWindow : undefined,
    });
  }
  return models;
}

function modelsFromCache(): ModelCatalogEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(grokHome(), "models_cache.json"), "utf8"));
    return modelsFromCachePayload(raw);
  } catch {
    return [];
  }
}

async function modelsFromCli(): Promise<string[]> {
  const bin = grokBin();
  if (!bin) return [];
  try {
    const env = await proxyEnvironmentForTarget(currentGrokTarget());
    const { stdout } = await execFileAsync(bin, ["models"], {
      windowsHide: true,
      timeout: 12_000,
      env,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, "").replace(/\s+\(default\)\s*$/, "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseFrontmatter(md: string): { name?: string; description?: string } {
  if (!md.startsWith("---")) return {};
  const end = md.indexOf("\n---", 3);
  if (end < 0) return {};
  const yaml = md.slice(3, end);
  const name = yaml.match(/^\s*name\s*:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const description = yaml
    .match(/^\s*description\s*:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return { name, description };
}

function pathIsIgnored(file: string, ignored: string[]): boolean {
  const absolute = path.resolve(file);
  return ignored.some((entry) => {
    const relative = path.relative(entry, absolute);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function fallbackSkill(meta: { name?: string; description?: string }, file: string, source: string): SkillInfo {
  const name = meta.name || path.basename(path.dirname(file)) || path.parse(file).name;
  return {
    id: `${source}:${file}:${name}`,
    name,
    description: meta.description || "",
    source,
    path: file,
    disabled: false,
    userInvocable: true,
    invocableAs: `/${name}`,
  };
}

function walkSkillDir(dir: string, source: string, out: SkillInfo[], ignored: string[]) {
  if (!fs.existsSync(dir)) return;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    if (pathIsIgnored(cur, ignored)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (pathIsIgnored(full, ignored)) continue;
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.toLowerCase() === "skill.md") {
        let md = "";
        try {
          md = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        const meta = parseFrontmatter(md);
        out.push(fallbackSkill(meta, full, source));
      }
    }
  }
}

function walkCommandDir(dir: string, source: string, out: SkillInfo[], ignored: string[]) {
  if (!fs.existsSync(dir)) return;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    if (pathIsIgnored(cur, ignored)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (pathIsIgnored(full, ignored)) continue;
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && /\.md$/i.test(entry.name) && entry.name.toLowerCase() !== "skill.md") {
        let md = "";
        try {
          md = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        const meta = parseFrontmatter(md);
        out.push(fallbackSkill({ ...meta, name: meta.name || path.parse(entry.name).name }, full, source));
      }
    }
  }
}

function expandSkillPath(value: string): string {
  return path.resolve(value.replace(/^~(?=[\\/]|$)/, os.homedir()));
}

function directoryChain(cwd: string, gitRoot: string | null): string[] {
  const current = path.resolve(cwd);
  const root = path.resolve(gitRoot || cwd);
  const relative = path.relative(root, current);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return [current];
  const result: string[] = [];
  let cursor = current;
  for (;;) {
    result.push(cursor);
    if (cursor.toLowerCase() === root.toLowerCase()) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return result;
}

export async function listSkills(cwd?: string | null): Promise<SkillInfo[]> {
  const text = readText();
  const disabled = new Set(readStringArray(text, "skills", "disabled").map((s) => s.toLowerCase()));
  const ignored = readStringArray(text, "skills", "ignore").map(expandSkillPath);
  const found: SkillInfo[] = [];
  const gitRoot = cwd ? await findGitRoot(cwd) : null;
  const dirs: { dir: string; source: string; kind: "skills" | "commands" }[] = [];
  const claudeEnabled = readBool(text, "compat.claude", "skills") !== false && process.env.GROK_CLAUDE_SKILLS_ENABLED !== "false";
  const cursorEnabled = readBool(text, "compat.cursor", "skills") !== false && process.env.GROK_CURSOR_SKILLS_ENABLED !== "false";
  for (const base of cwd ? directoryChain(cwd, gitRoot) : []) {
    const source = gitRoot && path.resolve(base).toLowerCase() === path.resolve(gitRoot).toLowerCase() ? "仓库" : "项目";
    for (const vendor of [".grok", ".agents"]) {
      dirs.push({ dir: path.join(base, vendor, "skills"), source, kind: "skills" });
      dirs.push({ dir: path.join(base, vendor, "commands"), source, kind: "commands" });
    }
    if (claudeEnabled) {
      dirs.push({ dir: path.join(base, ".claude", "skills"), source: "Claude", kind: "skills" });
      dirs.push({ dir: path.join(base, ".claude", "commands"), source: "Claude", kind: "commands" });
    }
    if (cursorEnabled) dirs.push({ dir: path.join(base, ".cursor", "skills"), source: "Cursor", kind: "skills" });
  }
  dirs.push({ dir: path.join(grokHome(), "skills"), source: "用户", kind: "skills" });
  dirs.push({ dir: path.join(grokHome(), "commands"), source: "用户", kind: "commands" });
  dirs.push({ dir: path.join(grokHome(), "server-skills"), source: "托管", kind: "skills" });
  for (const vendor of [".agents", ...(claudeEnabled ? [".claude"] : [])]) {
    dirs.push({ dir: path.join(os.homedir(), vendor, "skills"), source: vendor === ".claude" ? "Claude" : "用户", kind: "skills" });
    dirs.push({ dir: path.join(os.homedir(), vendor, "commands"), source: vendor === ".claude" ? "Claude" : "用户", kind: "commands" });
  }
  if (cursorEnabled) dirs.push({ dir: path.join(os.homedir(), ".cursor", "skills"), source: "Cursor", kind: "skills" });
  for (const extra of readStringArray(text, "skills", "paths")) {
    const expanded = expandSkillPath(extra);
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      if (!pathIsIgnored(expanded, ignored) && path.basename(expanded).toLowerCase() === "skill.md") {
        try {
          found.push(fallbackSkill(parseFrontmatter(fs.readFileSync(expanded, "utf8")), expanded, "额外"));
        } catch {
          // Ignore unreadable compatibility paths.
        }
      }
    } else dirs.push({ dir: expanded, source: "额外", kind: "skills" });
  }
  for (const { dir, source, kind } of dirs) {
    if (kind === "commands") walkCommandDir(dir, source, found, ignored);
    else walkSkillDir(dir, source, found, ignored);
  }
  const byPath = new Map<string, SkillInfo>();
  for (const skill of found) {
    const key = (skill.path || skill.id).toLowerCase();
    if (!byPath.has(key)) byPath.set(key, skill);
  }
  return [...byPath.values()].map((s) => ({
    ...s,
    disabled: disabled.has(s.name.toLowerCase()),
  }));
}

export async function loadSettings(
  cwd?: string | null,
  opts?: { skipCli?: boolean },
): Promise<AppSettings> {
  const text = readText();
  const fromConfig = modelNamesFromConfig(text);
  const fromCache = modelsFromCache();
  const fromCli = opts?.skipCli ? [] : await modelsFromCli();
  const byId = new Map<string, { id: string; name: string; contextWindow?: number }>();
  for (const model of fromCache) byId.set(model.id, model);
  for (const id of fromCli) {
    const cached = byId.get(id);
    byId.set(id, cached ?? { id, name: id });
  }
  for (const model of fromConfig) {
    const cached = byId.get(model.id);
    byId.set(model.id, {
      ...cached,
      ...model,
      contextWindow: model.contextWindow ?? cached?.contextWindow,
    });
  }
  if (byId.size === 0) {
    byId.set("grok-4.6", { id: "grok-4.6", name: "grok-4.6" });
    byId.set("grok-4.5", { id: "grok-4.5", name: "grok-4.5" });
  }
  const model = getDefaultModel(text);
  if (!byId.has(model)) byId.set(model, { id: model, name: model });
  const scanned = await listSkills(cwd);
  let skills = scanned;
  let mcpServers: AppSettings["mcpServers"] = [];
  let plugins: AppSettings["plugins"] = [];
  let marketplaces: AppSettings["marketplaces"] = [];
  let availablePlugins: AppSettings["availablePlugins"] = [];
  let hooks: AppSettings["hooks"] = [];
  let projectTrusted = isProjectTrusted(cwd);
  let inspectError: string | undefined;
  try {
    const inspected = await inspectGrok(cwd);
    projectTrusted = inspected.projectTrusted;
    mcpServers = inspected.mcpServers;
    plugins = attachPluginRuntimeDependencies(inspected.plugins, inspected.mcpServers);
    hooks = inspected.hooks;
    if (inspected.skills.length) {
      const disabled = new Set(scanned.filter((s) => s.disabled).map((s) => s.name.toLowerCase()));
      const unusedScanned = [...scanned];
      skills = inspected.skills.map((skill) => {
        const index = unusedScanned.findIndex((local) =>
          skill.path && local.path
            ? path.resolve(skill.path).toLowerCase() === path.resolve(local.path).toLowerCase()
            : skill.name.toLowerCase() === local.name.toLowerCase(),
        );
        const local = index >= 0 ? unusedScanned.splice(index, 1)[0] : undefined;
        const key = skill.name.toLowerCase();
        return {
          ...skill,
          path: skill.path || local?.path || "",
          disabled: skill.disabled || disabled.has(key),
          userInvocable: skill.userInvocable ?? local?.userInvocable ?? true,
          invocableAs: skill.invocableAs || local?.invocableAs || `/${skill.name}`,
        };
      });
      skills.push(...unusedScanned);
    }
    try {
      marketplaces = await listMarketplaces();
    } catch {
      marketplaces = inspected.marketplaces;
    }
  } catch (err) {
    inspectError = err instanceof Error ? err.message : String(err);
  }
  return {
    model,
    reasoningEffort: getDefaultReasoningEffort(text),
    permissionMode: getPermissionMode(text),
    models: [...byId.values()],
    skills,
    mcpServers,
    plugins,
    marketplaces,
    availablePlugins,
    hooks,
    projectTrusted,
    browserControl:
      getBrowserControl(text) ?? mcpServers.some((s) => isBrowserControlServer(s.name) && s.enabled),
    computerControl:
      getComputerControl(text) ??
      (mcpServers.some((s) => isComputerControlServer(s.name) && s.enabled) ||
        plugins.some((p) => isComputerControlServer(p.name) && p.enabled)),
    subagentsEnabled: getSubagentsEnabled(text),
    subagentTypes: await listSubagentTypes(cwd),
    inspectError,
  };
}

export function setDefaultModel(id: string) {
  writeText(setTableKey(readText(), "models", "default", JSON.stringify(id)));
}

export function setDefaultReasoningEffort(effort: ReasoningEffort) {
  writeText(setTableKey(readText(), "models", "default_reasoning_effort", JSON.stringify(effort)));
}

export function setPermissionMode(mode: PermissionMode) {
  writeText(setTableKey(readText(), "ui", "permission_mode", JSON.stringify(mode)));
}

export function setSkillDisabled(name: string, disabled: boolean) {
  const text = readText();
  const current = readStringArray(text, "skills", "disabled");
  const set = new Set(current);
  if (disabled) set.add(name);
  else {
    for (const v of [...set]) if (v.toLowerCase() === name.toLowerCase()) set.delete(v);
  }
  const raw = `[${[...set].map((s) => JSON.stringify(s)).join(", ")}]`;
  writeText(setTableKey(text, "skills", "disabled", raw));
}

export function addSkillSearchPath(skillPath: string) {
  const value = skillPath.trim();
  if (!value) throw new Error("Skills 路径不能为空");
  const text = readText();
  const paths = readStringArray(text, "skills", "paths");
  if (!paths.some((item) => path.resolve(item).toLowerCase() === path.resolve(value).toLowerCase())) paths.push(value);
  const ignore = readStringArray(text, "skills", "ignore").filter((item) => item.toLowerCase() !== value.toLowerCase());
  let next = setTableKey(text, "skills", "paths", `[${paths.map(JSON.stringify).join(", ")}]`);
  next = setTableKey(next, "skills", "ignore", `[${ignore.map(JSON.stringify).join(", ")}]`);
  writeText(next);
}

export function removeSkillSearchPath(skillPath: string) {
  const value = skillPath.trim();
  const text = readText();
  const paths = readStringArray(text, "skills", "paths").filter((item) => item.toLowerCase() !== value.toLowerCase());
  writeText(setTableKey(text, "skills", "paths", `[${paths.map(JSON.stringify).join(", ")}]`));
}

export function resetSkillConfig() {
  let text = readText();
  for (const key of ["paths", "ignore", "disabled"]) text = setTableKey(text, "skills", key, "[]");
  writeText(text);
}
