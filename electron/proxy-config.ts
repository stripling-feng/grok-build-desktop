import type { ProxyMode, ProxySettings } from "./shared";

function normalizeManualProxy(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("请填写有效的代理地址，例如 http://127.0.0.1:7897");
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
    throw new Error("第一版仅支持 HTTP/HTTPS 代理");
  }
  if (parsed.username || parsed.password) {
    throw new Error("第一版暂不支持带用户名和密码的代理");
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("代理地址只需要协议、主机和端口");
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function normalizeProxySettings(input?: Partial<ProxySettings> | null): ProxySettings {
  const mode: ProxyMode =
    input?.mode === "direct" || input?.mode === "manual" ? input.mode : "system";
  return {
    mode,
    url: mode === "manual" ? normalizeManualProxy(input?.url || "") : "",
  };
}
