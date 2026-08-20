import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AppSettings, PermissionMode, SkillInfo } from "./shared";
import { grokHome } from "./sessions";
import { findGitRoot } from "./git";
import { grokBin as resolveGrokBin } from "./grok-bin";

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

function tableBlock(text: string, table: string): { start: number; end: number; body: string } | null {
  const header = `[${table}]`;
  const start = text.indexOf(header);
  if (start < 0) return null;
  const after = start + header.length;
  const next = text.slice(after).search(/\n\[/);
  const end = next < 0 ? text.length : after + next;
  return { start, end, body: text.slice(start, end) };
}

export function setTableKey(text: string, table: string, key: string, rawValue: string): string {
  const line = `${key} = ${rawValue}`;
  const block = tableBlock(text, table);
  if (!block) {
    const prefix = text.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}[${table}]\n${line}\n`;
  }
  const keyRe = new RegExp(`^${key}\\s*=\\s*.*$`, "m");
  const nextBody = keyRe.test(block.body)
    ? block.body.replace(keyRe, line)
    : `${block.body.trimEnd()}\n${line}\n`;
  return text.slice(0, block.start) + nextBody + text.slice(block.end);
}

function readKey(text: string, table: string, key: string): string | null {
  const block = tableBlock(text, table);
  if (!block) return null;
  const m = block.body.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, "m"));
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

export function getDefaultModel(text = readText()): string {
  return readKey(text, "models", "default") || "grok-4.6";
}

export function sessionMeta(): Record<string, unknown> {
  const mode = getPermissionMode();
  if (mode === "always-approve") return { _meta: { yoloMode: true } };
  if (mode === "auto") return { _meta: { autoMode: true } };
  return {};
}

function modelNamesFromConfig(text: string): { id: string; name: string }[] {
  const models: { id: string; name: string }[] = [];
  const re = /\[model\.("?)([^"\]]+)\1\]([\s\S]*?)(?=\n\[|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = m[2];
    const name = m[3].match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] || id;
    models.push({ id, name });
  }
  return models;
}

async function modelsFromCli(): Promise<string[]> {
  const bin = grokBin();
  if (!bin) return [];
  try {
    const { stdout } = await execFileAsync(bin, ["models"], {
      windowsHide: true,
      timeout: 12_000,
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

function walkSkillDir(dir: string, source: string, out: SkillInfo[]) {
  if (!fs.existsSync(dir)) return;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.toLowerCase() === "skill.md") {
        let md = "";
        try {
          md = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        const meta = parseFrontmatter(md);
        const name = meta.name || path.basename(cur);
        out.push({
          name,
          description: meta.description || "",
          source,
          path: full,
          disabled: false,
        });
      }
    }
  }
}

export async function listSkills(cwd?: string | null): Promise<SkillInfo[]> {
  const text = readText();
  const disabled = new Set(readStringArray(text, "skills", "disabled").map((s) => s.toLowerCase()));
  const found: SkillInfo[] = [];
  const gitRoot = cwd ? await findGitRoot(cwd) : null;
  const dirs: { dir: string; source: string }[] = [];
  if (cwd) dirs.push({ dir: path.join(cwd, ".grok", "skills"), source: "项目" });
  if (gitRoot && gitRoot !== cwd) dirs.push({ dir: path.join(gitRoot, ".grok", "skills"), source: "仓库" });
  dirs.push({ dir: path.join(grokHome(), "skills"), source: "用户" });
  for (const extra of readStringArray(text, "skills", "paths")) {
    const expanded = extra.replace(/^~(?=[\\/]|$)/, os.homedir());
    dirs.push({ dir: expanded, source: "额外" });
  }
  for (const { dir, source } of dirs) walkSkillDir(dir, source, found);
  const byName = new Map<string, SkillInfo>();
  for (const skill of found) {
    if (!byName.has(skill.name.toLowerCase())) byName.set(skill.name.toLowerCase(), skill);
  }
  return [...byName.values()].map((s) => ({
    ...s,
    disabled: disabled.has(s.name.toLowerCase()),
  }));
}

export async function loadSettings(cwd?: string | null): Promise<AppSettings> {
  const text = readText();
  const fromConfig = modelNamesFromConfig(text);
  const fromCli = await modelsFromCli();
  const byId = new Map<string, { id: string; name: string }>();
  for (const id of fromCli) byId.set(id, { id, name: id });
  for (const m of fromConfig) byId.set(m.id, m);
  if (byId.size === 0) {
    byId.set("grok-4.6", { id: "grok-4.6", name: "grok-4.6" });
    byId.set("grok-4.5", { id: "grok-4.5", name: "grok-4.5" });
  }
  const model = getDefaultModel(text);
  if (!byId.has(model)) byId.set(model, { id: model, name: model });
  return {
    model,
    permissionMode: getPermissionMode(text),
    models: [...byId.values()],
    skills: await listSkills(cwd),
  };
}

export function setDefaultModel(id: string) {
  writeText(setTableKey(readText(), "models", "default", JSON.stringify(id)));
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
