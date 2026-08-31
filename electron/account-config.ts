export const API_KEY_SCOPE = "xai::api_key";
export const CUSTOM_MODEL_ID = "desktop-api";

export type ApiProviderConfigInput = {
  baseUrl: string;
  apiKey: string;
  model?: string;
  contextWindow?: number;
};

export type SavedApiProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow?: number;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tableBlock(text: string, table: string): { start: number; end: number; body: string } | null {
  const match = new RegExp(`^\\[${escapeRegExp(table)}\\][ \\t]*$`, "m").exec(text);
  if (!match) return null;
  const start = match.index;
  const after = start + match[0].length;
  const next = text.slice(after).search(/\n\[/);
  const end = next < 0 ? text.length : after + next;
  return { start, end, body: text.slice(start, end) };
}

function keyAssignmentRe(key: string) {
  return new RegExp(`^[ \t]*"?${escapeRegExp(key)}"?\\s*=\\s*(.*)$`, "m");
}

/** Return the complete span of a key, including TOML multi-line arrays. */
function keyAssignmentRange(body: string, key: string): { start: number; end: number } | null {
  const match = keyAssignmentRe(key).exec(body);
  if (!match) return null;
  let end = match.index + match[0].length;
  const firstValue = match[1].trim();
  let depth = (firstValue.match(/\[/g)?.length ?? 0) - (firstValue.match(/\]/g)?.length ?? 0);
  if (depth <= 0) {
    // Older builds replaced only the opening line of a multi-line array,
    // leaving orphaned "item", lines and a closing bracket behind.
    if (firstValue.includes("[") && firstValue.includes("]")) {
      let cursor = end;
      let sawItem = false;
      while (cursor < body.length) {
        const lineStart = body.indexOf("\n", cursor);
        if (lineStart < 0) break;
        const nextStart = lineStart + 1;
        const nextEnd = body.indexOf("\n", nextStart);
        const lineEnd = nextEnd < 0 ? body.length : nextEnd;
        const continuation = body.slice(nextStart, lineEnd).trim();
        if (/^"[^"]*"\s*,?\s*(?:#.*)?$/.test(continuation)) {
          sawItem = true;
          end = lineEnd;
          cursor = lineEnd;
          continue;
        }
        if (sawItem && continuation === "]") end = lineEnd;
        break;
      }
    }
    return { start: match.index, end };
  }

  let cursor = end;
  while (cursor < body.length && depth > 0) {
    const lineStart = body.indexOf("\n", cursor);
    if (lineStart < 0) {
      end = body.length;
      break;
    }
    const nextStart = lineStart + 1;
    const nextEnd = body.indexOf("\n", nextStart);
    const lineEnd = nextEnd < 0 ? body.length : nextEnd;
    const continuation = body.slice(nextStart, lineEnd);
    depth += (continuation.match(/\[/g)?.length ?? 0) - (continuation.match(/\]/g)?.length ?? 0);
    end = lineEnd;
    cursor = lineEnd;
  }
  return { start: match.index, end };
}

function setTableKey(text: string, table: string, key: string, rawValue: string): string {
  const line = `${key} = ${rawValue}`;
  const block = tableBlock(text, table);
  if (!block) {
    const prefix = text.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}[${table}]\n${line}\n`;
  }
  const range = keyAssignmentRange(block.body, key);
  const nextBody = range
    ? `${block.body.slice(0, range.start)}${line}${block.body.slice(range.end)}`
    : `${block.body.trimEnd()}\n${line}\n`;
  return text.slice(0, block.start) + nextBody + text.slice(block.end);
}

function deleteTableKey(text: string, table: string, key: string): string {
  const block = tableBlock(text, table);
  if (!block) return text;
  const range = keyAssignmentRange(block.body, key);
  if (!range) return text;
  const nextBody = `${block.body.slice(0, range.start)}${block.body.slice(range.end)}`.replace(/\n{3,}/g, "\n\n");
  return text.slice(0, block.start) + nextBody + text.slice(block.end);
}

function readTableString(text: string, table: string, key: string): string | null {
  const block = tableBlock(text, table);
  if (!block) return null;
  const keyMatch = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]*)"\\s*$`, "m").exec(block.body);
  return keyMatch?.[1]?.trim() || null;
}

function readTableNumber(text: string, table: string, key: string): number | null {
  const block = tableBlock(text, table);
  if (!block) return null;
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(\\d+)\\s*$`, "m").exec(block.body);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function contextWindowValue(value?: number): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("上下文长度必须是大于 0 的整数");
  }
  return value;
}

export function detachSubagentModelOverrides(text: string): {
  config: string;
  table: string | null;
} {
  const block = tableBlock(text, "subagents.models");
  if (!block) return { config: text, table: null };
  return {
    config: `${text.slice(0, block.start)}${text.slice(block.end)}`.replace(/\n{3,}/g, "\n\n"),
    table: block.body.trimEnd() + "\n",
  };
}

export function restoreSubagentModelOverrides(text: string, savedTable?: string | null): string {
  if (!savedTable?.trim()) return text;
  const withoutCurrent = detachSubagentModelOverrides(text).config.trimEnd();
  return `${withoutCurrent}${withoutCurrent ? "\n\n" : ""}${savedTable.trim()}\n`;
}

export function normalizeApiBaseUrl(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请填写有效的 Base URL，例如 https://api.x.ai/v1");
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname) {
    throw new Error("请填写有效的 Base URL，例如 https://api.x.ai/v1");
  }
  // Most OpenAI-compatible gateways expose chat completions below /v1. A
  // bare origin often returns a successful but unrelated payload, which Grok
  // interprets as an empty model response.
  if (url.pathname === "/") url.pathname = "/v1";
  return url.toString().replace(/\/+$/, "");
}

export function buildApiProviderConfig(text: string, input: ApiProviderConfigInput): string {
  const baseUrl = normalizeApiBaseUrl(input.baseUrl);
  const apiKey = input.apiKey.trim();
  const model = (input.model || "grok-4.6").trim() || "grok-4.6";
  const contextWindow = contextWindowValue(input.contextWindow);
  let next = text;
  next = setTableKey(next, "auth", "preferred_method", JSON.stringify("api_key"));
  next = setTableKey(next, "models", "default", JSON.stringify(CUSTOM_MODEL_ID));
  // A custom model owns its endpoint and key. Setting the global endpoints
  // makes Grok refresh the shared catalog with session auth instead, which can
  // produce a misleading INVALID_API_KEY even when this provider key is valid.
  next = deleteTableKey(next, "endpoints", "xai_api_base_url");
  next = deleteTableKey(next, "endpoints", "models_base_url");
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "model", JSON.stringify(model));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "base_url", JSON.stringify(baseUrl));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "name", JSON.stringify("API"));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "api_key", JSON.stringify(apiKey));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "api_backend", JSON.stringify("chat_completions"));
  next = contextWindow
    ? setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "context_window", String(contextWindow))
    : deleteTableKey(next, `model.${CUSTOM_MODEL_ID}`, "context_window");
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "supports_reasoning_effort", "true");
  next = setTableKey(
    next,
    `model.${CUSTOM_MODEL_ID}`,
    "reasoning_efforts",
    JSON.stringify(["low", "medium", "high", "xhigh"]),
  );
  return next;
}

export function buildOAuthConfig(text: string): string {
  let next = setTableKey(text, "auth", "preferred_method", JSON.stringify("oidc"));
  if (readTableString(text, "models", "default") === CUSTOM_MODEL_ID) {
    next = setTableKey(next, "models", "default", JSON.stringify("grok-4.6"));
  }
  return next;
}

export function buildRepairedApiConfig(text: string): string {
  const saved = readApiProviderConfig(text);
  const method = preferredAuthMethod(text);
  const selected = readTableString(text, "models", "default") === CUSTOM_MODEL_ID;
  if (!saved || (method !== "api_key" && !(method === null && selected))) return text;
  let next = text;
  if (method === null) {
    next = setTableKey(next, "auth", "preferred_method", JSON.stringify("api_key"));
  }
  next = setTableKey(next, "models", "default", JSON.stringify(CUSTOM_MODEL_ID));
  next = deleteTableKey(next, "endpoints", "xai_api_base_url");
  next = deleteTableKey(next, "endpoints", "models_base_url");
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "supports_reasoning_effort", "true");
  next = setTableKey(
    next,
    `model.${CUSTOM_MODEL_ID}`,
    "reasoning_efforts",
    JSON.stringify(["low", "medium", "high", "xhigh"]),
  );
  const currentBaseUrl = readTableString(next, `model.${CUSTOM_MODEL_ID}`, "base_url");
  if (currentBaseUrl) {
    next = setTableKey(
      next,
      `model.${CUSTOM_MODEL_ID}`,
      "base_url",
      JSON.stringify(normalizeApiBaseUrl(currentBaseUrl)),
    );
  }
  return next;
}

export function buildClearedAccountConfig(text: string): string {
  let next = setTableKey(text, "auth", "preferred_method", JSON.stringify(""));
  next = setTableKey(next, "models", "default", JSON.stringify(""));
  next = deleteTableKey(next, "endpoints", "xai_api_base_url");
  next = deleteTableKey(next, "endpoints", "models_base_url");
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "model", JSON.stringify(""));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "base_url", JSON.stringify(""));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "name", JSON.stringify(""));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "api_key", JSON.stringify(""));
  next = setTableKey(next, `model.${CUSTOM_MODEL_ID}`, "api_backend", JSON.stringify(""));
  next = deleteTableKey(next, `model.${CUSTOM_MODEL_ID}`, "context_window");
  next = deleteTableKey(next, `model.${CUSTOM_MODEL_ID}`, "supports_reasoning_effort");
  next = deleteTableKey(next, `model.${CUSTOM_MODEL_ID}`, "reasoning_efforts");
  return next;
}

export function preferredAuthMethod(text: string): "api_key" | "oidc" | null {
  const value = readTableString(text, "auth", "preferred_method");
  return value === "api_key" || value === "oidc" ? value : null;
}

export function hasSelectedApiProvider(text: string): boolean {
  return (
    readTableString(text, "models", "default") === CUSTOM_MODEL_ID &&
    Boolean(readTableString(text, `model.${CUSTOM_MODEL_ID}`, "base_url")) &&
    Boolean(readTableString(text, `model.${CUSTOM_MODEL_ID}`, "api_key"))
  );
}

export function readApiProviderConfig(text: string): SavedApiProviderConfig | null {
  const baseUrl = readTableString(text, `model.${CUSTOM_MODEL_ID}`, "base_url");
  const apiKey = readTableString(text, `model.${CUSTOM_MODEL_ID}`, "api_key");
  if (!baseUrl || !apiKey) return null;
  const contextWindow = readTableNumber(text, `model.${CUSTOM_MODEL_ID}`, "context_window");
  return {
    baseUrl,
    apiKey,
    model: readTableString(text, `model.${CUSTOM_MODEL_ID}`, "model") || "grok-4.6",
    ...(contextWindow ? { contextWindow } : {}),
  };
}

export function removeLegacyApiKeyAuthEntry(raw: Record<string, unknown>): {
  auth: Record<string, unknown>;
  changed: boolean;
} {
  if (!(API_KEY_SCOPE in raw)) return { auth: raw, changed: false };
  const auth = { ...raw };
  delete auth[API_KEY_SCOPE];
  return { auth, changed: true };
}
