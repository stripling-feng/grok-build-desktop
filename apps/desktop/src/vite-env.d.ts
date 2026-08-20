/// <reference types="vite/client" />

import type {
  AppSettings,
  GitStatus,
  GrokStatus,
  PermissionMode,
  PermissionRequest,
  ProjectInfo,
  StreamItem,
  ThreadInfo,
} from "../electron/shared";

export type NewThreadResult = {
  sessionId: string;
  cwd: string;
  projectCwd: string;
  title: string;
  worktree: { cwd: string; branch: string } | null;
  projectName: string;
};

declare global {
  interface Window {
    grok: {
      status: () => Promise<GrokStatus>;
      installInfo: () => Promise<{ command: string; docs: string; logsDir: string }>;
      copyInstallCommand: () => Promise<boolean>;
      openInstallDocs: () => Promise<void>;
      openLogs: () => Promise<string>;
      runInstall: () => Promise<{ ok: boolean; launched: boolean }>;
      listProjects: () => Promise<ProjectInfo[]>;
      addProject: () => Promise<ProjectInfo | null>;
      removeProject: (cwd: string) => Promise<ProjectInfo[]>;
      listThreads: (cwd?: string) => Promise<ThreadInfo[]>;
      loadTranscript: (sessionId: string, cwd: string) => Promise<StreamItem[]>;
      newThread: (cwd: string, worktree: boolean) => Promise<NewThreadResult>;
      resumeThread: (sessionId: string, cwd: string) => Promise<{ sessionId: string; cwd: string }>;
      sendPrompt: (sessionId: string, text: string) => Promise<unknown>;
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
      applyWorktree: (fromCwd: string, destCwd: string) => Promise<string>;
      openInEditor: (cwd: string, filePath?: string) => Promise<{ ok: boolean; editor: string }>;
      openPath: (target: string) => Promise<void>;
      windowControl: (action: "min" | "max" | "close") => Promise<void>;
      settings: (cwd?: string | null) => Promise<AppSettings>;
      setModel: (id: string) => Promise<AppSettings>;
      setPermission: (mode: PermissionMode) => Promise<AppSettings>;
      setSkillDisabled: (name: string, disabled: boolean, cwd?: string | null) => Promise<AppSettings>;
      terminalStart: (cwd: string) => Promise<{ cwd: string }>;
      terminalWrite: (text: string) => Promise<boolean>;
      terminalKill: () => Promise<void>;
      onTerminalData: (cb: (chunk: string) => void) => () => void;
      onUpdate: (cb: (payload: { sessionId: string; update: Record<string, unknown>; method?: string }) => void) => () => void;
      onPermission: (cb: (payload: PermissionRequest) => void) => () => void;
      onAgentStatus: (cb: (payload: { connected: boolean; message?: string }) => void) => () => void;
    };
  }
}

export {};
