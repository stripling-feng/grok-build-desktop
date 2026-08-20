import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("grok", {
  status: () => ipcRenderer.invoke("grok:status"),
  installInfo: () => ipcRenderer.invoke("grok:installInfo"),
  copyInstallCommand: () => ipcRenderer.invoke("grok:copyInstallCommand"),
  openInstallDocs: () => ipcRenderer.invoke("grok:openInstallDocs"),
  openLogs: () => ipcRenderer.invoke("grok:openLogs"),
  runInstall: () => ipcRenderer.invoke("grok:runInstall"),
  listProjects: () => ipcRenderer.invoke("grok:listProjects"),
  addProject: () => ipcRenderer.invoke("grok:addProject"),
  removeProject: (cwd: string) => ipcRenderer.invoke("grok:removeProject", cwd),
  listThreads: (cwd?: string) => ipcRenderer.invoke("grok:listThreads", cwd),
  loadTranscript: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("grok:loadTranscript", sessionId, cwd),
  newThread: (cwd: string, worktree: boolean) =>
    ipcRenderer.invoke("grok:newThread", cwd, worktree),
  resumeThread: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("grok:resumeThread", sessionId, cwd),
  sendPrompt: (sessionId: string, text: string) =>
    ipcRenderer.invoke("grok:sendPrompt", sessionId, text),
  setMode: (sessionId: string, modeId: string) =>
    ipcRenderer.invoke("grok:setMode", sessionId, modeId),
  pickFiles: () => ipcRenderer.invoke("grok:pickFiles"),
  pickFolder: () => ipcRenderer.invoke("grok:pickFolder"),
  getGoal: (cwd: string) => ipcRenderer.invoke("grok:getGoal", cwd),
  setGoal: (cwd: string, text: string) => ipcRenderer.invoke("grok:setGoal", cwd, text),
  cancel: (sessionId: string) => ipcRenderer.invoke("grok:cancel", sessionId),
  respondPermission: (requestId: string, optionId: string) =>
    ipcRenderer.invoke("grok:respondPermission", requestId, optionId),
  gitStatus: (cwd: string) => ipcRenderer.invoke("grok:gitStatus", cwd),
  gitFileDiff: (cwd: string, filePath: string) =>
    ipcRenderer.invoke("grok:gitFileDiff", cwd, filePath),
  gitDiscard: (cwd: string, filePath: string) =>
    ipcRenderer.invoke("grok:gitDiscard", cwd, filePath),
  gitStage: (cwd: string, filePath: string) =>
    ipcRenderer.invoke("grok:gitStage", cwd, filePath),
  gitUnstage: (cwd: string, filePath: string) =>
    ipcRenderer.invoke("grok:gitUnstage", cwd, filePath),
  applyWorktree: (fromCwd: string, destCwd: string) =>
    ipcRenderer.invoke("grok:applyWorktree", fromCwd, destCwd),
  openInEditor: (cwd: string, filePath?: string) =>
    ipcRenderer.invoke("grok:openInEditor", cwd, filePath),
  openPath: (target: string) => ipcRenderer.invoke("grok:openPath", target),
  windowControl: (action: "min" | "max" | "close") =>
    ipcRenderer.invoke("grok:window", action),
  settings: (cwd?: string | null) => ipcRenderer.invoke("grok:settings", cwd),
  setModel: (id: string) => ipcRenderer.invoke("grok:setModel", id),
  setPermission: (mode: string) => ipcRenderer.invoke("grok:setPermission", mode),
  setSkillDisabled: (name: string, disabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:setSkillDisabled", name, disabled, cwd),
  terminalStart: (cwd: string) => ipcRenderer.invoke("grok:terminalStart", cwd),
  terminalWrite: (text: string) => ipcRenderer.invoke("grok:terminalWrite", text),
  terminalKill: () => ipcRenderer.invoke("grok:terminalKill"),
  onTerminalData: (cb: (chunk: string) => void) => {
    const listener = (_event: unknown, chunk: string) => cb(chunk);
    ipcRenderer.on("grok:terminal-data", listener);
    return () => ipcRenderer.removeListener("grok:terminal-data", listener);
  },
  onUpdate: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:update", listener);
    return () => ipcRenderer.removeListener("grok:update", listener);
  },
  onPermission: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:permission", listener);
    return () => ipcRenderer.removeListener("grok:permission", listener);
  },
  onAgentStatus: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:agent-status", listener);
    return () => ipcRenderer.removeListener("grok:agent-status", listener);
  },
});
