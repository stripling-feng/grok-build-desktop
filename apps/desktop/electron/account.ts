import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configPath, getDefaultModelDisplayName, setTableKey } from "./config";
import { grokBin } from "./grok-bin";
import { grokHome } from "./sessions";
import type { AccountInfo, AccountUsage } from "./shared";

const OAUTH_SCOPE = "https://accounts.x.ai/sign-in";
const API_KEY_SCOPE = "xai::api_key";
const CC_SWITCH_DB = path.join(os.homedir(), ".cc-switch", "cc-switch.db");

const KNOWN_OAUTH_HOSTS = [
  "accounts.x.ai",
  "x.ai",
  "auth.x.ai",
  "console.x.ai",
];

function isPlaceholderKey(key: string): boolean {
  return !key || /^(PROXY_MANAGED|YOUR_.*|changeme)$/i.test(key);
}

function isLoopback(url: string): boolean {
  return /127\.0\.0\.1|localhost/i.test(url);
}

function walkStrings(value: unknown, visit: (key: string, text: string) => void, parent = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit, parent);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const pathKey = parent ? `${parent}.${key}` : key;
    if (typeof child === "string") visit(pathKey, child);
    else walkStrings(child, visit, pathKey);
  }
}

function providerDisplayName(raw: string, fallback: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const name =
        str(obj.name) ||
        str(obj.providerName) ||
        str(obj.displayName) ||
        str(obj.alias) ||
        str(obj.title);
      if (name) return name;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function credsFromProviderBlob(raw: string): { baseUrl: string; apiKey: string } | null {
  if (!raw) return null;
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* leave parsed as raw string; nothing else to do here */
  }
  let baseUrl = "";
  let apiKey = "";
  walkStrings(parsed, (key, text) => {
    const lk = key.toLowerCase();
    if (/base[_-]?url|endpoint|apiurl/.test(lk) && text.startsWith("http") && !isLoopback(text) && !baseUrl) {
      baseUrl = text.replace(/\/+$/, "");
    }
    if (/(api[_-]?key|apikey|token|secret)/.test(lk) && !isPlaceholderKey(text) && text.length > 8 && !apiKey) {
      apiKey = text;
    }
  });
  if (baseUrl && apiKey) return { baseUrl, apiKey };
  return null;
}

export type CcSwitchProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
};

export function listCcSwitchProviders(): CcSwitchProvider[] {
  if (!fs.existsSync(CC_SWITCH_DB)) return [];
  try {
    const script = [
      "import sqlite3,sys,json",
      "con=sqlite3.connect(sys.argv[1])",
      "cur=con.cursor()",
      "rows=cur.execute(\"SELECT id,name,settings_config FROM providers WHERE app_type='grokbuild' ORDER BY id\").fetchall()",
      "out=[]",
      "for r in rows:",
      "  out.append({'id':r[0],'name':r[1],'config':r[2]})",
      "print(json.dumps(out))",
    ].join("\n");
    const raw = execFileSync("python", ["-c", script, CC_SWITCH_DB], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    }).trim();
    if (!raw) return [];
    const rows = JSON.parse(raw) as Array<{ id: string | number; name: string | null; config: string }>;
    const providers: CcSwitchProvider[] = [];
    for (const row of rows) {
      const creds = credsFromProviderBlob(row.config || "");
      if (!creds) continue;
      providers.push({
        id: String(row.id),
        name: providerDisplayName(row.config || "", row.name || "中转站"),
        baseUrl: creds.baseUrl,
        apiKey: creds.apiKey,
      });
    }
    return providers;
  } catch {
    return [];
  }
}

export function getCcSwitchProvider(id: string): CcSwitchProvider | null {
  return listCcSwitchProviders().find((p) => p.id === id) ?? null;
}

type AuthEntry = {
  key?: string;
  access_token?: string;
  email?: string;
  user_id?: string;
  principal_display_name?: string;
  principal_id?: string;
  issuer?: string;
  [k: string]: unknown;
};

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (padded.length % 4)) % 4);
    const json = Buffer.from(padded + pad, "base64").toString("utf8");
    return asRecord(JSON.parse(json));
  } catch {
    return null;
  }
}

function nameFromClaims(claims: Record<string, unknown> | null): {
  name?: string;
  email?: string;
} {
  if (!claims) return {};
  const email =
    str(claims.email) ||
    str(claims.preferred_username) ||
    str(claims.upn) ||
    str(claims.unique_name);
  const name =
    str(claims.principal_display_name) ||
    str(claims.name) ||
    str(claims.display_name) ||
    str(claims.given_name) ||
    email;
  return { name, email };
}

function entryToken(entry: AuthEntry): string | undefined {
  return str(entry.key) || str(entry.access_token);
}

function parseAuthFile(): {
  method: AccountInfo["method"];
  name?: string;
  email?: string;
  token?: string;
} {
  const fromEnv = process.env.GROK_AUTH;
  const raw = fromEnv
    ? (() => {
        try {
          return JSON.parse(fromEnv) as Record<string, unknown>;
        } catch {
          return readJson(path.join(grokHome(), "auth.json"));
        }
      })()
    : readJson(path.join(grokHome(), "auth.json"));
  if (!raw) return { method: "none" };

  const oauth =
    asRecord(raw[OAUTH_SCOPE]) ||
    Object.entries(raw)
      .filter(([k]) => /accounts\.x\.ai|sign-in|oauth/i.test(k))
      .map(([, v]) => asRecord(v))
      .find(Boolean);

  if (oauth) {
    const entry = oauth as AuthEntry;
    const token = entryToken(entry);
    const claims = token ? decodeJwtClaims(token) : null;
    const fromJwt = nameFromClaims(claims);
    const email = str(entry.email) || fromJwt.email;
    const name =
      str(entry.principal_display_name) ||
      fromJwt.name ||
      email ||
      str(entry.principal_id) ||
      str(entry.user_id);
    return { method: "oauth", name, email, token };
  }

  const apiKeyEntry = asRecord(raw[API_KEY_SCOPE]) as AuthEntry | null;
  if (apiKeyEntry && entryToken(apiKeyEntry)) {
    return { method: "api-key", name: "API Key" };
  }

  return { method: "none" };
}

function hasConfigApiKey(): boolean {
  if (process.env.XAI_API_KEY?.trim()) return true;
  const file = path.join(grokHome(), "config.toml");
  if (!fs.existsSync(file)) return false;
  try {
    const text = fs.readFileSync(file, "utf8");
    return /^\s*api_key\s*=\s*".+"/m.test(text);
  } catch {
    return false;
  }
}

function proxyBase(): string {
  const raw =
    process.env.GROK_CLI_CHAT_PROXY_BASE_URL || "https://cli-chat-proxy.grok.com/v1";
  return raw.replace(/\/+$/, "");
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function formatCount(n: number): string {
  if (Math.abs(n) >= 1000 && Number.isInteger(n)) return n.toLocaleString("zh-CN");
  if (!Number.isInteger(n)) return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  return String(n);
}

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return value;
  return new Date(t).toLocaleDateString("zh-CN");
}

export function loadAccount(): AccountInfo {
  const parsed = parseAuthFile();
  if (parsed.method === "oauth") {
    return {
      method: "oauth",
      name: parsed.name || parsed.email || "已登录",
      email: parsed.email,
    };
  }
  if (parsed.method === "api-key" || hasConfigApiKey()) {
    return { method: "api-key", name: getDefaultModelDisplayName() };
  }
  return { method: "none", name: "未登录" };
}

const CUSTOM_MODEL_ID = "desktop-api";

export type ApiProviderInput = {
  baseUrl: string;
  apiKey: string;
  model?: string;
};

function normalizeBaseUrl(raw: string) {
  const url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error("请填写有效的 Base URL，例如 https://api.x.ai/v1");
  return url;
}

function writeApiProvider(input: ApiProviderInput) {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = input.apiKey.trim();
  const model = (input.model || "grok-4.6").trim() || "grok-4.6";
  const file = configPath();
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  let next = prev;
  next = setTableKey(next, "models", "default", JSON.stringify(CUSTOM_MODEL_ID));
  next = setTableKey(next, "endpoints", "xai_api_base_url", JSON.stringify(baseUrl));
  next = setTableKey(next, "endpoints", "models_base_url", JSON.stringify(baseUrl));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "model", JSON.stringify(model));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "base_url", JSON.stringify(baseUrl));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "name", JSON.stringify("API"));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "api_key", JSON.stringify(apiKey));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "api_backend", JSON.stringify("chat_completions"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next.endsWith("\n") ? next : `${next}\n`, "utf8");
}

function writeAuthApiKey(key: string) {
  const file = path.join(grokHome(), "auth.json");
  const prev = readJson(file) ?? {};
  prev[API_KEY_SCOPE] = { key };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(prev, null, 2)}\n`, "utf8");
}

export function saveApiKey(input: ApiProviderInput): AccountInfo {
  const key = input.apiKey.trim();
  if (!key) throw new Error("请输入 API Key");
  writeApiProvider(input);
  writeAuthApiKey(key);
  return loadAccount();
}

export function clearApiKey(): AccountInfo {
  const file = configPath();
  if (fs.existsSync(file)) {
    let text = fs.readFileSync(file, "utf8");
    text = setTableKey(text, "models", "default", JSON.stringify(""));
    text = setTableKey(text, "endpoints", "xai_api_base_url", JSON.stringify(""));
    text = setTableKey(text, "endpoints", "models_base_url", JSON.stringify(""));
    text = setTableKey(text, `model.${CUSTOM_MODEL_ID}`, "model", JSON.stringify(""));
    text = setTableKey(text, `model.${CUSTOM_MODEL_ID}`, "base_url", JSON.stringify(""));
    text = setTableKey(text, `model.${CUSTOM_MODEL_ID}`, "name", JSON.stringify(""));
    text = setTableKey(text, `model.${CUSTOM_MODEL_ID}`, "api_key", JSON.stringify(""));
    text = setTableKey(text, `model.${CUSTOM_MODEL_ID}`, "api_backend", JSON.stringify(""));
    fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  }
  const authFile = path.join(grokHome(), "auth.json");
  if (fs.existsSync(authFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(authFile, "utf8")) as Record<string, unknown>;
      if (prev[API_KEY_SCOPE]) {
        prev[API_KEY_SCOPE] = { key: "" };
        fs.writeFileSync(authFile, `${JSON.stringify(prev, null, 2)}\n`, "utf8");
      }
    } catch {
      /* ignore */
    }
  }
  return loadAccount();
}

export type AccountLoginResult = {
  ok: boolean;
  account: AccountInfo;
  message?: string;
  url?: string;
};

function extractHttpUrls(text: string): string[] {
  const clean = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  return (clean.match(/https?:\/\/[^\s)>\]]+/g) ?? [])
    .map((url) => url.replace(/[.,;]+$/, ""))
    .filter((url) => /^https?:\/\//i.test(url) && !/^https?:\/\/127\.0\.0\.1/i.test(url));
}

function isOAuthUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "127.0.0.1" || host === "localhost") return false;
    return KNOWN_OAUTH_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  } catch {
    return false;
  }
}

function spawnLoginWindow(bin: string, urlFile: string) {
  const env = { ...process.env, GROK_TEST_OPEN_URL_FILE: urlFile };
  const args = ["login", "--oauth"];
  if (process.platform === "win32") {
    try {
      return spawn(bin, args, {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env,
        windowsHide: true,
      });
    } catch {
      /* fall through to powershell */
    }
    const ps = [
      "&",
      JSON.stringify(bin),
      args.map((a) => (/\s/.test(a) ? `'${a.replace(/'/g, "''")}'` : a)).join(" "),
    ].join(" ");
    return spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Normal", "-Command", ps], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env,
    });
  }
  return spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    env,
  });
}

function looksLikeNetworkFailure(stderr: string): boolean {
  return /timed out|timeout|connection refused|network is unreachable|no such host|dns|connect error/i.test(stderr);
}

export function startAccountLogin(
  openUrl: (url: string) => void,
  options: { signal?: AbortSignal } = {},
): Promise<AccountLoginResult> {
  const bin = grokBin();
  if (!bin) {
    return Promise.resolve({
      ok: false,
      account: loadAccount(),
      message: "未找到 Grok CLI（请先安装 Grok CLI，或改用 API 登录）",
    });
  }

  return new Promise((resolve) => {
    const urlFile = path.join(os.tmpdir(), `grok-oauth-${Date.now()}.txt`);
    let settled = false;
    let opened = "";
    let childError: string | null = null;
    let childExit = false;
    let stderrBuf = "";
    let stdoutBuf = "";
    let exitTimer: ReturnType<typeof setTimeout> | null = null;
    const child = spawnLoginWindow(bin, urlFile);
    child.unref();

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdoutBuf += chunk;
        if (stdoutBuf.length > 8192) stdoutBuf = stdoutBuf.slice(-8192);
        for (const url of extractHttpUrls(stdoutBuf)) {
          if (isOAuthUrl(url)) openOnce(url);
        }
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrBuf += chunk;
        if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-8192);
        // Grok CLI 1.0.5 writes the human-facing login prompt (including the
        // authorization URL) to stderr, not stdout.
        for (const url of extractHttpUrls(stderrBuf)) {
          if (isOAuthUrl(url)) openOnce(url);
        }
      });
    }

    const finish = (result: AccountLoginResult) => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      clearTimeout(timeout);
      if (exitTimer) clearTimeout(exitTimer);
      options.signal?.removeEventListener("abort", abortLogin);
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(urlFile);
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const openOnce = (url: string) => {
      if (!url || url === opened || !/^https?:\/\//i.test(url)) return;
      opened = url;
      openUrl(url);
    };

    const readUrlFile = () => {
      try {
        if (!fs.existsSync(urlFile)) return;
        const text = fs.readFileSync(urlFile, "utf8");
        for (const url of extractHttpUrls(text)) {
          if (isOAuthUrl(url) || !opened) openOnce(url);
        }
      } catch {
        /* ignore */
      }
    };

    child.on("error", (err) => {
      childError = err.message;
      finish({
        ok: false,
        account: loadAccount(),
        message: `无法启动 Grok CLI：${err.message}。请确认已安装 Grok CLI，或改用 API 登录。`,
      });
    });

    child.on("close", (code, signal) => {
      childExit = true;
      if (settled) return;
      // Give the CLI a short moment to atomically replace auth.json before we
      // inspect it. Every other exit is terminal; waiting for the global
      // timeout here leaves the login modal looking stuck after a CLI error.
      exitTimer = setTimeout(() => {
        const account = loadAccount();
        if (account.method === "oauth") {
          finish({ ok: true, account, url: opened || undefined });
          return;
        }
        const network = looksLikeNetworkFailure(stderrBuf + " " + stdoutBuf);
        finish({
          ok: false,
          account,
          url: opened || undefined,
          message: network
            ? `Grok CLI 退出（${code ?? signal ?? "未知"}），无法连接 auth.x.ai（请检查网络/代理/VPN 是否放行 *.x.ai），或改用 API 登录。`
            : childError
              ? `Grok CLI 启动失败：${childError}`
              : opened
                ? `Grok CLI 已退出（${code ?? signal ?? "未知"}），但授权没有完成。请重试或改用 API 登录。`
                : `Grok CLI 已退出（${code ?? signal ?? "未知"}），未弹出授权页。请确认网络和 Grok CLI 后重试，或改用 API 登录。`,
        });
      }, 250);
    });

    const poller = setInterval(() => {
      readUrlFile();
      const account = loadAccount();
      if (account.method === "oauth") {
        finish({ ok: true, account, url: opened || undefined });
      }
    }, 400);

    const timeout = setTimeout(() => {
      const account = loadAccount();
      if (account.method === "oauth") {
        finish({ ok: true, account, url: opened || undefined });
        return;
      }
      const network = looksLikeNetworkFailure(stderrBuf + " " + stdoutBuf);
      finish({
        ok: false,
        account,
        url: opened || undefined,
        message: childExit
          ? network
            ? "Grok CLI 已退出且无法连接 auth.x.ai。请检查网络/代理后重试，或改用 API 登录。"
            : "Grok CLI 已退出，但未完成授权。请确认已安装 Grok CLI 后重试，或改用 API 登录。"
          : "登录未完成。请在弹出的授权页里完成授权，或改用 API 登录。",
      });
    }, 180_000);

    const abortLogin = () => {
      finish({
        ok: false,
        account: loadAccount(),
        url: opened || undefined,
        message: "登录已取消",
      });
    };
    options.signal?.addEventListener("abort", abortLogin, { once: true });
    if (options.signal?.aborted) abortLogin();
  });
}

function oauthToken(): string | null {
  return parseAuthFile().token ?? null;
}

function usageFromPayload(payload: Record<string, unknown>): AccountUsage {
  const current = asRecord(payload.currentPeriod) || payload;
  const percent = pickNumber(
    current.creditUsagePercent,
    payload.creditUsagePercent,
    current.usagePercent,
  );
  const used = pickNumber(
    current.used,
    current.includedUsed,
    current.totalUsed,
    payload.used,
  );
  const limit = pickNumber(current.monthlyLimit, payload.monthlyLimit, current.limit);
  const prepaid = pickNumber(current.prepaidBalance, payload.prepaidBalance);
  const onDemandUsed = pickNumber(current.onDemandUsed, payload.onDemandUsed);
  const onDemandCap = pickNumber(current.onDemandCap, payload.onDemandCap);
  const tier = pickString(current.subscriptionTier, payload.subscriptionTier, payload.tier);
  const start = formatDate(
    pickString(current.billingPeriodStart, payload.billingPeriodStart),
  );
  const end = formatDate(pickString(current.billingPeriodEnd, payload.billingPeriodEnd));
  const lines: string[] = [];
  if (tier) lines.push(`套餐：${tier}`);
  if (percent != null) lines.push(`本周期用量：${Math.round(percent)}%`);
  if (used != null && limit != null) {
    lines.push(`已用 ${formatCount(used)} / 限额 ${formatCount(limit)}`);
  } else if (used != null) {
    lines.push(`已用 ${formatCount(used)}`);
  }
  if (prepaid != null) lines.push(`预付余额：${formatCount(prepaid)}`);
  if (onDemandUsed != null) {
    lines.push(
      onDemandCap != null
        ? `按需：${formatCount(onDemandUsed)} / ${formatCount(onDemandCap)}`
        : `按需已用：${formatCount(onDemandUsed)}`,
    );
  }
  if (start || end) lines.push(`周期：${start || "?"} ~ ${end || "?"}`);
  return {
    text: lines.join("\n") || "暂无用量数据",
    percent,
    used,
    limit,
    prepaid,
    tier,
    periodStart: start,
    periodEnd: end,
  };
}

export async function loadAccountUsage(): Promise<AccountUsage> {
  const account = loadAccount();
  if (account.method !== "oauth") {
    return { text: "用量仅在 OAuth 登录时可用" };
  }
  const token = oauthToken();
  if (!token) return { text: "未找到 OAuth 凭据" };

  const url = `${proxyBase()}/billing?format=credits`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-XAI-Token-Auth": "xai-grok-cli",
        Accept: "application/json",
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      return { text: `用量请求失败（${res.status}）` };
    }
    const json = (await res.json()) as unknown;
    const payload = asRecord(json) || {};
    return usageFromPayload(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(message)) return { text: "用量请求超时" };
    return { text: "无法获取用量" };
  } finally {
    clearTimeout(timer);
  }
}
