import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("grok", {
  status: () => ipcRenderer.invoke("grok:status"),
  account: () => ipcRenderer.invoke("grok:account"),
  accountUsage: () => ipcRenderer.invoke("grok:accountUsage"),
  apiProvider: () => ipcRenderer.invoke("grok:apiProvider"),
  loginAccount: () => ipcRenderer.invoke("grok:loginAccount"),
  cancelAccountLogin: () => ipcRenderer.invoke("grok:cancelAccountLogin"),
  loginApiKey: (input: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    contextWindow?: number;
    fromCcSwitchId?: string;
    sessionId?: string;
    cwd?: string;
  }) =>
    ipcRenderer.invoke("grok:loginApiKey", input),
  listCcSwitchProviders: () => ipcRenderer.invoke("grok:listCcSwitchProviders"),
  logout: () => ipcRenderer.invoke("grok:logout"),
  checkUpdate: () => ipcRenderer.invoke("grok:checkUpdate"),
  downloadUpdate: () => ipcRenderer.invoke("grok:downloadUpdate"),
  installUpdate: () => ipcRenderer.invoke("grok:installUpdate"),
  onAppUpdateState: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:app-update-state", listener);
    return () => ipcRenderer.removeListener("grok:app-update-state", listener);
  },
  installInfo: () => ipcRenderer.invoke("grok:installInfo"),
  copyInstallCommand: () => ipcRenderer.invoke("grok:copyInstallCommand"),
  openInstallDocs: () => ipcRenderer.invoke("grok:openInstallDocs"),
  openLogs: () => ipcRenderer.invoke("grok:openLogs"),
  runInstall: () => ipcRenderer.invoke("grok:runInstall"),
  onInstallLog: (cb: (payload: { ts: number; text: string; tone: "info" | "ok" | "warn" | "error" }) => void) => {
    const listener = (_event: unknown, payload: { ts: number; text: string; tone: "info" | "ok" | "warn" | "error" }) =>
      cb(payload);
    ipcRenderer.on("grok:install-log", listener);
    return () => ipcRenderer.removeListener("grok:install-log", listener);
  },
  listProjects: () => ipcRenderer.invoke("grok:listProjects"),
  addProject: () => ipcRenderer.invoke("grok:addProject"),
  removeProject: (cwd: string) => ipcRenderer.invoke("grok:removeProject", cwd),
  renameProject: (cwd: string, name: string) => ipcRenderer.invoke("grok:renameProject", cwd, name),
  renameThread: (sessionId: string, cwd: string, title: string) =>
    ipcRenderer.invoke("grok:renameThread", sessionId, cwd, title),
  removeThread: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("grok:removeThread", sessionId, cwd),
  listThreads: (cwd?: string) => ipcRenderer.invoke("grok:listThreads", cwd),
  searchThreads: (query: string) => ipcRenderer.invoke("grok:searchThreads", query),
  loadTranscript: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("grok:loadTranscript", sessionId, cwd),
  newThread: (cwd?: string | null, worktree?: boolean, initialPrompt?: string) =>
    ipcRenderer.invoke("grok:newThread", cwd ?? null, Boolean(worktree), initialPrompt || ""),
  resumeThread: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("grok:resumeThread", sessionId, cwd),
  forkThread: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke("grok:forkThread", sessionId, cwd),
  sendPrompt: (
    sessionId: string,
    text: string,
    images?: { path: string; mimeType: string }[],
    attachments?: string[],
    startedAt?: number,
  ) => ipcRenderer.invoke("grok:sendPrompt", sessionId, text, images, attachments, startedAt),
  runningSessions: () => ipcRenderer.invoke("grok:runningSessions"),
  queueFollowUp: (
    sessionId: string,
    text: string,
    images?: { path: string; mimeType: string }[],
    attachments?: string[],
  ) => ipcRenderer.invoke("grok:queueFollowUp", sessionId, text, images, attachments),
  promoteFollowUp: (sessionId: string) => ipcRenderer.invoke("grok:promoteFollowUp", sessionId),
  removeFollowUp: (sessionId: string, entryId: string) =>
    ipcRenderer.invoke("grok:removeFollowUp", sessionId, entryId),
  queuedFollowUps: (sessionId?: string) => ipcRenderer.invoke("grok:queuedFollowUps", sessionId),
  savePastedImage: (payload: { data: string; mimeType?: string }) =>
    ipcRenderer.invoke("grok:savePastedImage", payload),
  savePastedFile: (payload: { data: string; name: string; mimeType?: string }) =>
    ipcRenderer.invoke("grok:savePastedFile", payload),
  saveClipboardImage: () => ipcRenderer.invoke("grok:saveClipboardImage"),
  clipboardFilePaths: () => ipcRenderer.sendSync("grok:clipboardFilePaths") as string[],
  pathForFile: (file: File) => webUtils.getPathForFile(file),
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
  readFilePreview: (cwd: string, filePath: string) =>
    ipcRenderer.invoke("grok:readFilePreview", cwd, filePath),
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
  resolveImage: (input: { src: string; sessionId?: string; cwd?: string }) =>
    ipcRenderer.invoke("grok:resolveImage", input),
  windowControl: (action: "min" | "max" | "close") =>
    ipcRenderer.invoke("grok:window", action),
  windowState: () => ipcRenderer.invoke("grok:window-state"),
  onWindowState: (cb: (state: { maximized: boolean; fullscreen: boolean }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: { maximized: boolean; fullscreen: boolean }) => cb(state);
    ipcRenderer.on("grok:window-state", listener);
    return () => ipcRenderer.removeListener("grok:window-state", listener);
  },
  settings: (cwd?: string | null) => ipcRenderer.invoke("grok:settings", cwd),
  proxySettings: () => ipcRenderer.invoke("grok:proxySettings"),
  setProxySettings: (input: unknown) => ipcRenderer.invoke("grok:setProxySettings", input),
  testProxy: (input: unknown, target: "oauth" | "api") =>
    ipcRenderer.invoke("grok:testProxy", input, target),
  setModel: (id: string) => ipcRenderer.invoke("grok:setModel", id),
  setReasoningEffort: (effort: string, sessionId?: string) =>
    ipcRenderer.invoke("grok:setReasoningEffort", { effort, sessionId }),
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
  skillsCatalog: (cwd?: string | null) => ipcRenderer.invoke("grok:skillsCatalog", cwd),
  skillsSetEnabled: (name: string, enabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:skillsSetEnabled", name, enabled, cwd),
  skillsAddPath: (skillPath: string, cwd?: string | null) =>
    ipcRenderer.invoke("grok:skillsAddPath", skillPath, cwd),
  skillsRemovePath: (skillPath: string, cwd?: string | null) =>
    ipcRenderer.invoke("grok:skillsRemovePath", skillPath, cwd),
  skillsReset: (cwd?: string | null) => ipcRenderer.invoke("grok:skillsReset", cwd),
  skillsCreate: (input: unknown, cwd?: string | null) => ipcRenderer.invoke("grok:skillsCreate", input, cwd),
  openSkillsDir: () => ipcRenderer.invoke("grok:openSkillsDir"),
  openProjectSkillsDir: (cwd: string) => ipcRenderer.invoke("grok:openProjectSkillsDir", cwd),
  openHooksDir: () => ipcRenderer.invoke("grok:openHooksDir"),
  mcpAdd: (input: unknown, cwd?: string | null, sessionId?: string | null) =>
    ipcRenderer.invoke("grok:mcpAdd", input, cwd, sessionId),
  mcpCatalog: (sessionId?: string | null, cwd?: string | null, refresh?: boolean) =>
    ipcRenderer.invoke("grok:mcpCatalog", sessionId, cwd, refresh),
  mcpRemove: (name: string, scope?: string, cwd?: string | null, sessionId?: string | null) =>
    ipcRenderer.invoke("grok:mcpRemove", name, scope, cwd, sessionId),
  mcpSetEnabled: (name: string, enabled: boolean, cwd?: string | null, sessionId?: string | null) =>
    ipcRenderer.invoke("grok:mcpSetEnabled", name, enabled, cwd, sessionId),
  mcpSetToolEnabled: (sessionId: string, name: string, tool: string, enabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:mcpSetToolEnabled", sessionId, name, tool, enabled, cwd),
  mcpAuthenticate: (sessionId: string, name: string, cwd?: string | null) =>
    ipcRenderer.invoke("grok:mcpAuthenticate", sessionId, name, cwd),
  mcpSetup: (sessionId: string, name: string, values: Record<string, string>, cwd?: string | null) =>
    ipcRenderer.invoke("grok:mcpSetup", sessionId, name, values, cwd),
  mcpDoctor: (name?: string, cwd?: string | null) => ipcRenderer.invoke("grok:mcpDoctor", name, cwd),
  onExtensionUpdate: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:extension-update", listener);
    return () => ipcRenderer.removeListener("grok:extension-update", listener);
  },
  pluginSetEnabled: (name: string, enabled: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:pluginSetEnabled", name, enabled, cwd),
  pluginInstall: (source: string, trust: boolean, cwd?: string | null, sessionId?: string | null) =>
    ipcRenderer.invoke("grok:pluginInstall", source, trust, cwd, sessionId),
  pluginInstallDependency: (command: string) => ipcRenderer.invoke("grok:pluginInstallDependency", command),
  pluginUninstall: (name: string, keepData: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:pluginUninstall", name, keepData, cwd),
  pluginUpdate: (name?: string, cwd?: string | null) => ipcRenderer.invoke("grok:pluginUpdate", name, cwd),
  pluginDetails: (name: string, cwd?: string | null) => ipcRenderer.invoke("grok:pluginDetails", name, cwd),
  pluginValidate: (targetPath?: string, cwd?: string | null) =>
    ipcRenderer.invoke("grok:pluginValidate", targetPath, cwd),
  pluginTag: (input: unknown, cwd?: string | null) => ipcRenderer.invoke("grok:pluginTag", input, cwd),
  marketplaceAdd: (url: string, force: boolean, cwd?: string | null) =>
    ipcRenderer.invoke("grok:marketplaceAdd", url, force, cwd),
  marketplaceRemove: (url: string, cwd?: string | null) =>
    ipcRenderer.invoke("grok:marketplaceRemove", url, cwd),
  marketplaceUpdate: (source?: string, cwd?: string | null) =>
    ipcRenderer.invoke("grok:marketplaceUpdate", source, cwd),
  availablePlugins: () => ipcRenderer.invoke("grok:availablePlugins"),
  trustProject: (cwd: string) => ipcRenderer.invoke("grok:trustProject", cwd),
  listAutomations: () => ipcRenderer.invoke("grok:listAutomations"),
  createAutomation: (input: unknown) => ipcRenderer.invoke("grok:createAutomation", input),
  updateAutomation: (id: string, patch: unknown) => ipcRenderer.invoke("grok:updateAutomation", id, patch),
  deleteAutomation: (id: string) => ipcRenderer.invoke("grok:deleteAutomation", id),
  runAutomation: (id: string) => ipcRenderer.invoke("grok:runAutomation", id),
  addHook: (input: unknown, cwd?: string | null) => ipcRenderer.invoke("grok:addHook", input, cwd),
  terminalStart: (cwd: string, cols?: number, rows?: number) =>
    ipcRenderer.invoke("grok:terminalStart", cwd, cols, rows),
  terminalWrite: (text: string) => ipcRenderer.invoke("grok:terminalWrite", text),
  terminalResize: (cols: number, rows: number) =>
    ipcRenderer.invoke("grok:terminalResize", cols, rows),
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
  onTurnFiles: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:turn-files", listener);
    return () => ipcRenderer.removeListener("grok:turn-files", listener);
  },
  onRunState: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:run-state", listener);
    return () => ipcRenderer.removeListener("grok:run-state", listener);
  },
  onFollowUpState: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:follow-up-state", listener);
    return () => ipcRenderer.removeListener("grok:follow-up-state", listener);
  },
  onFollowUpStarted: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:follow-up-started", listener);
    return () => ipcRenderer.removeListener("grok:follow-up-started", listener);
  },
  onFollowUpError: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("grok:follow-up-error", listener);
    return () => ipcRenderer.removeListener("grok:follow-up-error", listener);
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
