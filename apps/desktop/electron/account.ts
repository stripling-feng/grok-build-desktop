import fs from "node:fs";
import path from "node:path";
import { getDefaultModelDisplayName } from "./config";
import { grokHome } from "./sessions";
import type { AccountInfo, AccountUsage } from "./shared";

const OAUTH_SCOPE = "https://accounts.x.ai/sign-in";
const API_KEY_SCOPE = "xai::api_key";

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
