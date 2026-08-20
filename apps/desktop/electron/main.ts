import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { GrokAcpClient } from "./acp";
import {
  addProject,
  bindSessionToProject,
  listProjects,
  projectName,
  removeProject,
  threadBelongsToProject,
} from "./projects";
import { listThreads, loadTranscript } from "./sessions";
import {
  applyWorktree,
  createWorktree,
  findGitRoot,
  gitDiscard,
  gitFileDiff,
  gitStage,
  gitStatus,
  gitUnstage,
} from "./git";
import {
  loadSettings,
  sessionMeta,
  setDefaultModel,
  setPermissionMode,
  setSkillDisabled,
} from "./config";
import { ProjectTerminal } from "./terminal";
import type { PermissionMode } from "./shared";
import { INSTALL_COMMAND, INSTALL_DOCS } from "./grok-bin";
import { initLog, log, logsDir, pruneLogs } from "./log";
import { getGoal, setGoal } from "./goals";

app.setName("Grok Build");

const acp = new GrokAcpClient();
const loadedSessions = new Set<string>();
const terminal = new ProjectTerminal();
let mainWindow: BrowserWindow | null = null;

function send(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload);
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

acp.on("update", (payload) => send("grok:update", payload));
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
    initLog();
    pruneLogs();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
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
  const threads = raw.map((t) => {
    const match = projects.find((p) => threadBelongsToProject(t, p));
    return match ? { ...t, projectCwd: match.cwd } : t;
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

ipcMain.handle("grok:status", () => acp.status());
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
  if (process.platform !== "win32") {
    await shell.openExternal(INSTALL_DOCS);
    return { ok: true, launched: false };
  }
  spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", INSTALL_COMMAND],
    { detached: true, stdio: "ignore", windowsHide: false },
  ).unref();
  log("launched grok install script");
  return { ok: true, launched: true };
});
ipcMain.handle("grok:listProjects", () => workspace().projects);
ipcMain.handle("grok:listThreads", (_e, cwd?: string) => {
  const { threads } = workspace();
  if (!cwd) return threads;
  return threads.filter((t) => t.projectCwd === cwd || t.cwd === cwd);
});
ipcMain.handle("grok:loadTranscript", (_e, sessionId: string, cwd: string) =>
  loadTranscript(sessionId, cwd),
);
ipcMain.handle("grok:removeProject", (_e, cwd: string) => {
  removeProject(cwd);
  invalidateWorkspace();
  return workspace().projects;
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

ipcMain.handle("grok:newThread", async (_e, cwd: string, worktree: boolean) => {
  const projectCwd = cwd;
  const gitRoot = await findGitRoot(projectCwd);
  addProject(projectCwd, gitRoot);
  let threadCwd = projectCwd;
  let worktreeMeta: { cwd: string; branch: string } | null = null;
  if (worktree) {
    worktreeMeta = await createWorktree(projectCwd);
    threadCwd = worktreeMeta.cwd;
  }
  acp.allowRoot(projectCwd);
  acp.allowRoot(threadCwd);
  const extra = sessionMeta() as { _meta?: Record<string, unknown> };
  const goal = getGoal(projectCwd);
  if (goal) {
    extra._meta = { ...(extra._meta ?? {}), rules: `持续目标：${goal}` };
  }
  const sessionId = await acp.newSession(threadCwd, extra);
  loadedSessions.add(sessionId);
  bindSessionToProject(sessionId, projectCwd);
  invalidateWorkspace();
  return {
    sessionId,
    cwd: threadCwd,
    projectCwd,
    title: "新会话",
    worktree: worktreeMeta,
    projectName: projectName(projectCwd),
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

ipcMain.handle("grok:sendPrompt", async (_e, sessionId: string, text: string) => {
  return acp.prompt(sessionId, text);
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
ipcMain.handle("grok:setPermission", (_e, mode: PermissionMode) => {
  setPermissionMode(mode);
  return loadSettings();
});
ipcMain.handle("grok:setSkillDisabled", async (_e, name: string, disabled: boolean, cwd?: string | null) => {
  setSkillDisabled(name, disabled);
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
