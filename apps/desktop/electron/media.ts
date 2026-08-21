import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAccount } from "./account";
import { grokHome } from "./sessions";
import type { MediaKind, MediaResult } from "./shared";

const IMAGE_MODELS = ["grok-imagine-image-2.0", "grok-2-image", "dall-e-3"];
const VIDEO_MODELS = ["grok-imagine-video-1.5", "grok-imagine-video"];

type RelayCreds = { baseUrl: string; apiKey: string };

function readText(file: string): string {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

function unquote(value: string): string {
  return value.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
}

function isPlaceholderKey(key: string): boolean {
  return !key || /^(PROXY_MANAGED|YOUR_.*|changeme)$/i.test(key);
}

function isLoopback(url: string): boolean {
  return /127\.0\.0\.1|localhost/i.test(url);
}

function modelBlocks(text: string): { id: string; body: string }[] {
  const blocks: { id: string; body: string }[] = [];
  const re = /\[model\.("?)([^"\]]+)\1\]([\s\S]*?)(?=\n\[|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    blocks.push({ id: m[2], body: m[3] });
  }
  return blocks;
}

function keyInBody(body: string, key: string): string | null {
  const m = body.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"));
  return m ? unquote(m[1]) : null;
}

function defaultModelId(text: string): string {
  const m = text.match(/^\s*default\s*=\s*(.+)$/m);
  return m ? unquote(m[1]) : "";
}

function credsFromToml(text: string): RelayCreds | null {
  const blocks = modelBlocks(text);
  const preferred = defaultModelId(text);
  const ordered = [
    ...blocks.filter((b) => b.id === preferred),
    ...blocks.filter((b) => b.id !== preferred),
  ];
  for (const block of ordered) {
    const baseUrl = keyInBody(block.body, "base_url");
    const apiKey = keyInBody(block.body, "api_key");
    if (baseUrl && apiKey && !isLoopback(baseUrl) && !isPlaceholderKey(apiKey)) {
      return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
    }
  }
  return null;
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

function credsFromCcSwitch(): RelayCreds | null {
  const dbPath = path.join(os.homedir(), ".cc-switch", "cc-switch.db");
  if (!fs.existsSync(dbPath)) return null;
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const script = [
      "import sqlite3,sys",
      "con=sqlite3.connect(sys.argv[1])",
      "cur=con.cursor()",
      "row=cur.execute(\"SELECT settings_config FROM providers WHERE app_type='grokbuild' AND is_current=1 LIMIT 1\").fetchone()",
      "if not row:",
      "  row=cur.execute(\"SELECT settings_config FROM providers WHERE app_type='grokbuild' LIMIT 1\").fetchone()",
      "print(row[0] if row else '')",
    ].join("\n");
    const raw = execFileSync("python", ["-c", script, dbPath], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    }).trim();
    return credsFromProviderBlob(raw);
  } catch {
    return null;
  }
}

function credsFromProviderBlob(raw: string): RelayCreds | null {
  if (!raw) return null;
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return credsFromToml(raw);
  }
  const tomlBits: string[] = [];
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
    if (text.includes("[model") || text.includes("base_url")) tomlBits.push(text);
  });
  for (const bit of tomlBits) {
    const fromToml = credsFromToml(bit);
    if (fromToml) return fromToml;
  }
  if (baseUrl && apiKey) return { baseUrl, apiKey };
  return null;
}

export function resolveRelayCredentials(): RelayCreds {
  const fromConfig = credsFromToml(readText(path.join(grokHome(), "config.toml")));
  if (fromConfig) return fromConfig;
  const envKey = process.env.XAI_API_KEY?.trim() || process.env.GROK_CODE_XAI_API_KEY?.trim();
  const envBase = process.env.GROK_MEDIA_BASE_URL?.trim() || process.env.XAI_API_BASE?.trim();
  if (envKey && envBase && !isLoopback(envBase) && !isPlaceholderKey(envKey)) {
    return { baseUrl: envBase.replace(/\/+$/, ""), apiKey: envKey };
  }
  const fromSwitch = credsFromCcSwitch();
  if (fromSwitch) return fromSwitch;
  throw new Error("中转站生图需要供应商地址和 API Key。当前配置是本地代理占位，读不到上游凭证。");
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(text.slice(0, 400) || `HTTP ${res.status}`);
  }
}

function errorFromBody(body: Record<string, unknown>, status: number): string {
  const err = body.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string") return rec.message;
  }
  if (typeof body.message === "string") return body.message;
  return `HTTP ${status}`;
}

function collectUrls(value: unknown, into: string[]) {
  if (!value) return;
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, into);
    return;
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["url", "image_url", "b64_json", "uri", "src"]) {
      if (typeof rec[key] === "string") {
        const raw = rec[key] as string;
        if (raw.startsWith("http") || raw.startsWith("data:")) into.push(raw);
      }
    }
    for (const child of Object.values(rec)) collectUrls(child, into);
  }
}

async function postJson(url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const json = await readJson(res);
    if (!res.ok) throw new Error(errorFromBody(json, res.status));
    return json;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("生成超时");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url: string, apiKey: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ac.signal,
    });
    const json = await readJson(res);
    if (!res.ok) throw new Error(errorFromBody(json, res.status));
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function generateImageOnRelay(prompt: string): Promise<MediaResult> {
  const { baseUrl, apiKey } = resolveRelayCredentials();
  const url = `${baseUrl}/images/generations`;
  let last = new Error("中转站生图失败");
  for (const model of IMAGE_MODELS) {
    try {
      const json = await postJson(url, apiKey, { model, prompt, n: 1 }, 120_000);
      const urls: string[] = [];
      collectUrls(json.data ?? json, urls);
      const unique = [...new Set(urls)];
      if (!unique.length) throw new Error("中转站没有返回图片地址");
      return { kind: "image", prompt, urls: unique, via: "relay" };
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err));
      if (!/model|not found|does not exist|unknown/i.test(last.message)) throw last;
    }
  }
  throw last;
}

async function generateVideoOnRelay(prompt: string): Promise<MediaResult> {
  const { baseUrl, apiKey } = resolveRelayCredentials();
  const url = `${baseUrl}/videos/generations`;
  let created: Record<string, unknown> | null = null;
  let last = new Error("中转站未提供视频接口");
  for (const model of VIDEO_MODELS) {
    try {
      created = await postJson(url, apiKey, { model, prompt }, 60_000);
      break;
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err));
      if (/404|not found|unknown/i.test(last.message)) continue;
      throw last;
    }
  }
  if (!created) throw last;
  const urls: string[] = [];
  collectUrls(created, urls);
  const id = String(created.id ?? created.request_id ?? "");
  if (urls.some((u) => /\.(mp4|webm|mov)(\?|$)/i.test(u) || u.includes("/videos/"))) {
    return { kind: "video", prompt, urls: [...new Set(urls)], via: "relay" };
  }
  if (!id) {
    if (urls.length) return { kind: "video", prompt, urls: [...new Set(urls)], via: "relay" };
    throw new Error("中转站没有返回视频");
  }
  const started = Date.now();
  while (Date.now() - started < 8 * 60_000) {
    const status = await getJson(`${baseUrl}/videos/${id}`, apiKey, 30_000);
    const state = String(status.status ?? status.state ?? "").toLowerCase();
    const next: string[] = [];
    collectUrls(status, next);
    if (next.length && /complete|succeed|success|done/i.test(state || "done")) {
      return { kind: "video", prompt, urls: [...new Set(next)], via: "relay" };
    }
    if (/fail|error|cancel/i.test(state)) throw new Error(String(status.error || "视频生成失败"));
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("视频生成超时");
}

export async function generateMedia(kind: MediaKind, prompt: string): Promise<MediaResult> {
  const text = prompt.trim();
  if (!text) throw new Error("请输入描述");
  const account = loadAccount();
  if (account.method === "oauth") {
    throw new Error("OAUTH_VIA_ACP");
  }
  if (account.method !== "api-key") {
    throw new Error("当前未配置中转 API Key，无法生图");
  }
  return kind === "video" ? generateVideoOnRelay(text) : generateImageOnRelay(text);
}

export function parseMediaCommand(text: string): { kind: MediaKind; prompt: string } | null {
  const raw = text.trim();
  const image = raw.match(/^\/imagine(?:\s+|$)([\s\S]*)/i);
  if (image) return { kind: "image", prompt: image[1].trim() };
  const video = raw.match(/^\/imagine-video(?:\s+|$)([\s\S]*)/i);
  if (video) return { kind: "video", prompt: video[1].trim() };
  return null;
}
