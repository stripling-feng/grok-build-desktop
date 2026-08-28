import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import * as yauzl from "yauzl";

const execFileAsync = promisify(execFile);
const METADATA_FILE = ".grok-build-marketplace.json";
const MAX_ARCHIVE_ENTRIES = 30_000;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

type MirrorMetadata = {
  version: 1;
  originalSource: string;
  sourceIdentity: string;
  cloneSource: string;
  branch?: string;
  marketplaceName: string;
  renamedPaths: number;
  createdAt: string;
};

type RemoteMarketplaceSource = {
  kind: "remote";
  originalSource: string;
  sourceIdentity: string;
  cloneSource: string;
  branch?: string;
  slug: string;
};

type LocalMarketplaceSource = {
  kind: "local";
  path: string;
};

type MarketplaceSource = RemoteMarketplaceSource | LocalMarketplaceSource;

type RemotePluginSource = {
  cloneSource: string;
  ref?: string;
  sha?: string;
  subdir: string;
  identity: string;
};

type ExtractedRepository = {
  directory: string;
  paths: PortablePathMap;
};

export type PreparedMarketplaceMirror = {
  originalSource: string;
  sourceIdentity: string;
  localPath: string;
  marketplaceName: string;
  renamedPaths: number;
};

function mirrorRoot(): string {
  const home = process.env.GROK_HOME || path.join(os.homedir(), ".grok");
  return path.join(home, "marketplace-mirrors");
}

function trimSource(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function expandLocalPath(value: string, cwd?: string | null): string {
  const expanded = value === "~" || value.startsWith("~/") || value.startsWith("~\\")
    ? path.join(os.homedir(), value === "~" ? "" : value.slice(2))
    : value;
  return path.resolve(cwd || process.cwd(), expanded);
}

function marketplaceRootFromFile(file: string): string | null {
  if (path.basename(file).toLowerCase() !== "marketplace.json") return null;
  const parent = path.dirname(file);
  const parentName = path.basename(parent).toLowerCase();
  if (parentName === ".grok-plugin" || parentName === ".claude-plugin") {
    return path.dirname(parent);
  }
  if (parentName === "plugins" && path.basename(path.dirname(parent)).toLowerCase() === ".agents") {
    return path.dirname(path.dirname(parent));
  }
  return parent;
}

function githubSource(value: string): RemoteMarketplaceSource | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "raw.githubusercontent.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return null;
    const [owner, rawRepo, branch] = parts;
    const repo = rawRepo.replace(/\.git$/i, "");
    return {
      kind: "remote",
      originalSource: value,
      sourceIdentity: `github:${owner.toLowerCase()}/${repo.toLowerCase()}@${branch}`,
      cloneSource: `https://github.com/${owner}/${repo}.git`,
      branch,
      slug: repo,
    };
  }

  if (host !== "github.com" && host !== "www.github.com") return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  const refIndex = parts.findIndex((part) => part === "tree" || part === "blob");
  const branch = refIndex >= 0 ? parts[refIndex + 1] : undefined;
  return {
    kind: "remote",
    originalSource: value,
    sourceIdentity: `github:${owner.toLowerCase()}/${repo.toLowerCase()}${branch ? `@${branch}` : ""}`,
    cloneSource: `https://github.com/${owner}/${repo}.git`,
    branch,
    slug: repo,
  };
}

function parseMarketplaceSource(input: string, cwd?: string | null): MarketplaceSource {
  const value = trimSource(input);
  if (!value) throw new Error("请填写市场源地址");

  const github = githubSource(value);
  if (github) return github;

  const shorthand = value.match(/^([\w.-]+)\/([\w.-]+?)(?:@([^#]+))?$/);
  if (shorthand) {
    const [, owner, rawRepo, branch] = shorthand;
    const repo = rawRepo.replace(/\.git$/i, "");
    return {
      kind: "remote",
      originalSource: value,
      sourceIdentity: `github:${owner.toLowerCase()}/${repo.toLowerCase()}${branch ? `@${branch}` : ""}`,
      cloneSource: `https://github.com/${owner}/${repo}.git`,
      branch,
      slug: repo,
    };
  }

  const localPath = expandLocalPath(value, cwd);
  if (fs.existsSync(localPath)) {
    const stat = fs.statSync(localPath);
    if (stat.isDirectory()) return { kind: "local", path: localPath };
    if (stat.isFile()) {
      const root = marketplaceRootFromFile(localPath);
      if (root) return { kind: "local", path: root };
    }
    throw new Error("本地市场源必须是目录或 marketplace.json 文件");
  }

  const looksLocal =
    path.isAbsolute(value) ||
    value.startsWith("./") ||
    value.startsWith(".\\") ||
    value.startsWith("../") ||
    value.startsWith("..\\") ||
    value.startsWith("~");
  if (looksLocal) throw new Error(`本地市场源不存在：${localPath}`);

  if (/^https?:\/\//i.test(value) && /marketplace\.json(?:[?#].*)?$/i.test(value)) {
    throw new Error("远程 marketplace.json 需要使用 GitHub 页面或 raw.githubusercontent.com 地址");
  }

  if (/^(?:https?|ssh|git):\/\//i.test(value) || /^git@[^:]+:.+/i.test(value)) {
    const name = value.replace(/[?#].*$/, "").replace(/\/?\.git\/?$/i, "").split(/[/:\\]/).filter(Boolean).pop();
    return {
      kind: "remote",
      originalSource: value,
      sourceIdentity: `git:${value.replace(/\/?\.git\/?$/i, "").replace(/\/$/, "").toLowerCase()}`,
      cloneSource: value,
      slug: name || "marketplace",
    };
  }

  throw new Error("无法识别市场源。可填写 GitHub 仓库页、owner/repo、Git URL 或本地目录");
}

function encodeWindowsSegment(segment: string): string {
  let safe = "";
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    const code = char.charCodeAt(0);
    if (char === "~" || code < 32 || /[<>:"\\|?*]/.test(char)) {
      safe += `~${code.toString(16).padStart(2, "0")}`;
    } else {
      safe += char;
    }
  }
  safe = safe.replace(/[. ]+$/g, (tail) =>
    [...tail].map((char) => `~${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
  );
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(safe)) safe = `~${safe}`;
  if (safe.length > 120) {
    const ext = path.posix.extname(safe).slice(0, 20);
    const stemLength = Math.max(20, 100 - ext.length);
    safe = `${safe.slice(0, stemLength)}~${shortHash(segment)}${ext}`;
  }
  return safe || "~empty";
}

function shortHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function processErrorMessage(err: unknown): string {
  const detail = err as { stderr?: string; stdout?: string; message?: string };
  return `${detail.stderr || ""} ${detail.stdout || ""}`.trim() || detail.message || String(err);
}

class PortablePathMap {
  private readonly mapped = new Map<string, string>();
  private readonly used = new Map<string, string>();
  renamedPaths = 0;

  map(rawValue: string): string {
    const raw = rawValue.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (!raw) return "";
    const existing = this.mapped.get(raw);
    if (existing) return existing;

    const rawSegments = raw.split("/");
    const safeSegments: string[] = [];
    for (let index = 0; index < rawSegments.length; index += 1) {
      const rawPrefix = rawSegments.slice(0, index + 1).join("/");
      const mappedPrefix = this.mapped.get(rawPrefix);
      if (mappedPrefix) {
        safeSegments.splice(0, safeSegments.length, ...mappedPrefix.split("/"));
        continue;
      }

      const parent = safeSegments.join("/");
      const rawSegment = rawSegments[index];
      let safeSegment = encodeWindowsSegment(rawSegment);
      const keyBase = `${parent}/${safeSegment}`.toLowerCase();
      const owner = this.used.get(keyBase);
      if (owner && owner !== rawPrefix) {
        const ext = path.posix.extname(safeSegment);
        const stem = ext ? safeSegment.slice(0, -ext.length) : safeSegment;
        safeSegment = `${stem}~${shortHash(rawPrefix)}${ext}`;
      }
      safeSegments.push(safeSegment);
      const safePrefix = safeSegments.join("/");
      this.used.set(safePrefix.toLowerCase(), rawPrefix);
      this.mapped.set(rawPrefix, safePrefix);
      if (safeSegment !== rawSegment) this.renamedPaths += 1;
    }
    return safeSegments.join("/");
  }

  get(rawValue: string): string | undefined {
    const raw = rawValue.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    return this.mapped.get(raw);
  }
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, decodeStrings: true, strictFileNames: true }, (err, zip) => {
      if (err || !zip) reject(err || new Error("无法打开市场源归档"));
      else resolve(zip);
    });
  });
}

async function extractPortableZip(zipPath: string, outputDir: string): Promise<PortablePathMap> {
  const zip = await openZip(zipPath);
  const paths = new PortablePathMap();
  let entries = 0;
  let totalBytes = 0;

  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const fail = (err: unknown) => {
      if (finished) return;
      finished = true;
      zip.close();
      reject(err);
    };

    zip.on("error", fail);
    zip.on("end", () => {
      if (finished) return;
      finished = true;
      resolve();
    });
    zip.on("entry", (entry) => {
      if (finished) return;
      entries += 1;
      totalBytes += entry.uncompressedSize;
      if (entries > MAX_ARCHIVE_ENTRIES || totalBytes > MAX_ARCHIVE_BYTES) {
        fail(new Error("市场源归档过大，已停止展开"));
        return;
      }

      const raw = entry.fileName.replace(/\\/g, "/").replace(/\/$/, "");
      if (!raw || raw.startsWith("/") || raw.split("/").some((segment) => segment === "..")) {
        fail(new Error(`市场源包含不安全路径：${entry.fileName}`));
        return;
      }
      const safe = paths.map(raw);
      const destination = path.resolve(outputDir, ...safe.split("/"));
      const relative = path.relative(path.resolve(outputDir), destination);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        fail(new Error(`市场源路径越界：${entry.fileName}`));
        return;
      }

      const isDirectory = /\/$/.test(entry.fileName);
      const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
      const isSymlink = (unixMode & 0o170000) === 0o120000;
      if (isSymlink) {
        zip.readEntry();
        return;
      }
      if (isDirectory) {
        fs.mkdirSync(destination, { recursive: true });
        zip.readEntry();
        return;
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true });
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          fail(err || new Error(`无法读取归档文件：${entry.fileName}`));
          return;
        }
        void pipeline(stream, fs.createWriteStream(destination, { flags: "wx" }))
          .then(() => zip.readEntry())
          .catch(fail);
      });
    });
    zip.readEntry();
  });

  return paths;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourcePath(plugin: Record<string, unknown>): string | null {
  if (typeof plugin.source === "string") return plugin.source;
  const source = asRecord(plugin.source);
  if (!source) return null;
  const kind = typeof source.source === "string"
    ? source.source.toLowerCase()
    : typeof source.type === "string"
      ? source.type.toLowerCase()
      : "";
  // Remote marketplace entries may also carry a `path` (for example
  // git-subdir). That path belongs to the external repository and must not be
  // resolved or materialized against the marketplace checkout itself.
  if (kind && kind !== "local" && kind !== "path" && kind !== "directory") return null;
  if (typeof source.path === "string") return source.path;
  return null;
}

function remotePluginSource(plugin: Record<string, unknown>): RemotePluginSource | null {
  const source = asRecord(plugin.source);
  if (!source) return null;
  const kind = typeof source.source === "string"
    ? source.source.toLowerCase()
    : typeof source.type === "string"
      ? source.type.toLowerCase()
      : "";
  if (!kind || kind === "local" || kind === "path" || kind === "directory") return null;

  let cloneSource = typeof source.url === "string" ? source.url.trim() : "";
  if (!cloneSource && kind === "github" && typeof source.repo === "string" && source.repo.trim()) {
    cloneSource = `https://github.com/${source.repo.trim().replace(/^\/+|\/+$/g, "")}.git`;
  }
  if (!cloneSource || !/^(?:https?|ssh|git):\/\//i.test(cloneSource) && !/^git@[^:]+:.+/i.test(cloneSource)) {
    return null;
  }

  const ref = typeof source.ref === "string" && source.ref.trim() ? source.ref.trim() : undefined;
  const sha = typeof source.sha === "string" && source.sha.trim() ? source.sha.trim() : undefined;
  const subdir = typeof source.path === "string"
    ? source.path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "")
    : "";
  return {
    cloneSource,
    ref,
    sha,
    subdir,
    identity: `${cloneSource.toLowerCase()}@${sha || ref || "HEAD"}`,
  };
}

function setLocalSourcePath(plugin: Record<string, unknown>, value: string) {
  plugin.source = { type: "local", path: value };
}

function ensureGrokPluginManifest(sourceRoot: string, marketplacePlugin: Record<string, unknown>) {
  const grokManifest = path.join(sourceRoot, ".grok-plugin", "plugin.json");
  if (fs.existsSync(grokManifest)) return;
  const codexManifest = path.join(sourceRoot, ".codex-plugin", "plugin.json");
  if (!fs.existsSync(codexManifest)) return;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = asRecord(JSON.parse(fs.readFileSync(codexManifest, "utf8"))) || {};
  } catch {
    parsed = {};
  }
  const name = typeof marketplacePlugin.name === "string" && marketplacePlugin.name.trim()
    ? marketplacePlugin.name.trim()
    : typeof parsed.name === "string" && parsed.name.trim()
      ? parsed.name.trim()
      : path.basename(sourceRoot);
  parsed.name = name;
  if (typeof marketplacePlugin.version === "string") parsed.version = marketplacePlugin.version;
  if (typeof marketplacePlugin.description === "string") parsed.description = marketplacePlugin.description;
  if (typeof marketplacePlugin.description !== "string" && typeof parsed.description === "string") {
    marketplacePlugin.description = parsed.description;
  }
  if (typeof marketplacePlugin.version !== "string" && typeof parsed.version === "string") {
    marketplacePlugin.version = parsed.version;
  }
  fs.mkdirSync(path.dirname(grokManifest), { recursive: true });
  fs.writeFileSync(grokManifest, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function flatSkillName(contents: string, fallback: string): string | null {
  const normalized = contents.replace(/^\uFEFF/, "");
  const frontmatter = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return null;
  const name = frontmatter[1].match(/^name\s*:\s*["']?([^"'\r\n#]+?)["']?\s*(?:#.*)?$/im)?.[1]?.trim();
  return name || fallback;
}

function materializeFlatSkillFiles(sourceRoot: string): number {
  const skillsRoot = path.join(sourceRoot, "skills");
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) return 0;

  let created = 0;
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md" || entry.name.toLowerCase() === "skill.md") {
      continue;
    }
    const source = path.join(skillsRoot, entry.name);
    let contents = "";
    try {
      contents = fs.readFileSync(source, "utf8");
    } catch {
      continue;
    }
    const declaredName = flatSkillName(contents, path.basename(entry.name, path.extname(entry.name)));
    if (!declaredName) continue;

    const folderName = encodeWindowsSegment(declaredName);
    let destination = path.join(skillsRoot, folderName, "SKILL.md");
    if (fs.existsSync(destination)) {
      try {
        if (fs.readFileSync(destination, "utf8") === contents) continue;
      } catch {
        // A conflicting generated destination gets a stable suffix below.
      }
      destination = path.join(skillsRoot, `${folderName}~${shortHash(entry.name)}`, "SKILL.md");
    }
    if (fs.existsSync(destination)) continue;
    linkOrCopy(source, destination);
    created += 1;
  }
  return created;
}

function normalizeRemoteSourceForGrok(plugin: Record<string, unknown>, source: RemotePluginSource) {
  const current = asRecord(plugin.source);
  const kind = typeof current?.source === "string"
    ? current.source.toLowerCase()
    : typeof current?.type === "string"
      ? current.type.toLowerCase()
      : "";
  if (kind !== "github" || !current) return;
  const normalized = { ...current, source: "url", url: source.cloneSource };
  delete normalized.repo;
  plugin.source = normalized;
}

function rewritePluginPaths(value: unknown, originalRoot: string, safeRoot: string, paths: PortablePathMap): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewritePluginPaths(item, originalRoot, safeRoot, paths));
  }
  const record = asRecord(value);
  if (record) {
    for (const [key, child] of Object.entries(record)) {
      if (key === "source") continue;
      record[key] = rewritePluginPaths(child, originalRoot, safeRoot, paths);
    }
    return record;
  }
  if (typeof value !== "string" || /^\w+:\/\//.test(value)) return value;
  const joined = path.posix.normalize(path.posix.join(originalRoot.replace(/\\/g, "/"), value.replace(/\\/g, "/")));
  const mapped = paths.get(joined.replace(/^\.\//, ""));
  if (!mapped) return value;
  const rewritten = path.posix.relative(safeRoot.replace(/^\.\//, ""), mapped);
  return value.startsWith("./") ? `./${rewritten}` : rewritten;
}

const LEGACY_COMPONENT_KEYS = [
  "agents",
  "commands",
  "skills",
  "hooks",
  "mcpServers",
  "mcp_servers",
  "lspServers",
  "lsp_servers",
  "workflows",
  "outputStyles",
  "output_styles",
  "sandbox",
] as const;

function componentDestination(key: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const componentRoot = ({
    agents: "agents",
    commands: "commands",
    skills: "skills",
    hooks: "hooks",
    mcpServers: "mcp-servers",
    mcp_servers: "mcp-servers",
    lspServers: "lsp-servers",
    lsp_servers: "lsp-servers",
  } as Record<string, string>)[key];
  if (componentRoot) {
    return normalized === componentRoot || normalized.startsWith(`${componentRoot}/`)
      ? normalized
      : path.posix.join(componentRoot, normalized);
  }
  if (key === "workflows") return normalized.replace(/^workflows\//, "commands/workflows/");
  if (key === "outputStyles" || key === "output_styles") {
    return normalized.replace(/^(?:output-styles|outputStyles)\//, "commands/output-styles/");
  }
  if (key === "sandbox") return normalized.replace(/^sandbox\//, "commands/sandbox/");
  return normalized;
}

function linkOrCopy(source: string, destination: string) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      linkOrCopy(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return;
  }
  if (!stat.isFile()) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) return;
  try {
    fs.linkSync(source, destination);
  } catch {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
}

function resolveComponentSource(
  sourceRoot: string,
  relativePath: string,
): { absolute: string; relative: string } | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized === ".") return { absolute: sourceRoot, relative: "." };
  if (path.posix.isAbsolute(normalized) || normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(`插件组件路径越界：${relativePath}`);
  }

  let current = sourceRoot;
  const resolvedSegments: string[] = [];
  for (const segment of normalized.split("/").filter((value) => value && value !== ".")) {
    const exact = path.join(current, segment);
    const portable = path.join(current, encodeWindowsSegment(segment));
    let selected = fs.existsSync(exact) ? segment : fs.existsSync(portable) ? path.basename(portable) : "";
    if (!selected && segment.includes("\uFFFD") && fs.existsSync(current)) {
      const pattern = new RegExp(
        `^${segment
          .split(/\uFFFD+/u)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".+")}$`,
        "iu",
      );
      const matches = fs.readdirSync(current).filter((name) => pattern.test(name));
      if (matches.length === 1) selected = matches[0];
    }
    if (!selected) return null;
    current = path.join(current, selected);
    resolvedSegments.push(selected);
  }

  const relative = path.relative(path.resolve(sourceRoot), path.resolve(current));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`插件组件路径越界：${relativePath}`);
  return { absolute: current, relative: resolvedSegments.join("/") || "." };
}

function materializeRootPlugin(
  outputDir: string,
  plugin: Record<string, unknown>,
  sourceRoot: string,
): string {
  const rawName = typeof plugin.name === "string" ? plugin.name.trim() : "plugin";
  const folderName = encodeWindowsSegment(rawName || "plugin");
  const relativePluginDir = path.posix.join(".grok-build-plugins", folderName);
  const pluginDir = path.join(outputDir, ...relativePluginDir.split("/"));
  fs.mkdirSync(pluginDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === ".grok-build-plugins" || entry.name === ".grok-plugin") continue;
    linkOrCopy(path.join(sourceRoot, entry.name), path.join(pluginDir, entry.name));
  }

  const manifestCandidates = [
    path.join(sourceRoot, ".grok-plugin", "plugin.json"),
    path.join(sourceRoot, ".claude-plugin", "plugin.json"),
    path.join(sourceRoot, ".codex-plugin", "plugin.json"),
  ];
  let pluginManifest: Record<string, unknown> = {};
  const manifestSource = manifestCandidates.find((candidate) => fs.existsSync(candidate));
  if (manifestSource) {
    try {
      pluginManifest = asRecord(JSON.parse(fs.readFileSync(manifestSource, "utf8"))) || {};
    } catch {
      pluginManifest = {};
    }
  }
  pluginManifest.name = rawName || folderName;
  if (typeof plugin.version === "string") pluginManifest.version = plugin.version;
  if (typeof plugin.description === "string") pluginManifest.description = plugin.description;
  const manifestDir = path.join(pluginDir, ".grok-plugin");
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, "plugin.json"), `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf8");
  return relativePluginDir;
}

function materializeLegacyPlugin(
  outputDir: string,
  plugin: Record<string, unknown>,
  sourceRoot: string,
): string | null {
  const rawName = typeof plugin.name === "string" ? plugin.name.trim() : "plugin";
  const folderName = encodeWindowsSegment(rawName || "plugin");
  const selected: { key: string; item: string }[] = LEGACY_COMPONENT_KEYS.flatMap((key) => {
    const value = plugin[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").map((item) => ({ key, item }))
      : [];
  });
  const hasManifest = [".grok-plugin", ".claude-plugin", ".codex-plugin"]
    .some((directory) => fs.existsSync(path.join(sourceRoot, directory, "plugin.json")));
  if (!selected.length && !hasManifest && fs.existsSync(path.join(sourceRoot, "SKILL.md"))) {
    selected.push({ key: "skills", item: "." });
  }
  if (!selected.length) return null;

  const relativePluginDir = path.posix.join(".grok-build-plugins", folderName);
  const pluginDir = path.join(outputDir, ...relativePluginDir.split("/"));
  fs.mkdirSync(pluginDir, { recursive: true });

  const missing: string[] = [];
  let copied = 0;

  for (const { key, item } of selected) {
    const resolved = resolveComponentSource(sourceRoot, item);
    if (!resolved) {
      missing.push(item);
      continue;
    }

    const targetRelative = key === "skills" && resolved.relative === "."
      ? path.posix.join("skills", folderName)
      : componentDestination(key, resolved.relative);
    const destination = path.resolve(pluginDir, ...targetRelative.split("/"));
    const destinationRelative = path.relative(path.resolve(pluginDir), destination);
    if (destinationRelative.startsWith("..") || path.isAbsolute(destinationRelative)) {
      throw new Error(`插件 ${rawName} 的目标路径越界：${targetRelative}`);
    }
    linkOrCopy(resolved.absolute, destination);
    copied += 1;
  }

  if (!copied) throw new Error(`插件 ${rawName} 的声明组件均不存在${missing[0] ? `：${missing[0]}` : ""}`);
  if (missing.length) {
    const note = `Grok 兼容镜像已跳过上游清单中 ${missing.length} 个不存在的组件。`;
    plugin.description = typeof plugin.description === "string" && plugin.description.trim()
      ? `${plugin.description.trim()} ${note}`
      : note;
  }

  const pluginManifest: Record<string, unknown> = { name: rawName || folderName };
  if (typeof plugin.version === "string") pluginManifest.version = plugin.version;
  if (typeof plugin.description === "string") pluginManifest.description = plugin.description;
  const manifestDir = path.join(pluginDir, ".grok-plugin");
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, "plugin.json"), `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf8");

  for (const key of LEGACY_COMPONENT_KEYS) delete plugin[key];
  delete plugin.strict;
  return relativePluginDir;
}

async function extractRemotePluginRepository(
  source: RemotePluginSource,
  stagingRoot: string,
  cache: Map<string, Promise<ExtractedRepository>>,
): Promise<ExtractedRepository> {
  const existing = cache.get(source.identity);
  if (existing) return existing;

  const pending = (async () => {
    const target = path.join(stagingRoot, `external-${shortHash(source.identity)}`);
    const repository = path.join(target, "repository");
    const archive = path.join(target, "plugin.zip");
    const content = path.join(target, "content");
    fs.mkdirSync(content, { recursive: true });

    const cloneArgs = ["-c", "core.protectNTFS=false", "clone", "--bare", "--depth", "1"];
    if (source.ref) cloneArgs.push("--branch", source.ref);
    cloneArgs.push("--", source.cloneSource, repository);
    try {
      await execFileAsync("git", cloneArgs, {
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (err) {
      throw new Error(`克隆外部插件仓库失败（${source.cloneSource}）：${processErrorMessage(err)}`);
    }

    let treeish = "HEAD";
    if (source.sha) {
      try {
        await execFileAsync("git", ["-C", repository, "cat-file", "-e", `${source.sha}^{commit}`], {
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 2 * 1024 * 1024,
        });
      } catch {
        try {
          await execFileAsync("git", ["-C", repository, "fetch", "--depth", "1", "origin", source.sha], {
            windowsHide: true,
            timeout: 180_000,
            maxBuffer: 8 * 1024 * 1024,
          });
        } catch (err) {
          throw new Error(`无法获取外部插件固定版本（${source.sha}）：${processErrorMessage(err)}`);
        }
      }
      treeish = source.sha;
    }

    try {
      await execFileAsync(
        "git",
        ["-c", "core.protectNTFS=false", "-C", repository, "archive", "--format=zip", "--output", archive, treeish],
        { windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
      );
    } catch (err) {
      throw new Error(`生成外部插件归档失败（${source.cloneSource}）：${processErrorMessage(err)}`);
    }

    const paths = await extractPortableZip(archive, content);
    return { directory: content, paths };
  })();
  cache.set(source.identity, pending);
  return pending;
}

async function rewriteMarketplaceManifest(
  outputDir: string,
  paths: PortablePathMap,
  stagingRoot: string,
): Promise<{ name: string; file: string }> {
  const candidates = [
    path.join(outputDir, ".grok-plugin", "marketplace.json"),
    path.join(outputDir, ".claude-plugin", "marketplace.json"),
    path.join(outputDir, ".agents", "plugins", "marketplace.json"),
  ];
  const manifestPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!manifestPath) {
    throw new Error("仓库中没有 Grok、Claude 或 Codex marketplace.json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`市场清单不是有效 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
  const manifest = asRecord(parsed);
  if (!manifest || !Array.isArray(manifest.plugins)) throw new Error("市场清单缺少 plugins 数组");
  const name = typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : "marketplace";
  const externalRepositories = new Map<string, Promise<ExtractedRepository>>();

  for (const rawPlugin of manifest.plugins) {
    const plugin = asRecord(rawPlugin);
    if (!plugin) continue;
    const remote = remotePluginSource(plugin);
    if (remote) normalizeRemoteSourceForGrok(plugin, remote);
    if (remote && LEGACY_COMPONENT_KEYS.some((key) => Array.isArray(plugin[key]) && plugin[key].length > 0)) {
      const extracted = await extractRemotePluginRepository(remote, stagingRoot, externalRepositories);
      const safeSubdir = remote.subdir ? extracted.paths.get(remote.subdir) : "";
      if (remote.subdir && !safeSubdir) {
        throw new Error(`插件 ${String(plugin.name || "plugin")} 的外部子目录不存在：${remote.subdir}`);
      }
      const sourceRoot = safeSubdir
        ? path.join(extracted.directory, ...safeSubdir.split("/"))
        : extracted.directory;
      const materialized = materializeLegacyPlugin(outputDir, plugin, sourceRoot);
      if (materialized) {
        setLocalSourcePath(plugin, `./${materialized.replace(/^\.\//, "")}`);
        continue;
      }
    }
    const originalRoot = sourcePath(plugin);
    if (!originalRoot || /^\w+:\/\//.test(originalRoot)) continue;
    const normalizedRoot = originalRoot.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    const safeRoot = paths.get(normalizedRoot) || paths.map(normalizedRoot);
    rewritePluginPaths(plugin, normalizedRoot, safeRoot, paths);
    const localSourceRoot = path.join(outputDir, ...safeRoot.split("/"));
    ensureGrokPluginManifest(localSourceRoot, plugin);
    materializeFlatSkillFiles(localSourceRoot);
    const materialized = materializeLegacyPlugin(
      outputDir,
      plugin,
      localSourceRoot,
    );
    const finalRoot = materialized || (!safeRoot || safeRoot === "."
      ? materializeRootPlugin(outputDir, plugin, outputDir)
      : safeRoot);
    setLocalSourcePath(plugin, `./${finalRoot.replace(/^\.\//, "")}`);
  }

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, serialized, "utf8");
  const grokManifestPath = path.join(outputDir, ".grok-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(grokManifestPath), { recursive: true });
  fs.writeFileSync(grokManifestPath, serialized, "utf8");
  return { name, file: grokManifestPath };
}

function assertManagedPath(target: string) {
  const root = path.resolve(mirrorRoot());
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("拒绝操作市场镜像目录之外的路径");
  }
}

function replaceDirectory(staged: string, target: string) {
  assertManagedPath(target);
  const backup = `${target}.old-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  let movedOld = false;
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      movedOld = true;
    }
    fs.renameSync(staged, target);
    if (movedOld) fs.rmSync(backup, { recursive: true, force: true });
  } catch (err) {
    if (!fs.existsSync(target) && movedOld && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw err;
  }
}

function readMetadata(directory: string): MirrorMetadata | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(directory, METADATA_FILE), "utf8")) as Partial<MirrorMetadata>;
    if (
      raw.version !== 1 ||
      typeof raw.originalSource !== "string" ||
      typeof raw.sourceIdentity !== "string" ||
      typeof raw.marketplaceName !== "string"
    ) {
      return null;
    }
    return raw as MirrorMetadata;
  } catch {
    return null;
  }
}

export function managedMarketplaceMetadata(source: string): MirrorMetadata | null {
  if (!source) return null;
  const resolved = path.resolve(source);
  return readMetadata(resolved);
}

export function managedMarketplaceName(sourceOrName: string): string | null {
  const direct = managedMarketplaceMetadata(sourceOrName);
  if (direct) return direct.marketplaceName;
  const root = mirrorRoot();
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (entry.name !== sourceOrName) continue;
    return readMetadata(path.join(root, entry.name))?.marketplaceName || null;
  }
  return null;
}

export function managedMarketplacePath(input: string): string | null {
  const value = trimSource(input);
  if (!value) return null;
  if (fs.existsSync(value)) {
    const metadata = readMetadata(path.resolve(value));
    if (metadata) return path.resolve(value);
  }
  const root = mirrorRoot();
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const directory = path.join(root, entry.name);
    const metadata = readMetadata(directory);
    if (!metadata) continue;
    if (metadata.originalSource === value) return directory;
    try {
      const parsed = parseMarketplaceSource(value);
      if (parsed.kind === "remote" && parsed.sourceIdentity === metadata.sourceIdentity) return directory;
    } catch {
      /* compare the literal source only */
    }
  }
  return null;
}

export function removeManagedMarketplaceFiles(directory: string) {
  const metadata = readMetadata(directory);
  if (!metadata) return;
  assertManagedPath(directory);
  fs.rmSync(directory, { recursive: true, force: true });
}

export function marketplaceSourceIdentity(input: string, cwd?: string | null): string {
  const parsed = parseMarketplaceSource(input, cwd);
  return parsed.kind === "remote" ? parsed.sourceIdentity : `local:${parsed.path.toLowerCase()}`;
}

export async function prepareMarketplaceSource(
  input: string,
  cwd?: string | null,
): Promise<{ kind: "local"; path: string } | { kind: "mirror"; value: PreparedMarketplaceMirror }> {
  const parsed = parseMarketplaceSource(input, cwd);
  if (parsed.kind === "local") return parsed;

  const root = mirrorRoot();
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, `${parsed.slug.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 40) || "marketplace"}-${shortHash(parsed.sourceIdentity)}`);
  const stagingRoot = fs.mkdtempSync(path.join(root, ".staging-"));
  const repository = path.join(stagingRoot, "repository");
  const archive = path.join(stagingRoot, "marketplace.zip");
  const content = path.join(stagingRoot, "content");
  fs.mkdirSync(content, { recursive: true });

  try {
    const cloneArgs = ["-c", "core.protectNTFS=false", "clone", "--bare", "--depth", "1"];
    if (parsed.branch) cloneArgs.push("--branch", parsed.branch);
    cloneArgs.push("--", parsed.cloneSource, repository);
    try {
      await execFileAsync("git", cloneArgs, {
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (err) {
      throw new Error(`克隆仓库失败：${processErrorMessage(err)}`);
    }
    try {
      await execFileAsync(
        "git",
        ["-c", "core.protectNTFS=false", "-C", repository, "archive", "--format=zip", "--output", archive, "HEAD"],
        {
          windowsHide: true,
          timeout: 180_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
    } catch (err) {
      throw new Error(`生成仓库归档失败：${processErrorMessage(err)}`);
    }

    const paths = await extractPortableZip(archive, content);
    const manifest = await rewriteMarketplaceManifest(content, paths, stagingRoot);
    const metadata: MirrorMetadata = {
      version: 1,
      originalSource: parsed.originalSource,
      sourceIdentity: parsed.sourceIdentity,
      cloneSource: parsed.cloneSource,
      branch: parsed.branch,
      marketplaceName: manifest.name,
      renamedPaths: paths.renamedPaths,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(content, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    replaceDirectory(content, target);
    return {
      kind: "mirror",
      value: {
        originalSource: parsed.originalSource,
        sourceIdentity: parsed.sourceIdentity,
        localPath: target,
        marketplaceName: manifest.name,
        renamedPaths: paths.renamedPaths,
      },
    };
  } catch (err) {
    const message = processErrorMessage(err);
    throw new Error(`市场源同步失败：${message.slice(0, 1800)}`);
  } finally {
    if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}
