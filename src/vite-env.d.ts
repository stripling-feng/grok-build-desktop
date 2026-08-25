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
  GitStatus,
  GrokStatus,
  PermissionMode,
  ReasoningEffort,
  PermissionRequest,
  ProjectInfo,
  StreamItem,
  ThreadInfo,
  ThreadSearchResult,
} from "../electron/shared";

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
      loginAccount: () => Promise<{ ok: boolean; account: AccountInfo; message?: string; url?: string }>;
      cancelAccountLogin: () => Promise<boolean>;
      loginApiKey: (input: { baseUrl?: string; apiKey?: string; model?: string; fromCcSwitchId?: string }) => Promise<{ ok: boolean; account: AccountInfo; message?: string }>;
      listCcSwitchProviders: () => Promise<Array<{ id: string; name: string; baseUrl: string; apiKey: string }>>;
      logout: () => Promise<AccountInfo>;
      checkUpdate: () => Promise<AppUpdateInfo>;
      openUpdate: (url?: string) => Promise<void>;
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
      newThread: (cwd?: string | null, worktree?: boolean) => Promise<NewThreadResult>;
      resumeThread: (sessionId: string, cwd: string) => Promise<{ sessionId: string; cwd: string }>;
      forkThread: (sessionId: string, cwd: string) => Promise<NewThreadResult>;
      sendPrompt: (
        sessionId: string,
        text: string,
        images?: { path: string; mimeType: string }[],
      ) => Promise<unknown>;
      runningSessions: () => Promise<string[]>;
      savePastedImage: (payload: { data: string; mimeType?: string }) => Promise<{ path: string; mimeType: string }>;
      saveClipboardImage: () => Promise<{ path: string; mimeType: string; dataUrl: string } | null>;
      setMode: (sessionId: string, modeId: string) => Promise<void>;
      pickFiles: () => Promise<string[]>;
      pickFolder: () => Promise<string[]>;
      getGoal: (cwd: string) => Promise<string>;
      setGoal: (cwd: string, text: string) => Promise<string>;
      cancel: (sessionId: string) => Promise<void>;
      respondPermission: (requestId: string, optionId: string) => Promise<boolean>;
      gitStatus: (cwd: string) => Promise<GitStatus>;
      gitFileDiff: (cwd: string, filePath: string) => Promise<string>;
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
      settings: (cwd?: string | null) => Promise<AppSettings>;
      setModel: (id: string) => Promise<AppSettings>;
      setReasoningEffort: (effort: ReasoningEffort) => Promise<AppSettings>;
      setPermission: (mode: PermissionMode) => Promise<AppSettings>;
      setBrowserControl: (enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      setComputerControl: (enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      setSubagentsEnabled: (enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      setSubagentTypeEnabled: (id: string, enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      setSubagentTypeModel: (id: string, model: string | null, cwd?: string | null) => Promise<AppSettings>;
      openAgentsDir: () => Promise<string>;
      setSkillDisabled: (name: string, disabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      openSkillsDir: () => Promise<string>;
      openHooksDir: () => Promise<string>;
      mcpAdd: (
        input: {
          name: string;
          transport: "stdio" | "http" | "sse";
          scope: "user" | "project";
          commandOrUrl: string;
          args?: string[];
          env?: string[];
          headers?: string[];
        },
        cwd?: string | null,
      ) => Promise<AppSettings>;
      mcpRemove: (name: string, scope?: "user" | "project", cwd?: string | null) => Promise<AppSettings>;
      mcpSetEnabled: (name: string, enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      mcpDoctor: (name?: string, cwd?: string | null) => Promise<string>;
      pluginSetEnabled: (name: string, enabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      pluginInstall: (source: string, trust: boolean, cwd?: string | null) => Promise<AppSettings>;
      pluginUninstall: (name: string, cwd?: string | null) => Promise<AppSettings>;
      marketplaceAdd: (url: string, cwd?: string | null) => Promise<AppSettings>;
      marketplaceRemove: (url: string, cwd?: string | null) => Promise<AppSettings>;
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
      terminalStart: (cwd: string) => Promise<{ cwd: string }>;
      terminalWrite: (text: string) => Promise<boolean>;
      terminalKill: () => Promise<void>;
      onTerminalData: (cb: (chunk: string) => void) => () => void;
      onUpdate: (cb: (payload: { sessionId: string; update: Record<string, unknown>; method?: string; meta?: Record<string, unknown> }) => void) => () => void;
      onRunState: (cb: (payload: { sessionId: string; running: boolean }) => void) => () => void;
      onPermission: (cb: (payload: PermissionRequest) => void) => () => void;
      onAgentStatus: (cb: (payload: { connected: boolean; message?: string }) => void) => () => void;
      onAutomations: (cb: (rows: Automation[]) => void) => () => void;
      onWorkspace: (cb: (payload: { projects: ProjectInfo[]; threads: ThreadInfo[] }) => void) => () => void;
    };
  }
}

export {};
