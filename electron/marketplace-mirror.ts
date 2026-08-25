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
  if (typeof source.path === "string") return source.path;
  return null;
}

function setSourcePath(plugin: Record<string, unknown>, value: string) {
  if (typeof plugin.source === "string") {
    plugin.source = { type: "local", path: value };
    return;
  }
  const source = asRecord(plugin.source);
  if (source && typeof source.path === "string") source.path = value;
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

function materializeLegacyPlugin(
  outputDir: string,
  plugin: Record<string, unknown>,
  safeSourceRoot: string,
): string | null {
  const selected = LEGACY_COMPONENT_KEYS.flatMap((key) => {
    const value = plugin[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").map((item) => ({ key, item }))
      : [];
  });
  if (!selected.length) return null;

  const rawName = typeof plugin.name === "string" ? plugin.name.trim() : "plugin";
  const folderName = encodeWindowsSegment(rawName || "plugin");
  const relativePluginDir = path.posix.join(".grok-build-plugins", folderName);
  const pluginDir = path.join(outputDir, ...relativePluginDir.split("/"));
  const sourceRoot = path.join(outputDir, ...safeSourceRoot.split("/"));
  fs.mkdirSync(pluginDir, { recursive: true });

  for (const { key, item } of selected) {
    const normalizedItem = item.replace(/\\/g, "/").replace(/^\.\//, "");
    const source = path.resolve(sourceRoot, ...normalizedItem.split("/"));
    const sourceRelative = path.relative(path.resolve(sourceRoot), source);
    if (sourceRelative.startsWith("..") || path.isAbsolute(sourceRelative)) {
      throw new Error(`插件 ${rawName} 的组件路径越界：${item}`);
    }
    if (!fs.existsSync(source)) throw new Error(`插件 ${rawName} 缺少组件：${item}`);

    const targetRelative = componentDestination(key, normalizedItem);
    const destination = path.resolve(pluginDir, ...targetRelative.split("/"));
    const destinationRelative = path.relative(path.resolve(pluginDir), destination);
    if (destinationRelative.startsWith("..") || path.isAbsolute(destinationRelative)) {
      throw new Error(`插件 ${rawName} 的目标路径越界：${targetRelative}`);
    }
    linkOrCopy(source, destination);
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

function rewriteMarketplaceManifest(outputDir: string, paths: PortablePathMap): { name: string; file: string } {
  const candidates = [
    path.join(outputDir, ".grok-plugin", "marketplace.json"),
    path.join(outputDir, ".claude-plugin", "marketplace.json"),
  ];
  const manifestPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!manifestPath) {
    throw new Error("仓库中没有 .grok-plugin/marketplace.json 或 .claude-plugin/marketplace.json");
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

  for (const rawPlugin of manifest.plugins) {
    const plugin = asRecord(rawPlugin);
    if (!plugin) continue;
    const originalRoot = sourcePath(plugin);
    if (!originalRoot || /^\w+:\/\//.test(originalRoot)) continue;
    const normalizedRoot = originalRoot.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    const safeRoot = paths.get(normalizedRoot) || paths.map(normalizedRoot);
    rewritePluginPaths(plugin, normalizedRoot, safeRoot, paths);
    const materialized = materializeLegacyPlugin(outputDir, plugin, safeRoot);
    const finalRoot = materialized || safeRoot;
    setSourcePath(plugin, `./${finalRoot.replace(/^\.\//, "")}`);
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
    const manifest = rewriteMarketplaceManifest(content, paths);
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
