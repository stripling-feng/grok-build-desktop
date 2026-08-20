import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { DiffPanel } from "./components/DiffPanel";
import { MessageStream } from "./components/MessageStream";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { TerminalPanel } from "./components/TerminalPanel";
import { TitleBar } from "./components/TitleBar";
import { applyLiveUpdate, stripEphemeral } from "./lib/stream";
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

type Active = { sessionId: string; cwd: string; title: string; projectCwd: string };

export function App() {
  const [status, setStatus] = useState<GrokStatus | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [selectedProjectCwd, setSelectedProjectCwd] = useState<string | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [items, setItems] = useState<StreamItem[]>([]);
  const [draft, setDraft] = useState("");
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [worktreeMode, setWorktreeMode] = useState(false);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [installHint, setInstallHint] = useState("");
  const [planMode, setPlanMode] = useState(false);
  const [goal, setGoal] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const sendingRef = useRef(false);

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
    void refresh();
    void window.grok.settings().then(setSettings);
  }, [refresh]);

  useEffect(() => {
    const cwd = selectedProjectCwd;
    if (!cwd) {
      setGoal("");
      return;
    }
    void window.grok.getGoal(cwd).then(setGoal);
  }, [selectedProjectCwd]);

  useEffect(() => {
    if (!selectedProjectCwd && projects[0]) setSelectedProjectCwd(projects[0].cwd);
  }, [projects, selectedProjectCwd]);

  useEffect(() => {
    const offUpdate = window.grok.onUpdate((payload) => {
      const kind = String(payload.update?.sessionUpdate ?? "");
      if (kind === "turn_completed") {
        setRunningIds((s) => {
          const n = new Set(s);
          n.delete(payload.sessionId);
          return n;
        });
        if (active?.sessionId === payload.sessionId) {
          setItems((prev) => stripEphemeral(prev));
          void window.grok.gitStatus(active.cwd).then(setGit);
        }
        void refresh();
        return;
      }
      if (active?.sessionId === payload.sessionId) {
        setItems((prev) => applyLiveUpdate(prev, payload.update));
        const status = String(payload.update.status ?? "");
        const toolKind = String(payload.update.kind ?? payload.update.toolKind ?? "");
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
    setSelectedProjectCwd(thread.projectCwd);
    setActive({
      sessionId: thread.id,
      cwd: thread.cwd,
      title: thread.title,
      projectCwd: thread.projectCwd,
    });
    const transcript = await window.grok.loadTranscript(thread.id, thread.cwd);
    setItems(transcript);
    try {
      await window.grok.resumeThread(thread.id, thread.cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setWorktreeMode(Boolean(thread.worktree));
    setSelectedDiffFile(null);
    void window.grok.gitStatus(thread.cwd).then(setGit);
  }, []);

  const openProject = useCallback(async () => {
    const project = await window.grok.addProject();
    if (!project) return;
    setSelectedProjectCwd(project.cwd);
    setActive(null);
    setItems([]);
    await refresh();
  }, [refresh]);

  const newThread = useCallback(
    async (cwd: string, worktree: boolean) => {
      setError(null);
      try {
        const created = await window.grok.newThread(cwd, worktree);
        setSelectedProjectCwd(created.projectCwd);
        setWorktreeMode(Boolean(created.worktree));
        setActive({
          sessionId: created.sessionId,
          cwd: created.cwd,
          title: created.title,
          projectCwd: created.projectCwd,
        });
        setItems([]);
        setDraft("");
        await refresh();
        void window.grok.gitStatus(created.cwd).then(setGit);
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
        const cwd = selectedProjectCwd || active?.projectCwd || projects[0]?.cwd;
        if (cwd) void newThread(cwd, e.shiftKey || worktreeMode);
        else void openProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, selectedProjectCwd, projects, newThread, openProject, worktreeMode]);

  const send = useCallback(async () => {
    if (sendingRef.current) return;
    if (!draft.trim() || (active && runningIds.has(active.sessionId))) return;
    const text = draft.trim();
    sendingRef.current = true;
    const attached = attachments;
    let session = active;
    if (!session) {
      const cwd = selectedProjectCwd || projects[0]?.cwd;
      if (!cwd) {
        sendingRef.current = false;
        return;
      }
      setError(null);
      try {
        const created = await window.grok.newThread(cwd, worktreeMode);
        session = {
          sessionId: created.sessionId,
          cwd: created.cwd,
          title: created.title,
          projectCwd: created.projectCwd,
        };
        setSelectedProjectCwd(created.projectCwd);
        setActive(session);
        await refresh();
      } catch (err) {
        sendingRef.current = false;
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    setDraft("");
    setAttachments([]);
    setRunningIds((s) => new Set(s).add(session.sessionId));
    let payload = text;
    if (attached.length) {
      payload += "\n\n请同时参考这些路径：\n" + attached.map((p) => `- @${p}`).join("\n");
    }
    if (planMode) {
      try {
        await window.grok.setMode(session.sessionId, "plan");
      } catch {
        payload = `/plan ${payload}`;
      }
    }
    setItems((prev) => [...prev, { kind: "user", text: payload }]);
    try {
      await window.grok.sendPrompt(session.sessionId, payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      sendingRef.current = false;
      setItems((prev) => stripEphemeral(prev));
      setRunningIds((s) => {
        const n = new Set(s);
        n.delete(session.sessionId);
        return n;
      });
      void refresh();
      void window.grok.gitStatus(session.cwd).then(setGit);
    }
  }, [active, attachments, draft, planMode, projects, refresh, runningIds, selectedProjectCwd, worktreeMode]);

  const stop = useCallback(() => {
    if (!active) return;
    void window.grok.cancel(active.sessionId);
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
    return (
      <div className="app">
        <TitleBar />
        <div className="setup">
          <div className="setup-card">
            <h2>请先安装 Grok CLI</h2>
            <p>
              桌面端只是界面，智能层用本机 <code>grok</code>。检测到未安装或无法运行。
            </p>
            <pre>irm https://x.ai/cli/install.ps1 | iex{"\n"}grok --version</pre>
            <p>{status.error}</p>
            {installHint ? <p>{installHint}</p> : null}
            <div className="setup-actions">
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  setInstallHint("已启动官方安装脚本，完成后点「重新检测」。");
                  void window.grok.runInstall();
                }}
              >
                运行安装脚本
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

  const selectedProject = projects.find((p) => p.cwd === selectedProjectCwd) ?? null;
  const isWorktree = Boolean(active && /desktop-worktrees/i.test(active.cwd));
  const sessionBusy = Boolean(active && runningIds.has(active.sessionId));
  const envIsWorktree = active ? isWorktree : worktreeMode;

  return (
    <div className="app">
      <TitleBar
        subtitle={active?.title}
        onSettings={() => {
          setSettingsOpen(true);
          void window.grok.settings(active?.cwd || selectedProjectCwd).then(setSettings);
        }}
        onTerminal={() => setTerminalOpen((v) => !v)}
      />
      <div className="shell">
        <Sidebar
          projects={projects}
          threads={threads}
          selectedProjectCwd={selectedProjectCwd}
          activeId={active?.sessionId ?? null}
          runningIds={runningIds}
          grokLabel={grokLabel}
          onOpenProject={() => void openProject()}
          onSelectProject={(p) => {
            setSelectedProjectCwd(p.cwd);
            setActive(null);
            setItems([]);
            setError(null);
            setSelectedDiffFile(null);
            void window.grok.gitStatus(p.cwd).then(setGit);
          }}
          onSelectThread={(t) => void selectThread(t)}
        />
        <section className="main">
          <div className="thread-header">
            <h1>
              {active?.title ||
                (selectedProject ? selectedProject.name : "Grok Build")}
            </h1>
            <div className="header-meta">
              {selectedProject ? <span className="badge">{selectedProject.name}</span> : null}
              {active ? <span className="badge">{isWorktree ? "工作树" : "本地"}</span> : null}
              <button className="btn small ghost" type="button" onClick={() => setRightOpen((v) => !v)}>
                {rightOpen ? "隐藏差异" : "差异"}
              </button>
            </div>
          </div>
          {error ? (
            <div className="permission" style={{ margin: "10px 20px 0" }}>
              <p>{error}</p>
            </div>
          ) : null}
          <MessageStream
            items={items}
            onOpenFile={(filePath) => {
              setRightOpen(true);
              setSelectedDiffFile(filePath.replace(/\\/g, "/"));
              const cwd = active?.cwd || selectedProjectCwd;
              if (cwd) void window.grok.gitStatus(cwd).then(setGit);
            }}
            emptyTitle={
              active
                ? "新会话"
                : selectedProject
                  ? selectedProject.name
                  : "开始工作"
            }
            emptyBody={
              active
                ? "描述你想做的事。Grok 会改文件、跑命令，并在这里实时显示结果。"
                : selectedProject
                  ? `当前项目：${selectedProject.name}。选「本地」或「工作树」，输入后会在这个项目里开一条新会话。`
                  : "先打开一个项目。同一个项目下可以有多条会话。"
            }
          />
          <TerminalPanel
            open={terminalOpen}
            cwd={active?.cwd || selectedProjectCwd}
            onClose={() => setTerminalOpen(false)}
          />
          <Composer
            value={draft}
            busy={sessionBusy}
            disabled={!active && !selectedProject}
            worktree={envIsWorktree}
            canChooseEnv={!active}
            planMode={planMode}
            goal={goal}
            attachments={attachments}
            settings={settings}
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
            onSend={() => void send()}
            onStop={stop}
            onPermission={(optionId) => {
              if (!permission) return;
              void window.grok.respondPermission(permission.requestId, optionId);
              setPermission(null);
            }}
          />
        </section>
        <DiffPanel
          git={git}
          cwd={active?.cwd || selectedProjectCwd}
          open={rightOpen}
          selectedPath={selectedDiffFile}
          onSelectFile={setSelectedDiffFile}
          onToggle={() => setRightOpen((v) => !v)}
          onOpenEditor={(filePath) => {
            const cwd = active?.cwd || selectedProjectCwd;
            if (cwd) void window.grok.openInEditor(cwd, filePath);
          }}
          onRefresh={() => {
            const cwd = active?.cwd || selectedProjectCwd;
            if (cwd) void window.grok.gitStatus(cwd).then(setGit);
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
