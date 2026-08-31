/// <reference types="vite/client" />

import type {
  AccountInfo,
  AccountUsage,
  AppSettings,
  AppUpdateInfo,
  ContextUsage,
  Automation,
  AutomationInput,
  AvailablePluginInfo,
  FilePreview,
  GitStatus,
  GrokStatus,
  McpAddInput,
  McpServerInfo,
  PermissionMode,
  PluginTagInput,
  ProxyApplyResult,
  ProxySettings,
  ProxyTestResult,
  ReasoningEffort,
  SkillCatalog,
  SkillCreateInput,
  PermissionRequest,
  ProjectInfo,
  StreamItem,
  ThreadInfo,
  ThreadSearchResult,
} from "../electron/shared";
import type { FollowUpReceipt, QueuedFollowUp } from "../electron/follow-ups";

export type NewThreadResult = {
  sessionId: string;
  cwd: string;
  projectCwd: string;
  title: string;
  worktree: { cwd: string; branch: string } | null;
  projectName: string;
  unattached?: boolean;
};

declare global {
  interface Window {
    grok: {
      status: () => Promise<GrokStatus>;
      account: () => Promise<AccountInfo>;
      accountUsage: () => Promise<AccountUsage>;
      apiProvider: () => Promise<{
        baseUrl: string;
        apiKey: string;
        model: string;
        contextWindow?: number;
      } | null>;
      loginAccount: () => Promise<{ ok: boolean; account: AccountInfo; message?: string; url?: string }>;
      cancelAccountLogin: () => Promise<boolean>;
      loginApiKey: (input: {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        contextWindow?: number;
        fromCcSwitchId?: string;
        sessionId?: string;
        cwd?: string;
      }) => Promise<{ ok: boolean; account: AccountInfo; message?: string }>;
      listCcSwitchProviders: () => Promise<Array<{ id: string; name: string; baseUrl: string; apiKey: string }>>;
      logout: () => Promise<AccountInfo>;
      checkUpdate: () => Promise<AppUpdateInfo>;
      downloadUpdate: () => Promise<AppUpdateInfo>;
      installUpdate: () => Promise<boolean>;
      onAppUpdateState: (cb: (payload: AppUpdateInfo) => void) => () => void;
      installInfo: () => Promise<{ command: string; docs: string; logsDir: string }>;
      copyInstallCommand: () => Promise<boolean>;
      openInstallDocs: () => Promise<void>;
      openLogs: () => Promise<string>;
      runInstall: () => Promise<{ ok: boolean; launched: boolean; error?: string }>;
      onInstallLog: (
        cb: (payload: { ts: number; text: string; tone: "info" | "ok" | "warn" | "error" }) => void,
      ) => () => void;
      listProjects: () => Promise<ProjectInfo[]>;
      addProject: () => Promise<ProjectInfo | null>;
      removeProject: (cwd: string) => Promise<ProjectInfo[]>;
      renameProject: (cwd: string, name: string) => Promise<ProjectInfo>;
      renameThread: (sessionId: string, cwd: string, title: string) => Promise<ThreadInfo>;
      removeThread: (sessionId: string, cwd: string) => Promise<boolean>;
      listThreads: (cwd?: string) => Promise<ThreadInfo[]>;
      searchThreads: (query: string) => Promise<ThreadSearchResult[]>;
      loadTranscript: (
        sessionId: string,
        cwd: string,
      ) => Promise<{
        items: StreamItem[];
        contextUsed: number | null;
        contextUsage: ContextUsage | null;
        planAwaiting: boolean;
        planModifiedAt: number | null;
      }>;
      newThread: (cwd?: string | null, worktree?: boolean, initialPrompt?: string) => Promise<NewThreadResult>;
      resumeThread: (sessionId: string, cwd: string) => Promise<{ sessionId: string; cwd: string }>;
      forkThread: (sessionId: string, cwd: string) => Promise<NewThreadResult>;
      sendPrompt: (
        sessionId: string,
        text: string,
        images?: { path: string; mimeType: string }[],
        attachments?: string[],
        startedAt?: number,
      ) => Promise<unknown>;
      runningSessions: () => Promise<string[]>;
      queueFollowUp: (
        sessionId: string,
        text: string,
        images?: { path: string; mimeType: string }[],
        attachments?: string[],
      ) => Promise<FollowUpReceipt>;
      promoteFollowUp: (sessionId: string) => Promise<FollowUpReceipt | null>;
      removeFollowUp: (sessionId: string, entryId: string) => Promise<QueuedFollowUp | null>;
      queuedFollowUps: (sessionId?: string) => Promise<QueuedFollowUp[]>;
      savePastedImage: (payload: { data: string; mimeType?: string }) => Promise<{ path: string; mimeType: string }>;
      savePastedFile: (payload: { data: string; name: string; mimeType?: string }) => Promise<{ path: string; mimeType: string }>;
      saveClipboardImage: () => Promise<{ path: string; mimeType: string; dataUrl: string } | null>;
      clipboardFilePaths: () => string[];
      pathForFile: (file: File) => string;
      setMode: (sessionId: string, modeId: string) => Promise<void>;
      pickFiles: () => Promise<string[]>;
      pickFolder: () => Promise<string[]>;
      getGoal: (cwd: string) => Promise<string>;
      setGoal: (cwd: string, text: string) => Promise<string>;
      cancel: (sessionId: string) => Promise<QueuedFollowUp[]>;
      respondPermission: (requestId: string, optionId: string) => Promise<boolean>;
      gitStatus: (cwd: string) => Promise<GitStatus>;
      gitFileDiff: (cwd: string, filePath: string) => Promise<string>;
      readFilePreview: (cwd: string, filePath: string) => Promise<FilePreview>;
      gitDiscard: (cwd: string, filePath: string) => Promise<void>;
      gitStage: (cwd: string, filePath: string) => Promise<void>;
      gitUnstage: (cwd: string, filePath: string) => Promise<void>;
      gitCommit: (cwd: string, message: string) => Promise<string>;
      gitPush: (cwd: string) => Promise<string>;
      applyWorktree: (fromCwd: string, destCwd: string) => Promise<string>;
      openInEditor: (cwd: string, filePath?: string) => Promise<{ ok: boolean; editor: string }>;
      openPath: (target: string) => Promise<void>;
      resolveImage: (input: {
        src: string;
        sessionId?: string;
        cwd?: string;
      }) => Promise<{ path: string; dataUrl: string } | null>;
      windowControl: (action: "min" | "max" | "close") => Promise<void>;
      windowState: () => Promise<{ maximized: boolean; fullscreen: boolean }>;
      onWindowState: (cb: (state: { maximized: boolean; fullscreen: boolean }) => void) => () => void;
      settings: (cwd?: string | null) => Promise<AppSettings>;
      proxySettings: () => Promise<ProxySettings>;
      setProxySettings: (input: ProxySettings) => Promise<ProxyApplyResult>;
      testProxy: (input: ProxySettings, target: "oauth" | "api") => Promise<ProxyTestResult>;
      setModel: (id: string) => Promise<AppSettings>;
      setReasoningEffort: (effort: ReasoningEffort, sessionId?: string) => Promise<AppSettings>;
      setPermission: (mode: PermissionMode) => Promise<void>;
      setBrowserControl: (enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      setComputerControl: (enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      setSubagentsEnabled: (enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      setSubagentTypeEnabled: (id: string, enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      setSubagentTypeModel: (id: string, model: string | null, cwd?: string | null) => Promise<AppSettings>;
      openAgentsDir: () => Promise<string>;
      setSkillDisabled: (name: string, disabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      skillsCatalog: (cwd?: string | null) => Promise<SkillCatalog>;
      skillsSetEnabled: (name: string, enabled: boolean, cwd?: string | null) => Promise<SkillCatalog>;
      skillsAddPath: (path: string, cwd?: string | null) => Promise<SkillCatalog>;
      skillsRemovePath: (path: string, cwd?: string | null) => Promise<SkillCatalog>;
      skillsReset: (cwd?: string | null) => Promise<SkillCatalog>;
      skillsCreate: (input: SkillCreateInput, cwd?: string | null) => Promise<{ file: string; catalog: SkillCatalog }>;
      openSkillsDir: () => Promise<string>;
      openProjectSkillsDir: (cwd: string) => Promise<string>;
      openHooksDir: () => Promise<string>;
      mcpAdd: (
        input: McpAddInput,
        cwd?: string | null,
        sessionId?: string | null,
      ) => Promise<AppSettings>;
      mcpCatalog: (sessionId?: string | null, cwd?: string | null, refresh?: boolean) => Promise<McpServerInfo[]>;
      mcpRemove: (name: string, scope?: "user" | "project", cwd?: string | null, sessionId?: string | null) => Promise<AppSettings>;
      mcpSetEnabled: (name: string, enabled: boolean, cwd?: string | null, sessionId?: string | null) => Promise<AppSettings>;
      mcpSetToolEnabled: (sessionId: string, name: string, tool: string, enabled: boolean, cwd?: string | null) => Promise<McpServerInfo[]>;
      mcpAuthenticate: (sessionId: string, name: string, cwd?: string | null) => Promise<{ result: unknown; servers: McpServerInfo[] }>;
      mcpSetup: (sessionId: string, name: string, values: Record<string, string>, cwd?: string | null) => Promise<McpServerInfo[]>;
      mcpDoctor: (name?: string, cwd?: string | null) => Promise<string>;
      onExtensionUpdate: (cb: (payload: unknown) => void) => () => void;
      pluginSetEnabled: (name: string, enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      pluginInstall: (source: string, trust: boolean, cwd?: string | null, sessionId?: string | null) => Promise<AppSettings>;
      pluginInstallDependency: (command: string) => Promise<{ command: string; packageName: string; restartRequired: boolean }>;
      pluginUninstall: (name: string, keepData: boolean, cwd?: string | null) => Promise<AppSettings>;
      pluginUpdate: (name?: string, cwd?: string | null) => Promise<AppSettings>;
      pluginDetails: (name: string, cwd?: string | null) => Promise<string>;
      pluginValidate: (targetPath?: string, cwd?: string | null) => Promise<string>;
      pluginTag: (input: PluginTagInput, cwd?: string | null) => Promise<string>;
      marketplaceAdd: (url: string, force: boolean, cwd?: string | null) => Promise<AppSettings>;
      marketplaceRemove: (url: string, cwd?: string | null) => Promise<AppSettings>;
      marketplaceUpdate: (source?: string, cwd?: string | null) => Promise<AppSettings>;
      availablePlugins: () => Promise<AvailablePluginInfo[]>;
      trustProject: (cwd: string) => Promise<AppSettings>;
      listAutomations: () => Promise<Automation[]>;
      createAutomation: (input: AutomationInput) => Promise<Automation>;
      updateAutomation: (id: string, patch: Partial<AutomationInput> & { enabled?: boolean }) => Promise<Automation>;
      deleteAutomation: (id: string) => Promise<boolean>;
      runAutomation: (id: string) => Promise<Automation | null>;
      addHook: (
        input: { name: string; event: string; matcher?: string; command: string },
        cwd?: string | null,
      ) => Promise<AppSettings>;
      terminalStart: (cwd: string, cols?: number, rows?: number) => Promise<{ cwd: string }>;
      terminalWrite: (text: string) => Promise<boolean>;
      terminalResize: (cols: number, rows: number) => Promise<boolean>;
      terminalKill: () => Promise<void>;
      onTerminalData: (cb: (chunk: string) => void) => () => void;
      onUpdate: (cb: (payload: { sessionId: string; update: Record<string, unknown>; method?: string; meta?: Record<string, unknown>; runContinues?: boolean }) => void) => () => void;
      onTurnFiles: (cb: (payload: {
        sessionId: string;
        files: string[];
        stats?: Record<string, { added: number; removed: number }>;
      }) => void) => () => void;
      onRunState: (cb: (payload: { sessionId: string; running: boolean }) => void) => () => void;
      onFollowUpState: (cb: (payload: { sessionId: string; entries: QueuedFollowUp[] }) => void) => () => void;
      onFollowUpStarted: (cb: (payload: { entry: QueuedFollowUp; delivery: "queued" | "steered" }) => void) => () => void;
      onFollowUpError: (cb: (payload: { entry: QueuedFollowUp; message: string }) => void) => () => void;
      onPermission: (cb: (payload: PermissionRequest) => void) => () => void;
      onAgentStatus: (cb: (payload: { connected: boolean; message?: string }) => void) => () => void;
      onAutomations: (cb: (rows: Automation[]) => void) => () => void;
      onWorkspace: (cb: (payload: { projects: ProjectInfo[]; threads: ThreadInfo[] }) => void) => () => void;
    };
  }
}

export {};
