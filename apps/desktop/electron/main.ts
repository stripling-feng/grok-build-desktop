import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session as electronSession, shell, Tray } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { GrokAcpClient } from "./acp";
import {
  addProject,
  bindSessionToProject,
  isScratchPath,
  listProjects,
  projectName,
  removeProject,
  renameProject,
  scratchCwd,
  threadBelongsToProject,
  unbindSession,
} from "./projects";
import { copySession, listThreads, loadTranscript, removeThread, renameThread, searchThreads, touchThreadActivity } from "./sessions";
import {
  applyWorktree,
  createWorktree,
  findGitRoot,
  gitCommit,
  gitDiscard,
  gitFileDiff,
  gitPush,
  gitStage,
  gitStatus,
  gitUnstage,
} from "./git";
import {
  loadSettings,
  sessionMeta,
  setDefaultModel,
  setDefaultReasoningEffort,
  setPermissionMode,
  setSkillDisabled,
  setBrowserControl,
  setComputerControl,
  setSubagentsEnabled,
  setSubagentTypeEnabled,
  setSubagentTypeModel,
  isBrowserControlServer,
  isComputerControlServer,
} from "./config";
import {
  GrokCliError,
  ensureUserAgentsDir,
  ensureUserHooksDir,
  ensureUserSkillsDir,
  listAvailablePlugins,
  marketplaceAdd,
  marketplaceRemove,
  mcpAdd,
  mcpDisable,
  mcpDoctor,
  mcpEnable,
  mcpRemove,
  pluginDisable,
  pluginEnable,
  pluginInstall,
  pluginUninstall,
  trustProject,
  writeUserHook,
  type McpAddInput,
} from "./grok-cli";
import { ProjectTerminal } from "./terminal";
import type { PermissionMode, ReasoningEffort } from "./shared";
import { INSTALL_COMMAND, INSTALL_DOCS } from "./grok-bin";
import { startGrokInstall, stopGrokInstall, type InstallLogLine } from "./install-cli";
import { initLog, log, logsDir, pruneLogs } from "./log";
import { getGoal, setGoal } from "./goals";
import { loadAccount, loadAccountUsage, saveApiKey, startAccountLogin, getCcSwitchProvider, listCcSwitchProviders, clearApiKey } from "./account";
import { checkAppUpdate, openUpdateUrl } from "./update";
import {
  createAutomation,
  deleteAutomation,
  dueAutomations,
  getAutomation,
  listAutomations,
  markFinished,
  markRunning,
  recoverStuckAutomations,
  startAutomationLoop,
  updateAutomation,
  type AutomationInput,
} from "./automations";

app.setName("Grok Build");

const acp = new GrokAcpClient();
const loadedSessions = new Set<string>();
const terminal = new ProjectTerminal();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let systemProxyPromise: Promise<string | null> | null = null;
let accountLoginController: AbortController | null = null;

function proxyUrlFromRules(rules: string): string | null {
  for (const rule of rules.split(";")) {
    const match = rule.trim().match(/^(PROXY|HTTPS|SOCKS5|SOCKS4|SOCKS)\s+(.+)$/i);
    if (!match) continue;
    const scheme = match[1].toUpperCase().startsWith("SOCKS") ? "socks5" : "http";
    const candidate = `${scheme}://${match[2].trim()}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.hostname && parsed.port) return candidate;
    } catch {
      /* try the next proxy rule */
    }
  }
  return null;
}

function existingProxy(): string | null {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    null
  );
}

function proxyLabel(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "configured";
  }
}

async function ensureSystemProxyEnvironment(): Promise<string | null> {
  if (systemProxyPromise) return systemProxyPromise;
  systemProxyPromise = (async () => {
    const configured = existingProxy();
    const proxy =
      configured ||
      proxyUrlFromRules(
        await electronSession.defaultSession.resolveProxy(
          "https://auth.x.ai/.well-known/openid-configuration",
        ),
      );
    if (!proxy) {
      log("network proxy direct");
      return null;
    }
    // Grok CLI uses the conventional proxy environment variables, while
    // Electron/Chrome reads the Windows proxy settings itself. Bridge the two.
    if (!process.env.HTTPS_PROXY && !process.env.https_proxy) process.env.HTTPS_PROXY = proxy;
    if (!process.env.HTTP_PROXY && !process.env.http_proxy) process.env.HTTP_PROXY = proxy;
    log("network proxy", proxyLabel(proxy));
    return proxy;
  })().catch((err) => {
    log("system proxy detection failed", err);
    return null;
  });
  return systemProxyPromise;
}

function send(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload);
}

function appIconPath() {
  return path.join(__dirname, "..", "build", "icon-rounded.ico");
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray && !tray.isDestroyed()) return;
  tray = new Tray(appIconPath());
  tray.setToolTip("Grok Build");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示主窗口", click: showMainWindow },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", showMainWindow);
}

function createWindow() {
  const preload = path.join(__dirname, "preload.js");
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: "Grok Build 桌面端",
    backgroundColor: "#ffffff",
    icon: appIconPath(),
    frame: false,
    titleBarStyle: "hidden",
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    log("renderer", level, message, sourceId, line);
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log("did-fail-load", code, desc, url);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on("unresponsive", () => log("window unresponsive"));
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    log("webContents gone", details.reason);
    if (details.reason === "clean-exit") return;
    const win = mainWindow;
    if (win && !win.isDestroyed()) win.reload();
    else setTimeout(() => {
      if (!mainWindow) createWindow();
    }, 400);
  });
}

acp.on("update", (payload) => {
  // Completion is the renderer's authoritative signal to stop showing a busy
  // session. Deliver it before best-effort workspace bookkeeping so a refresh
  // failure cannot leave the UI spinning forever.
  send("grok:update", payload);
  if (String(payload.update?.sessionUpdate ?? "") === "turn_completed") {
    touchThreadActivity(payload.sessionId);
    invalidateWorkspace();
    send("grok:workspace", workspace());
  }
});
acp.on("permission", (payload) => send("grok:permission", payload));
acp.on("status", (payload) => send("grok:agent-status", payload));
acp.on("stderr", (chunk: string) => log("grok stderr", String(chunk).slice(0, 2000)));
terminal.on("data", (chunk: string) => send("grok:terminal-data", chunk));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("ai.x.grok.build.desktop");
    initLog();
    pruneLogs();
    createTray();
    createWindow();
    void ensureSystemProxyEnvironment()
      .then(() => acp.ensureStarted())
      .catch((err) => log("agent warmup failed", err));
    recoverStuckAutomations(Date.now(), { force: true, skipIds: runningAutomations });
    startAutomationLoop(() => {
      void tickAutomations();
    });
    app.on("activate", () => {
      showMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  tray?.destroy();
  tray = null;
  stopGrokInstall();
  terminal.kill();
  void acp.stop();
});

app.on("render-process-gone", (_event, _webContents, details) => {
  log("renderer gone", details.reason, details.exitCode);
  if (details.reason !== "clean-exit" && !mainWindow) createWindow();
});

process.on("uncaughtException", (err) => {
  log("uncaughtException", err);
});
process.on("unhandledRejection", (err) => {
  log("unhandledRejection", err);
});

let workspaceCache: { at: number; data: ReturnType<typeof buildWorkspace> } | null = null;

function buildWorkspace() {
  const raw = listThreads();
  const projects = listProjects(raw);
  const threads = raw.flatMap((t) => {
    const match = projects.find((p) => threadBelongsToProject({ ...t, unattached: false }, p));
    if (match) {
      return [{ ...t, projectCwd: match.cwd, unattached: false }];
    }
    if (isScratchPath(t.cwd) || isScratchPath(t.projectCwd) || isScratchPath(t.gitRoot)) {
      return [{ ...t, projectCwd: "", unattached: true }];
    }
    return [];
  });
  return { projects, threads };
}

function workspace() {
  if (workspaceCache && Date.now() - workspaceCache.at < 400) return workspaceCache.data;
  const data = buildWorkspace();
  workspaceCache = { at: Date.now(), data };
  return data;
}

function invalidateWorkspace() {
  workspaceCache = null;
}

const runningAutomations = new Set<string>();
const queuedAutomations = new Set<string>();
let automationChain: Promise<void> = Promise.resolve();

function publishAutomations() {
  send("grok:automations", listAutomations());
}

function sameCwd(a?: string | null, b?: string | null) {
  return (a || "").replace(/[\\/]+$/, "").toLowerCase() === (b || "").replace(/[\\/]+$/, "").toLowerCase();
}

async function runAutomation(id: string, manual = false) {
  if (runningAutomations.has(id)) return;
  const job = getAutomation(id);
  if (!job) return;
  if (!job.prompt.trim()) {
    markFinished(id, false, "没有任务内容");
    publishAutomations();
    return;
  }
  runningAutomations.add(id);
  if (job.lastStatus !== "running") {
    markRunning(id, { trigger: manual ? "manual" : "schedule" });
    publishAutomations();
  }
  const started = Date.now();
  let sessionId = "";
  let threadCwd = "";
  try {
    const unattached = !job.cwd;
    const projectCwd = unattached ? scratchCwd() : job.cwd;
    const boundCwd = job.sessionCwd || "";
    threadCwd = boundCwd && (unattached || sameCwd(boundCwd, projectCwd) || sameCwd(boundCwd, job.cwd))
      ? boundCwd
      : projectCwd;
    acp.allowRoot(projectCwd);
    acp.allowRoot(threadCwd);
    const extra = sessionMeta() as { _meta?: Record<string, unknown> };
    extra._meta = { ...(extra._meta ?? {}), autoMode: true };
    const reused = job.lastSessionId?.trim() || "";
    if (reused) {
      try {
        if (!loadedSessions.has(reused)) {
          await acp.loadSession(reused, threadCwd);
          loadedSessions.add(reused);
        }
        sessionId = reused;
      } catch (err) {
        log("automation reuse failed, creating session", id, err);
        sessionId = "";
      }
    }
    if (!sessionId) {
      sessionId = await acp.newSession(threadCwd, extra);
      loadedSessions.add(sessionId);
      bindSessionToProject(sessionId, unattached ? "" : projectCwd);
      try {
        renameThread(sessionId, threadCwd, job.title || "定时任务");
      } catch {
        /* title is best-effort */
      }
      invalidateWorkspace();
      send("grok:workspace", workspace());
    }
    acp.markAutoSession(sessionId);
    try {
      await acp.prompt(sessionId, job.prompt);
      markFinished(id, true, undefined, { sessionId, sessionCwd: threadCwd, durationMs: Date.now() - started });
      invalidateWorkspace();
      send("grok:workspace", workspace());
    } finally {
      acp.unmarkAutoSession(sessionId);
    }
  } catch (err) {
    if (sessionId) acp.unmarkAutoSession(sessionId);
    markFinished(id, false, err instanceof Error ? err.message : String(err), {
      sessionId: sessionId || undefined,
      sessionCwd: threadCwd || undefined,
      durationMs: Date.now() - started,
    });
    if (!manual) log("automation failed", id, err);
  } finally {
    runningAutomations.delete(id);
    publishAutomations();
  }
}

function enqueueAutomation(id: string, manual = false) {
  if (queuedAutomations.has(id) || runningAutomations.has(id)) return automationChain;
  queuedAutomations.add(id);
  automationChain = automationChain
    .then(() => runAutomation(id, manual))
    .catch((err) => log("automation queue failed", id, err))
    .finally(() => {
      queuedAutomations.delete(id);
    });
  return automationChain;
}

async function tickAutomations() {
  for (const job of dueAutomations(Date.now(), runningAutomations)) {
    void enqueueAutomation(job.id);
  }
}

ipcMain.handle("grok:status", () => acp.status());
ipcMain.handle("grok:account", () => loadAccount());
ipcMain.handle("grok:accountUsage", () => loadAccountUsage());
ipcMain.handle("grok:loginAccount", async () => {
  await ensureSystemProxyEnvironment();
  accountLoginController?.abort();
  const controller = new AbortController();
  accountLoginController = controller;
  try {
    return await startAccountLogin(
      (url) => {
        void shell.openExternal(url);
      },
      { signal: controller.signal },
    );
  } finally {
    if (accountLoginController === controller) accountLoginController = null;
  }
});
ipcMain.handle("grok:cancelAccountLogin", () => {
  accountLoginController?.abort();
  return true;
});
ipcMain.handle("grok:loginApiKey", (_e, input: { baseUrl?: string; apiKey?: string; model?: string; fromCcSwitchId?: string }) => {
  try {
    const payload =
      input?.fromCcSwitchId
        ? (() => {
            const provider = getCcSwitchProvider(input.fromCcSwitchId);
            if (!provider) throw new Error("cc-switch 中没有找到该供应商");
            return { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: input.model };
          })()
        : input;
    if (!payload || !payload.baseUrl || !payload.apiKey) {
      throw new Error("请填写 Base URL 和 API Key");
    }
    const account = saveApiKey({ baseUrl: payload.baseUrl, apiKey: payload.apiKey, model: payload.model });
    return { ok: true, account };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, account: loadAccount(), message };
  }
});
ipcMain.handle("grok:listCcSwitchProviders", () => listCcSwitchProviders());
ipcMain.handle("grok:logout", () => clearApiKey());
ipcMain.handle("grok:checkUpdate", () => checkAppUpdate());
ipcMain.handle("grok:openUpdate", (_e, url?: string) => openUpdateUrl(url));
ipcMain.handle("grok:installInfo", () => ({
  command: INSTALL_COMMAND,
  docs: INSTALL_DOCS,
  logsDir: app.isReady() ? logsDir() : "",
}));
ipcMain.handle("grok:copyInstallCommand", () => {
  clipboard.writeText(INSTALL_COMMAND);
  return true;
});
ipcMain.handle("grok:openInstallDocs", () => shell.openExternal(INSTALL_DOCS));
ipcMain.handle("grok:openLogs", () => shell.openPath(logsDir()));
ipcMain.handle("grok:runInstall", async () => {
  log("started in-app grok install");
  return startGrokInstall((line: InstallLogLine) => {
    send("grok:install-log", line);
    log("install", line.text);
  });
});
ipcMain.handle("grok:listProjects", () => workspace().projects);
ipcMain.handle("grok:listThreads", (_e, cwd?: string) => {
  const { threads } = workspace();
  if (!cwd) return threads;
  return threads.filter((t) => t.projectCwd === cwd || t.cwd === cwd);
});
ipcMain.handle("grok:searchThreads", (_e, query: string) => searchThreads(query, workspace().threads));
ipcMain.handle("grok:loadTranscript", (_e, sessionId: string, cwd: string) =>
  loadTranscript(sessionId, cwd),
);
ipcMain.handle("grok:removeProject", (_e, cwd: string) => {
  removeProject(cwd);
  invalidateWorkspace();
  return workspace().projects;
});
ipcMain.handle("grok:renameProject", (_e, cwd: string, name: string) => {
  const project = renameProject(cwd, name);
  invalidateWorkspace();
  return project;
});
ipcMain.handle("grok:renameThread", (_e, sessionId: string, cwd: string, title: string) => {
  const thread = renameThread(sessionId, cwd, title);
  invalidateWorkspace();
  return thread;
});
ipcMain.handle("grok:removeThread", (_e, sessionId: string, cwd: string) => {
  removeThread(sessionId, cwd);
  unbindSession(sessionId);
  invalidateWorkspace();
  return true;
});

ipcMain.handle("grok:addProject", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "打开项目",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const cwd = result.filePaths[0];
  const gitRoot = await findGitRoot(cwd);
  invalidateWorkspace();
  acp.allowRoot(gitRoot || cwd);
  return addProject(gitRoot || cwd, gitRoot);
});

ipcMain.handle("grok:newThread", async (_e, cwd?: string | null, worktree?: boolean) => {
  const unattached = !cwd;
  const projectCwd = unattached ? scratchCwd() : cwd;
  const gitRoot = unattached ? null : await findGitRoot(projectCwd);
  if (!unattached) addProject(projectCwd, gitRoot);
  let threadCwd = projectCwd;
  let worktreeMeta: { cwd: string; branch: string } | null = null;
  if (!unattached && worktree) {
    worktreeMeta = await createWorktree(projectCwd);
    threadCwd = worktreeMeta.cwd;
  }
  acp.allowRoot(projectCwd);
  acp.allowRoot(threadCwd);
  const goal = unattached ? "" : getGoal(projectCwd);
  const extra = sessionMeta(goal ? [`持续目标：${goal}`] : []);
  const sessionId = await acp.newSession(threadCwd, extra);
  loadedSessions.add(sessionId);
  if (unattached) bindSessionToProject(sessionId, "");
  else bindSessionToProject(sessionId, projectCwd);
  invalidateWorkspace();
  return {
    sessionId,
    cwd: threadCwd,
    projectCwd: unattached ? "" : projectCwd,
    title: "新会话",
    worktree: worktreeMeta,
    projectName: unattached ? "对话" : projectName(projectCwd),
    unattached,
  };
});

ipcMain.handle("grok:forkThread", async (_e, sessionId: string, cwd: string) => {
  if (!sessionId) throw new Error("会话还没创建完成");
  acp.allowRoot(cwd);
  if (!loadedSessions.has(sessionId)) {
    try {
      await acp.loadSession(sessionId, cwd);
      loadedSessions.add(sessionId);
    } catch {
      /* fork can still copy from disk */
    }
  }

  let forkedId = "";
  let forkedCwd = cwd;
  let title = "分叉会话";
  try {
    forkedId = await acp.forkSession(sessionId, cwd);
  } catch {
    const copied = copySession(sessionId, cwd);
    forkedId = copied.id;
    forkedCwd = copied.cwd;
    title = copied.title;
  }

  acp.allowRoot(forkedCwd);
  try {
    await acp.loadSession(forkedId, forkedCwd);
    loadedSessions.add(forkedId);
  } catch {
    /* transcript is enough to open the fork */
  }

  const source = listThreads().find((t) => t.id === sessionId);
  const forked = listThreads().find((t) => t.id === forkedId);
  const projectCwd = forked?.projectCwd || source?.projectCwd || "";
  const unattached = Boolean(forked?.unattached ?? source?.unattached ?? !projectCwd);
  if (unattached) bindSessionToProject(forkedId, "");
  else bindSessionToProject(forkedId, projectCwd);
  invalidateWorkspace();
  return {
    sessionId: forkedId,
    cwd: forked?.cwd || forkedCwd,
    projectCwd: unattached ? "" : projectCwd,
    title: forked?.title || title,
    worktree: forked?.worktree ? { cwd: forked.cwd, branch: "" } : null,
    projectName: unattached ? "对话" : projectName(projectCwd || forkedCwd),
    unattached,
  };
});

ipcMain.handle("grok:resumeThread", async (_e, sessionId: string, cwd: string) => {
  acp.allowRoot(cwd);
  if (!loadedSessions.has(sessionId)) {
    try {
      await acp.loadSession(sessionId, cwd);
      loadedSessions.add(sessionId);
    } catch (err) {
      // loadSession may be unsupported or the session may already be live
      const message = err instanceof Error ? err.message : String(err);
      if (/not found|unknown method|loadSession/i.test(message)) {
        /* continue with local transcript */
      } else {
        throw err;
      }
    }
  }
  return { sessionId, cwd };
});

ipcMain.handle("grok:sendPrompt", async (_e, sessionId: string, text: string, images?: { path: string; mimeType: string }[]) => {
  try {
    return await acp.prompt(sessionId, text, images);
  } catch (err) {
    log("sendPrompt failed", sessionId, err);
    throw err;
  }
});
ipcMain.handle("grok:savePastedImage", async (_e, payload: { data: string; mimeType?: string }) => {
  const mime = (payload?.mimeType || "image/png").toLowerCase();
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "png";
  const raw = String(payload?.data || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw new Error("剪贴板里没有图片");
  const dir = path.join(app.getPath("temp"), "grok-pasted");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `paste-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${ext}`);
  fs.writeFileSync(file, Buffer.from(raw, "base64"));
  return { path: file, mimeType: mime.startsWith("image/") ? mime : `image/${ext}` };
});
ipcMain.handle("grok:saveClipboardImage", async () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const png = image.toPNG();
  const dir = path.join(app.getPath("temp"), "grok-pasted");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `paste-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`);
  fs.writeFileSync(file, png);
  return { path: file, mimeType: "image/png", dataUrl: `data:image/png;base64,${png.toString("base64")}` };
});
ipcMain.handle("grok:setMode", async (_e, sessionId: string, modeId: string) => {
  await acp.setMode(sessionId, modeId);
});
ipcMain.handle("grok:pickFiles", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "选择文件",
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled) return [] as string[];
  return result.filePaths;
});
ipcMain.handle("grok:pickFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "选择文件夹",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return [] as string[];
  return result.filePaths;
});
ipcMain.handle("grok:getGoal", (_e, cwd: string) => getGoal(cwd));
ipcMain.handle("grok:setGoal", (_e, cwd: string, text: string) => setGoal(cwd, text));

ipcMain.handle("grok:cancel", (_e, sessionId: string) => {
  acp.cancel(sessionId);
});

ipcMain.handle("grok:respondPermission", (_e, requestId: string, optionId: string) => {
  return acp.resolvePermission(requestId, optionId);
});

ipcMain.handle("grok:gitStatus", (_e, cwd: string) => gitStatus(cwd));
ipcMain.handle("grok:gitFileDiff", (_e, cwd: string, filePath: string) => gitFileDiff(cwd, filePath));
ipcMain.handle("grok:gitDiscard", (_e, cwd: string, filePath: string) => gitDiscard(cwd, filePath));
ipcMain.handle("grok:gitStage", (_e, cwd: string, filePath: string) => gitStage(cwd, filePath));
ipcMain.handle("grok:gitUnstage", (_e, cwd: string, filePath: string) => gitUnstage(cwd, filePath));
ipcMain.handle("grok:gitCommit", (_e, cwd: string, message: string) => gitCommit(cwd, message));
ipcMain.handle("grok:gitPush", (_e, cwd: string) => gitPush(cwd));
ipcMain.handle("grok:applyWorktree", (_e, fromCwd: string, destCwd: string) =>
  applyWorktree(fromCwd, destCwd),
);

ipcMain.handle("grok:openInEditor", async (_e, cwd: string, filePath?: string) => {
  const target = filePath ? path.resolve(cwd, filePath) : cwd;
  const args = filePath ? [target] : ["."];
  const candidates =
    process.platform === "win32"
      ? [
          ["code.cmd", args],
          ["cursor.cmd", args],
        ]
      : [
          ["code", args],
          ["cursor", args],
        ];
  for (const [cmd, cmdArgs] of candidates) {
    const launched = await new Promise<boolean>((resolve) => {
      const child = spawn(cmd, cmdArgs, {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: true,
      });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
      setTimeout(() => resolve(true), 400);
    });
    if (launched) return { ok: true, editor: cmd };
  }
  await shell.openPath(target);
  return { ok: true, editor: "folder" };
});

ipcMain.handle("grok:openPath", async (_e, target: string) => {
  if (fs.existsSync(target)) await shell.openPath(target);
});

ipcMain.handle("grok:settings", (_e, cwd?: string | null) => loadSettings(cwd));
ipcMain.handle("grok:setModel", async (_e, id: string) => {
  setDefaultModel(id);
  loadedSessions.clear();
  await acp.stop();
  return loadSettings();
});
ipcMain.handle("grok:setReasoningEffort", async (_e, effort: ReasoningEffort) => {
  setDefaultReasoningEffort(effort);
  return loadSettings(undefined, { skipCli: true });
});
ipcMain.handle("grok:setBrowserControl", async (_e, enabled: boolean, cwd?: string | null) => {
  setBrowserControl(enabled);
  try {
    const current = await loadSettings(cwd);
    for (const server of current.mcpServers) {
      if (!isBrowserControlServer(server.name)) continue;
      if (enabled && !server.enabled) await mcpEnable(server.name, cwd);
      if (!enabled && server.enabled) await mcpDisable(server.name, cwd);
    }
  } catch {
    /* keep the UI flag even if MCP toggle fails */
  }
  return loadSettings(cwd);
});
ipcMain.handle("grok:setSubagentsEnabled", async (_e, enabled: boolean, cwd?: string | null) => {
  setSubagentsEnabled(enabled);
  return loadSettings(cwd, { skipCli: true });
});
ipcMain.handle(
  "grok:setSubagentTypeEnabled",
  async (_e, id: string, enabled: boolean, cwd?: string | null) => {
    setSubagentTypeEnabled(id, enabled);
    return loadSettings(cwd, { skipCli: true });
  },
);
ipcMain.handle(
  "grok:setSubagentTypeModel",
  async (_e, id: string, model: string | null, cwd?: string | null) => {
    setSubagentTypeModel(id, model);
    return loadSettings(cwd, { skipCli: true });
  },
);
ipcMain.handle("grok:openAgentsDir", async () => {
  const dir = ensureUserAgentsDir();
  await shell.openPath(dir);
  return dir;
});
ipcMain.handle("grok:setComputerControl", async (_e, enabled: boolean, cwd?: string | null) => {
  setComputerControl(enabled);
  try {
    const current = await loadSettings(cwd);
    for (const server of current.mcpServers) {
      if (!isComputerControlServer(server.name)) continue;
      if (enabled && !server.enabled) await mcpEnable(server.name, cwd);
      if (!enabled && server.enabled) await mcpDisable(server.name, cwd);
    }
    for (const plugin of current.plugins) {
      if (!isComputerControlServer(plugin.name)) continue;
      if (enabled && !plugin.enabled) await pluginEnable(plugin.name, cwd);
      if (!enabled && plugin.enabled) await pluginDisable(plugin.name, cwd);
    }
  } catch {
    /* keep the UI flag even if MCP/plugin toggle fails */
  }
  return loadSettings(cwd);
});
ipcMain.handle("grok:setPermission", (_e, mode: PermissionMode) => {
  setPermissionMode(mode);
  return loadSettings();
});
ipcMain.handle("grok:setSkillDisabled", async (_e, name: string, disabled: boolean, cwd?: string | null) => {
  setSkillDisabled(name, disabled);
  return loadSettings(cwd);
});
ipcMain.handle("grok:openSkillsDir", async () => {
  const dir = ensureUserSkillsDir();
  await shell.openPath(dir);
  return dir;
});
ipcMain.handle("grok:openHooksDir", async () => {
  const dir = ensureUserHooksDir();
  await shell.openPath(dir);
  return dir;
});
ipcMain.handle("grok:mcpAdd", async (_e, input: McpAddInput, cwd?: string | null) => {
  try {
    await mcpAdd(input, cwd);
    return await loadSettings(cwd);
  } catch (err) {
    throw new Error(err instanceof GrokCliError ? err.message : String(err));
  }
});
ipcMain.handle("grok:mcpRemove", async (_e, name: string, scope: "user" | "project" | undefined, cwd?: string | null) => {
  try {
    await mcpRemove(name, scope, cwd);
    return await loadSettings(cwd);
  } catch (err) {
    throw new Error(err instanceof GrokCliError ? err.message : String(err));
  }
});
ipcMain.handle("grok:mcpSetEnabled", async (_e, name: string, enabled: boolean, cwd?: string | null) => {
  try {
    if (enabled) await mcpEnable(name, cwd);
    else await mcpDisable(name, cwd);
    return await loadSettings(cwd);
  } catch (err) {
    throw new Error(err instanceof GrokCliError ? err.message : String(err));
  }
});
ipcMain.handle("grok:mcpDoctor", async (_e, name?: string, cwd?: string | null) => {
  try {
    return await mcpDoctor(name, cwd);
  } catch (err) {
    throw new Error(err instanceof GrokCliError ? err.message : String(err));
  }
});
ipcMain.handle("grok:pluginSetEnabled", async (_e, name: string, enabled: boolean, cwd?: string | null) => {
  try {
    if (enabled) await pluginEnable(name, cwd);
    else await pluginDisable(name, cwd);
    return await loadSettings(cwd);
  } catch (err) {
    throw new Error(err instanceof GrokCliError ? err.message : String(err));
  }
});
ipcMain.handle("grok:pluginInstall", async (_e, source: string, trust: boolean, cwd?: string | null) => {
  try {
    await pluginInstall(source, trust, cwd);
    return await loadSettings(cwd);
  } catch (err) {
    throw new Error(err instanceof GrokCliError ? err.message : String(err));
  }
});
ipcMain.handle("grok:pluginUninstall", async (_e, name: string, cwd?: string | null) => {
  try {
    await pluginUninstall(name, cwd);
    return await loadSettings(cwd);
  } catch (err) {
    throw new Error(err instanceof GrokCliError ? err.message : String(err));
  }
});
ipcMain.handle("grok:marketplaceAdd", async (_e, url: string, cwd?: string | null) => {
  try {
    await marketplaceAdd(url, cwd);
    return await loadSettings(cwd);
  } catch (err) {
    throw new Error(err instanceof GrokCliError ? err.message : String(err));
  }
});
ipcMain.handle("grok:marketplaceRemove", async (_e, url: string, cwd?: string | null) => {
  try {
    await marketplaceRemove(url, cwd);
    return await loadSettings(cwd);
  } catch (err) {
    throw new Error(err instanceof GrokCliError ? err.message : String(err));
  }
});
ipcMain.handle("grok:availablePlugins", async () => {
  try {
    return await listAvailablePlugins();
  } catch (err) {
    throw new Error(err instanceof GrokCliError ? err.message : String(err));
  }
});
ipcMain.handle("grok:trustProject", async (_e, cwd: string) => {
  trustProject(cwd);
  return loadSettings(cwd);
});
ipcMain.handle("grok:listAutomations", () => listAutomations());
ipcMain.handle("grok:createAutomation", (_e, input: AutomationInput) => {
  const row = createAutomation(input);
  publishAutomations();
  return row;
});
ipcMain.handle("grok:updateAutomation", (_e, id: string, patch: Partial<AutomationInput> & { enabled?: boolean }) => {
  const row = updateAutomation(id, patch);
  publishAutomations();
  return row;
});
ipcMain.handle("grok:deleteAutomation", (_e, id: string) => {
  const ok = deleteAutomation(id);
  publishAutomations();
  return ok;
});
ipcMain.handle("grok:runAutomation", (_e, id: string) => {
  const job = getAutomation(id);
  if (!job) return null;
  if (job.lastStatus === "running" || runningAutomations.has(id) || queuedAutomations.has(id)) return job;
  markRunning(id, { trigger: "manual" });
  publishAutomations();
  void enqueueAutomation(id, true);
  return getAutomation(id);
});
ipcMain.handle("grok:addHook", async (_e, input: { name: string; event: string; matcher?: string; command: string }, cwd?: string | null) => {
  writeUserHook(input);
  return loadSettings(cwd);
});
ipcMain.handle("grok:terminalStart", (_e, cwd: string) => {
  terminal.start(cwd);
  return { cwd };
});
ipcMain.handle("grok:terminalWrite", (_e, text: string) => terminal.write(text));
ipcMain.handle("grok:terminalKill", () => terminal.kill());

ipcMain.handle("grok:window", (_e, action: "min" | "max" | "close") => {
  const win = mainWindow;
  if (!win) return;
  if (action === "min") win.minimize();
  else if (action === "max") {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } else win.close();
});
