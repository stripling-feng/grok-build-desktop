import { app, shell } from "electron";
import type { AppUpdateInfo } from "./shared";

const RELEASES_API =
  "https://api.github.com/repos/stripling-feng/grok-build-desktop/releases/latest";
const RELEASES_PAGE = "https://github.com/stripling-feng/grok-build-desktop/releases/latest";

function parseVersion(raw: string): number[] | null {
  const cleaned = raw.trim().replace(/^v/i, "");
  const parts = cleaned.split(/[.-]/).filter((p) => /^\d+$/.test(p));
  if (!parts.length) return null;
  return parts.map((p) => Number(p));
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const d = (left[i] ?? 0) - (right[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function installerUrl(assets: { name?: string; browser_download_url?: string }[]): string | null {
  const exe = assets.find((a) => /\.exe$/i.test(a.name || "") && a.browser_download_url);
  return exe?.browser_download_url || null;
}

export async function checkAppUpdate(): Promise<AppUpdateInfo> {
  const current = app.getVersion();
  const dev = Boolean(process.env.VITE_DEV_SERVER_URL);
  try {
    const res = await fetch(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "grok-build-desktop",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 404) {
      return {
        current,
        latest: null,
        hasUpdate: false,
        url: RELEASES_PAGE,
        notes: "",
        dev,
        error: "还没有 GitHub Release。发版后即可检测更新。",
      };
    }
    if (!res.ok) {
      return {
        current,
        latest: null,
        hasUpdate: false,
        url: RELEASES_PAGE,
        notes: "",
        dev,
        error: `检测失败（${res.status}）`,
      };
    }
    const data = (await res.json()) as {
      tag_name?: string;
      body?: string;
      html_url?: string;
      assets?: { name?: string; browser_download_url?: string }[];
    };
    const latest = String(data.tag_name || "").replace(/^v/i, "");
    if (!latest) {
      return {
        current,
        latest: null,
        hasUpdate: false,
        url: data.html_url || RELEASES_PAGE,
        notes: "",
        dev,
        error: "Release 没有版本号",
      };
    }
    const hasUpdate = compareVersions(latest, current) > 0;
    return {
      current,
      latest,
      hasUpdate,
      url: installerUrl(data.assets || []) || data.html_url || RELEASES_PAGE,
      notes: String(data.body || "").trim(),
      dev,
    };
  } catch (err) {
    return {
      current,
      latest: null,
      hasUpdate: false,
      url: RELEASES_PAGE,
      notes: "",
      dev,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function openUpdateUrl(url?: string | null) {
  await shell.openExternal(url || RELEASES_PAGE);
}
