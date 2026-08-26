import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Composer } from "./components/Composer";
import { DiffPanel } from "./components/DiffPanel";
import { FilePreviewPanel } from "./components/FilePreviewPanel";
import { MessageStream } from "./components/MessageStream";
import { PlanSidebar } from "./components/PlanSidebar";
import { StatusCard } from "./components/StatusCard";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { AutomationPage, MarketplacePage, type WorkspacePage } from "./components/WorkspacePages";
import { TerminalPanel } from "./components/TerminalPanel";
import { TitleBar } from "./components/TitleBar";
import grokLogo from "./assets/grok-logo.jpg";
import {
  appendTurnChanges,
  applyLiveUpdate,
  mergeTranscriptWithLiveItems,
  stampTurnDuration,
  stripEphemeral,
  type PlanRevision,
} from "./lib/stream";
import {
  PLAN_FLOW_STORAGE_KEY,
  buildPlanConversationPrompt,
  buildPlanExecutionPrompt,
  isPlanFlow,
  latestPlanClarification,
  latestPlanDocument,
  latestPlanForFlow,
  markFlowPlans,
  mergeRecoveredPlan,
  planActivityForFlow,
  planFlowBusy,
  planRevisionsForFlow,
  recoverAwaitingPlanFlow,
  restorePlanFlow,
  settlePlanTurn,
  type PlanFlow,
} from "./lib/plan-flow";
import { extractContextUsage, mergeContextUsage } from "../electron/shared";
import {
  agentModeForComposer,
  isSessionViewCurrent,
  updateRunningSessionIds,
  updateUnreadSessionIds,
} from "./lib/session-state";
import type {
  AccountInfo,
  AppSettings,
  ContextUsage,
  GitStatus,
  GrokStatus,
  PermissionMode,
  PermissionRequest,
  ProjectInfo,
  StreamItem,
  ThreadInfo,
} from "../electron/shared";
import type { QueuedFollowUp } from "../electron/follow-ups";

type Active = {
  sessionId: string;
  cwd: string;
  projectCwd: string;
  unattached?: boolean;
  pending?: boolean;
};

type ConversationComposerState = {
  draft: string;
  attachments: string[];
  planMode: boolean;
};

const EMPTY_COMPOSER_STATE: ConversationComposerState = {
  draft: "",
  attachments: [],
  planMode: false,
};

const COMPOSER_STATES_STORAGE_KEY = "grok.composerStates.v1";
const UNREAD_SESSIONS_STORAGE_KEY = "grok.unreadSessions.v1";
const IMAGE_ATTACHMENT_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

function imageMimeType(filePath: string): string {
  if (/\.jpe?g$/i.test(filePath)) return "image/jpeg";
  if (/\.gif$/i.test(filePath)) return "image/gif";
  if (/\.webp$/i.test(filePath)) return "image/webp";
  return "image/png";
}

function followUpDisplayText(entry: Pick<QueuedFollowUp, "text" | "images" | "attachments">): string {
  const marker = "请同时参考这些路径：";
  const markerIndex = entry.text.lastIndexOf(marker);
  const text = (markerIndex >= 0 ? entry.text.slice(0, markerIndex) : entry.text).trim();
  if (text === "请参考我附带的图片。" && entry.attachments.length) return "";
  if (text) return text;
  if (entry.attachments.length) return "";
  return entry.images.length ? `图片 ×${entry.images.length}` : "后续消息";
}

function followUpPayload(text: string, attached: string[]) {
  const imageFiles = attached.filter((filePath) => IMAGE_ATTACHMENT_RE.test(filePath));
  const otherFiles = attached.filter((filePath) => !IMAGE_ATTACHMENT_RE.test(filePath));
  let payload = text.trim();
  if (otherFiles.length) {
    payload += `${payload ? "\n\n" : ""}请同时参考这些路径：\n` +
      otherFiles.map((filePath) => `- @${filePath}`).join("\n");
  }
  if (!payload && imageFiles.length) payload = "请参考我附带的图片。";
  return {
    payload,
    images: imageFiles.map((filePath) => ({ path: filePath, mimeType: imageMimeType(filePath) })),
    attachments: attached,
  };
}

function readUnreadSessionIds(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((id): id is string => typeof id === "string" && Boolean(id)));
  } catch {
    return new Set();
  }
}

function readComposerStates(): Record<string, ConversationComposerState> {
  try {
    const raw = JSON.parse(localStorage.getItem(COMPOSER_STATES_STORAGE_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, ConversationComposerState] => {
        const value = entry[1] as Partial<ConversationComposerState> | null;
        return Boolean(
          value &&
            typeof value.draft === "string" &&
            Array.isArray(value.attachments) &&
            value.attachments.every((item) => typeof item === "string") &&
            typeof value.planMode === "boolean",
        );
      }),
    );
  } catch {
    return {};
  }
}

function conversationComposerKey(
  active: Active | null,
  selectedProjectCwd: string | null,
  worktree: boolean,
) {
  if (active?.sessionId) return `session:${active.sessionId}`;
  const cwd = active?.projectCwd || selectedProjectCwd || "unattached";
  return `new:${cwd.toLowerCase()}:${worktree ? "worktree" : "local"}`;
}

function isUnattached(thread: { projectCwd?: string; unattached?: boolean }) {
  return Boolean(thread.unattached && !thread.projectCwd);
}

function samePath(a: string, b: string) {
  return a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
}

const SIDEBAR_MIN = 180;
const RIGHT_SIDEBAR_MIN = 300;
const MAIN_MIN = 280;
const PLAN_DRAG_MAIN_MIN = 180;
const MIDDLE_COMPACT_RATIO = 0.4;
const HANDLE = 6;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readWidth(key: string, fallback: number, min: number) {
  try {
    const raw = Number(localStorage.getItem(key));
    if (Number.isFinite(raw) && raw >= min) return raw;
  } catch {
    /* ignore */
  }
  return fallback;
}

function fitSidebar(winW: number, sidebar: number, reserved = 0) {
  const maxSidebar = Math.max(SIDEBAR_MIN, winW - HANDLE - MAIN_MIN - reserved);
  return clamp(sidebar, SIDEBAR_MIN, maxSidebar);
}

function fitRightSidebar(winW: number, sidebar: number, rightSidebar: number) {
  const available = winW - sidebar - HANDLE * 2 - PLAN_DRAG_MAIN_MIN;
  const maxPlanSidebar = Math.max(180, available);
  const minPlanSidebar = Math.min(RIGHT_SIDEBAR_MIN, maxPlanSidebar);
  return clamp(rightSidebar, minPlanSidebar, maxPlanSidebar);
}

function newLocalId(prefix: string) {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
}

function readStoredPlanFlows(): Record<string, PlanFlow> {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAN_FLOW_STORAGE_KEY) || "{}");
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, PlanFlow] => isPlanFlow(entry[1])),
    );
  } catch {
    return {};
  }
}

function readStoredPlanFlow(sessionId: string): PlanFlow | null {
  return readStoredPlanFlows()[sessionId] ?? null;
}

function writeStoredPlanFlow(flow: PlanFlow) {
  try {
    const rows = readStoredPlanFlows();
    rows[flow.sessionId] = flow;
    localStorage.setItem(PLAN_FLOW_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* persistence is best effort */
  }
}

function clearStoredPlanFlow(sessionId: string) {
  try {
    const rows = readStoredPlanFlows();
    delete rows[sessionId];
    localStorage.setItem(PLAN_FLOW_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* persistence is best effort */
  }
}

function ResizeHandle({
  onDragStart,
  onDrag,
  label,
}: {
  onDragStart: () => void;
  onDrag: (delta: number) => void;
  label?: string;
}) {
  const startX = useRef<number | null>(null);
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        startX.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
        document.body.classList.add("is-resizing");
        onDragStart();
      }}
      onPointerMove={(e) => {
        if (startX.current == null) return;
        onDrag(e.clientX - startX.current);
      }}
      onPointerUp={(e) => {
        startX.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        document.body.classList.remove("is-resizing");
      }}
      onPointerCancel={() => {
        startX.current = null;
        document.body.classList.remove("is-resizing");
      }}
    />
  );
}

export function App() {
  const [status, setStatus] = useState<GrokStatus | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [selectedProjectCwd, setSelectedProjectCwd] = useState<string | null>(null);
  const activeRef = useRef<Active | null>(null);
  const activeViewVersionRef = useRef(0);
  const [active, setActiveState] = useState<Active | null>(null);
  const setActive = useCallback(
    (next: Active | null | ((current: Active | null) => Active | null)) => {
      const commit = (resolved: Active | null) => {
        if ((activeRef.current?.sessionId ?? "") !== (resolved?.sessionId ?? "")) {
          activeViewVersionRef.current += 1;
        }
        activeRef.current = resolved;
        return resolved;
      };
      if (typeof next === "function") {
        setActiveState((current) => commit(next(current)));
      } else {
        commit(next);
        setActiveState(next);
      }
    },
    [],
  );
  const [items, setItems] = useState<StreamItem[]>([]);
  const [contextUsed, setContextUsed] = useState<number | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [composerStates, setComposerStates] = useState<Record<string, ConversationComposerState>>(
    readComposerStates,
  );
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [followUpsBySession, setFollowUpsBySession] = useState<Record<string, QueuedFollowUp[]>>({});
  const [unreadIds, setUnreadIds] = useState<Set<string>>(readUnreadSessionIds);
  const [permissionsBySession, setPermissionsBySession] = useState<Record<string, PermissionRequest>>({});
  const [git, setGit] = useState<GitStatus | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [planDocument, setPlanDocument] = useState<PlanRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [worktreeMode, setWorktreeMode] = useState(false);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [page, setPage] = useState<WorkspacePage>("chat");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [installHint, setInstallHint] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installLogs, setInstallLogs] = useState<{ ts: number; text: string; tone: "info" | "ok" | "warn" | "error" }[]>([]);
  const installLogRef = useRef<HTMLDivElement | null>(null);
  const [goal, setGoal] = useState("");
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readWidth("grok.sidebarWidth", 252, SIDEBAR_MIN),
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readWidth(
      "grok.rightSidebarWidth",
      readWidth("grok.planSidebarWidth", 420, RIGHT_SIDEBAR_MIN),
      RIGHT_SIDEBAR_MIN,
    ),
  );
  const [winW, setWinW] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const [planPanel, setPlanPanel] = useState<PlanFlow | null>(null);
  const sendingRef = useRef<Set<string>>(new Set());
  const followUpSendingRef = useRef<Set<string>>(new Set());
  const renderedFollowUpIdsRef = useRef<Set<string>>(new Set());
  // Vite Fast Refresh can retain the old boolean ref from earlier builds.
  // Normalize it during render so a hot-updated window can send immediately.
  if (!(sendingRef.current instanceof Set)) sendingRef.current = new Set<string>();
  const sendAttemptRef = useRef(0);
  const planActionRef = useRef<string | null>(null);
  const pendingThreadRef = useRef<Promise<Active | null> | null>(null);
  const failedPromptRef = useRef<{
    sessionId: string;
    text: string;
    images: { path: string; mimeType: string }[];
    attachments: string[];
    startedAt: number;
  } | null>(null);
  const restoredRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const sidebarDragOrigin = useRef(sidebarWidth);
  const rightSidebarDragOrigin = useRef(rightSidebarWidth);
  const unattachedActive = Boolean(active && isUnattached(active));
  const gitCwd = unattachedActive ? null : active?.cwd || selectedProjectCwd;
  const composerKey = conversationComposerKey(active, selectedProjectCwd, worktreeMode);
  const composerState = composerStates[composerKey] ?? EMPTY_COMPOSER_STATE;
  const { draft, attachments, planMode } = composerState;
  const activeFollowUps = active?.sessionId ? followUpsBySession[active.sessionId] ?? [] : [];

  useEffect(() => {
    setPreviewFilePath(null);
  }, [active?.sessionId, selectedProjectCwd, page]);

  const setDraft = useCallback((value: string) => {
    setComposerStates((cur) => ({
      ...cur,
      [composerKey]: { ...(cur[composerKey] ?? EMPTY_COMPOSER_STATE), draft: value },
    }));
  }, [composerKey]);
  const setAttachments = useCallback((value: string[]) => {
    setComposerStates((cur) => ({
      ...cur,
      [composerKey]: { ...(cur[composerKey] ?? EMPTY_COMPOSER_STATE), attachments: value },
    }));
  }, [composerKey]);
  const setPlanModeState = useCallback((value: boolean) => {
    setComposerStates((cur) => ({
      ...cur,
      [composerKey]: { ...(cur[composerKey] ?? EMPTY_COMPOSER_STATE), planMode: value },
    }));
  }, [composerKey]);
  const syncRunningSession = useCallback((sessionId: string) => {
    void window.grok.runningSessions().then((ids) => {
      setRunningIds((current) =>
        updateRunningSessionIds(current, { sessionId, running: ids.includes(sessionId) }),
      );
    }).catch(() => undefined);
  }, []);
  const changePlanMode = useCallback((value: boolean) => {
    setPlanModeState(value);
    if (value) return;
    const sessionId = activeRef.current?.sessionId;
    if (!sessionId) return;
    const flow = planPanel?.sessionId === sessionId ? planPanel : null;
    if (flow && planFlowBusy(flow.phase)) {
      sendAttemptRef.current += 1;
      planActionRef.current = null;
      void window.grok.cancel(sessionId);
      setRunningIds((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    }
    void window.grok
      .setMode(sessionId, agentModeForComposer(false))
      .then(() => {
        clearStoredPlanFlow(sessionId);
        setPlanPanel((current) => (current?.sessionId === sessionId ? null : current));
      })
      .catch((err) => {
        setPlanModeState(true);
        setError(`无法关闭计划模式：${err instanceof Error ? err.message : String(err)}`);
      });
  }, [planPanel, setPlanModeState]);

  const refresh = useCallback(async () => {
    const [p, t] = await Promise.all([window.grok.listProjects(), window.grok.listThreads()]);
    setProjects(p);
    setThreads(t);
  }, []);

  useEffect(() => {
    void window.grok.status().then(setStatus);
    void window.grok.account().then(setAccount);
    void window.grok.settings().then(setSettings);
  }, []);

  useEffect(() => {
    if (typeof window.grok.onInstallLog !== "function") return;
    return window.grok.onInstallLog((line) => {
      setInstallLogs((prev) => [...prev, line]);
    });
  }, []);

  useEffect(() => {
    const el = installLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [installLogs]);

  useEffect(() => {
    if (typeof window.grok.onWorkspace !== "function") return;
    return window.grok.onWorkspace((payload) => {
      if (Array.isArray(payload?.projects)) setProjects(payload.projects);
      if (Array.isArray(payload?.threads)) setThreads(payload.threads);
    });
  }, []);

  useEffect(() => {
    void window.grok.settings(active?.cwd || selectedProjectCwd).then(setSettings);
  }, [active?.cwd, selectedProjectCwd]);

  useEffect(() => {
    try {
      localStorage.setItem("grok.sidebarWidth", String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem("grok.rightSidebarWidth", String(rightSidebarWidth));
    } catch {
      /* ignore */
    }
  }, [rightSidebarWidth]);

  useEffect(() => {
    if (planPanel) writeStoredPlanFlow(planPanel);
  }, [planPanel]);

  useEffect(() => {
    try {
      localStorage.setItem(COMPOSER_STATES_STORAGE_KEY, JSON.stringify(composerStates));
    } catch {
      /* persistence is best effort */
    }
  }, [composerStates]);

  useEffect(() => {
    try {
      localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...unreadIds]));
    } catch {
      /* persistence is best effort */
    }
  }, [unreadIds]);

  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const cwd = selectedProjectCwd;
    if (!cwd) {
      setGoal("");
      return;
    }
    void window.grok.getGoal(cwd).then(setGoal);
  }, [selectedProjectCwd]);

  useEffect(() => {
    if (!gitCwd) {
      if (unattachedActive) setGit(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      void window.grok.gitStatus(gitCwd).then((next) => {
        if (!cancelled) setGit(next);
      });
    };
    load();
    const id = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [gitCwd, unattachedActive]);

  useEffect(() => {
    const applyRunState = (payload: { sessionId: string; running: boolean }) => {
      if (!payload?.sessionId) return;
      setRunningIds((current) => updateRunningSessionIds(current, payload));
    };
    const offRunState = window.grok.onRunState(applyRunState);
    void window.grok.runningSessions().then((ids) => setRunningIds(new Set(ids))).catch(() => undefined);
    return offRunState;
  }, []);

  useEffect(() => {
    const sessionsUpdatedAfterSnapshot = new Set<string>();
    const offState = window.grok.onFollowUpState(({ sessionId, entries }) => {
      sessionsUpdatedAfterSnapshot.add(sessionId);
      setFollowUpsBySession((current) => ({ ...current, [sessionId]: entries }));
    });
    const offStarted = window.grok.onFollowUpStarted(({ entry }) => {
      if (renderedFollowUpIdsRef.current.has(entry.id)) return;
      renderedFollowUpIdsRef.current.add(entry.id);
      if (activeRef.current?.sessionId === entry.sessionId) {
        setItems((current) => [
          ...stampTurnDuration(stripEphemeral(current)),
          {
            kind: "user",
            text: followUpDisplayText(entry),
            attachments: entry.attachments,
            startedAt: Date.now(),
          },
        ]);
      }
    });
    const offError = window.grok.onFollowUpError(({ entry, message }) => {
      if (activeRef.current?.sessionId === entry.sessionId) setError(message);
    });
    void window.grok.queuedFollowUps().then((entries) => {
      const grouped: Record<string, QueuedFollowUp[]> = {};
      for (const entry of entries) (grouped[entry.sessionId] ??= []).push(entry);
      setFollowUpsBySession((current) => {
        const next = { ...current };
        for (const [sessionId, queued] of Object.entries(grouped)) {
          if (!sessionsUpdatedAfterSnapshot.has(sessionId)) next[sessionId] = queued;
        }
        return next;
      });
    }).catch(() => undefined);
    return () => {
      offState();
      offStarted();
      offError();
    };
  }, []);

  useEffect(() => {
    const offUpdate = window.grok.onUpdate((payload) => {
      const currentActive = activeRef.current;
      const usage = extractContextUsage(payload.update, payload.meta);
      if (usage && isSessionViewCurrent(currentActive?.sessionId, payload.sessionId)) {
        setContextUsage((prev) => mergeContextUsage(prev, usage));
        if (usage.used != null) setContextUsed(usage.used);
      }
      const kind = String(payload.update?.sessionUpdate ?? "");
      if (kind === "plan") {
        setPlanPanel((cur) =>
          cur && cur.sessionId === payload.sessionId
            ? { ...cur, open: true, hasPlan: true, error: undefined }
            : cur,
        );
        const stored = readStoredPlanFlow(payload.sessionId);
        if (stored) writeStoredPlanFlow({ ...stored, open: true, hasPlan: true, error: undefined });
      }
      if (kind === "turn_completed") {
        if (payload.runContinues) {
          if (currentActive && isSessionViewCurrent(currentActive.sessionId, payload.sessionId)) {
            setItems((prev) => stampTurnDuration(stripEphemeral(prev)));
          }
          void refresh();
          return;
        }
        const visibleSessionCompleted = Boolean(
          currentActive &&
            isSessionViewCurrent(currentActive.sessionId, payload.sessionId) &&
            page === "chat" &&
            document.visibilityState === "visible" &&
            document.hasFocus(),
        );
        setUnreadIds((current) =>
          updateUnreadSessionIds(current, {
            sessionId: payload.sessionId,
            unread: !visibleSessionCompleted,
          }),
        );
        setRunningIds((s) => {
          const n = new Set(s);
          n.delete(payload.sessionId);
          return n;
        });
        setPermissionsBySession((current) => {
          if (!current[payload.sessionId]) return current;
          const next = { ...current };
          delete next[payload.sessionId];
          return next;
        });
        setPlanPanel((cur) => {
          if (cur?.sessionId === payload.sessionId) planActionRef.current = null;
          if (cur?.sessionId === payload.sessionId && cur.phase === "executing") {
            clearStoredPlanFlow(payload.sessionId);
            return null;
          }
          if (!cur || cur.sessionId !== payload.sessionId) return cur;
          return settlePlanTurn(cur);
        });
        const stored = readStoredPlanFlow(payload.sessionId);
        if (stored?.phase === "executing") {
          clearStoredPlanFlow(payload.sessionId);
        } else if (stored) {
          writeStoredPlanFlow(settlePlanTurn(stored));
        }
        if (currentActive && isSessionViewCurrent(currentActive.sessionId, payload.sessionId)) {
          setItems((prev) => stampTurnDuration(stripEphemeral(prev)));
          if (!isUnattached(currentActive)) {
            const completedCwd = currentActive.cwd;
            void window.grok.gitStatus(completedCwd).then((next) => {
              if (activeRef.current?.sessionId === payload.sessionId) setGit(next);
            });
          }
          void window.grok.loadTranscript(payload.sessionId, currentActive.cwd).then((transcript) => {
            if (activeRef.current?.sessionId !== payload.sessionId) return;
            setContextUsed(transcript.contextUsed);
            setContextUsage(transcript.contextUsage);
          }).catch(() => undefined);
        }
        void refresh();
        return;
      }
      if (currentActive && isSessionViewCurrent(currentActive.sessionId, payload.sessionId)) {
        setItems((prev) => applyLiveUpdate(prev, payload.update));
        const status = String(payload.update.status ?? "");
        const toolKind = String(payload.update.kind ?? payload.update.toolKind ?? "");
        if (!isUnattached(currentActive)) {
          if (
            payload.update.sessionUpdate === "tool_call_update" &&
            /complet|success/i.test(status)
          ) {
            const updateCwd = currentActive.cwd;
            void window.grok.gitStatus(updateCwd).then((next) => {
              if (activeRef.current?.sessionId === payload.sessionId) setGit(next);
            });
          }
          if (toolKind === "edit" || toolKind === "write") {
            const updateCwd = currentActive.cwd;
            void window.grok.gitStatus(updateCwd).then((next) => {
              if (activeRef.current?.sessionId === payload.sessionId) setGit(next);
            });
          }
        }
      }
    });
    const offTurnFiles = window.grok.onTurnFiles((payload) => {
      if (!payload?.files?.length) return;
      if (!isSessionViewCurrent(activeRef.current?.sessionId, payload.sessionId)) return;
      setItems((prev) => appendTurnChanges(prev, payload.files));
    });
    const offPerm = window.grok.onPermission((p) => {
      setPermissionsBySession((current) => ({ ...current, [p.sessionId]: p }));
    });
    const offStatus = window.grok.onAgentStatus(() => {
      /* connected flag is informational */
    });
    return () => {
      offUpdate();
      offTurnFiles();
      offPerm();
      offStatus();
    };
  }, [page, refresh]);

  const selectThread = useCallback(async (thread: ThreadInfo, markRead = true) => {
    if (markRead) {
      setUnreadIds((current) =>
        updateUnreadSessionIds(current, { sessionId: thread.id, unread: false }),
      );
    }
    const unattached = isUnattached(thread);
    setPage("chat");
    setSelectedProjectCwd(unattached ? null : thread.projectCwd);
    if (activeRef.current?.sessionId === thread.id) return;
    sendAttemptRef.current += 1;
    planActionRef.current = null;
    setError(null);
    setPlanDocument(null);
    const nextActive: Active = {
      sessionId: thread.id,
      cwd: thread.cwd,
      projectCwd: unattached ? "" : thread.projectCwd,
      unattached,
    };
    setActive(nextActive);
    const viewVersion = activeViewVersionRef.current;
    setItems([]);
    setContextUsed(null);
    setContextUsage(null);
    let transcript: Awaited<ReturnType<typeof window.grok.loadTranscript>>;
    try {
      transcript = await window.grok.loadTranscript(thread.id, thread.cwd);
    } catch (err) {
      if (activeViewVersionRef.current === viewVersion) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (activeViewVersionRef.current !== viewVersion || activeRef.current?.sessionId !== thread.id) return;
    setItems((current) => mergeTranscriptWithLiveItems(transcript.items, current));
    setContextUsed(transcript.contextUsed);
    setContextUsage(transcript.contextUsage);
    const storedPlan = readStoredPlanFlow(thread.id);
    const restoredPlan = storedPlan
      ? restorePlanFlow(storedPlan, transcript.items)
      : transcript.planAwaiting
        ? recoverAwaitingPlanFlow(thread.id, transcript.items)
        : null;
    setPlanPanel(restoredPlan);
    if (restoredPlan) {
      writeStoredPlanFlow(restoredPlan);
      const key = `session:${thread.id}`;
      setComposerStates((cur) => ({
        ...cur,
        [key]: { ...(cur[key] ?? EMPTY_COMPOSER_STATE), planMode: true },
      }));
    }
    try {
      await window.grok.resumeThread(thread.id, thread.cwd);
    } catch (err) {
      if (activeViewVersionRef.current === viewVersion && activeRef.current?.sessionId === thread.id) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    if (activeViewVersionRef.current !== viewVersion || activeRef.current?.sessionId !== thread.id) return;
    setWorktreeMode(Boolean(thread.worktree));
    setSelectedDiffFile(null);
    setReviewOpen(false);
    if (unattached) setGit(null);
    else void window.grok.gitStatus(thread.cwd).then((next) => {
      if (activeViewVersionRef.current === viewVersion && activeRef.current?.sessionId === thread.id) setGit(next);
    });
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void (async () => {
      await refresh();
      let projectCwd = "";
      let sessionId = "";
      try {
        projectCwd = localStorage.getItem("grok.selectedProjectCwd") || "";
        sessionId = localStorage.getItem("grok.activeSessionId") || "";
      } catch {
        setHydrated(true);
        return;
      }
      const [projectList, threadList] = await Promise.all([
        window.grok.listProjects(),
        window.grok.listThreads(),
      ]);
      const thread = sessionId ? threadList.find((item) => item.id === sessionId) : undefined;
      if (thread) {
        await selectThread(thread, false);
      } else if (projectCwd && projectList.some((p) => samePath(p.cwd, projectCwd))) {
        setSelectedProjectCwd(projectCwd);
        void window.grok.gitStatus(projectCwd).then(setGit);
      }
      setHydrated(true);
    })();
  }, [refresh, selectThread]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (selectedProjectCwd) localStorage.setItem("grok.selectedProjectCwd", selectedProjectCwd);
      else localStorage.removeItem("grok.selectedProjectCwd");
    } catch {
      /* ignore */
    }
  }, [hydrated, selectedProjectCwd]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (active?.sessionId) localStorage.setItem("grok.activeSessionId", active.sessionId);
      else localStorage.removeItem("grok.activeSessionId");
    } catch {
      /* ignore */
    }
  }, [hydrated, active?.sessionId]);

  const beginComposer = useCallback(
    (cwd?: string | null, worktree = false, resetDraft = true) => {
      sendAttemptRef.current += 1;
      planActionRef.current = null;
      pendingThreadRef.current = null;
      setError(null);
      setPage("chat");
      const unattached = !cwd;
      setSelectedProjectCwd(unattached ? null : cwd);
      setWorktreeMode(Boolean(cwd) && worktree);
      setItems([]);
      setContextUsed(null);
      setContextUsage(null);
      const nextActive: Active = {
        sessionId: "",
        cwd: cwd || "",
        projectCwd: cwd || "",
        unattached,
        pending: true,
      };
      const nextKey = conversationComposerKey(nextActive, cwd || null, Boolean(cwd) && worktree);
      setComposerStates((cur) => ({
        ...cur,
        [nextKey]: resetDraft
          ? { ...EMPTY_COMPOSER_STATE, attachments: [] }
          : { ...(cur[composerKey] ?? EMPTY_COMPOSER_STATE), attachments: [...(cur[composerKey]?.attachments ?? [])] },
      }));
      setSelectedDiffFile(null);
      setReviewOpen(false);
      setPlanDocument(null);
      setPlanPanel(null);
      if (unattached) setGit(null);
      else if (cwd) void window.grok.gitStatus(cwd).then(setGit);
      setActive(nextActive);
    },
    [composerKey],
  );

  const openProject = useCallback(async () => {
    const project = await window.grok.addProject();
    if (!project) return;
    beginComposer(project.cwd, worktreeMode, false);
    await refresh();
  }, [beginComposer, refresh, worktreeMode]);

  const createThread = useCallback(
    async (cwd?: string | null, worktree = false, initialPrompt = "") => {
      const createAttempt = sendAttemptRef.current;
      const task = (async (): Promise<Active | null> => {
        const created = await window.grok.newThread(
          cwd || null,
          Boolean(cwd) && worktree,
          initialPrompt,
        );
        if (sendAttemptRef.current !== createAttempt) return null;
        const nextUnattached = Boolean(created.unattached || !created.projectCwd);
        const next: Active = {
          sessionId: created.sessionId,
          cwd: created.cwd,
          projectCwd: nextUnattached ? "" : created.projectCwd,
          unattached: nextUnattached,
        };
        setSelectedProjectCwd(nextUnattached ? null : created.projectCwd);
        setWorktreeMode(Boolean(created.worktree));
        setActive(next);
        const now = new Date().toISOString();
        const pendingThread: ThreadInfo = {
          id: created.sessionId,
          cwd: created.cwd,
          title: created.title || "新会话",
          updatedAt: now,
          createdAt: now,
          projectCwd: nextUnattached ? "" : created.projectCwd,
          worktree: Boolean(created.worktree),
          unattached: nextUnattached,
        };
        setThreads((current) =>
          current.some((thread) => thread.id === pendingThread.id)
            ? current
            : [pendingThread, ...current],
        );
        if (nextUnattached) setGit(null);
        else void window.grok.gitStatus(created.cwd).then(setGit);
        return next;
      })();
      pendingThreadRef.current = task;
      try {
        return await task;
      } catch (err) {
        if (sendAttemptRef.current === createAttempt) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return null;
      } finally {
        if (pendingThreadRef.current === task) pendingThreadRef.current = null;
      }
    },
    [],
  );

  const forkThread = useCallback(
    async (thread: ThreadInfo) => {
      sendAttemptRef.current += 1;
      const sourceViewVersion = activeViewVersionRef.current;
      let forkedSessionId = "";
      planActionRef.current = null;
      if (!thread.id) {
        setError("会话还没创建完成");
        return;
      }
      setError(null);
      try {
        const created = await window.grok.forkThread(thread.id, thread.cwd);
        if (activeViewVersionRef.current !== sourceViewVersion) return;
        forkedSessionId = created.sessionId;
        setPage("chat");
        const nextUnattached = Boolean(created.unattached || !created.projectCwd);
        setSelectedProjectCwd(nextUnattached ? null : created.projectCwd);
        setWorktreeMode(Boolean(created.worktree));
        setActive({
          sessionId: created.sessionId,
          cwd: created.cwd,
          projectCwd: nextUnattached ? "" : created.projectCwd,
          unattached: nextUnattached,
        });
        const forkViewVersion = activeViewVersionRef.current;
        setPlanPanel(null);
        const transcript = await window.grok.loadTranscript(created.sessionId, created.cwd);
        if (
          activeViewVersionRef.current !== forkViewVersion ||
          activeRef.current?.sessionId !== created.sessionId
        ) return;
        setItems(transcript.items);
        setContextUsed(transcript.contextUsed);
        setContextUsage(transcript.contextUsage);
        setSelectedDiffFile(null);
        if (nextUnattached) setGit(null);
        else void window.grok.gitStatus(created.cwd).then((next) => {
          if (activeRef.current?.sessionId === created.sessionId) setGit(next);
        });
        void refresh();
      } catch (err) {
        if (
          activeViewVersionRef.current === sourceViewVersion ||
          (forkedSessionId && activeRef.current?.sessionId === forkedSessionId)
        ) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [refresh],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        beginComposer(null, e.shiftKey || worktreeMode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beginComposer, worktreeMode]);

  const send = useCallback(async () => {
    const sourceComposerKey = composerKey;
    const runningSessionId = active?.sessionId && runningIds.has(active.sessionId)
      ? active.sessionId
      : null;
    if (runningSessionId) {
      if (followUpSendingRef.current.has(runningSessionId)) return;
      if (!draft.trim() && !attachments.length) {
        if (!activeFollowUps.length) return;
        followUpSendingRef.current.add(runningSessionId);
        try {
          await window.grok.promoteFollowUp(runningSessionId);
          setError(null);
        } catch (err) {
          setError(`调整方向失败，消息仍在队列中：${err instanceof Error ? err.message : String(err)}`);
        } finally {
          followUpSendingRef.current.delete(runningSessionId);
        }
        return;
      }

      const queuedDraft = draft;
      const queuedAttachments = [...attachments];
      const { payload, images, attachments: queuedFiles } = followUpPayload(queuedDraft, queuedAttachments);
      followUpSendingRef.current.add(runningSessionId);
      try {
        await window.grok.queueFollowUp(runningSessionId, payload, images, queuedFiles);
        setComposerStates((current) => {
          const source = current[sourceComposerKey] ?? EMPTY_COMPOSER_STATE;
          const unchanged =
            source.draft === queuedDraft &&
            source.attachments.length === queuedAttachments.length &&
            source.attachments.every((filePath, index) => filePath === queuedAttachments[index]);
          if (!unchanged) return current;
          return {
            ...current,
            [sourceComposerKey]: { ...source, draft: "", attachments: [] },
          };
        });
        setError(null);
      } catch (err) {
        setError(`加入队列失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        followUpSendingRef.current.delete(runningSessionId);
      }
      return;
    }
    if (sendingRef.current.has(sourceComposerKey)) {
      const requestStillRunning = Boolean(
        pendingThreadRef.current || (active?.sessionId && runningIds.has(active.sessionId)),
      );
      if (requestStillRunning) return;
      sendingRef.current.delete(sourceComposerKey);
    }
    const sendAttempt = ++sendAttemptRef.current;
    if (!draft.trim() && !attachments.length) return;
    const text = draft.trim();
    sendingRef.current.add(sourceComposerKey);
    const attached = attachments;
    let session = active && !active.pending && active.sessionId ? active : null;
    if (!session?.sessionId) {
      const cwd = selectedProjectCwd;
      setError(null);
      try {
        const initialPrompt = text || (attachments.length
          ? `${attachments.some((path) => /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(path)) ? "图片" : "附件"}任务 ×${attachments.length}`
          : "");
        session = await createThread(cwd, Boolean(cwd) && worktreeMode, initialPrompt);
      } catch (err) {
        sendingRef.current.delete(sourceComposerKey);
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    if (!session?.sessionId) {
      sendingRef.current.delete(sourceComposerKey);
      return;
    }
    const sessionComposerKey = `session:${session.sessionId}`;
    sendingRef.current.add(sessionComposerKey);
    const releaseSendLocks = () => {
      sendingRef.current.delete(sourceComposerKey);
      sendingRef.current.delete(sessionComposerKey);
    };
    const restoreComposerInput = () => {
      setComposerStates((cur) => {
        const source = cur[sourceComposerKey] ?? { draft: "", attachments: [], planMode };
        const restored = { ...source, draft: text, attachments: [...attached], planMode };
        return sourceComposerKey === sessionComposerKey
          ? { ...cur, [sourceComposerKey]: restored }
          : { ...cur, [sourceComposerKey]: restored, [sessionComposerKey]: restored };
      });
    };
    const imageExt = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
    const imageFiles = attached.filter((p) => imageExt.test(p));
    const otherFiles = attached.filter((p) => !imageExt.test(p));
    let payload = text;
    if (otherFiles.length) {
      payload += `${payload ? "\n\n" : ""}请同时参考这些路径：\n` + otherFiles.map((p) => `- @${p}`).join("\n");
    }
    if (!payload && imageFiles.length) payload = "请参考我附带的图片。";
    setComposerStates((cur) => {
      const source = cur[sourceComposerKey] ?? { draft, attachments, planMode };
      const cleared = { ...source, draft: "", attachments: [], planMode };
      return sourceComposerKey === sessionComposerKey
        ? { ...cur, [sourceComposerKey]: cleared }
        : { ...cur, [sourceComposerKey]: cleared, [sessionComposerKey]: cleared };
    });
    setRunningIds((s) => new Set(s).add(session.sessionId));
    if (planMode) {
      const currentFlow = planPanel?.sessionId === session.sessionId ? planPanel : null;
      if (!currentFlow) {
        try {
          await window.grok.setMode(session.sessionId, agentModeForComposer(true));
        } catch (err) {
          if (sendAttemptRef.current !== sendAttempt) {
            setRunningIds((s) => {
              const n = new Set(s);
              n.delete(session.sessionId);
              return n;
            });
            releaseSendLocks();
            return;
          }
          const message = `无法进入计划模式，任务没有发送：${err instanceof Error ? err.message : String(err)}`;
          setError(message);
          restoreComposerInput();
          setRunningIds((s) => {
            const n = new Set(s);
            n.delete(session.sessionId);
            return n;
          });
          releaseSendLocks();
          return;
        }
      }
      if (sendAttemptRef.current !== sendAttempt) {
        syncRunningSession(session.sessionId);
        releaseSendLocks();
        return;
      }
      const userText = text;
      const userStartedAt = Date.now();
      const pendingImages = imageFiles.map((p) => ({
        path: p,
        mimeType: /\.jpe?g$/i.test(p)
          ? "image/jpeg"
          : /\.gif$/i.test(p)
            ? "image/gif"
            : /\.webp$/i.test(p)
              ? "image/webp"
              : "image/png",
      }));
      const planPrompt = currentFlow ? payload : buildPlanConversationPrompt(payload);
      const flow: PlanFlow = currentFlow
        ? {
            ...currentFlow,
            planId: newLocalId("plan"),
            turnId: newLocalId("turn"),
            open: true,
            phase: currentFlow.hasPlan ? "revising" : "generating",
            userText,
            userStartedAt,
            hasPlan: false,
            retryPrompt: planPrompt,
            retryImages: pendingImages,
            error: undefined,
          }
        : {
            planId: newLocalId("plan"),
            turnId: newLocalId("turn"),
            sessionId: session.sessionId,
            open: true,
            phase: "generating",
            pendingPrompt: payload,
            userText,
            pendingImages,
            retryPrompt: planPrompt,
            retryImages: pendingImages,
            userStartedAt,
            hasPlan: false,
          };
      setItems((prev) => [
        ...prev,
        { kind: "user", text: userText, attachments: [...attached], startedAt: userStartedAt },
      ]);
      setPlanPanel(flow);
      writeStoredPlanFlow(flow);
      let planSendError: string | null = null;
      let previousPlanModifiedAt: number | null = null;
      try {
        previousPlanModifiedAt = (
          await window.grok.loadTranscript(session.sessionId, session.cwd)
        ).planModifiedAt;
      } catch {
        /* A missing baseline must not prevent the plan request from being sent. */
      }
      try {
        await window.grok.sendPrompt(session.sessionId, planPrompt, pendingImages, attached, userStartedAt);
      } catch (err) {
        planSendError = err instanceof Error ? err.message : String(err);
      } finally {
        let persistedRevision: PlanRevision | null = null;
        try {
          const transcript = await window.grok.loadTranscript(session.sessionId, session.cwd);
          const planFileChanged = Boolean(
            transcript.planModifiedAt != null &&
              (previousPlanModifiedAt == null || transcript.planModifiedAt > previousPlanModifiedAt),
          );
          if (planFileChanged) {
            persistedRevision = latestPlanForFlow(
              transcript.items,
              flow.userStartedAt,
              flow.userText,
            ) ?? latestPlanDocument(transcript.items);
          }
        } catch {
          /* the live plan update can still complete the flow */
        }
        if (persistedRevision) {
          if (activeRef.current?.sessionId === session.sessionId) {
            setError(null);
            setItems((prev) => mergeRecoveredPlan(prev, flow, persistedRevision!));
          }
          setPlanPanel((cur) => {
            if (!cur || cur.planId !== flow.planId) return cur;
            const ready: PlanFlow = {
              ...cur,
              open: true,
              phase: "awaiting_approval",
              hasPlan: true,
              error: undefined,
            };
            writeStoredPlanFlow(ready);
            return ready;
          });
        } else if (planSendError) {
          if (activeRef.current?.sessionId === session.sessionId) setError(planSendError);
          const failed: PlanFlow = { ...flow, open: true, phase: "failed", error: planSendError };
          setPlanPanel((cur) => (cur?.planId === flow.planId ? failed : cur));
          writeStoredPlanFlow(failed);
        } else {
          setPlanPanel((cur) =>
            cur?.sessionId === session.sessionId ? settlePlanTurn(cur) : cur,
          );
        }
        syncRunningSession(session.sessionId);
        if (activeRef.current?.sessionId === session.sessionId) {
          setItems((prev) => stampTurnDuration(stripEphemeral(prev)));
        }
        releaseSendLocks();
        void refresh();
      }
      return;
    }
    const userText = text;
    const userStartedAt = Date.now();
    const promptImages = imageFiles.map((p) => ({
      path: p,
      mimeType: /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.gif$/i.test(p) ? "image/gif" : /\.webp$/i.test(p) ? "image/webp" : "image/png",
    }));
    try {
      await window.grok.setMode(session.sessionId, agentModeForComposer(false));
      clearStoredPlanFlow(session.sessionId);
      setPlanPanel((current) =>
        current?.sessionId === session!.sessionId ? null : current,
      );
    } catch (err) {
      const message = `无法退出计划模式，消息没有发送：${err instanceof Error ? err.message : String(err)}`;
      if (activeRef.current?.sessionId === session.sessionId) setError(message);
      restoreComposerInput();
      setRunningIds((current) => {
        const next = new Set(current);
        next.delete(session!.sessionId);
        return next;
      });
      releaseSendLocks();
      return;
    }
    failedPromptRef.current = null;
    setError(null);
    setItems((prev) => [
      ...prev,
      { kind: "user", text: userText, attachments: [...attached], startedAt: userStartedAt },
    ]);
    try {
      await window.grok.sendPrompt(session.sessionId, payload, promptImages, attached, userStartedAt);
    } catch (err) {
      failedPromptRef.current = {
        sessionId: session.sessionId,
        text: payload,
        images: promptImages,
        attachments: [...attached],
        startedAt: userStartedAt,
      };
      if (activeRef.current?.sessionId === session.sessionId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      // session/prompt resolves only after the turn has ended. Treat that
      // request result as a fallback completion signal because some Grok CLI
      // versions persist `_x.ai/session/update` without forwarding it live.
      syncRunningSession(session.sessionId);
      if (activeRef.current?.sessionId === session.sessionId) {
        setItems((prev) => stampTurnDuration(stripEphemeral(prev)));
      }
      releaseSendLocks();
      void refresh();
    }
  }, [active, activeFollowUps, attachments, composerKey, draft, createThread, planMode, planPanel, refresh, runningIds, selectedProjectCwd, syncRunningSession, worktreeMode]);

  const retryFailedPrompt = useCallback(async () => {
    const failed = failedPromptRef.current;
    const retryKey = failed ? `session:${failed.sessionId}` : "";
    if (!failed || sendingRef.current.has(retryKey) || runningIds.has(failed.sessionId)) return;
    sendingRef.current.add(retryKey);
    setError(null);
    setRunningIds((cur) => new Set(cur).add(failed.sessionId));
    try {
      await window.grok.sendPrompt(
        failed.sessionId,
        failed.text,
        failed.images,
        failed.attachments,
        failed.startedAt,
      );
      failedPromptRef.current = null;
    } catch (err) {
      if (activeRef.current?.sessionId === failed.sessionId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      sendingRef.current.delete(retryKey);
      syncRunningSession(failed.sessionId);
      void refresh();
    }
  }, [refresh, runningIds, syncRunningSession]);

  const approvePlan = useCallback(async (revision: PlanRevision) => {
    if (!planPanel || planFlowBusy(planPanel.phase) || revision.entries.length === 0) return;
    const flow = planPanel;
    const actionId = `${flow.planId}:approve`;
    if (planActionRef.current) return;
    planActionRef.current = actionId;
    const { pendingImages, sessionId } = flow;
    setPlanPanel({ ...flow, phase: "approving", error: undefined });
    try {
      await window.grok.setMode(sessionId, "act");
    } catch (err) {
      const message = `无法进入执行模式，计划没有执行：${err instanceof Error ? err.message : String(err)}`;
      if (activeRef.current?.sessionId === sessionId) setError(message);
      const failed: PlanFlow = { ...flow, open: true, phase: "failed", error: message };
      setPlanPanel((current) =>
        current?.sessionId === sessionId && current.planId === flow.planId ? failed : current,
      );
      writeStoredPlanFlow(failed);
      planActionRef.current = null;
      return;
    }
    setPlanModeState(false);
    setPlanDocument(null);

    const executionPrompt = buildPlanExecutionPrompt(flow.pendingPrompt, revision);
    setItems((prev) => [
      ...prev,
      {
        kind: "user",
        text: `[已批准计划] 执行第 ${revision.revision} 份计划`,
        startedAt: Date.now(),
      },
    ]);
    setRunningIds((s) => new Set(s).add(sessionId));
    const executing: PlanFlow = { ...flow, open: false, phase: "executing", error: undefined };
    setPlanPanel(executing);
    writeStoredPlanFlow(executing);
    try {
      await window.grok.sendPrompt(sessionId, executionPrompt, pendingImages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (activeRef.current?.sessionId === sessionId) setError(message);
      const failed: PlanFlow = { ...flow, open: true, phase: "failed", error: message };
      setPlanPanel((current) =>
        current?.sessionId === sessionId && current.planId === flow.planId ? failed : current,
      );
      writeStoredPlanFlow(failed);
      syncRunningSession(sessionId);
    } finally {
      if (planActionRef.current === actionId) planActionRef.current = null;
    }
  }, [planPanel, setPlanModeState, syncRunningSession]);

  const rejectPlan = useCallback(() => {
    if (!planPanel) return;
    const flow = planPanel;
    planActionRef.current = null;
    if (planFlowBusy(flow.phase)) void window.grok.cancel(flow.sessionId);
    setRunningIds((s) => {
      const n = new Set(s);
      n.delete(flow.sessionId);
      return n;
    });
    clearStoredPlanFlow(flow.sessionId);
    setPlanPanel(null);
    setPlanDocument(null);
    setPlanModeState(false);
    setItems((prev) => markFlowPlans(prev, flow.userStartedAt, "cancelled", flow.userText));
  }, [planPanel, setPlanModeState]);

  const retryPlan = useCallback(async () => {
    if (!planPanel || planFlowBusy(planPanel.phase)) return;
    const flow = planPanel;
    const actionId = `${flow.planId}:retry`;
    if (planActionRef.current) return;
    planActionRef.current = actionId;
    try {
      await window.grok.setMode(flow.sessionId, "plan");
    } catch (err) {
      const message = `无法进入计划模式，任务没有发送：${err instanceof Error ? err.message : String(err)}`;
      if (activeRef.current?.sessionId === flow.sessionId) setError(message);
      const failed: PlanFlow = { ...flow, open: true, phase: "failed", error: message };
      setPlanPanel((current) =>
        current?.sessionId === flow.sessionId && current.planId === flow.planId ? failed : current,
      );
      writeStoredPlanFlow(failed);
      planActionRef.current = null;
      return;
    }
    const retryPrompt = flow.retryPrompt ?? flow.pendingPrompt;
    const retryImages = flow.retryImages ?? flow.pendingImages;
    const generating: PlanFlow = {
      ...flow,
      open: true,
      phase: flow.hasPlan ? "revising" : "generating",
      error: undefined,
    };
    setPlanPanel(generating);
    writeStoredPlanFlow(generating);
    setRunningIds((s) => new Set(s).add(flow.sessionId));
    try {
      await window.grok.sendPrompt(flow.sessionId, retryPrompt, retryImages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (activeRef.current?.sessionId === flow.sessionId) setError(message);
      const failed: PlanFlow = { ...flow, open: true, phase: "failed", error: message };
      setPlanPanel((current) =>
        current?.sessionId === flow.sessionId && current.planId === flow.planId ? failed : current,
      );
      writeStoredPlanFlow(failed);
    } finally {
      syncRunningSession(flow.sessionId);
      if (activeRef.current?.sessionId === flow.sessionId) {
        setItems((prev) => stampTurnDuration(stripEphemeral(prev)));
      }
      setPlanPanel((cur) =>
        cur?.sessionId === flow.sessionId ? settlePlanTurn(cur) : cur,
      );
      if (planActionRef.current === actionId) planActionRef.current = null;
      void refresh();
    }
  }, [planPanel, refresh, syncRunningSession]);

  const reloadPlanDocument = useCallback(async () => {
    if (!planPanel) return;
    const flow = planPanel;
    const thread = active?.sessionId === flow.sessionId
      ? active
      : threads.find((item) => item.id === flow.sessionId);
    if (!thread?.cwd) return;
    try {
      const transcript = await window.grok.loadTranscript(flow.sessionId, thread.cwd);
      if (activeRef.current?.sessionId !== flow.sessionId) return;
      const revision = latestPlanForFlow(
        transcript.items,
        flow.userStartedAt,
        flow.userText,
      ) ?? latestPlanDocument(transcript.items);
      if (!revision?.markdown) {
        const waiting: PlanFlow = {
          ...flow,
          open: true,
          phase: "awaiting_approval",
          error: "尚未读取到 plan.md。可以再次读取，或在输入框继续让 Grok 完成计划。",
        };
        setPlanPanel(waiting);
        writeStoredPlanFlow(waiting);
        return;
      }
      setItems((prev) => mergeRecoveredPlan(prev, flow, revision));
      const ready: PlanFlow = {
        ...flow,
        open: true,
        phase: "awaiting_approval",
        hasPlan: true,
        error: undefined,
      };
      setPlanPanel(ready);
      writeStoredPlanFlow(ready);
    } catch (err) {
      const waiting: PlanFlow = {
        ...flow,
        open: true,
        phase: "awaiting_approval",
        error: `读取计划文档失败：${err instanceof Error ? err.message : String(err)}`,
      };
      setPlanPanel(waiting);
      writeStoredPlanFlow(waiting);
    }
  }, [active, planPanel, threads]);

  const stop = useCallback(() => {
    if (!active) return;
    sendAttemptRef.current += 1;
    sendingRef.current.delete(`session:${active.sessionId}`);
    sendingRef.current.delete(composerKey);
    planActionRef.current = null;
    void window.grok.cancel(active.sessionId).then((cleared) => {
      if (!cleared.length || activeRef.current?.sessionId !== active.sessionId) return;
      const queuedText = cleared.map((entry) => entry.text.trim()).filter(Boolean).join("\n\n");
      const queuedImages = cleared.flatMap((entry) => entry.attachments);
      setComposerStates((current) => {
        const source = current[composerKey] ?? EMPTY_COMPOSER_STATE;
        return {
          ...current,
          [composerKey]: {
            ...source,
            draft: [queuedText, source.draft].filter(Boolean).join("\n\n"),
            attachments: [...new Set([...queuedImages, ...source.attachments])],
          },
        };
      });
    }).catch(() => undefined);
    setItems((prev) => stampTurnDuration(stripEphemeral(prev)));
    setRunningIds((s) => {
      const n = new Set(s);
      n.delete(active.sessionId);
      return n;
    });
    setPlanPanel((cur) => {
      if (!cur || cur.sessionId !== active.sessionId || !planFlowBusy(cur.phase)) return cur;
      return {
        ...cur,
        open: true,
        phase: "failed",
        error: cur.hasPlan
          ? "计划操作已停止，可以继续补充要求或批准现有计划。"
          : "计划对话已停止，可以继续输入或重试。",
      };
    });
  }, [active, composerKey]);

  const grokLabel = useMemo(() => {
    if (!status) return "正在检测 grok…";
    if (!status.ok) return status.error || "未找到 grok";
    return status.version || "grok 已就绪";
  }, [status]);

  if (status && !status.ok) {
    const copyLogs = () => {
      const text = installLogs
        .map((line) => `[${new Date(line.ts).toLocaleTimeString("zh-CN", { hour12: false })}] ${line.text}`)
        .join("\n");
      void navigator.clipboard.writeText(text).then(() => setInstallHint("安装日志已复制"));
    };
    return (
      <div className="app">
        <TitleBar />
        <div className="setup">
          <div className="setup-card">
            <img className="setup-logo" src={grokLogo} alt="Grok" />
            {installing || installLogs.length > 0 ? (
              <div className="setup-console">
                <div className="setup-console-head">
                  <span>安装日志</span>
                  <button className="setup-copy-log" type="button" onClick={copyLogs} disabled={!installLogs.length}>
                    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                      <rect x="5.2" y="5.2" width="7.3" height="7.3" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M3.5 10.2V3.8A1.3 1.3 0 0 1 4.8 2.5h6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                    复制日志
                  </button>
                </div>
                <div className="setup-console-body" ref={installLogRef}>
                  {installLogs.length ? (
                    installLogs.map((line, i) => (
                      <div className={`setup-log setup-log-${line.tone}`} key={`${line.ts}-${i}`}>
                        <span className="setup-log-time">
                          [{new Date(line.ts).toLocaleTimeString("zh-CN", { hour12: false })}]
                        </span>{" "}
                        {line.text}
                      </div>
                    ))
                  ) : (
                    <div className="setup-log setup-log-muted">正在启动安装…</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="setup-empty">没有检测到 grok-cli</div>
            )}
            {installHint ? <p className="setup-hint">{installHint}</p> : null}
            <div className="setup-actions">
              <button
                className="btn primary"
                type="button"
                disabled={installing}
                onClick={() => {
                  setInstalling(true);
                  setInstallHint("");
                  setInstallLogs([]);
                  void window.grok
                    .runInstall()
                    .then((result) => {
                      setInstalling(false);
                      if (result.ok) {
                        setInstallHint("安装完成，正在进入应用…");
                        void window.grok.status().then(setStatus);
                        return;
                      }
                      setInstallHint(result.error || "安装未完成，可查看上方日志后重试。");
                    })
                    .catch((err) => {
                      setInstalling(false);
                      setInstallHint(err instanceof Error ? err.message : String(err));
                    });
                }}
              >
                {installing ? "正在安装…" : "运行安装脚本"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void window.grok.copyInstallCommand().then(() => setInstallHint("安装命令已复制"));
                }}
              >
                复制命令
              </button>
              <button className="btn" type="button" onClick={() => void window.grok.openInstallDocs()}>
                打开说明
              </button>
              <button
                className="btn"
                type="button"
                disabled={installing}
                onClick={() => {
                  setInstallHint("正在检测…");
                  void window.grok.status().then((next) => {
                    setStatus(next);
                    setInstallHint(next.ok ? "已找到 grok" : "仍未找到 grok");
                  });
                }}
              >
                重新检测
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const selectedProject = projects.find((p) => selectedProjectCwd && samePath(p.cwd, selectedProjectCwd)) ?? null;
  const isWorktree = Boolean(active && !unattachedActive && /desktop-worktrees/i.test(active.cwd));
  const sessionBusy = Boolean(active && runningIds.has(active.sessionId));
  const activePermission = active?.sessionId ? permissionsBySession[active.sessionId] ?? null : null;
  const activePlan = planPanel && active?.sessionId === planPanel.sessionId ? planPanel : null;
  const activePlanRevisions = activePlan
    ? planRevisionsForFlow(items, activePlan.userStartedAt, activePlan.userText)
    : [];
  const activePlanActivity = activePlan
    ? planActivityForFlow(items, activePlan)
    : planActivityForFlow([], {
        phase: "awaiting_approval",
        userStartedAt: 0,
        userText: "",
      });
  const activePlanQuestion =
    activePlan?.phase === "discussing" ? latestPlanClarification(items, activePlan) : null;
  const latestActivePlanRevision = activePlanRevisions.at(-1) ?? null;
  const displayedPlanIsCurrent = Boolean(
    planDocument &&
      latestActivePlanRevision &&
      planDocument.revision === latestActivePlanRevision.revision &&
      planDocument.markdown === latestActivePlanRevision.markdown,
  );
  const planSidebarOpen = page === "chat" && Boolean(planDocument);
  const envIsWorktree = active ? isWorktree : Boolean(selectedProject) && worktreeMode;
  const showProjectChrome = Boolean(selectedProject && !unattachedActive);
  const reviewSidebarOpen = page === "chat" && reviewOpen && showProjectChrome;
  const filePreviewCwd = active?.cwd || selectedProjectCwd;
  const fileSidebarOpen = page === "chat" && Boolean(previewFilePath && filePreviewCwd);
  const rightSidebarOpen = planSidebarOpen || fileSidebarOpen || reviewSidebarOpen;
  const sidebarCol = fitSidebar(
    winW,
    sidebarWidth,
    rightSidebarOpen ? HANDLE + RIGHT_SIDEBAR_MIN : 0,
  );
  const rightSidebarCol = fitRightSidebar(winW, sidebarCol, rightSidebarWidth);
  const middleCol =
    winW - sidebarCol - HANDLE - (rightSidebarOpen ? HANDLE + rightSidebarCol : 0);
  const middleCompact = middleCol / Math.max(1, winW) < MIDDLE_COMPACT_RATIO;
  const hasGitChanges = Boolean(!unattachedActive && git?.isRepo && git.files.length > 0);
  const statusCardVisible =
    page === "chat" && (activePermission || hasGitChanges || activePlanRevisions.length > 0);

  return (
    <div
      className={`app${rightSidebarOpen ? " right-sidebar-open" : ""}${
        middleCompact ? " middle-compact" : ""
      }`}
      style={
        rightSidebarOpen
          ? ({ "--right-sidebar-offset": `${rightSidebarCol + HANDLE}px` } as CSSProperties)
          : undefined
      }
    >
      <TitleBar
        onTerminal={() => setTerminalOpen((v) => !v)}
        terminalActive={terminalOpen}
      />
      <div
        className="shell"
        style={{
          gridTemplateColumns: `${sidebarCol}px ${HANDLE}px minmax(0, 1fr)${
            rightSidebarOpen ? ` ${HANDLE}px ${rightSidebarCol}px` : ""
          }`,
        }}
      >
        <Sidebar
          projects={projects}
          threads={threads}
          selectedProjectCwd={selectedProjectCwd}
          activeId={active?.sessionId ?? null}
          runningIds={runningIds}
          unreadIds={unreadIds}
          grokLabel={grokLabel}
          account={account}
          onAccountChange={setAccount}
          onOpenProject={() => void openProject()}
          onNewChat={() => beginComposer(null)}
          page={page}
          onOpenMarketplace={() => {
            setPlanDocument(null);
            setReviewOpen(false);
            setPage("marketplace");
            void window.grok.settings(active?.cwd || selectedProjectCwd).then(setSettings);
          }}
          onOpenAutomation={() => {
            setPlanDocument(null);
            setReviewOpen(false);
            setPage("automation");
            void window.grok.settings(active?.cwd || selectedProjectCwd).then(setSettings);
          }}
          onOpenNewTask={() => beginComposer(null)}
          onSettings={() => {
            setSettingsOpen(true);
            void window.grok.settings(active?.cwd || selectedProjectCwd).then(setSettings);
          }}
          onSelectProject={(p) => {
            setPage("chat");
            setSelectedProjectCwd(p.cwd);
            setActive(null);
            setItems([]);
            setContextUsed(null);
            setContextUsage(null);
            setError(null);
            setSelectedDiffFile(null);
            setReviewOpen(false);
            setPlanDocument(null);
            setPlanPanel(null);
            void window.grok.gitStatus(p.cwd).then(setGit);
          }}
          onSelectThread={(t) => void selectThread(t)}
          onRenameProject={(project, name) => {
            void window.grok.renameProject(project.cwd, name).then(() => refresh());
          }}
          onRemoveProject={(project) => {
            if (!window.confirm(`从列表中移除项目「${project.name}」？不会删除磁盘上的文件。`)) return;
            void window.grok.removeProject(project.cwd).then(async (nextProjects) => {
              if (selectedProjectCwd && samePath(selectedProjectCwd, project.cwd)) {
                const next = nextProjects[0]?.cwd ?? null;
                setSelectedProjectCwd(next);
                if (active && samePath(active.projectCwd, project.cwd)) {
                  setActive(null);
                  setItems([]);
                  setContextUsed(null);
                  setContextUsage(null);
                  setPlanDocument(null);
                  setPlanPanel(null);
                }
                if (next) void window.grok.gitStatus(next).then(setGit);
                else setGit(null);
              }
              await refresh();
            });
          }}
          onRemoveProjectThreads={(project) => {
            const projectThreads = threads.filter(
              (thread) =>
                !thread.unattached &&
                Boolean(thread.projectCwd) &&
                samePath(thread.projectCwd, project.cwd),
            );
            if (projectThreads.length === 0) {
              window.alert(`项目「${project.name}」中没有聊天。`);
              return;
            }
            if (
              !window.confirm(
                `移除项目「${project.name}」中的全部 ${projectThreads.length} 个聊天？此操作无法撤销，项目文件不会被删除。`,
              )
            ) {
              return;
            }

            void (async () => {
              const removedIds = new Set(projectThreads.map((thread) => thread.id));
              await Promise.all(
                projectThreads.map(async (thread) => {
                  if (runningIds.has(thread.id)) {
                    await window.grok.cancel(thread.id).catch(() => undefined);
                  }
                  await window.grok.removeThread(thread.id, thread.cwd);
                  clearStoredPlanFlow(thread.id);
                }),
              );
              setUnreadIds((current) => {
                const next = new Set(current);
                removedIds.forEach((id) => next.delete(id));
                return next;
              });
              setRunningIds((current) => {
                const next = new Set(current);
                removedIds.forEach((id) => next.delete(id));
                return next;
              });
              if (active && removedIds.has(active.sessionId)) {
                setActive(null);
                setItems([]);
                setContextUsed(null);
                setContextUsage(null);
                setPlanDocument(null);
                setPlanPanel(null);
              }
              await refresh();
            })().catch((err) => {
              setError(`无法移除全部聊天：${err instanceof Error ? err.message : String(err)}`);
              void refresh();
            });
          }}
          onOpenProjectFolder={(project) => {
            void window.grok.openPath(project.cwd);
          }}
          onRenameThread={(thread, title) => {
            void window.grok.renameThread(thread.id, thread.cwd, title).then(() => {
              void refresh();
            });
          }}
          onForkThread={(thread) => void forkThread(thread)}
          onRemoveThread={(thread) => {
            if (!window.confirm(`移除会话「${thread.title}」？`)) return;
            void window.grok.removeThread(thread.id, thread.cwd).then(async () => {
              setUnreadIds((current) =>
                updateUnreadSessionIds(current, { sessionId: thread.id, unread: false }),
              );
              clearStoredPlanFlow(thread.id);
              if (active?.sessionId === thread.id) {
                setActive(null);
                setItems([]);
                setContextUsed(null);
                setContextUsage(null);
                setPlanPanel(null);
              }
              await refresh();
            });
          }}
        />
        <ResizeHandle
          onDragStart={() => {
            sidebarDragOrigin.current = sidebarCol;
          }}
          onDrag={(delta) => {
            setSidebarWidth(
              fitSidebar(
                window.innerWidth,
                sidebarDragOrigin.current + delta,
                rightSidebarOpen ? HANDLE + RIGHT_SIDEBAR_MIN : 0,
              ),
            );
          }}
        />
        <section className={`main${page === "chat" && items.length === 0 ? " landing" : ""}`}>
          {page === "marketplace" ? (
            <MarketplacePage
              settings={settings}
              cwd={active?.cwd || selectedProjectCwd}
              onChange={setSettings}
            />
          ) : null}
          {page === "automation" ? (
            <AutomationPage
              cwd={active?.cwd || selectedProjectCwd}
              projects={projects}
              onOpenSession={(sessionId, sessionCwd) => {
                const thread = threads.find((item) => item.id === sessionId);
                if (thread) void selectThread(thread);
                else {
                  setPage("chat");
                  setPlanDocument(null);
                  setPlanPanel(null);
                  const unattached = !sessionCwd;
                  const nextActive: Active = {
                    sessionId,
                    cwd: sessionCwd,
                    projectCwd: unattached ? "" : sessionCwd,
                    unattached,
                  };
                  setActive(nextActive);
                  const viewVersion = activeViewVersionRef.current;
                  setItems([]);
                  setContextUsed(null);
                  setContextUsage(null);
                  if (unattached) setSelectedProjectCwd(null);
                  else setSelectedProjectCwd(sessionCwd);
                  void window.grok.loadTranscript(sessionId, sessionCwd).then((transcript) => {
                    if (
                      activeViewVersionRef.current !== viewVersion ||
                      activeRef.current?.sessionId !== sessionId
                    ) return;
                    setItems(transcript.items);
                    setContextUsed(transcript.contextUsed);
                    setContextUsage(transcript.contextUsage);
                    const storedPlan = readStoredPlanFlow(sessionId);
                    const restoredPlan = storedPlan
                      ? restorePlanFlow(storedPlan, transcript.items)
                      : transcript.planAwaiting
                        ? recoverAwaitingPlanFlow(sessionId, transcript.items)
                        : null;
                    setPlanPanel(restoredPlan);
                    if (restoredPlan) {
                      writeStoredPlanFlow(restoredPlan);
                      const key = `session:${sessionId}`;
                      setComposerStates((cur) => ({
                        ...cur,
                        [key]: { ...(cur[key] ?? EMPTY_COMPOSER_STATE), planMode: true },
                      }));
                    }
                  }).catch(() => undefined);
                }
              }}
            />
          ) : null}
          {page === "chat" ? (
            <>
          <MessageStream
            items={items}
            busy={sessionBusy}
            sessionId={active?.sessionId}
            cwd={active?.cwd}
            error={error}
            onRetryError={
              failedPromptRef.current?.sessionId === active?.sessionId
                ? () => void retryFailedPrompt()
                : undefined
            }
            onDismissError={() => {
              failedPromptRef.current = null;
              setError(null);
            }}
            onOpenFile={(filePath) => {
              setPlanDocument(null);
              setReviewOpen(false);
              setPreviewFilePath(filePath.replace(/\\/g, "/"));
              if (gitCwd) void window.grok.gitStatus(gitCwd).then(setGit);
            }}
            onOpenAttachment={(filePath) => void window.grok.openPath(filePath)}
            emptyTitle={
              active
                ? "新会话"
                : selectedProject
                  ? selectedProject.name
                  : "开始对话"
            }
            planConsole={
              activePlan
                ? {
                    activity: activePlanActivity,
                    phase: activePlan.phase,
                    revision: activePlanRevisions.at(-1) ?? null,
                    question: activePlanQuestion,
                    error: activePlan.error,
                    busy: planFlowBusy(activePlan.phase),
                    onApprove: (revision) => void approvePlan(revision),
                    onReject: rejectPlan,
                    onRetry: () => void retryPlan(),
                    onReload: () => void reloadPlanDocument(),
                  }
                : undefined
            }
            onOpenPlan={(revision) => {
              setReviewOpen(false);
              setPreviewFilePath(null);
              setPlanDocument(revision);
            }}
          />
          <Composer
            value={draft}
            busy={sessionBusy}
            disabled={false}
            worktree={envIsWorktree}
            canChooseEnv={!active && Boolean(selectedProject)}
            showWorktree={Boolean(selectedProject) && !unattachedActive}
            showGoal={Boolean(selectedProject) && !unattachedActive}
            planMode={planMode}
            goal={goal}
            attachments={attachments}
            queuedFollowUps={activeFollowUps}
            settings={settings}
            contextUsed={contextUsed}
            contextUsage={contextUsage}
            permission={activePermission}
            awaitingAnswer={activePlan?.phase === "discussing"}
            onChange={setDraft}
            onEnvChange={setWorktreeMode}
            onPlanMode={changePlanMode}
            onGoal={(text) => {
              setGoal(text);
              const cwd = selectedProjectCwd;
              if (cwd) void window.grok.setGoal(cwd, text);
            }}
            onAttachments={setAttachments}
            onRemoveFollowUp={(entryId) => {
              if (!active?.sessionId) return;
              void window.grok.removeFollowUp(active.sessionId, entryId);
            }}
            onPermissionMode={(mode: PermissionMode) => {
              void window.grok.setPermission(mode).then(setSettings);
            }}
            onModel={(id) => {
              void window.grok.setModel(id).then(setSettings);
            }}
            onReasoningEffort={(effort) => {
              setSettings((cur) => (cur ? { ...cur, reasoningEffort: effort } : cur));
              void window.grok.setReasoningEffort(effort).then(setSettings);
            }}
            onSend={() => {
              void send().catch((err) => {
                sendingRef.current.delete(composerKey);
                setError(`发送失败：${err instanceof Error ? err.message : String(err)}`);
              });
            }}
            onStop={stop}
            onPermission={(optionId) => {
              if (!activePermission) return;
              void window.grok.respondPermission(activePermission.requestId, optionId);
              setPermissionsBySession((current) => {
                if (!active?.sessionId || !current[active.sessionId]) return current;
                const next = { ...current };
                delete next[active.sessionId];
                return next;
              });
            }}
            onNewChat={() => beginComposer(null)}
            onOpenSettings={() => {
              setSettingsOpen(true);
              void window.grok.settings(active?.cwd || selectedProjectCwd).then(setSettings);
            }}
            projects={projects}
            selectedProject={unattachedActive ? null : selectedProject}
            git={unattachedActive ? null : git}
            onSelectProject={(project) => {
              beginComposer(project?.cwd ?? null, worktreeMode, false);
            }}
            onPickProject={() => void openProject()}
            showProjectPicker={items.length === 0 && (!active?.sessionId || Boolean(active.pending))}
          />
          <TerminalPanel
            open={terminalOpen}
            cwd={active?.cwd || selectedProjectCwd}
            onClose={() => setTerminalOpen(false)}
          />
            </>
          ) : null}
        </section>
        {rightSidebarOpen ? (
          <>
            <ResizeHandle
              label="调整右侧栏宽度"
              onDragStart={() => {
                rightSidebarDragOrigin.current = rightSidebarCol;
              }}
              onDrag={(delta) => {
                setRightSidebarWidth(
                  fitRightSidebar(
                    window.innerWidth,
                    sidebarCol,
                    rightSidebarDragOrigin.current - delta,
                  ),
                );
              }}
            />
            {planSidebarOpen && planDocument ? (
              <PlanSidebar
                plan={planDocument}
                phase={displayedPlanIsCurrent ? activePlan?.phase : undefined}
                sessionId={active?.sessionId}
                cwd={active?.cwd}
                canExecute={Boolean(
                  displayedPlanIsCurrent &&
                    activePlan &&
                    latestActivePlanRevision &&
                    latestActivePlanRevision.entries.length > 0 &&
                    !planFlowBusy(activePlan.phase) &&
                    activePlan.phase !== "executing",
                )}
                busy={Boolean(activePlan && planFlowBusy(activePlan.phase))}
                onClose={() => setPlanDocument(null)}
                onExecute={() => {
                  if (latestActivePlanRevision) void approvePlan(latestActivePlanRevision);
                }}
              />
            ) : fileSidebarOpen && previewFilePath && filePreviewCwd ? (
              <FilePreviewPanel
                cwd={filePreviewCwd}
                filePath={previewFilePath}
                onClose={() => setPreviewFilePath(null)}
                onOpenEditor={() => void window.grok.openInEditor(filePreviewCwd, previewFilePath)}
              />
            ) : (
              <DiffPanel
                git={git}
                cwd={gitCwd}
                open
                selectedPath={selectedDiffFile}
                onSelectFile={setSelectedDiffFile}
                onToggle={() => setReviewOpen(false)}
                onOpenEditor={(filePath) => {
                  if (gitCwd) void window.grok.openInEditor(gitCwd, filePath);
                }}
                onRefresh={() => {
                  if (gitCwd) void window.grok.gitStatus(gitCwd).then(setGit);
                }}
                onError={setError}
                canApply={Boolean(git?.isWorktree && git.mainRoot)}
                onApply={
                  git?.isWorktree && git.mainRoot && active
                    ? () => {
                        void window.grok.applyWorktree(active.cwd, git.mainRoot!).then(() =>
                          window.grok.gitStatus(active.cwd).then(setGit),
                        );
                      }
                    : undefined
                }
              />
            )}
          </>
        ) : null}
      </div>
      {statusCardVisible ? (
        <StatusCard
          key={active?.sessionId ?? `project:${gitCwd || "none"}`}
          scopeId={active?.sessionId ?? `project:${gitCwd || "none"}`}
          git={unattachedActive ? null : git}
          cwd={gitCwd}
          unattached={unattachedActive}
          items={items}
          onOpenChanges={() => {
            setPlanDocument(null);
            setPreviewFilePath(null);
            setReviewOpen(true);
            setSelectedDiffFile((cur) => cur || git?.files[0]?.path || null);
          }}
          onRefresh={() => {
            if (gitCwd) void window.grok.gitStatus(gitCwd).then(setGit);
          }}
          onError={setError}
          onOpenEditor={() => {
            if (gitCwd) void window.grok.openInEditor(gitCwd);
          }}
          onOpenFolder={() => {
            if (gitCwd) void window.grok.openPath(gitCwd);
          }}
          canApply={Boolean(git?.isWorktree && git.mainRoot)}
          onApply={
            git?.isWorktree && git.mainRoot && active
              ? () => {
                  void window.grok.applyWorktree(active.cwd, git.mainRoot!).then(() =>
                    window.grok.gitStatus(active.cwd).then(setGit),
                  );
                }
              : undefined
          }
          permission={activePermission}
        />
      ) : null}
      <Settings
        open={settingsOpen}
        settings={settings}
        cwd={active?.cwd || selectedProjectCwd}
        onClose={() => setSettingsOpen(false)}
        onChange={setSettings}
      />
    </div>
  );
}
