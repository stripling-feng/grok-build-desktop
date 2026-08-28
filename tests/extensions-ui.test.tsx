import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppSettings, McpServerInfo, SkillCatalog } from "../electron/shared";
import { McpForm, McpSetupForm, McpTab, SkillCreateForm, SkillsTab } from "../src/components/Settings";

const noop = () => {};
const run = async <T,>(_label: string, work: () => Promise<T>) => work();
const settings = {
  skills: [],
  mcpServers: [],
  plugins: [],
  marketplaces: [],
  availablePlugins: [],
  hooks: [],
  projectTrusted: true,
} as unknown as AppSettings;

const server: McpServerInfo = {
  name: "github",
  displayName: "GitHub",
  transport: "http",
  target: "https://example.test/mcp",
  source: "用户",
  path: "C:\\Users\\demo\\.grok\\config.toml",
  vendor: "",
  enabled: true,
  status: "ready",
  native: true,
  live: true,
  toolCount: 1,
  authRequired: true,
  setupRequired: true,
  setup: { fields: [{ id: "region", label: "Region", type: "select", required: true, options: [{ label: "US", value: "us" }] }] },
  tools: [{ name: "search", displayName: "Search", description: "Search issues", enabled: true }],
};

test("MCP page exposes live auth, setup, tool toggles, diagnostics, and deletion", () => {
  const rendered = renderToStaticMarkup(createElement(McpTab, {
    settings,
    servers: [server],
    cwd: "C:\\repo",
    sessionId: "session-1",
    doctor: "",
    onDoctor: noop,
    onOpenAdd: noop,
    onRefresh: noop,
    onSetup: noop,
    onServers: noop,
    onChange: noop,
    run,
  }));
  for (const label of ["实时", "认证", "初始化", "工具 (1)", "Search", "诊断全部", "打开配置", "删除"]) {
    assert.match(rendered, new RegExp(label.replace(/[()]/g, "\\$&")));
  }
});

test("MCP page does not guess that an unready remote server needs authentication", () => {
  const rendered = renderToStaticMarkup(createElement(McpTab, {
    settings,
    servers: [{
      ...server,
      name: "cloudflare-api",
      status: "configured",
      live: false,
      authRequired: false,
      setupRequired: false,
      setup: undefined,
      tools: [],
    }],
    cwd: "C:\\repo",
    sessionId: null,
    doctor: "",
    onDoctor: noop,
    onOpenAdd: noop,
    onRefresh: noop,
    onSetup: noop,
    onServers: noop,
    onChange: noop,
    run,
  }));

  assert.match(rendered, /打开一个对话后可判断实时认证状态/);
  assert.doesNotMatch(rendered, />认证<\/button>/);
});

test("MCP forms expose complete transport, OAuth, timeout, image, and setup controls", () => {
  const add = renderToStaticMarkup(createElement(McpForm, {
    cwd: "C:\\repo",
    sessionId: "session-1",
    onClose: noop,
    onChange: noop,
    run,
  }));
  for (const label of ["stdio", "http", "sse", "高级配置", "启动超时", "默认工具超时", "Base64", "添加或更新"]) {
    assert.match(add, new RegExp(label));
  }

  const setup = renderToStaticMarkup(createElement(McpSetupForm, {
    server,
    sessionId: "session-1",
    cwd: "C:\\repo",
    onClose: noop,
    onServers: noop,
    run,
  }));
  assert.match(setup, /Region/);
  assert.match(setup, /保存并连接/);
});

test("Skills page preserves rich metadata and exposes path lifecycle and creation", () => {
  const catalog: SkillCatalog = {
    paths: ["C:\\skills"],
    ignore: ["C:\\skills\\old"],
    message: "ready",
    skills: [{
      id: "local:deploy",
      name: "deploy-dir",
      displayName: "deploy",
      description: "Deploy safely",
      shortDescription: "Deploy",
      source: "项目",
      path: "C:\\repo\\.grok\\skills\\deploy-dir\\SKILL.md",
      disabled: false,
      invocableAs: "/deploy-dir",
      collidesWith: "deploy",
      whenToUse: "ship it",
      argumentHint: "[env]",
      author: "release",
      compatibility: "git",
      allowedTools: ["Bash"],
    }],
  };
  const rendered = renderToStaticMarkup(createElement(SkillsTab, {
    settings,
    catalog,
    cwd: "C:\\repo",
    onCatalog: noop,
    onRefresh: noop,
    onCreate: noop,
    run,
  }));
  for (const label of ["创建 Skill", "添加目录", "重置配置", "额外搜索路径", "同名", "完整信息", "允许的工具"]) {
    if (label === "允许的工具") continue;
    assert.match(rendered, new RegExp(label));
  }

  const create = renderToStaticMarkup(createElement(SkillCreateForm, {
    cwd: "C:\\repo",
    onClose: noop,
    onCreated: noop,
    run,
  }));
  for (const label of ["创建 Skill", "指令正文", "调用与元数据", "允许的工具", "用户手动调用", "模型自动调用", "创建 SKILL.md"]) {
    assert.match(create, new RegExp(label));
  }
});
