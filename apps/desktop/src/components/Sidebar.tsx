import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountInfo, AccountUsage, AppUpdateInfo, ProjectInfo, ThreadInfo } from "../../electron/shared";

type Props = {
  projects: ProjectInfo[];
  threads: ThreadInfo[];
  selectedProjectCwd: string | null;
  activeId: string | null;
  runningIds: Set<string>;
  grokLabel: string;
  account: AccountInfo | null;
  onOpenProject: () => void;
  onNewChat?: () => void;
  onSelectProject: (project: ProjectInfo) => void;
  onSelectThread: (thread: ThreadInfo) => void;
  onRenameProject: (project: ProjectInfo, name: string) => void;
  onRemoveProject: (project: ProjectInfo) => void;
  onOpenProjectFolder: (project: ProjectInfo) => void;
  onRenameThread: (thread: ThreadInfo, title: string) => void;
  onForkThread: (thread: ThreadInfo) => void;
  onRemoveThread: (thread: ThreadInfo) => void;
  page?: "chat" | "marketplace" | "automation";
  onOpenMarketplace?: () => void;
  onOpenAutomation?: () => void;
  onOpenNewTask?: () => void;
  onSettings?: () => void;
};

type MenuState =
  | { kind: "project"; project: ProjectInfo; x: number; y: number }
  | { kind: "thread"; thread: ThreadInfo; x: number; y: number };

type RenameState =
  | { kind: "project"; cwd: string; value: string }
  | { kind: "thread"; id: string; value: string };

function same(a: string, b: string) {
  return a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
}

function Icon({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {children}
    </svg>
  );
}

function FolderIcon() {
  return (
    <Icon className="row-icon folder-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        d="M2.2 4.2A1.4 1.4 0 0 1 3.6 2.8h2.6c.3 0 .6.12.8.34l.7.76c.2.22.5.34.8.34h3.9A1.4 1.4 0 0 1 14 5.64v6.76A1.4 1.4 0 0 1 12.6 13.8h-9A1.4 1.4 0 0 1 2.2 12.4V4.2z"
      />
    </Icon>
  );
}

function ChatIcon() {
  return (
    <Icon className="row-icon chat-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        d="M3.2 3.4h9.6A1.4 1.4 0 0 1 14.2 4.8v5.2A1.4 1.4 0 0 1 12.8 11.4H8.2L4.4 13.8V11.4H3.2A1.4 1.4 0 0 1 1.8 10V4.8A1.4 1.4 0 0 1 3.2 3.4z"
      />
    </Icon>
  );
}

function PlusIcon() {
  return (
    <Icon>
      <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </Icon>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={`spinner ${className ?? ""}`} width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.22" />
      <path
        d="M13.4 8a5.4 5.4 0 0 0-5.4-5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RenameIcon() {
  return (
    <Icon className="menu-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13h10M4.8 10.4 11.2 4a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4L6.8 12.4 3.6 13z"
      />
    </Icon>
  );
}

function OpenFolderIcon() {
  return (
    <Icon className="menu-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        d="M2.5 4.3A1.1 1.1 0 0 1 3.6 3.2h2.2c.3 0 .5.1.7.3l.5.6c.2.2.4.3.7.3h4.3A1.1 1.1 0 0 1 13.1 5.5v6.2A1.1 1.1 0 0 1 12 12.8H4A1.1 1.1 0 0 1 2.9 11.7V4.3z"
      />
      <path
        d="M9.4 7.4 12.2 4.6M12.2 4.6H9.8M12.2 4.6V7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

function ForkIcon() {
  return (
    <Icon className="menu-icon">
      <circle cx="5" cy="4" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="12" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11.2" cy="8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 5.6v4.8M5 8h2.4a2.4 2.4 0 0 1 2.4 2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

function TrashIcon() {
  return (
    <Icon className="menu-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.2 4.5h9.6M6.3 4.5V3.3h3.4v1.2M5.2 4.5l.5 8.2h4.6l.5-8.2M6.8 7v4M9.2 7v4"
      />
    </Icon>
  );
}

function MarketIcon() {
  return (
    <Icon className="nav-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        d="M3 4.2h10v8.4H3zM3 7.2h10M8 4.2v8.4"
      />
    </Icon>
  );
}

function NewTaskIcon() {
  return (
    <Icon className="nav-icon">
      <path
        d="M8 3.2v9.6M3.2 8h9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Icon>
  );
}

function AutoIcon() {
  return (
    <Icon className="nav-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 3.2v2.2M8 10.6v2.2M3.2 8h2.2M10.6 8h2.2M4.6 4.6l1.5 1.5M9.9 9.9l1.5 1.5M11.4 4.6 9.9 6.1M6.1 9.9 4.6 11.4"
      />
      <circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  );
}

function SettingsIcon() {
  return (
    <Icon>
      <path
        d="M8 10.1A2.1 2.1 0 1 0 8 5.9a2.1 2.1 0 0 0 0 4.2zM3.2 8.7l-1 .6.8 1.6 1.1-.2c.2.3.5.6.8.8l-.2 1.1 1.6.8.6-1c.3 0 .7.1 1 .1s.7 0 1-.1l.6 1 1.6-.8-.2-1.1c.3-.2.6-.5.8-.8l1.1.2.8-1.6-1-.6c0-.3.1-.7.1-1s0-.7-.1-1l1-.6-.8-1.6-1.1.2a4.7 4.7 0 0 0-.8-.8l.2-1.1-1.6-.8-.6 1c-.3 0-.7-.1-1-.1s-.7 0-1 .1l-.6-1-1.6.8.2 1.1c-.3.2-.6.5-.8.8l-1.1-.2-.8 1.6 1 .6c0 .3-.1.7-.1 1s0 .7.1 1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

function UpdateIcon() {
  return (
    <Icon>
      <path
        d="M12.4 8.2A4.4 4.4 0 1 1 11 4.7M12.4 3.4v2.6H9.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

function UserIcon() {
  return (
    <Icon className="account-icon">
      <circle cx="8" cy="5.4" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M3.4 13c.6-2.3 2.3-3.4 4.6-3.4s4 1.1 4.6 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </Icon>
  );
}

function accountLabel(account: AccountInfo | null): string {
  if (!account) return "检测登录…";
  if (account.method === "none") return "未登录";
  return account.name;
}

function clampMenu(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

export function Sidebar({
  projects,
  threads,
  selectedProjectCwd,
  activeId,
  runningIds,
  grokLabel,
  account,
  onOpenProject,
  onNewChat,
  onSelectProject,
  onSelectThread,
  onRenameProject,
  onRemoveProject,
  onOpenProjectFolder,
  onRenameThread,
  onForkThread,
  onRemoveThread,
  page = "chat",
  onOpenMarketplace,
  onOpenAutomation,
  onOpenNewTask,
  onSettings,
}: Props) {
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const grouped = useMemo(() => {
    return projects.map((project) => ({
      project,
      threads: threads.filter((t) => !t.unattached && t.projectCwd && same(t.projectCwd, project.cwd)),
    }));
  }, [projects, threads]);

  const projectThreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of grouped) {
      for (const t of group.threads) ids.add(t.id);
    }
    return ids;
  }, [grouped]);

  const chatThreads = useMemo(
    () =>
      threads.filter(
        (t) => t.unattached === true && !t.projectCwd && !projectThreadIds.has(t.id),
      ),
    [threads, projectThreadIds],
  );

  useEffect(() => {
    if (rename) renameRef.current?.focus();
  }, [rename]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onDismiss = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onDismiss);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
    };
  }, [menu]);

  const commitRename = () => {
    if (!rename) return;
    const value = rename.value.trim();
    if (rename.kind === "project") {
      const project = projects.find((p) => same(p.cwd, rename.cwd));
      if (project && value && value !== project.name) onRenameProject(project, value);
    } else {
      const thread = threads.find((t) => t.id === rename.id);
      if (thread && value && value !== thread.title) onRenameThread(thread, value);
    }
    setRename(null);
  };

  const openMenu = (next: MenuState, height: number) => {
    const pos = clampMenu(next.x, next.y, 176, height);
    setMenu({ ...next, ...pos });
  };

  const checkUpdate = async () => {
    if (updateLoading) return;
    setUpdateLoading(true);
    try {
      const next = await window.grok.checkUpdate();
      setUpdate(next);
      setUpdateOpen(true);
    } catch {
      setUpdate({
        current: "",
        latest: null,
        hasUpdate: false,
        url: "",
        notes: "",
        error: "检测失败",
      });
      setUpdateOpen(true);
    } finally {
      setUpdateLoading(false);
    }
  };

  const canShowUsage = account?.method === "oauth";
  const usageTitle = canShowUsage
    ? usageLoading
      ? "正在获取用量…"
      : usage?.text || "悬停查看用量"
    : grokLabel;

  return (
    <aside className="sidebar" onContextMenu={(e) => e.preventDefault()}>
      <div className="sidebar-nav">
        <button type="button" className="btn primary block" onClick={onOpenNewTask}>
          <NewTaskIcon />
          新建任务
        </button>
        <button
          type="button"
          className={`sidebar-nav-item${page === "automation" ? " on" : ""}`}
          onClick={onOpenAutomation}
        >
          <AutoIcon />
          自动化
        </button>
        <button
          type="button"
          className={`sidebar-nav-item${page === "marketplace" ? " on" : ""}`}
          onClick={onOpenMarketplace}
        >
          <MarketIcon />
          插件市场
        </button>
      </div>
      <div className="sidebar-list">
        <div className="sidebar-title-row">
          <span className="sidebar-title">项目</span>
          <button className="icon-btn" type="button" title="打开项目" onClick={onOpenProject}>
            <PlusIcon />
          </button>
        </div>
        {grouped.map(({ project, threads: list }) => {
          const isSelected = !!selectedProjectCwd && same(project.cwd, selectedProjectCwd);
          return (
            <div className={`project${isSelected ? " selected" : ""}`} key={project.cwd}>
              {rename?.kind === "project" && same(rename.cwd, project.cwd) ? (
                <div className="project-head renaming">
                  <FolderIcon />
                  <input
                    ref={renameRef}
                    className="rename-input"
                    value={rename.value}
                    onChange={(e) => setRename({ ...rename, value: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setRename(null);
                      }
                    }}
                  />
                </div>
              ) : (
                <button
                  className="project-head"
                  type="button"
                  title={project.cwd}
                  onClick={() => onSelectProject(project)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectProject(project);
                    openMenu({ kind: "project", project, x: e.clientX, y: e.clientY }, 124);
                  }}
                >
                  <FolderIcon />
                  <span className="project-name">{project.name}</span>
                </button>
              )}
              {list.map((t) =>
                rename?.kind === "thread" && rename.id === t.id ? (
                  <div key={t.id} className="thread renaming">
                    <ChatIcon />
                    <input
                      ref={renameRef}
                      className="rename-input"
                      value={rename.value}
                      onChange={(e) => setRename({ ...rename, value: e.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRename(null);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    key={t.id}
                    type="button"
                    className={`thread${activeId === t.id ? " active" : ""}${runningIds.has(t.id) ? " running" : ""}`}
                    title={t.title}
                    onClick={() => onSelectThread(t)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectThread(t);
                      openMenu({ kind: "thread", thread: t, x: e.clientX, y: e.clientY }, 128);
                    }}
                  >
                    {runningIds.has(t.id) ? <SpinnerIcon className="thread-spinner" /> : <ChatIcon />}
                    <span className="thread-name">{t.title}</span>
                  </button>
                ),
              )}
            </div>
          );
        })}
        <div className="sidebar-title-row chats-label">
          <span className="sidebar-title">对话</span>
          <button className="icon-btn" type="button" title="新对话" onClick={onNewChat}>
            <PlusIcon />
          </button>
        </div>
        <div className="chats">
          {chatThreads.map((t) =>
            rename?.kind === "thread" && rename.id === t.id ? (
              <div key={t.id} className="thread chat-thread renaming">
                <ChatIcon />
                <input
                  ref={renameRef}
                  className="rename-input"
                  value={rename.value}
                  onChange={(e) => setRename({ ...rename, value: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setRename(null);
                    }
                  }}
                />
              </div>
            ) : (
              <button
                key={t.id}
                type="button"
                className={`thread chat-thread${activeId === t.id ? " active" : ""}${runningIds.has(t.id) ? " running" : ""}`}
                title={t.title}
                onClick={() => onSelectThread(t)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectThread(t);
                  openMenu({ kind: "thread", thread: t, x: e.clientX, y: e.clientY }, 88);
                }}
              >
                <ChatIcon />
                <span className="thread-name">{t.title}</span>
              </button>
            ),
          )}
        </div>
      </div>
      <div className="sidebar-foot">
        <div
          className="account-pill"
          title={usageTitle}
          onMouseEnter={() => {
            if (!canShowUsage || usageLoading) return;
            setUsageLoading(true);
            void window.grok
              .accountUsage()
              .then(setUsage)
              .catch(() => setUsage({ text: "无法获取用量" }))
              .finally(() => setUsageLoading(false));
          }}
        >
          <UserIcon />
          <span className="account-name">{accountLabel(account)}</span>
          {account?.method === "oauth" ? <span className="account-kind">OAuth</span> : null}
        </div>
        {onSettings ? (
          <button className="update-btn" type="button" title="设置" onClick={onSettings}>
            <SettingsIcon />
            设置
          </button>
        ) : null}
        <button
          className={`update-btn${update?.hasUpdate ? " has-update" : ""}`}
          type="button"
          title="检查更新"
          disabled={updateLoading}
          onClick={() => void checkUpdate()}
        >
          {updateLoading ? <SpinnerIcon /> : <UpdateIcon />}
          更新
        </button>
      </div>
      {updateOpen && update ? (
        <div className="modal-backdrop" onClick={() => setUpdateOpen(false)}>
          <div className="modal update-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>检查更新</h2>
              <button className="btn small ghost" type="button" onClick={() => setUpdateOpen(false)}>
                关闭
              </button>
            </div>
            {update.error ? <p className="settings-hint">{update.error}</p> : null}
            {!update.error && update.hasUpdate ? (
              <>
                <p>
                  当前 {update.current}，最新 {update.latest}。
                </p>
                {update.dev ? <p className="settings-hint">开发版不会自动安装，请下载安装包后手动安装。</p> : null}
                {update.notes ? <pre className="update-notes">{update.notes}</pre> : null}
                <div className="permission-actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => {
                      void window.grok.openUpdate(update.url);
                    }}
                  >
                    下载安装包
                  </button>
                </div>
              </>
            ) : null}
            {!update.error && !update.hasUpdate ? (
              <p>已是最新版本{update.current ? ` ${update.current}` : ""}。</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {menu ? (
        <div
          ref={menuRef}
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.kind === "project" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setRename({ kind: "project", cwd: menu.project.cwd, value: menu.project.name });
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <RenameIcon />
                </span>
                重命名
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenProjectFolder(menu.project);
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <OpenFolderIcon />
                </span>
                打开所在目录
              </button>
              <div className="ctx-sep" />
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onRemoveProject(menu.project);
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <TrashIcon />
                </span>
                移除
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  onForkThread(menu.thread);
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <ForkIcon />
                </span>
                分叉对话
              </button>
              <button
                type="button"
                onClick={() => {
                  setRename({ kind: "thread", id: menu.thread.id, value: menu.thread.title });
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <RenameIcon />
                </span>
                重命名
              </button>
              <div className="ctx-sep" />
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onRemoveThread(menu.thread);
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <TrashIcon />
                </span>
                移除
              </button>
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
}
