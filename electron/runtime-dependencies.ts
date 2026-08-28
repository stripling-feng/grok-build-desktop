import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { McpServerInfo, PluginDependencyInfo, PluginInfo } from "./shared";

const execFileAsync = promisify(execFile);

type KnownInstaller = {
  packageName: string;
  buttonLabel: string;
  wingetId: string;
};

const KNOWN_INSTALLERS: Record<string, KnownInstaller> = {
  uvx: {
    packageName: "uv",
    buttonLabel: "安装 uv",
    wingetId: "astral-sh.uv",
  },
};

function executableNames(command: string): string[] {
  if (process.platform !== "win32" || path.extname(command)) return [command];
  return [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`];
}

function wingetLinksDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "WinGet", "Links");
}

function windowsAppsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "WindowsApps");
}

function wingetPackageDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "WinGet", "Packages");
  const packagePrefixes = [...new Set(Object.values(KNOWN_INSTALLERS).map((installer) => `${installer.wingetId}_`.toLowerCase()))];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && packagePrefixes.some((prefix) => entry.name.toLowerCase().startsWith(prefix)))
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function pluginRuntimeDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  if (process.platform !== "win32") return [];
  return [wingetLinksDirectory(env), windowsAppsDirectory(env), ...wingetPackageDirectories(env)];
}

function isRunnablePath(candidate: string): boolean {
  try {
    const info = fs.lstatSync(candidate);
    // Windows App Execution Aliases (including winget.exe) are reparse points,
    // not regular files. CreateProcess can still launch them normally.
    return !info.isDirectory();
  } catch {
    return false;
  }
}

function searchDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = (env.PATH || env.Path || env.path || "")
    .split(path.delimiter)
    .map((value) => value.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  if (process.platform === "win32") {
    dirs.push(...pluginRuntimeDirectories(env));
  }
  return [...new Set(dirs.map((value) => path.resolve(value)))];
}

export function ensurePluginRuntimePath(env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform !== "win32") return;
  let currentPath = env.PATH || env.Path || env.path || "";
  const normalized = new Set(currentPath.split(path.delimiter)
    .filter((item) => item.trim())
    .map((item) => path.resolve(item.trim().replace(/^"|"$/g, "")).toLowerCase()));
  const additions = pluginRuntimeDirectories(env).filter((directory) => {
    const identity = path.resolve(directory).toLowerCase();
    if (normalized.has(identity)) return false;
    normalized.add(identity);
    return fs.existsSync(directory);
  });
  if (additions.length) {
    currentPath = `${additions.join(path.delimiter)}${path.delimiter}${currentPath}`;
    env.PATH = currentPath;
  }
}

export function resolveRuntimeCommand(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const value = command.trim().replace(/^"|"$/g, "");
  if (!value || /[\r\n\0]/.test(value)) return null;
  if (path.isAbsolute(value)) {
    return executableNames(value).find(isRunnablePath) || null;
  }
  for (const dir of searchDirectories(env)) {
    for (const name of executableNames(value)) {
      const candidate = path.join(dir, name);
      if (isRunnablePath(candidate)) return candidate;
    }
  }
  return null;
}

export function pluginOwnsServer(plugin: PluginInfo, server: McpServerInfo): boolean {
  if (!/插件|plugin/i.test(server.source)) return false;
  if (!plugin.path || !server.path) return false;
  const pluginPath = path.resolve(plugin.path).toLowerCase();
  const serverPath = path.resolve(server.path).toLowerCase();
  return serverPath === pluginPath || serverPath.startsWith(`${pluginPath}${path.sep}`);
}

function stdioCommand(server: McpServerInfo): string {
  if (server.transport !== "stdio") return "";
  const target = server.target.trim();
  if (!target) return "";
  if (target.startsWith('"')) {
    const end = target.indexOf('"', 1);
    return end > 1 ? target.slice(1, end) : "";
  }
  return target.split(/\s+/, 1)[0];
}

export function pluginDependenciesFromCatalog(
  plugin: PluginInfo,
  servers: McpServerInfo[],
  resolveCommand: (command: string) => string | null = resolveRuntimeCommand,
): PluginDependencyInfo[] {
  const commands = new Map<string, Set<string>>();
  for (const server of servers) {
    if (!pluginOwnsServer(plugin, server)) continue;
    const command = stdioCommand(server);
    if (!command) continue;
    const names = commands.get(command) || new Set<string>();
    names.add(server.name);
    commands.set(command, names);
  }
  return [...commands].map(([command, serverNames]) => {
    const installer = KNOWN_INSTALLERS[command.toLowerCase()];
    return {
      command,
      available: Boolean(resolveCommand(command)),
      requiredBy: [...serverNames],
      packageName: installer?.packageName,
      installLabel: installer?.buttonLabel,
      installable: Boolean(installer) && process.platform === "win32",
    };
  });
}

export function attachPluginRuntimeDependencies(plugins: PluginInfo[], servers: McpServerInfo[]): PluginInfo[] {
  return plugins.map((plugin) => ({
    ...plugin,
    dependencies: pluginDependenciesFromCatalog(plugin, servers),
  }));
}

export async function installPluginRuntimeDependency(command: string): Promise<{ command: string; packageName: string }> {
  const normalized = command.trim().toLowerCase();
  const installer = KNOWN_INSTALLERS[normalized];
  if (!installer) throw new Error(`暂不支持自动安装运行环境：${command}`);
  ensurePluginRuntimePath();
  if (resolveRuntimeCommand(normalized)) return { command: normalized, packageName: installer.packageName };
  if (process.platform !== "win32") throw new Error(`请先手动安装 ${installer.packageName}`);
  const winget = resolveRuntimeCommand("winget");
  if (!winget) throw new Error(`未找到 winget，请先手动安装 ${installer.packageName}`);
  await execFileAsync(winget, [
    "install",
    "--id",
    installer.wingetId,
    "--exact",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--disable-interactivity",
  ], {
    windowsHide: true,
    timeout: 5 * 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  ensurePluginRuntimePath();
  if (!resolveRuntimeCommand(normalized)) {
    throw new Error(`${installer.packageName} 已安装，但仍未找到 ${command}`);
  }
  return { command: normalized, packageName: installer.packageName };
}
