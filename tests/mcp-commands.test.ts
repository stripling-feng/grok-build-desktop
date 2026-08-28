import assert from "node:assert/strict";
import test from "node:test";
import {
  mcpAddArgs,
  mcpAuthenticationSettled,
  mcpAuthResultError,
  mcpAuthTriggerParams,
  mcpDeleteParams,
  mcpRuntimeReady,
  mcpRuntimeSettled,
  mcpToggleParams,
  mcpToggleToolParams,
  mcpUpsertParams,
  parseMcpArguments,
  parseMcpToolTimeouts,
  validateMcpAddInput,
} from "../electron/mcp-commands";
import { patchMcpAdvancedConfig } from "../electron/mcp-config";
import { mapMcpCatalog, parseMcpDoctorReport } from "../electron/grok-cli";
import {
  grokExtensionMethodCandidates,
  grokExtensionNotificationMethod,
  isMethodNotFoundError,
} from "../electron/acp-extensions";
import type { McpAddInput } from "../electron/shared";

const stdio: McpAddInput = {
  name: "filesystem",
  transport: "stdio",
  scope: "user",
  commandOrUrl: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "C:\\My Files"],
  env: ["MODE=read only"],
};

test("MCP CLI builder preserves stdio argument boundaries", () => {
  assert.deepEqual(mcpAddArgs(stdio), [
    "mcp", "add", "--transport", "stdio", "--scope", "user", "-e", "MODE=read only",
    "filesystem", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "C:\\My Files",
  ]);
  assert.deepEqual(parseMcpArguments('-y "C:\\My Files" \'two words\''), ["-y", "C:\\My Files", "two words"]);
  assert.deepEqual(parseMcpArguments("--flag\nC:\\My Files"), ["--flag", "C:\\My Files"]);
  assert.throws(() => parseMcpArguments('"unfinished'), /未闭合/);
});

test("MCP validation rejects unsafe or malformed configuration", () => {
  assert.throws(() => validateMcpAddInput({ ...stdio, scope: "project" }), /先选择项目/);
  assert.throws(() => validateMcpAddInput({ ...stdio, env: ["1BAD=value"] }), /环境变量格式无效/);
  assert.throws(() => validateMcpAddInput({ ...stdio, transport: "http", commandOrUrl: "file:///tmp/x" }), /只支持 http/);
  assert.deepEqual(parseMcpToolTimeouts("search=30\ncreate_issue=120"), { search: 30, create_issue: 120 });
  assert.throws(() => parseMcpToolTimeouts("search=nope"), /tool_name=秒数/);
});

test("ACP management params match Grok's mixed snake/camel wire contract", () => {
  assert.deepEqual(mcpToggleParams("s1", "github", true), { session_id: "s1", server_name: "github", enabled: true });
  assert.deepEqual(mcpToggleToolParams("s1", "github", "search", false), {
    session_id: "s1", server_name: "github", tool_name: "search", enabled: false,
  });
  assert.deepEqual(mcpAuthTriggerParams("s1", "github"), { session_id: "s1", server_name: "github" });
  assert.deepEqual(mcpDeleteParams("s1", "github"), { session_id: "s1", server_name: "github" });
});

test("ACP upsert includes complete stdio and remote configuration", () => {
  assert.deepEqual(mcpUpsertParams("s1", {
    ...stdio,
    serverCwd: "C:\\repo",
    startupTimeoutSec: 15,
    toolTimeoutSec: 60,
    toolTimeouts: { search: 20 },
    exposeImageBase64: true,
  }), {
    session_id: "s1",
    server_name: "filesystem",
    enabled: true,
    startup_timeout_sec: 15,
    tool_timeout_sec: 60,
    tool_timeouts: { search: 20 },
    expose_image_base64: true,
    command: "npx",
    args: stdio.args,
    env: { MODE: "read only" },
    cwd: "C:\\repo",
  });

  assert.deepEqual(mcpUpsertParams("s2", {
    name: "remote",
    transport: "sse",
    scope: "user",
    commandOrUrl: "https://example.test/sse",
    headers: ["X-Team: desktop"],
    bearerTokenEnvVar: "MCP_TOKEN",
    oauthClientId: "client",
    oauthClientSecretEnvVar: "MCP_SECRET",
    oauthScopes: ["read", "write"],
  }), {
    session_id: "s2",
    server_name: "remote",
    enabled: true,
    url: "https://example.test/sse",
    type: "sse",
    headers: { "X-Team": "desktop" },
    bearer_token_env_var: "MCP_TOKEN",
    oauth_client_id: "client",
    oauth_client_secret_env_var: "MCP_SECRET",
    oauth_scopes: ["read", "write"],
  });
});

test("advanced MCP TOML patch preserves ordinary keys and replaces managed fields", () => {
  const before = [
    "[models]",
    'default = "grok-4"',
    "",
    '[mcp_servers."filesystem"]',
    'command = "npx"',
    'args = ["-y"]',
    "tool_timeout_sec = 5",
    "",
    "[mcp_servers.other]",
    'url = "https://example.test/mcp"',
    "",
  ].join("\n");
  const after = patchMcpAdvancedConfig(before, "filesystem", {
    ...stdio,
    serverCwd: "C:\\repo",
    startupTimeoutSec: 20,
    toolTimeoutSec: 90,
    toolTimeouts: { search: 30 },
    exposeImageBase64: true,
  });
  assert.match(after, /command = "npx"/);
  assert.match(after, /cwd = "C:\\\\repo"/);
  assert.match(after, /startup_timeout_sec = 20/);
  assert.match(after, /tool_timeout_sec = 90/);
  assert.match(after, /tool_timeouts = \{ "search" = 30 \}/);
  assert.match(after, /\[mcp_servers\.other\]/);
  assert.equal((after.match(/tool_timeout_sec/g) ?? []).length, 1);
});

test("live MCP catalog mapping retains setup, auth, tools, and disk identity", () => {
  const [mapped] = mapMcpCatalog({
    servers: [{
      name: "github",
      displayName: "GitHub",
      source: "local",
      sourceLabel: "Plugin: github-tools",
      type: "http",
      url: "https://example.test/mcp",
      setup: {
        fields: [{
          id: "region",
          label: "Region",
          type: "select",
          required: true,
          default: "us",
          options: [{ label: "US", value: "us" }],
        }],
      },
      setupValues: { region: "us" },
      session: {
        enabled: true,
        status: "ready",
        authRequired: true,
        setupRequired: true,
        tools: [{ name: "search", displayName: "Search", description: "Search issues", enabled: false }],
      },
    }],
  }, [{
    name: "github",
    transport: "http",
    target: "https://old.test/mcp",
    source: "用户",
    path: "C:\\Users\\demo\\.grok\\config.toml",
    vendor: "grok",
    enabled: true,
    status: "configured",
    native: true,
  }]);

  assert.equal(mapped.displayName, "GitHub");
  assert.equal(mapped.source, "插件 · github-tools");
  assert.equal(mapped.path, "C:\\Users\\demo\\.grok\\config.toml");
  assert.equal(mapped.status, "ready");
  assert.equal(mapped.live, true);
  assert.equal(mapped.authRequired, true);
  assert.equal(mapped.setupRequired, true);
  assert.deepEqual(mapped.setupValues, { region: "us" });
  assert.deepEqual(mapped.setup?.fields[0].options, [{ label: "US", value: "us" }]);
  assert.deepEqual(mapped.tools, [{ name: "search", displayName: "Search", description: "Search issues", enabled: false }]);
});

test("live MCP catalog treats an explicit OAuth-required status as authentication required", () => {
  const [mapped] = mapMcpCatalog({
    servers: [{
      name: "cloudflare-api",
      type: "http",
      url: "https://mcp.cloudflare.com/mcp",
      session: {
        enabled: true,
        status: "OAuth authorization required",
      },
    }],
  });

  assert.equal(mapped.authRequired, true);
  assert.equal(mapped.status, "OAuth authorization required");
});

test("Grok ACP extension requests use the underscore wire namespace with compatibility fallback", () => {
  assert.deepEqual(grokExtensionMethodCandidates("x.ai/mcp/list"), ["_x.ai/mcp/list", "x.ai/mcp/list"]);
  assert.deepEqual(grokExtensionMethodCandidates("_x.ai/skills/config"), ["_x.ai/skills/config", "x.ai/skills/config"]);
  assert.equal(grokExtensionNotificationMethod("_x.ai/mcp/server_status"), "x.ai/mcp/server_status");
  assert.equal(grokExtensionNotificationMethod("x.ai/skills/config"), "x.ai/skills/config");
  assert.equal(grokExtensionNotificationMethod("session/update"), null);
  assert.equal(isMethodNotFoundError(new Error("Method not found")), true);
  assert.throws(() => grokExtensionMethodCandidates("session/new"), /不允许的扩展方法/);
});

test("MCP runtime does not settle while initialization is still in progress", () => {
  const runtime = (status: string, extra: Partial<McpServerInfo> = {}): McpServerInfo => ({
    name: "cloudflare-api",
    transport: "http",
    target: "https://mcp.cloudflare.com/mcp",
    source: "插件 · cloudflare",
    path: "",
    vendor: "",
    enabled: true,
    status,
    native: false,
    live: true,
    ...extra,
  });

  assert.equal(mcpRuntimeSettled(runtime("initializing")), false);
  assert.equal(mcpRuntimeReady(runtime("initializing")), false);
  assert.equal(mcpAuthenticationSettled(runtime("initializing")), false);
  assert.equal(mcpRuntimeSettled(runtime("unavailable", { authRequired: true })), true);
  assert.equal(mcpRuntimeReady(runtime("unavailable", { authRequired: true })), false);
  assert.equal(mcpAuthenticationSettled(runtime("unavailable", { authRequired: true })), false);
  assert.equal(mcpRuntimeSettled(runtime("ready")), true);
  assert.equal(mcpRuntimeReady(runtime("ready")), true);
  assert.equal(mcpAuthenticationSettled(runtime("ready")), true);
  assert.equal(mcpAuthenticationSettled(runtime("needs setup", { setupRequired: true })), true);
});

test("MCP authentication failures are recognized through result envelopes", () => {
  assert.equal(mcpAuthResultError({ status: "success" }), null);
  assert.equal(mcpAuthResultError({ result: { status: "cancelled", message: "OAuth cancelled" } }), "OAuth cancelled");
  assert.equal(mcpAuthResultError({ status: "failed", error: "denied" }), "denied");
});

test("live MCP catalog unwraps the ACP extension result envelope", () => {
  const [mapped] = mapMcpCatalog({
    result: {
      servers: [{
        name: "cloudflare-api",
        type: "http",
        url: "https://mcp.cloudflare.com/mcp",
        session: { enabled: true, status: "ready", tools: [{ name: "accounts_list" }] },
      }],
    },
  });

  assert.equal(mapped.name, "cloudflare-api");
  assert.equal(mapped.live, true);
  assert.equal(mapped.status, "ready");
  assert.equal(mapped.toolCount, 1);
});

test("MCP doctor JSON retains health and failed check details for runtime fallback", () => {
  const report = parseMcpDoctorReport({
    servers: [{
      name: "browser-use",
      healthy: true,
      checks: [
        { label: "command found", passed: true, detail: "C:\\tools\\uvx.exe" },
        { label: "handshake OK", passed: true, detail: "protocol 2025-11-25" },
      ],
    }],
    healthy_count: 1,
    failing_count: 0,
  });

  assert.equal(report.healthyCount, 1);
  assert.equal(report.failingCount, 0);
  assert.equal(report.servers[0].healthy, true);
  assert.deepEqual(report.servers[0].checks[1], {
    label: "handshake OK",
    passed: true,
    detail: "protocol 2025-11-25",
  });
});
