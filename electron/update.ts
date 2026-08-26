import { app } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import type { AppUpdateInfo } from "./shared";
import { log } from "./log";

const RELEASES_API =
  "https://api.github.com/repos/stripling-feng/grok-build-desktop/releases/latest";
const RELEASES_PAGE = "https://github.com/stripling-feng/grok-build-desktop/releases/latest";

type UpdatePublisher = (state: AppUpdateInfo) => void;

let publishUpdate: UpdatePublisher | null = null;
let updaterInitialized = false;
let downloadPromise: Promise<AppUpdateInfo> | null = null;
let updateState: AppUpdateInfo = {
  current: app.getVersion(),
  latest: null,
  hasUpdate: false,
  url: RELEASES_PAGE,
  notes: "",
  dev: !app.isPackaged,
  status: "idle",
};

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

function releaseNotes(info: UpdateInfo): string {
  if (typeof info.releaseNotes === "string") return info.releaseNotes.trim();
  if (!Array.isArray(info.releaseNotes)) return "";
  return info.releaseNotes
    .map((entry) => `${entry.version ? `### ${entry.version}\n` : ""}${entry.note || ""}`.trim())
    .filter(Boolean)
    .join("\n\n");
}

function installerUrl(assets: { name?: string; browser_download_url?: string }[]): string | null {
  const exe = assets.find((asset) => /\.exe$/i.test(asset.name || "") && asset.browser_download_url);
  return exe?.browser_download_url || null;
}

function snapshot(): AppUpdateInfo {
  return { ...updateState };
}

function commit(patch: Partial<AppUpdateInfo>): AppUpdateInfo {
  updateState = {
    ...updateState,
    current: app.getVersion(),
    dev: !app.isPackaged,
    ...patch,
  };
  const next = snapshot();
  publishUpdate?.(next);
  return next;
}

function friendlyUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/latest\.yml|cannot find.*channel|404/i.test(message)) {
    return "更新文件不完整，请发布包含安装包和 latest.yml 的新版本。";
  }
  if (/net::|ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(message)) {
    return "无法连接更新服务器，请检查网络或代理后重试。";
  }
  return message || "更新失败，请稍后重试。";
}

function progressPatch(progress: ProgressInfo): Partial<AppUpdateInfo> {
  return {
    status: "downloading",
    progress: Math.max(0, Math.min(100, progress.percent || 0)),
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond,
    error: undefined,
  };
}

export function initializeAppUpdater(publisher: UpdatePublisher) {
  publishUpdate = publisher;
  if (updaterInitialized) return;
  updaterInitialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.logger = {
    info: (message?: unknown) => log("updater", message),
    warn: (message?: unknown) => log("updater warning", message),
    error: (message?: unknown) => log("updater error", message),
  };

  autoUpdater.on("checking-for-update", () => {
    commit({ status: "checking", error: undefined });
  });
  autoUpdater.on("update-available", (info) => {
    commit({
      latest: info.version,
      hasUpdate: true,
      notes: releaseNotes(info),
      status: "available",
      progress: 0,
      transferred: 0,
      total: info.files?.[0]?.size,
      error: undefined,
    });
  });
  autoUpdater.on("update-not-available", (info) => {
    commit({
      latest: info.version || app.getVersion(),
      hasUpdate: false,
      notes: releaseNotes(info),
      status: "idle",
      progress: undefined,
      transferred: undefined,
      total: undefined,
      bytesPerSecond: undefined,
      error: undefined,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    commit(progressPatch(progress));
  });
  autoUpdater.on("update-downloaded", (info) => {
    commit({
      latest: info.version,
      hasUpdate: true,
      notes: releaseNotes(info),
      status: "downloaded",
      progress: 100,
      transferred: updateState.total ?? updateState.transferred,
      bytesPerSecond: 0,
      error: undefined,
    });
  });
  autoUpdater.on("update-cancelled", () => {
    commit({ status: "available", progress: 0, error: "下载已取消。" });
  });
  autoUpdater.on("error", (error) => {
    commit({ status: "error", error: friendlyUpdateError(error) });
  });
}

async function checkGitHubReleaseForDevelopment(): Promise<AppUpdateInfo> {
  const current = app.getVersion();
  try {
    const response = await fetch(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "grok-build-desktop",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (response.status === 404) {
      return commit({
        latest: null,
        hasUpdate: false,
        status: "idle",
        error: "还没有 GitHub Release。发版后即可检测更新。",
      });
    }
    if (!response.ok) throw new Error(`检测失败（${response.status}）`);

    const data = (await response.json()) as {
      tag_name?: string;
      body?: string;
      html_url?: string;
      assets?: { name?: string; browser_download_url?: string }[];
    };
    const latest = String(data.tag_name || "").replace(/^v/i, "");
    if (!latest) throw new Error("Release 没有版本号");
    const hasUpdate = compareVersions(latest, current) > 0;
    return commit({
      latest,
      hasUpdate,
      url: installerUrl(data.assets || []) || data.html_url || RELEASES_PAGE,
      notes: String(data.body || "").trim(),
      status: hasUpdate ? "available" : "idle",
      error: undefined,
    });
  } catch (error) {
    return commit({ status: "error", error: friendlyUpdateError(error) });
  }
}

export async function checkAppUpdate(): Promise<AppUpdateInfo> {
  if (updateState.status === "downloading" || updateState.status === "downloaded") return snapshot();
  commit({ status: "checking", error: undefined });
  if (!app.isPackaged) return checkGitHubReleaseForDevelopment();

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) return commit({ status: "error", error: "当前安装包不支持应用内更新。" });
    if (updateState.status === "checking") {
      const latest = result.updateInfo.version;
      const hasUpdate = compareVersions(latest, app.getVersion()) > 0;
      return commit({
        latest,
        hasUpdate,
        notes: releaseNotes(result.updateInfo),
        status: hasUpdate ? "available" : "idle",
        error: undefined,
      });
    }
    return snapshot();
  } catch (error) {
    return commit({ status: "error", error: friendlyUpdateError(error) });
  }
}

export function downloadAppUpdate(): Promise<AppUpdateInfo> {
  if (downloadPromise) return downloadPromise;
  downloadPromise = (async () => {
    if (!app.isPackaged) {
      return commit({ status: "error", error: "开发环境不能安装更新，请使用正式安装版测试。" });
    }
    if (updateState.status === "downloaded") return snapshot();
    if (!updateState.hasUpdate) {
      const checked = await checkAppUpdate();
      if (!checked.hasUpdate) return checked;
    }

    commit({ status: "downloading", progress: 0, transferred: 0, error: undefined });
    try {
      await autoUpdater.downloadUpdate();
      if (updateState.status !== "downloaded") commit({ status: "downloaded", progress: 100 });
      return snapshot();
    } catch (error) {
      return commit({ status: "error", error: friendlyUpdateError(error) });
    }
  })().finally(() => {
    downloadPromise = null;
  });
  return downloadPromise;
}

export function installDownloadedUpdate(): boolean {
  if (!app.isPackaged || updateState.status !== "downloaded") return false;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}
