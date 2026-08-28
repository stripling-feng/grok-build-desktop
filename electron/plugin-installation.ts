import type { AppSettings, PluginInfo } from "./shared";

export type PluginInstallTransactionPorts = {
  install: () => Promise<void>;
  uninstall: (name: string) => Promise<void>;
  loadSettings: () => Promise<AppSettings>;
  installDependency: (command: string) => Promise<unknown>;
  validate: (plugins: PluginInfo[], settings: AppSettings) => Promise<void>;
  restoreAfterRollback?: () => Promise<void>;
};

function addedPlugins(before: AppSettings, after: AppSettings): PluginInfo[] {
  const existing = new Set(before.plugins.map((plugin) => plugin.name.toLowerCase()));
  return after.plugins.filter((plugin) => !existing.has(plugin.name.toLowerCase()));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function installPluginTransaction(ports: PluginInstallTransactionPorts): Promise<AppSettings> {
  const before = await ports.loadSettings();
  let installed: PluginInfo[] = [];
  try {
    await ports.install();
    let current = await ports.loadSettings();
    installed = addedPlugins(before, current);
    if (installed.length === 0) throw new Error("安装命令完成，但没有发现新插件");

    const dependencies = new Map<string, { installable: boolean }>();
    for (const plugin of installed) {
      for (const dependency of plugin.dependencies || []) {
        if (!dependency.available) dependencies.set(dependency.command, { installable: dependency.installable });
      }
    }
    for (const [command, dependency] of dependencies) {
      if (!dependency.installable) throw new Error(`缺少运行环境 ${command}，且没有可用的自动安装器`);
      await ports.installDependency(command);
    }

    current = await ports.loadSettings();
    installed = installed.map((plugin) => current.plugins.find((item) => item.name === plugin.name) || plugin);
    const unresolved = installed.flatMap((plugin) =>
      (plugin.dependencies || []).filter((dependency) => !dependency.available)
        .map((dependency) => `${plugin.name}: ${dependency.command}`),
    );
    if (unresolved.length) throw new Error(`运行环境安装后仍不可用：${unresolved.join("、")}`);

    await ports.validate(installed, current);
    return await ports.loadSettings();
  } catch (error) {
    if (installed.length === 0) {
      try {
        installed = addedPlugins(before, await ports.loadSettings());
      } catch {
        /* Preserve the original installation error. */
      }
    }
    const rollbackErrors: string[] = [];
    for (const plugin of [...installed].reverse()) {
      try {
        await ports.uninstall(plugin.name);
      } catch (rollbackError) {
        rollbackErrors.push(`${plugin.name}: ${messageOf(rollbackError)}`);
      }
    }
    try {
      await ports.restoreAfterRollback?.();
    } catch (restoreError) {
      rollbackErrors.push(`恢复 Grok 代理: ${messageOf(restoreError)}`);
    }
    const rollback = rollbackErrors.length
      ? `；回滚未完全成功：${rollbackErrors.join("；")}`
      : installed.length ? "；已回滚插件安装" : "";
    throw new Error(`插件安装失败：${messageOf(error)}${rollback}`);
  }
}
