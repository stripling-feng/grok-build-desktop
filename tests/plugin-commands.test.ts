import assert from "node:assert/strict";
import test from "node:test";
import {
  marketplaceAddArgs,
  marketplaceUpdateArgs,
  pluginDetailsArgs,
  pluginInstallArgs,
  pluginTagArgs,
  pluginUninstallArgs,
  pluginUpdateArgs,
  pluginValidateArgs,
} from "../electron/plugin-commands";
import { pluginDependenciesFromCatalog } from "../electron/runtime-dependencies";
import { installPluginTransaction } from "../electron/plugin-installation";
import type { AppSettings, McpServerInfo, PluginInfo } from "../electron/shared";

test("plugin lifecycle commands preserve Grok CLI flags", () => {
  assert.deepEqual(pluginInstallArgs("owner/repo@v1.0#packages/tool", true), [
    "plugin",
    "install",
    "--trust",
    "owner/repo@v1.0#packages/tool",
  ]);
  assert.deepEqual(pluginUninstallArgs("tool", true), [
    "plugin",
    "uninstall",
    "--confirm",
    "--keep-data",
    "tool",
  ]);
  assert.deepEqual(pluginUninstallArgs("tool", false), ["plugin", "uninstall", "--confirm", "tool"]);
  assert.deepEqual(pluginUpdateArgs(), ["plugin", "update"]);
  assert.deepEqual(pluginUpdateArgs(" tool "), ["plugin", "update", "tool"]);
  assert.deepEqual(pluginDetailsArgs("tool"), ["plugin", "details", "tool"]);
});

test("plugin developer commands support validate and every tag option", () => {
  assert.deepEqual(pluginValidateArgs(), ["plugin", "validate", "."]);
  assert.deepEqual(pluginValidateArgs(" packages/tool "), ["plugin", "validate", "packages/tool"]);
  assert.deepEqual(
    pluginTagArgs({ path: "packages/tool", push: true, force: true, dryRun: false }),
    ["plugin", "tag", "--push", "--force", "packages/tool"],
  );
  assert.deepEqual(
    pluginTagArgs({ path: ".", push: false, force: false, dryRun: true }),
    ["plugin", "tag", "--dry-run", "."],
  );
});

test("marketplace commands support force and targeted or global refresh", () => {
  assert.deepEqual(marketplaceAddArgs("owner/catalog", true), [
    "plugin",
    "marketplace",
    "add",
    "--force",
    "owner/catalog",
  ]);
  assert.deepEqual(marketplaceUpdateArgs(), ["plugin", "marketplace", "update"]);
  assert.deepEqual(marketplaceUpdateArgs("catalog"), ["plugin", "marketplace", "update", "catalog"]);
});

test("plugin command builders reject blank destructive targets", () => {
  assert.throws(() => pluginInstallArgs("  ", true), /插件来源不能为空/);
  assert.throws(() => pluginUninstallArgs("", false), /插件名称不能为空/);
  assert.throws(() => pluginDetailsArgs(" "), /插件名称不能为空/);
  assert.throws(() => marketplaceAddArgs("", false), /市场源不能为空/);
});

test("plugin runtime dependency scan reports a missing stdio launcher", () => {
  const plugin = {
    name: "browser-use",
    path: "C:\\plugins\\browser-use",
    scope: "user",
    enabled: true,
    skills: 1,
    agents: 0,
    hooks: false,
    mcpServers: 1,
    commands: 0,
    lspServers: 0,
  } as PluginInfo;
  const server = {
    name: "browser-use",
    transport: "stdio",
    target: "uvx",
    source: "插件",
    path: "C:\\plugins\\browser-use",
    vendor: "",
    enabled: true,
    status: "enabled",
    native: false,
  } as McpServerInfo;

  const dependencies = pluginDependenciesFromCatalog(plugin, [server], () => null);
  assert.equal(dependencies.length, 1);
  assert.equal(dependencies[0].command, "uvx");
  assert.equal(dependencies[0].available, false);
  assert.equal(dependencies[0].packageName, "uv");
  assert.deepEqual(dependencies[0].requiredBy, ["browser-use"]);
});

test("plugin install transaction installs dependencies before validation", async () => {
  const basePlugin = {
    name: "browser-use",
    path: "C:\\plugins\\browser-use",
    scope: "user",
    enabled: true,
    skills: 1,
    agents: 0,
    hooks: false,
    mcpServers: 1,
    commands: 0,
    lspServers: 0,
  } as PluginInfo;
  let stage = 0;
  let validated = false;
  const appSettings = (plugins: PluginInfo[]) => ({ plugins, mcpServers: [] }) as AppSettings;

  const result = await installPluginTransaction({
    install: async () => { stage = 1; },
    uninstall: async () => { stage = 0; },
    loadSettings: async () => stage === 0
      ? appSettings([])
      : appSettings([{
          ...basePlugin,
          dependencies: [{
            command: "uvx",
            available: stage >= 2,
            requiredBy: ["browser-use"],
            packageName: "uv",
            installLabel: "安装 uv",
            installable: true,
          }],
        }]),
    installDependency: async (command) => {
      assert.equal(command, "uvx");
      stage = 2;
    },
    validate: async () => { validated = true; },
  });

  assert.equal(stage, 2);
  assert.equal(validated, true);
  assert.equal(result.plugins[0].dependencies?.[0].available, true);
});

test("plugin install transaction rolls back when authentication validation fails", async () => {
  const plugin = {
    name: "cloudflare",
    path: "C:\\plugins\\cloudflare",
    scope: "user",
    enabled: true,
    skills: 1,
    agents: 0,
    hooks: false,
    mcpServers: 1,
    commands: 0,
    lspServers: 0,
    dependencies: [],
  } as PluginInfo;
  let installed = false;
  let restored = false;
  const appSettings = () => ({ plugins: installed ? [plugin] : [], mcpServers: [] }) as AppSettings;

  await assert.rejects(() => installPluginTransaction({
    install: async () => { installed = true; },
    uninstall: async (name) => {
      assert.equal(name, "cloudflare");
      installed = false;
    },
    loadSettings: async () => appSettings(),
    installDependency: async () => {},
    validate: async () => { throw new Error("OAuth cancelled"); },
    restoreAfterRollback: async () => { restored = true; },
  }), /插件安装失败：OAuth cancelled；已回滚插件安装/);

  assert.equal(installed, false);
  assert.equal(restored, true);
});
