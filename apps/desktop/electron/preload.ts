import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("grok", {
  status: () => ipcRenderer.invoke("grok:status"),
  account: () => ipcRenderer.invoke("grok:account"),
  accountUsage: () => ipcRenderer.invoke("grok:accountUsage"),
  checkUpdate: () => ipcRenderer.invoke("grok:checkUpdate"),
  openUpdate: (url?: string) => ipcRenderer.invoke("grok:openUpdate", url),
  installInfo: () => ipcRenderer.invoke("grok:installInfo"),
  copyInstallCommand: () => ipcRenderer.invoke("grok:copyInstallCommand"),
  openInstallDocs: () => ipcRenderer.invoke("grok:openInstallDocs"),
  openLogs: () => ipcRenderer.invoke("grok:openLogs"),
  runInstall: () => ipcRenderer.invoke("grok:runInstall"),
  listProjects: () => ipcRenderer.invoke("grok:listProjects"),
  addProject: () => ipcRenderer.invoke("grok:addProject"),
  removeProject: (cwd: string) => ipcRenderer.invoke("grok:removeProject", cwd),
  renameProject: (cwd: string, name: string) => ipcRenderer.invoke("grok:renameProject", cwd, name),
  renameThread: (sessionId: string, cwd: string, title: string) =>
    ipcRenderer.invoke("grok:renameThread", sessionId, cwd, title),
  removeThread: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("grok:removeThread", sessionId, cwd),
  listThreads: (cwd?: string) => ipcRenderer.invoke("grok:listThreads", cwd),
  loadTranscript: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("grok:loadTranscript", sessionId, cwd),
  newThread: (cwd?: string | null, worktree?: boolean) =>
    ipcRenderer.invoke("grok:newThread", cwd ?? null, Boolean(worktree)),
  resumeThread: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("grok:resumeThread", sessionId, cwd),
  forkThread: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("grok:forkThread", sessionId, cwd),
  sendPrompt: (sessionId: string, text: string, images?: { path: string; mimeType: string }[]) =>
    ipcRenderer.invoke("grok:sendPrompt", sessionId, text, images),
  savePastedImage: (payload: { data: string; mimeType?: string }) =>
    ipcRenderer.invoke("grok:savePastedImage", payload),
  saveClipboardImage: () => ipcRenderer.invoke("grok:saveClipboardImage"),
  generateMedia: (kind: "image" | "video", prompt: string) =>
    ipcRenderer.invoke("grok:generateMedia", kind, prompt),
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
  gitCommit: (cwd: string, message: string) =>
    ipcRenderer.invoke("grok:gitCommit", cwd, message),
  gitPush: (cwd: string) => ipcRenderer.invoke("grok:gitPush", cwd),
  applyWorktree: (fromCwd: string, destCwd: string) =>
    ipcRenderer.invoke("grok:applyWorktree", fromCwd, destCwd),
  openInEditor: (cwd: string, filePath?: string) =>
    ipcRenderer.invoke("grok:openInEditor", cwd, filePath),
  openPath: (target: string) => ipcRenderer.invoke("grok:openPath", target),
  windowControl: (action: "min" | "max" | "close") =>
    ipcRenderer.invoke("grok:window", action),
  settings: (cwd?: string | null) => ipcRenderer.invoke("grok:settings", cwd),
  setModel: (id: string) => ipcRenderer.invoke("grok:setModel", id),
  setReasoningEffort: (effort: string) => ipcRenderer.invoke("grok:setReasoningEffort", effort),
  setPermission: (mode: string) => ipcRenderer.invoke("grok:setPermission", mode),
  setBrowserControl: (enabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:setBrowserControl", enabled, cwd),
  setComputerControl: (enabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:setComputerControl", enabled, cwd),
  setSubagentsEnabled: (enabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:setSubagentsEnabled", enabled, cwd),
  setSubagentTypeEnabled: (id: string, enabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:setSubagentTypeEnabled", id, enabled, cwd),
  setSubagentTypeModel: (id: string, model: string | null, cwd?: string | null) =>
    ipcRenderer.invoke("grok:setSubagentTypeModel", id, model, cwd),
  openAgentsDir: () => ipcRenderer.invoke("grok:openAgentsDir"),
  setSkillDisabled: (name: string, disabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:setSkillDisabled", name, disabled, cwd),
  openSkillsDir: () => ipcRenderer.invoke("grok:openSkillsDir"),
  openHooksDir: () => ipcRenderer.invoke("grok:openHooksDir"),
  mcpAdd: (input: unknown, cwd?: string | null) => ipcRenderer.invoke("grok:mcpAdd", input, cwd),
  mcpRemove: (name: string, scope?: string, cwd?: string | null) =>
    ipcRenderer.invoke("grok:mcpRemove", name, scope, cwd),
  mcpSetEnabled: (name: string, enabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:mcpSetEnabled", name, enabled, cwd),
  mcpDoctor: (name?: string, cwd?: string | null) => ipcRenderer.invoke("grok:mcpDoctor", name, cwd),
  pluginSetEnabled: (name: string, enabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:pluginSetEnabled", name, enabled, cwd),
  pluginInstall: (source: string, trust: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:pluginInstall", source, trust, cwd),
  pluginUninstall: (name: string, cwd?: string | null) =>
    ipcRenderer.invoke("grok:pluginUninstall", name, cwd),
  marketplaceAdd: (url: string, cwd?: string | null) => ipcRenderer.invoke("grok:marketplaceAdd", url, cwd),
  marketplaceRemove: (url: string, cwd?: string | null) =>
    ipcRenderer.invoke("grok:marketplaceRemove", url, cwd),
  availablePlugins: () => ipcRenderer.invoke("grok:availablePlugins"),
  trustProject: (cwd: string) => ipcRenderer.invoke("grok:trustProject", cwd),
  listAutomations: () => ipcRenderer.invoke("grok:listAutomations"),
  createAutomation: (input: unknown) => ipcRenderer.invoke("grok:createAutomation", input),
  updateAutomation: (id: string, patch: unknown) => ipcRenderer.invoke("grok:updateAutomation", id, patch),
  deleteAutomation: (id: string) => ipcRenderer.invoke("grok:deleteAutomation", id),
  runAutomation: (id: string) => ipcRenderer.invoke("grok:runAutomation", id),
  addHook: (input: unknown, cwd?: string | null) => ipcRenderer.invoke("grok:addHook", input, cwd),
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
  onAutomations: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:automations", listener);
    return () => ipcRenderer.removeListener("grok:automations", listener);
  },
  onWorkspace: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:workspace", listener);
    return () => ipcRenderer.removeListener("grok:workspace", listener);
  },
});
