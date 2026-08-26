import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, session as electronSession, shell, Tray } from "electron";
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
import { copySession, initializeThreadTitle, listThreads, loadTranscript, readChatImage, removeThread, renameThread, saveTurnAttachments, saveTurnFiles, searchThreads, touchThreadActivity } from "./sessions";
import {
  applyWorktree,
  createWorktree,
  findGitRoot,
  gitFilesChangedSince,
  gitCommit,
  gitDiscard,
  gitFileDiff,
  gitPush,
  readFilePreview,
  gitStage,
  gitStatus,
  gitUnstage,
  gitWorktreeSnapshot,
  type GitWorktreeSnapshot,
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
import { extractModifiedFilePaths, type PermissionMode, type ReasoningEffort } from "./shared";
import {
  FollowUpQueue,
  type FollowUpImage,
  type QueuedFollowUp,
} from "./follow-ups";
import { TurnCompletionTracker } from "./turn-completion";
import { SessionReplayGate } from "./session-replay";
import { INSTALL_COMMAND, INSTALL_DOCS } from "./grok-bin";
import { startGrokInstall, stopGrokInstall, type InstallLogLine } from "./install-cli";
import { initLog, log, logsDir, pruneLogs } from "./log";
import { getGoal, setGoal } from "./goals";
import { loadAccount, loadAccountUsage, saveApiKey, startAccountLogin, getCcSwitchProvider, listCcSwitchProviders, clearAccountCredentials } from "./account";
import { checkAppUpdate, downloadAppUpdate, initializeAppUpdater, installDownloadedUpdate } from "./update";
import { pathsFromClipboardBuffer } from "./clipboard-files";
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
const runningSessions = new Set<string>();
const followUps = new FollowUpQueue();
const activePromptSessions = new Set<string>();
const drainingFollowUps = new Set<string>();
const steeredSessions = new Set<string>();
const turnCompletions = new TurnCompletionTracker();
const sessionReplays = new SessionReplayGate();
const activeTurnFiles = new Map<
  string,
  { cwd: string; startedAt: number; reported: Set<string>; baseline: GitWorktreeSnapshot | null }
>();
const terminal = new ProjectTerminal();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let windowRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
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

function setSessionRunning(sessionId: string, running: boolean) {
  if (!sessionId) return;
  const changed = running ? !runningSessions.has(sessionId) : runningSessions.has(sessionId);
  if (!changed) return;
  if (running) runningSessions.add(sessionId);
  else runningSessions.delete(sessionId);
  send("grok:run-state", { sessionId, running });
}

function clearRunningSessions() {
  for (const sessionId of [...runningSessions]) setSessionRunning(sessionId, false);
}

function relativeTurnPath(cwd: string, candidate: string): string | null {
  if (!cwd || !candidate.trim()) return null;
  const root = path.resolve(cwd);
  const full = path.resolve(root, candidate);
  const relative = path.relative(root, full).replace(/\\/g, "/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) return null;
  if (relative === ".git" || relative.startsWith(".git/")) return null;
  return relative;
}

function recordTurnFile(sessionId: string, candidate: string) {
  const turn = activeTurnFiles.get(sessionId);
  if (!turn) return;
  const relative = relativeTurnPath(turn.cwd, candidate);
  if (relative) turn.reported.add(relative);
}

async function finishTurnFiles(sessionId: string, succeeded: boolean) {
  const turn = activeTurnFiles.get(sessionId);
  activeTurnFiles.delete(sessionId);
  if (!turn || !succeeded) return;
  let gitFiles: string[] = [];
  try {
    gitFiles = await gitFilesChangedSince(turn.cwd, turn.baseline);
  } catch (err) {
    log("turn file comparison failed", sessionId, err);
  }
  const files = [...new Set([...turn.reported, ...gitFiles])].sort((a, b) => a.localeCompare(b));
  if (!files.length) return;
  const payload = { sessionId, files };
  saveTurnFiles(sessionId, turn.cwd, {
    startedAt: turn.startedAt,
    completedAt: Date.now(),
    files,
  });
  send("grok:turn-files", payload);
}

function publishFollowUps(sessionId: string) {
  send("grok:follow-up-state", { sessionId, entries: followUps.list(sessionId) });
}

async function executePromptTurn(
  sessionId: string,
  text: string,
  images?: FollowUpImage[],
  attachments: string[] = [],
  startedAt = Date.now(),
): Promise<unknown> {
  activePromptSessions.add(sessionId);
  turnCompletions.start(sessionId);
  const cwd =
    acp.cwdForSession(sessionId) ||
    listThreads().find((thread) => thread.id === sessionId)?.cwd ||
    "";
  let baseline: GitWorktreeSnapshot | null = null;
  if (cwd) {
    try {
      baseline = await gitWorktreeSnapshot(cwd);
    } catch (err) {
      log("turn file baseline failed", sessionId, err);
    }
  }
  activeTurnFiles.set(sessionId, {
    cwd,
    startedAt,
    reported: new Set<string>(),
    baseline,
  });
  if (cwd && attachments.length) {
    saveTurnAttachments(sessionId, cwd, { startedAt, files: attachments });
  }
  let succeeded = false;
  try {
    const result = await acp.prompt(sessionId, text, images);
    succeeded = true;
    return result;
  } finally {
    await finishTurnFiles(sessionId, succeeded);
    activePromptSessions.delete(sessionId);
    steeredSessions.delete(sessionId);
    if (succeeded) {
      if (turnCompletions.settle(sessionId)) {
        publishSessionTurnCompleted(sessionId, followUps.has(sessionId));
      }
    } else {
      turnCompletions.abort(sessionId);
    }
  }
}

async function loadSessionWithoutRendererReplay(sessionId: string, cwd: string): Promise<void> {
  sessionReplays.begin(sessionId);
  try {
    await acp.loadSession(sessionId, cwd);
  } finally {
    const suppressed = sessionReplays.end(sessionId);
    if (suppressed > 0) log("session replay updates suppressed", sessionId, suppressed);
  }
}

async function drainFollowUps(sessionId: string) {
  if (activePromptSessions.has(sessionId) || drainingFollowUps.has(sessionId)) return;
  drainingFollowUps.add(sessionId);
  setSessionRunning(sessionId, true);
  try {
    while (!activePromptSessions.has(sessionId)) {
      const entry = followUps.take(sessionId);
      if (!entry) break;
      publishFollowUps(sessionId);
      send("grok:follow-up-started", { entry, delivery: "queued" });
      try {
        await executePromptTurn(sessionId, entry.text, entry.images, entry.attachments);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("queued follow-up failed", sessionId, err);
        send("grok:follow-up-error", { entry, message });
        break;
      }
    }
  } finally {
    drainingFollowUps.delete(sessionId);
    if (!activePromptSessions.has(sessionId) && !steeredSessions.has(sessionId)) {
      setSessionRunning(sessionId, false);
    }
  }
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

function notifySessionCompleted(sessionId: string, title?: string) {
  if (!Notification.isSupported()) return;
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    mainWindow.isFocused()
  ) {
    log("completion notification skipped", sessionId, "foreground");
    return;
  }
  const notification = new Notification({
    title: "会话已完成",
    body: title ? `“${title}”已完成` : `会话 ${sessionId.slice(0, 8)} 已完成`,
    icon: appIconPath(),
  });
  notification.on("click", showMainWindow);
  notification.show();
  log("completion notification shown", sessionId);
}

function publishSessionTurnCompleted(
  sessionId: string,
  runContinues: boolean,
  payload: {
    sessionId: string;
    update: Record<string, unknown>;
    method?: string;
    meta?: Record<string, unknown>;
  } = { sessionId, update: { sessionUpdate: "turn_completed" } },
) {
  send("grok:update", runContinues ? { ...payload, runContinues: true } : payload);
  if (!runContinues) setSessionRunning(sessionId, false);
  touchThreadActivity(sessionId);
  invalidateWorkspace();
  const completedWorkspace = workspace();
  send("grok:workspace", completedWorkspace);
  if (!runContinues) {
    notifySessionCompleted(
      sessionId,
      completedWorkspace.threads.find((thread) => thread.id === sessionId)?.title,
    );
  }
}

function recoverMainWindow() {
  if (isQuitting || mainWindow || windowRecoveryTimer) return;
  windowRecoveryTimer = setTimeout(() => {
    windowRecoveryTimer = null;
    if (isQuitting || mainWindow) return;
    log("recovering main window");
    createWindow();
  }, 250);
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
  if (mainWindow && !mainWindow.isDestroyed()) return;
  const preload = path.join(__dirname, "preload.js");
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: "Grok 桌面端",
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
  mainWindow = win;
  log("window created");

  win.once("ready-to-show", () => {
    log("window ready-to-show");
    if (!isQuitting && mainWindow === win && !win.isDestroyed()) win.show();
  });
  win.on("close", (event) => {
    log("window close requested", `quitting=${isQuitting}`);
    if (isQuitting) return;
    event.preventDefault();
    if (!win.isDestroyed()) win.hide();
  });
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    log("renderer", level, message, sourceId, line);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log("did-fail-load", code, desc, url);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.on("closed", () => {
    log("window closed", `quitting=${isQuitting}`);
    if (mainWindow === win) mainWindow = null;
    recoverMainWindow();
  });
  win.webContents.on("unresponsive", () => log("window unresponsive"));
  win.webContents.on("render-process-gone", (_e, details) => {
    log("webContents gone", details.reason);
    if (details.reason === "clean-exit") return;
    if (!win.isDestroyed()) win.reload();
    else recoverMainWindow();
  });
}

acp.on("update", (payload) => {
  if (sessionReplays.shouldSuppress(payload.sessionId)) return;
  for (const filePath of extractModifiedFilePaths(payload.update)) {
    recordTurnFile(payload.sessionId, filePath);
  }
  const turnCompleted = String(payload.update?.sessionUpdate ?? "") === "turn_completed";
  if (turnCompleted) {
    if (!turnCompletions.acceptLive(payload.sessionId)) return;
    steeredSessions.delete(payload.sessionId);
    publishSessionTurnCompleted(payload.sessionId, followUps.has(payload.sessionId), payload);
    return;
  }
  send("grok:update", payload);
});
acp.on("fileWrite", (payload: { sessionId: string; path: string }) => {
  recordTurnFile(payload.sessionId, payload.path);
});
acp.on("permission", (payload) => send("grok:permission", payload));
acp.on("status", (payload) => {
  if (!payload.connected) {
    loadedSessions.clear();
    steeredSessions.clear();
    turnCompletions.clear();
    sessionReplays.clear();
    clearRunningSessions();
  }
  send("grok:agent-status", payload);
});
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
    initializeAppUpdater((state) => send("grok:app-update-state", state));
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
  log("window-all-closed", `quitting=${isQuitting}`);
  if (isQuitting) return;
  // This application is tray-based. Losing the last BrowserWindow must not
  // terminate the main process; recreate it after an unexpected destruction.
  if (!tray || tray.isDestroyed()) createTray();
  recoverMainWindow();
});

app.on("before-quit", () => {
  log("before-quit");
  isQuitting = true;
  if (windowRecoveryTimer) {
    clearTimeout(windowRecoveryTimer);
    windowRecoveryTimer = null;
  }
  tray?.destroy();
  tray = null;
  stopGrokInstall();
  terminal.kill();
  void acp.stop();
});

app.on("will-quit", () => log("will-quit"));
app.on("quit", (_event, exitCode) => log("quit", exitCode));

app.on("render-process-gone", (_event, _webContents, details) => {
  log("renderer gone", details.reason, details.exitCode);
  if (details.reason !== "clean-exit") recoverMainWindow();
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
          await loadSessionWithoutRendererReplay(reused, threadCwd);
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
ipcMain.handle("grok:logout", async () => {
  const account = clearAccountCredentials();
  await acp.stop();
  return account;
});
ipcMain.handle("grok:checkUpdate", () => checkAppUpdate());
ipcMain.handle("grok:downloadUpdate", () => downloadAppUpdate());
ipcMain.handle("grok:installUpdate", () => installDownloadedUpdate());
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

ipcMain.handle("grok:newThread", async (_e, cwd?: string | null, worktree?: boolean, initialPrompt?: string) => {
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
  const title = initializeThreadTitle(sessionId, threadCwd, initialPrompt || "");
  invalidateWorkspace();
  return {
    sessionId,
    cwd: threadCwd,
    projectCwd: unattached ? "" : projectCwd,
    title,
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
      await loadSessionWithoutRendererReplay(sessionId, cwd);
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
    await loadSessionWithoutRendererReplay(forkedId, forkedCwd);
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
      await loadSessionWithoutRendererReplay(sessionId, cwd);
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

ipcMain.handle("grok:sendPrompt", async (
  _e,
  sessionId: string,
  text: string,
  images?: FollowUpImage[],
  attachments?: string[],
  startedAt?: number,
) => {
  setSessionRunning(sessionId, true);
  try {
    return await executePromptTurn(sessionId, text, images, attachments, startedAt);
  } catch (err) {
    log("sendPrompt failed", sessionId, err);
    throw err;
  } finally {
    if (followUps.has(sessionId)) void drainFollowUps(sessionId);
    else if (!steeredSessions.has(sessionId)) {
      // Some Grok versions do not forward the persisted `turn_completed` event.
      // The prompt request settling is the authoritative fallback completion.
      setSessionRunning(sessionId, false);
    }
  }
});
ipcMain.handle("grok:runningSessions", () => [...runningSessions]);
ipcMain.handle(
  "grok:queueFollowUp",
  (_e, sessionId: string, text: string, images?: FollowUpImage[], attachments?: string[]) => {
    if (!sessionId || (!text.trim() && !images?.length)) throw new Error("没有可排队的内容");
    const entry = followUps.create(sessionId, text, images, attachments);
    followUps.enqueue(entry);
    publishFollowUps(sessionId);
    return { delivery: "queued", entry };
  },
);
ipcMain.handle("grok:promoteFollowUp", async (_e, sessionId: string) => {
  const entry = followUps.take(sessionId);
  if (!entry) return null;
  if (!activePromptSessions.has(sessionId)) {
    followUps.prepend(entry);
    publishFollowUps(sessionId);
    return { delivery: "queued", entry, fallback: true };
  }
  publishFollowUps(sessionId);
  try {
    const result = await acp.interject(sessionId, entry.text, entry.images);
    if (result === "unsupported") {
      followUps.prepend(entry);
      publishFollowUps(sessionId);
      return { delivery: "queued", entry, fallback: true };
    }
    steeredSessions.add(sessionId);
    const cwd =
      acp.cwdForSession(sessionId) ||
      listThreads().find((thread) => thread.id === sessionId)?.cwd ||
      "";
    if (cwd && entry.attachments.length) {
      saveTurnAttachments(sessionId, cwd, { startedAt: Date.now(), files: entry.attachments });
    }
    setSessionRunning(sessionId, true);
    send("grok:follow-up-started", { entry, delivery: "steered" });
    return { delivery: "steered", entry };
  } catch (err) {
    followUps.prepend(entry);
    publishFollowUps(sessionId);
    throw err;
  }
});
ipcMain.handle("grok:removeFollowUp", (_e, sessionId: string, entryId: string) => {
  const removed = followUps.remove(sessionId, entryId);
  if (removed) publishFollowUps(sessionId);
  return removed;
});
ipcMain.handle("grok:queuedFollowUps", (_e, sessionId?: string) => followUps.list(sessionId));

function clipboardFilePaths(): string[] {
  const formats = clipboard.availableFormats();
  const candidates = [
    ...formats.filter((format) => /(?:filenamew|filename|cf_hdrop|filedrop|file-url|uri-list)/i.test(format)),
    "FileNameW",
    "CF_HDROP",
  ];
  const paths: string[] = [];
  for (const format of [...new Set(candidates)]) {
    try {
      paths.push(...pathsFromClipboardBuffer(format, clipboard.readBuffer(format)));
    } catch {
      // Some clipboard formats are advertised but cannot be read as buffers.
    }
  }
  return [...new Set(paths)]
    .filter((filePath) => path.isAbsolute(filePath) && fs.existsSync(filePath))
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    });
}

ipcMain.on("grok:clipboardFilePaths", (event) => {
  event.returnValue = clipboardFilePaths();
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
ipcMain.handle("grok:savePastedFile", async (_e, payload: { data: string; name?: string; mimeType?: string }) => {
  const raw = String(payload?.data || "").replace(/^data:[^;]*;base64,/, "");
  if (!raw) throw new Error("剪贴板里的文件为空");
  const originalName = path.basename(String(payload?.name || "file"));
  const safeName = originalName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "file";
  const dir = path.join(app.getPath("temp"), "grok-pasted");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `paste-${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${safeName}`);
  fs.writeFileSync(file, Buffer.from(raw, "base64"));
  return { path: file, mimeType: String(payload?.mimeType || "application/octet-stream") };
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
  const cleared = followUps.clear(sessionId);
  if (cleared.length) publishFollowUps(sessionId);
  steeredSessions.delete(sessionId);
  acp.cancel(sessionId);
  setSessionRunning(sessionId, false);
  return cleared;
});

ipcMain.handle("grok:respondPermission", (_e, requestId: string, optionId: string) => {
  return acp.resolvePermission(requestId, optionId);
});

ipcMain.handle("grok:gitStatus", (_e, cwd: string) => gitStatus(cwd));
ipcMain.handle("grok:gitFileDiff", (_e, cwd: string, filePath: string) => gitFileDiff(cwd, filePath));
ipcMain.handle("grok:readFilePreview", (_e, cwd: string, filePath: string) =>
  readFilePreview(cwd, filePath),
);
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
ipcMain.handle(
  "grok:resolveImage",
  (_e, input: { src: string; sessionId?: string; cwd?: string }) =>
    readChatImage(input?.src || "", input?.sessionId, input?.cwd),
);

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
    await ensureSystemProxyEnvironment();
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
    await ensureSystemProxyEnvironment();
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
