import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppSettings } from "../electron/shared";
import {
  PluginInstallForm,
  PluginToolsForm,
  PluginUninstallForm,
  PluginsTab,
  MarketForm,
} from "../src/components/Settings";

const noop = () => {};
const run = async <T,>(_label: string, work: () => Promise<T>) => work();

test("plugin install and uninstall modals expose trust and data preservation controls", () => {
  const install = renderToStaticMarkup(createElement(PluginInstallForm, {
    cwd: "C:\\repo",
    onClose: noop,
    onChange: noop,
    run,
  }));
  assert.match(install, /从来源安装插件/);
  assert.match(install, /@ref/);
  assert.match(install, /#subdir/);
  assert.match(install, /信任并安装/);
  assert.match(install, /任何一步失败都会回滚插件/);

  const uninstall = renderToStaticMarkup(createElement(PluginUninstallForm, {
    name: "demo-plugin",
    cwd: "C:\\repo",
    onClose: noop,
    onChange: noop,
    run,
  }));
  assert.match(uninstall, /卸载 demo-plugin/);
  assert.match(uninstall, /保留插件数据/);
  assert.match(uninstall, /checked=""/);
  assert.match(uninstall, /同时卸载/);
});

test("plugin developer tools expose validate and every tag mode", () => {
  const rendered = renderToStaticMarkup(createElement(PluginToolsForm, {
    cwd: "C:\\repo",
    onClose: noop,
    run,
  }));
  assert.match(rendered, /校验 manifest/);
  assert.match(rendered, /仅预览标签/);
  assert.match(rendered, /强制创建/);
  assert.match(rendered, /推送到远程/);
});

test("market source form accepts Grok marketplace sources without bundled presets", () => {
  const rendered = renderToStaticMarkup(createElement(MarketForm, {
    cwd: "C:\\repo",
    marketplaces: [],
    onClose: noop,
    onChange: noop,
    run,
  }));

  assert.match(rendered, /通过 Grok marketplace 注册/);
  assert.match(rendered, /市场源地址/);
  assert.doesNotMatch(rendered, /中文生态|国际精选|推荐市场源/);
});

test("plugin market renders lifecycle actions, source updates, and component inventory", () => {
  const settings = {
    plugins: [{
      name: "demo-plugin",
      version: "1.2.3",
      description: "Installed plugin details",
      scope: "user",
      path: "C:\\plugins\\demo-plugin",
      enabled: true,
      skills: 2,
      agents: 1,
      hooks: true,
      mcpServers: 1,
      commands: 3,
      lspServers: 1,
      dependencies: [{
        command: "uvx",
        available: false,
        requiredBy: ["browser-use"],
        packageName: "uv",
        installLabel: "安装 uv",
        installable: true,
      }],
    }],
    marketplaces: [{ name: "demo-market", kind: "git", url: "owner/catalog" }],
  } as AppSettings;
  const rendered = renderToStaticMarkup(createElement(PluginsTab, {
    settings,
    cwd: "C:\\repo",
    available: [{
      name: "demo-plugin",
      description: "",
      marketplace: "demo-market",
      status: "installed",
      skillCount: 0,
      hasHooks: false,
      hasAgents: false,
      hasMcp: false,
      commandCount: 0,
      hasLsp: false,
    }, {
      name: "catalog-plugin",
      version: "2.0.0",
      description: "Catalog plugin",
      marketplace: "demo-market",
      status: "available",
      skillCount: 1,
      hasHooks: true,
      hasAgents: true,
      hasMcp: true,
      commandCount: 2,
      hasLsp: true,
    }],
    loading: false,
    onRefresh: noop,
    onMarket: noop,
    onInstall: noop,
    onUninstall: noop,
    onChange: noop,
    run,
  }));

  for (const label of ["从来源安装", "更新全部插件", "安装并完成配置", "已安装 · 卸载", "添加市场源", "更新全部源", "重读目录", "缺少运行环境 uvx", "安装 uv"]) {
    assert.match(rendered, new RegExp(label));
  }
  assert.doesNotMatch(rendered, /开发工具/);
  assert.doesNotMatch(rendered, /组件详情|>详情<|>打开<|>启用<|v1\.2\.3|commands [23]|lsp 1|2\.0\.0/);
  assert.doesNotMatch(rendered, /中文推荐市场源|添加此源/);
  assert.doesNotMatch(rendered, /<h3>已安装<\/h3>|plugin-installed-card|plugin-installed-grid/);
  assert.match(rendered, /class="plugin-card plugin-available-card"/);
  assert.match(rendered, /class="plugin-tile-icon"/);
  assert.match(rendered, /class="plugin-tile-description"[^>]*>Catalog plugin/);
  assert.match(rendered, /class="plugin-tile-description"[^>]*>Installed plugin details/);
  assert.match(rendered, /class="market-source-tabs" role="tablist"/);
  assert.match(rendered, /role="tab" aria-selected="true"/);
  assert.match(rendered, /demo-market/);
});
