import fs from "node:fs";
import path from "node:path";
import { app, session as electronSession, type Session } from "electron";
import {
  preferredAuthMethod,
  readApiProviderConfig,
} from "./account-config";
import { grokHome } from "./sessions";
import type {
  ProxySettings,
  ProxyTestResult,
} from "./shared";
import { normalizeProxySettings } from "./proxy-config";

export const OAUTH_DISCOVERY_URL = "https://auth.x.ai/.well-known/openid-configuration";

const DEFAULT_SETTINGS: ProxySettings = { mode: "system", url: "" };
const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
] as const;
const INHERITED_PROXY =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.ALL_PROXY ||
  process.env.all_proxy ||
  "";

function settingsPath() {
  return path.join(app.getPath("userData"), "network-settings.json");
}

function readConfigText(): string {
  try {
    return fs.readFileSync(path.join(grokHome(), "config.toml"), "utf8");
  } catch {
    return "";
  }
}

export function loadProxySettings(): ProxySettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Partial<ProxySettings>;
    return normalizeProxySettings(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveProxySettings(input: Partial<ProxySettings>): ProxySettings {
  const settings = normalizeProxySettings(input);
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

export function currentGrokTarget(): string {
  const config = readConfigText();
  if (preferredAuthMethod(config) === "api_key") {
    return readApiProviderConfig(config)?.baseUrl || OAUTH_DISCOVERY_URL;
  }
  return OAUTH_DISCOVERY_URL;
}

function proxyUrlFromRules(rules: string): string | null {
  for (const rule of rules.split(";")) {
    const match = rule.trim().match(/^(PROXY|HTTPS|SOCKS5|SOCKS4|SOCKS)\s+(.+)$/i);
    if (!match) continue;
    const scheme = match[1].toUpperCase().startsWith("SOCKS") ? "socks5" : "http";
    const candidate = `${scheme}://${match[2].trim()}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.hostname) return candidate;
    } catch {
      /* try the next proxy rule */
    }
  }
  return null;
}

function safeProxyLabel(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "已配置";
  }
}

async function configureSession(target: Session, settings: ProxySettings) {
  if (settings.mode === "direct") {
    await target.setProxy({ mode: "direct" });
  } else if (settings.mode === "manual") {
    await target.setProxy({ mode: "fixed_servers", proxyRules: settings.url });
  } else {
    await target.setProxy({ mode: "system" });
  }
  await target.closeAllConnections();
}

async function effectiveProxy(
  settings: ProxySettings,
  targetUrl: string,
  targetSession = electronSession.defaultSession,
): Promise<{ proxy: string | null; route: string }> {
  if (settings.mode === "direct") return { proxy: null, route: "直连" };
  if (settings.mode === "manual") {
    return { proxy: settings.url, route: `手动代理 ${safeProxyLabel(settings.url)}` };
  }
  if (INHERITED_PROXY) {
    return { proxy: INHERITED_PROXY, route: `系统代理 ${safeProxyLabel(INHERITED_PROXY)}` };
  }
  const proxy = proxyUrlFromRules(await targetSession.resolveProxy(targetUrl));
  return proxy
    ? { proxy, route: `系统代理 ${safeProxyLabel(proxy)}` }
    : { proxy: null, route: "系统设置：直连" };
}

export async function applyStoredProxySettings(targetUrl = currentGrokTarget()): Promise<string> {
  const settings = loadProxySettings();
  await configureSession(electronSession.defaultSession, settings);
  return (await effectiveProxy(settings, targetUrl)).route;
}

export async function proxyEnvironmentForTarget(
  targetUrl = currentGrokTarget(),
  input: ProxySettings = loadProxySettings(),
): Promise<NodeJS.ProcessEnv> {
  const settings = normalizeProxySettings(input);
  if (settings.mode === "system") {
    await electronSession.defaultSession.setProxy({ mode: "system" });
  }
  const { proxy } = await effectiveProxy(settings, targetUrl);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of PROXY_ENV_KEYS) delete env[key];
  if (proxy) {
    env.HTTP_PROXY = proxy;
    env.HTTPS_PROXY = proxy;
    env.ALL_PROXY = proxy;
    env.http_proxy = proxy;
    env.https_proxy = proxy;
    env.all_proxy = proxy;
  }
  return env;
}

export async function testProxySettings(
  input: Partial<ProxySettings>,
  target: "oauth" | "api",
): Promise<ProxyTestResult> {
  const settings = normalizeProxySettings(input);
  const savedApi = readApiProviderConfig(readConfigText());
  if (target === "api" && !savedApi) {
    return {
      ok: false,
      target,
      route: "—",
      durationMs: 0,
      message: "请先保存 API 登录配置",
    };
  }
  const targetUrl = target === "api" ? `${savedApi!.baseUrl}/models` : OAUTH_DISCOVERY_URL;
  const testSession = electronSession.fromPartition("grok-proxy-test", { cache: false });
  await configureSession(testSession, settings);
  const { route } = await effectiveProxy(settings, targetUrl, testSession);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const startedAt = Date.now();
  try {
    const response = await testSession.fetch(targetUrl, {
      method: "GET",
      headers:
        target === "api" && savedApi?.apiKey
          ? { Authorization: `Bearer ${savedApi.apiKey}`, Accept: "application/json" }
          : { Accept: "application/json" },
      signal: controller.signal,
    });
    const durationMs = Date.now() - startedAt;
    return {
      ok: true,
      target,
      route,
      durationMs,
      status: response.status,
      message: response.ok
        ? `连接成功（HTTP ${response.status}）`
        : `已连接到服务器（HTTP ${response.status}）`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      target,
      route,
      durationMs: Date.now() - startedAt,
      message: /abort/i.test(message) ? "连接超时" : `连接失败：${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
