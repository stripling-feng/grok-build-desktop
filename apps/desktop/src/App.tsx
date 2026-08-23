import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { DiffPanel } from "./components/DiffPanel";
import { MessageStream } from "./components/MessageStream";
import { StatusCard } from "./components/StatusCard";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { AutomationPage, MarketplacePage, type WorkspacePage } from "./components/WorkspacePages";
import { TerminalPanel } from "./components/TerminalPanel";
import { TitleBar } from "./components/TitleBar";
import { PlanPanel } from "./components/PlanPanel";
import grokLogo from "./assets/grok-logo.jpg";
import { applyLiveUpdate, stampTurnDuration, stripEphemeral, planRevisions } from "./lib/stream";
import { extractContextUsage, mergeContextUsage } from "../electron/shared";
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

type Active = {
  sessionId: string;
  cwd: string;
  title: string;
  projectCwd: string;
  unattached?: boolean;
  pending?: boolean;
};

function isUnattached(thread: { projectCwd?: string; unattached?: boolean }) {
  return Boolean(thread.unattached && !thread.projectCwd);
}

function samePath(a: string, b: string) {
  return a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
}

const SIDEBAR_MIN = 180;
const MAIN_MIN = 280;
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

function fitSidebar(winW: number, sidebar: number) {
  const maxSidebar = Math.max(SIDEBAR_MIN, winW - HANDLE - MAIN_MIN);
  return clamp(sidebar, SIDEBAR_MIN, maxSidebar);
}

function ResizeHandle({
  onDragStart,
  onDrag,
}: {
  onDragStart: () => void;
  onDrag: (delta: number) => void;
}) {
  const startX = useRef<number | null>(null);
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
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
  const [active, setActive] = useState<Active | null>(null);
  const [items, setItems] = useState<StreamItem[]>([]);
  const [contextUsed, setContextUsed] = useState<number | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [draft, setDraft] = useState("");
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [worktreeMode, setWorktreeMode] = useState(false);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [page, setPage] = useState<WorkspacePage>("chat");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [installHint, setInstallHint] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installLogs, setInstallLogs] = useState<{ ts: number; text: string; tone: "info" | "ok" | "warn" | "error" }[]>([]);
  const installLogRef = useRef<HTMLDivElement | null>(null);
  const [planMode, setPlanMode] = useState(false);
  const [goal, setGoal] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readWidth("grok.sidebarWidth", 252, SIDEBAR_MIN),
  );
  const [winW, setWinW] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const [planPanel, setPlanPanel] = useState<{
    open: boolean;
    pendingPrompt: string;
    pendingImages: { path: string; mimeType: string }[];
    sessionId: string;
  } | null>(null);
  const sendingRef = useRef(false);
  const pendingThreadRef = useRef<Promise<Active | null> | null>(null);
  const restoredRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const sidebarDragOrigin = useRef(sidebarWidth);
  const unattachedActive = Boolean(active && isUnattached(active));
  const gitCwd = unattachedActive ? null : active?.cwd || selectedProjectCwd;

  const refresh = useCallback(async () => {
    const [p, t] = await Promise.all([window.grok.listProjects(), window.grok.listThreads()]);
    setProjects(p);
    setThreads(t);
    setActive((cur) => {
      if (!cur) return cur;
      const next = t.find((thread) => thread.id === cur.sessionId);
      if (!next || next.title === cur.title) return cur;
      return { ...cur, title: next.title };
    });
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
    const offUpdate = window.grok.onUpdate((payload) => {
      const usage = extractContextUsage(payload.update, payload.meta);
      if (usage && active?.sessionId === payload.sessionId) {
        setContextUsage((prev) => mergeContextUsage(prev, usage));
        if (usage.used != null) setContextUsed(usage.used);
      }
      const kind = String(payload.update?.sessionUpdate ?? "");
      if (kind === "turn_completed") {
        setRunningIds((s) => {
          const n = new Set(s);
          n.delete(payload.sessionId);
          return n;
        });
        if (active?.sessionId === payload.sessionId) {
          setItems((prev) => stampTurnDuration(stripEphemeral(prev)));
          if (!isUnattached(active)) void window.grok.gitStatus(active.cwd).then(setGit);
          void window.grok.loadTranscript(active.sessionId, active.cwd).then((transcript) => {
            setContextUsed(transcript.contextUsed);
            setContextUsage(transcript.contextUsage);
          }).catch(() => undefined);
        }
        void refresh();
        return;
      }
      if (active?.sessionId === payload.sessionId) {
        setItems((prev) => applyLiveUpdate(prev, payload.update));
        const status = String(payload.update.status ?? "");
        const toolKind = String(payload.update.kind ?? payload.update.toolKind ?? "");
        if (!isUnattached(active)) {
          if (
            payload.update.sessionUpdate === "tool_call_update" &&
            /complet|success/i.test(status)
          ) {
            void window.grok.gitStatus(active.cwd).then(setGit);
          }
          if (toolKind === "edit" || toolKind === "write") {
            void window.grok.gitStatus(active.cwd).then(setGit);
          }
        }
      }
    });
    const offPerm = window.grok.onPermission((p) => setPermission(p));
    const offStatus = window.grok.onAgentStatus(() => {
      /* connected flag is informational */
    });
    return () => {
      offUpdate();
      offPerm();
      offStatus();
    };
  }, [active, refresh]);

  const selectThread = useCallback(async (thread: ThreadInfo) => {
    setError(null);
    const unattached = isUnattached(thread);
    setPage("chat");
    setSelectedProjectCwd(unattached ? null : thread.projectCwd);
    setActive({
      sessionId: thread.id,
      cwd: thread.cwd,
      title: thread.title,
      projectCwd: unattached ? "" : thread.projectCwd,
      unattached,
    });
    const transcript = await window.grok.loadTranscript(thread.id, thread.cwd);
    setItems(transcript.items);
    setContextUsed(transcript.contextUsed);
    setContextUsage(transcript.contextUsage);
    try {
      await window.grok.resumeThread(thread.id, thread.cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setWorktreeMode(Boolean(thread.worktree));
    setSelectedDiffFile(null);
    setReviewOpen(false);
    if (unattached) setGit(null);
    else void window.grok.gitStatus(thread.cwd).then(setGit);
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
        await selectThread(thread);
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
      pendingThreadRef.current = null;
      setError(null);
      setPage("chat");
      const unattached = !cwd;
      setSelectedProjectCwd(unattached ? null : cwd);
      setWorktreeMode(Boolean(cwd) && worktree);
      setItems([]);
      setContextUsed(null);
      setContextUsage(null);
      if (resetDraft) {
        setDraft("");
        setAttachments([]);
      }
      setSelectedDiffFile(null);
      setReviewOpen(false);
      if (unattached) setGit(null);
      else if (cwd) void window.grok.gitStatus(cwd).then(setGit);
      setActive({
        sessionId: "",
        cwd: cwd || "",
        title: "新会话",
        projectCwd: cwd || "",
        unattached,
        pending: true,
      });
    },
    [],
  );

  const openProject = useCallback(async () => {
    const project = await window.grok.addProject();
    if (!project) return;
    beginComposer(project.cwd, worktreeMode, false);
    await refresh();
  }, [beginComposer, refresh, worktreeMode]);

  const createThread = useCallback(
    async (cwd?: string | null, worktree = false) => {
      const task = (async (): Promise<Active | null> => {
        const created = await window.grok.newThread(cwd || null, Boolean(cwd) && worktree);
        const nextUnattached = Boolean(created.unattached || !created.projectCwd);
        const next: Active = {
          sessionId: created.sessionId,
          cwd: created.cwd,
          title: created.title,
          projectCwd: nextUnattached ? "" : created.projectCwd,
          unattached: nextUnattached,
        };
        setSelectedProjectCwd(nextUnattached ? null : created.projectCwd);
        setWorktreeMode(Boolean(created.worktree));
        setActive(next);
        void refresh();
        if (nextUnattached) setGit(null);
        else void window.grok.gitStatus(created.cwd).then(setGit);
        return next;
      })();
      pendingThreadRef.current = task;
      try {
        return await task;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        if (pendingThreadRef.current === task) pendingThreadRef.current = null;
      }
    },
    [refresh],
  );

  const forkThread = useCallback(
    async (thread: ThreadInfo) => {
      if (!thread.id) {
        setError("会话还没创建完成");
        return;
      }
      setError(null);
      try {
        const created = await window.grok.forkThread(thread.id, thread.cwd);
        setPage("chat");
        const nextUnattached = Boolean(created.unattached || !created.projectCwd);
        setSelectedProjectCwd(nextUnattached ? null : created.projectCwd);
        setWorktreeMode(Boolean(created.worktree));
        setActive({
          sessionId: created.sessionId,
          cwd: created.cwd,
          title: created.title,
          projectCwd: nextUnattached ? "" : created.projectCwd,
          unattached: nextUnattached,
        });
        const transcript = await window.grok.loadTranscript(created.sessionId, created.cwd);
        setItems(transcript.items);
        setContextUsed(transcript.contextUsed);
        setContextUsage(transcript.contextUsage);
        setSelectedDiffFile(null);
        if (nextUnattached) setGit(null);
        else void window.grok.gitStatus(created.cwd).then(setGit);
        void refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
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
    if (sendingRef.current) return;
    if ((!draft.trim() && !attachments.length) || (active && runningIds.has(active.sessionId))) return;
    const text = draft.trim();
    sendingRef.current = true;
    const attached = attachments;
    let session = active && !active.pending && active.sessionId ? active : null;
    if (!session?.sessionId) {
      const cwd = selectedProjectCwd;
      setError(null);
      try {
        session = await createThread(cwd, Boolean(cwd) && worktreeMode);
      } catch (err) {
        sendingRef.current = false;
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    if (!session?.sessionId) {
      sendingRef.current = false;
      return;
    }
    const imageExt = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
    const imageFiles = attached.filter((p) => imageExt.test(p));
    const otherFiles = attached.filter((p) => !imageExt.test(p));
    let payload = text;
    if (otherFiles.length) {
      payload += `${payload ? "\n\n" : ""}请同时参考这些路径：\n` + otherFiles.map((p) => `- @${p}`).join("\n");
    }
    const mediaCmd = payload.match(/^\/imagine(-video)?(?:\s+|$)([\s\S]*)/i);
    if (mediaCmd && !mediaCmd[2].trim()) {
      sendingRef.current = false;
      setError(mediaCmd[1] ? "请先写视频描述，例如 /imagine-video 一只猫在弹钢琴" : "请先写图片描述，例如 /imagine 海边日落");
      return;
    }
    setDraft("");
    setAttachments([]);
    setRunningIds((s) => new Set(s).add(session.sessionId));
    if (mediaCmd) {
      const kind = mediaCmd[1] ? "video" : "image";
      const prompt = mediaCmd[2].trim();
      const startedAt = Date.now();
      setItems((prev) => [
        ...prev,
        { kind: "user", text: payload, startedAt },
        { kind: "media", mediaKind: kind, prompt, urls: [], status: "pending" },
      ]);
      try {
        const result = await window.grok.generateMedia(kind, prompt);
        setItems((prev) => {
          const next = prev.slice();
          for (let i = next.length - 1; i >= 0; i--) {
            const item = next[i];
            if (item.kind === "media" && item.status === "pending") {
              next[i] = {
                kind: "media",
                mediaKind: result.kind,
                prompt: result.prompt,
                urls: result.urls,
                via: result.via,
                status: "done",
              };
              break;
            }
          }
          return stampTurnDuration(next);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "OAUTH_VIA_ACP") {
          setItems((prev) => prev.filter((item) => !(item.kind === "media" && item.status === "pending")));
          try {
            await window.grok.sendPrompt(session.sessionId, payload);
          } catch (oauthErr) {
            setError(oauthErr instanceof Error ? oauthErr.message : String(oauthErr));
          }
        } else {
          setError(message);
          setItems((prev) =>
            prev.map((item) =>
              item.kind === "media" && item.status === "pending"
                ? { ...item, status: "error", error: message }
                : item,
            ),
          );
        }
      } finally {
        sendingRef.current = false;
        setItems((prev) => stampTurnDuration(prev));
        setRunningIds((s) => {
          const n = new Set(s);
          n.delete(session.sessionId);
          return n;
        });
        void refresh();
      }
      return;
    }
    if (planMode) {
      try {
        await window.grok.setMode(session.sessionId, "plan");
      } catch {
        /* fall through: agent should still respond in plan-like manner */
      }
      const userText = payload || (imageFiles.length ? `图片 ×${imageFiles.length}` : "");
      setItems((prev) => [...prev, { kind: "user", text: userText, startedAt: Date.now() }]);
      setPlanPanel({
        open: true,
        pendingPrompt: payload,
        pendingImages: imageFiles.map((p) => ({
          path: p,
          mimeType: /\.jpe?g$/i.test(p)
            ? "image/jpeg"
            : /\.gif$/i.test(p)
              ? "image/gif"
              : /\.webp$/i.test(p)
                ? "image/webp"
                : "image/png",
        })),
        sessionId: session.sessionId,
      });
      setRunningIds((s) => new Set(s).add(session.sessionId));
      try {
        await window.grok.sendPrompt(
          session.sessionId,
          payload,
          imageFiles.map((p) => ({
            path: p,
            mimeType: /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.gif$/i.test(p) ? "image/gif" : /\.webp$/i.test(p) ? "image/webp" : "image/png",
          })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPlanPanel(null);
        setRunningIds((s) => {
          const n = new Set(s);
          n.delete(session.sessionId);
          return n;
        });
      } finally {
        sendingRef.current = false;
      }
      return;
    }
  }, [active, attachments, draft, createThread, planMode, refresh, runningIds, selectedProjectCwd, worktreeMode]);

  const approvePlan = useCallback(async () => {
    if (!planPanel) return;
    const { pendingPrompt, pendingImages, sessionId } = planPanel;
    setPlanPanel(null);
    setItems((prev) =>
      prev.map((it) => {
        if (it.kind !== "plan") return it;
        return {
          ...it,
          entries: it.entries.map((e) => ({
            content: e.content,
            status: "done" as const,
          })),
        };
      }),
    );
    try {
      await window.grok.setMode(sessionId, "act");
    } catch {
      /* best effort */
    }
    setRunningIds((s) => new Set(s).add(sessionId));
    try {
      await window.grok.sendPrompt(sessionId, pendingPrompt, pendingImages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunningIds((s) => {
        const n = new Set(s);
        n.delete(sessionId);
        return n;
      });
    }
  }, [planPanel]);

  const rejectPlan = useCallback(() => {
    if (!planPanel) return;
    void window.grok.cancel(planPanel.sessionId);
    setRunningIds((s) => {
      const n = new Set(s);
      n.delete(planPanel.sessionId);
      return n;
    });
    setPlanPanel(null);
    setItems((prev) =>
      prev.map((it) => {
        if (it.kind !== "plan") return it;
        return {
          ...it,
          entries: it.entries.map((e) => ({
            content: e.content,
            status: "cancelled" as const,
          })),
        };
      }),
    );
  }, [planPanel]);

  const revisePlan = useCallback(
    (note: string) => {
      if (!planPanel || !note.trim()) return;
      const sid = planPanel.sessionId;
      setItems((prev) => [
        ...prev,
        { kind: "user", text: `[计划修订] ${note.trim()}`, startedAt: Date.now() },
      ]);
      void window.grok.sendPrompt(sid, `按以下调整重新计划：\n${note.trim()}`);
    },
    [planPanel],
  );

  const stop = useCallback(() => {
    if (!active) return;
    void window.grok.cancel(active.sessionId);
    setItems((prev) => stampTurnDuration(stripEphemeral(prev)));
    setRunningIds((s) => {
      const n = new Set(s);
      n.delete(active.sessionId);
      return n;
    });
  }, [active]);

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
  const envIsWorktree = active ? isWorktree : Boolean(selectedProject) && worktreeMode;
  const showProjectChrome = Boolean(selectedProject && !unattachedActive);
  const sidebarCol = fitSidebar(winW, sidebarWidth);
  const hasRunning = runningIds.size > 0;
  const hasPermission = permission != null;
  const hasError = error != null;
  const hasGitChanges = Boolean(!unattachedActive && git?.isRepo && git.files.length > 0);
  const statusCardVisible =
    page === "chat" && (hasRunning || hasPermission || hasError || hasGitChanges);

  return (
    <div className="app">
      <TitleBar
        subtitle={active?.title}
        onTerminal={() => setTerminalOpen((v) => !v)}
        terminalActive={terminalOpen}
      />
      <div
        className="shell"
        style={{
          gridTemplateColumns: `${sidebarCol}px ${HANDLE}px minmax(0, 1fr)`,
        }}
      >
        <Sidebar
          projects={projects}
          threads={threads}
          selectedProjectCwd={selectedProjectCwd}
          activeId={active?.sessionId ?? null}
          runningIds={runningIds}
          grokLabel={grokLabel}
          account={account}
          onAccountChange={setAccount}
          onOpenProject={() => void openProject()}
          onNewChat={() => beginComposer(null)}
          page={page}
          onOpenMarketplace={() => {
            setPage("marketplace");
            void window.grok.settings(active?.cwd || selectedProjectCwd).then(setSettings);
          }}
          onOpenAutomation={() => {
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
                }
                if (next) void window.grok.gitStatus(next).then(setGit);
                else setGit(null);
              }
              await refresh();
            });
          }}
          onOpenProjectFolder={(project) => {
            void window.grok.openPath(project.cwd);
          }}
          onRenameThread={(thread, title) => {
            void window.grok.renameThread(thread.id, thread.cwd, title).then((next) => {
              setActive((cur) =>
                cur && cur.sessionId === next.id ? { ...cur, title: next.title } : cur,
              );
              void refresh();
            });
          }}
          onForkThread={(thread) => void forkThread(thread)}
          onRemoveThread={(thread) => {
            if (!window.confirm(`移除会话「${thread.title}」？`)) return;
            void window.grok.removeThread(thread.id, thread.cwd).then(async () => {
              if (active?.sessionId === thread.id) {
                setActive(null);
                setItems([]);
                setContextUsed(null);
                setContextUsage(null);
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
            setSidebarWidth(fitSidebar(window.innerWidth, sidebarDragOrigin.current + delta));
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
              onCreateViaChat={(prompt) => {
                beginComposer(selectedProjectCwd, Boolean(selectedProjectCwd) && worktreeMode);
                setDraft(prompt);
              }}
              onOpenSession={(sessionId, sessionCwd) => {
                const thread = threads.find((item) => item.id === sessionId);
                if (thread) void selectThread(thread);
                else {
                  setPage("chat");
                  const unattached = !sessionCwd;
                  setActive({
                    sessionId,
                    cwd: sessionCwd,
                    title: "定时任务",
                    projectCwd: unattached ? "" : sessionCwd,
                    unattached,
                  });
                  if (unattached) setSelectedProjectCwd(null);
                  else setSelectedProjectCwd(sessionCwd);
                  void window.grok.loadTranscript(sessionId, sessionCwd).then((transcript) => {
                    setItems(transcript.items);
                    setContextUsed(transcript.contextUsed);
                    setContextUsage(transcript.contextUsage);
                  }).catch(() => undefined);
                }
              }}
            />
          ) : null}
          {page === "chat" ? (
            <>
          {error ? (
            <div className="permission" style={{ margin: "10px 20px 0" }}>
              <p>{error}</p>
            </div>
          ) : null}
          <MessageStream
            items={items}
            busy={sessionBusy}
            onOpenFile={(filePath) => {
              setReviewOpen(true);
              setSelectedDiffFile(filePath.replace(/\\/g, "/"));
              if (gitCwd) void window.grok.gitStatus(gitCwd).then(setGit);
            }}
            emptyTitle={
              active
                ? "新会话"
                : selectedProject
                  ? selectedProject.name
                  : "开始对话"
            }
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
            settings={settings}
            contextUsed={contextUsed}
            contextUsage={contextUsage}
            permission={permission}
            onChange={setDraft}
            onEnvChange={setWorktreeMode}
            onPlanMode={setPlanMode}
            onGoal={(text) => {
              setGoal(text);
              const cwd = selectedProjectCwd;
              if (cwd) void window.grok.setGoal(cwd, text);
            }}
            onAttachments={setAttachments}
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
            onSend={() => void send()}
            onStop={stop}
            onPermission={(optionId) => {
              if (!permission) return;
              void window.grok.respondPermission(permission.requestId, optionId);
              setPermission(null);
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
          <PlanPanel
            open={Boolean(planPanel?.open)}
            revisions={planRevisions(items)}
            busy={planPanel ? runningIds.has(planPanel.sessionId) : false}
            onApprove={() => void approvePlan()}
            onReject={rejectPlan}
            onRevise={revisePlan}
            onClose={() => setPlanPanel((p) => (p ? { ...p, open: false } : p))}
          />
            </>
          ) : null}
        </section>
      </div>
      {statusCardVisible ? (
        <StatusCard
          git={unattachedActive ? null : git}
          cwd={gitCwd}
          unattached={unattachedActive}
          items={items}
          onOpenChanges={() => {
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
        />
      ) : null}
      {reviewOpen && showProjectChrome ? (
        <div className="review-overlay" role="dialog" aria-label="审阅更改">
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
        </div>
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
