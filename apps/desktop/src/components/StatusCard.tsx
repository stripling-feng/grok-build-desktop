import { useEffect, useMemo, useState } from "react";
import type { GitStatus, StreamItem } from "../../electron/shared";
type PlanEntry = { content: string; status?: string };
type AgentItem = Extract<StreamItem, { kind: "subagent" }>;

function latestPlan(items: StreamItem[]): PlanEntry[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "plan") return item.entries;
  }
  return [];
}

function agentsFrom(items: StreamItem[]): AgentItem[] {
  const seen = new Map<string, AgentItem>();
  for (const item of items) {
    if (item.kind === "subagent") seen.set(item.id, item);
  }
  return [...seen.values()];
}

function planCounts(entries: PlanEntry[]) {
  const done = entries.filter((e) => /complet|done|success/i.test(e.status || "")).length;
  const running = entries.find((e) => /in_progress|running|active/i.test(e.status || ""));
  return { total: entries.length, done, running };
}

function agentLabel(item: AgentItem) {
  const title = item.title.replace(/^spawn_subagent[:\s]*/i, "").trim();
  const type = item.type ? ` · ${item.type}` : "";
  return `${title || "子智能体"}${type}`;
}

function agentBusy(item: AgentItem) {
  return !/complet|success|fail|error|cancel|done/i.test(item.status);
}

export function StatusCard({
  git,
  cwd,
  unattached,
  items,
  onOpenChanges,
  onRefresh,
  onError,
  onOpenEditor,
  onOpenFolder,
  onApply,
  canApply,
}: {
  git: GitStatus | null;
  cwd: string | null;
  unattached?: boolean;
  items: StreamItem[];
  onOpenChanges: () => void;
  onRefresh: () => void;
  onError?: (message: string) => void;
  onOpenEditor: () => void;
  onOpenFolder: () => void;
  onApply?: () => void;
  canApply?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => latestPlan(items), [items]);
  const agents = useMemo(() => agentsFrom(items), [items]);
  const todos = planCounts(plan);
  const showGit = Boolean(!unattached && cwd);
  const inRepo = Boolean(showGit && git?.isRepo);
  const dirty = Boolean(inRepo && git && git.files.length > 0);
  const added = git?.added ?? 0;
  const removed = git?.removed ?? 0;
  const workingAgents = agents.filter(agentBusy);
  const doneAgents = agents.filter((item) => !agentBusy(item));

  useEffect(() => {
    if (!open) {
      setMenuOpen(false);
      setCommitOpen(false);
    }
  }, [open]);

  const mini = (() => {
    if (todos.running) return todos.running.content;
    if (dirty && (added || removed)) return `+${added} −${removed}`;
    if (todos.total) return `进程 ${todos.done}/${todos.total}`;
    if (workingAgents.length) return `${workingAgents.length} 个智能体工作中`;
    if (doneAgents.length) return `${doneAgents.length} 个智能体已完成`;
    if (inRepo && git?.branch) return dirty ? `${git.files.length} 个更改` : git.branch;
    if (showGit && git && !git.isRepo) return "不是 Git 仓库";
    return "状态";
  })();

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onRefresh();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`status-float${open ? " open" : ""}`}>
      {open ? (
        <div className="status-card">
          {showGit ? (
            <section className="status-section">
              <div className="status-kicker">Git 工具</div>
              {!git ? (
                <div className="status-row">正在读取仓库…</div>
              ) : !git.isRepo ? (
                <div className="status-row">不是 Git 仓库</div>
              ) : (
                <>
              <button className="status-row" type="button" onClick={onOpenChanges}>
                <span>更改</span>
                <span className="status-stat">
                  {dirty ? (
                    <>
                      <b className="add">+{added}</b>
                      <b className="del">−{removed}</b>
                    </>
                  ) : (
                    "干净"
                  )}
                </span>
              </button>
              <button
                className="status-row"
                type="button"
                title="复制分支名"
                onClick={() => {
                  if (git.branch) void navigator.clipboard.writeText(git.branch);
                }}
              >
                <span className="status-branch">{git.branch || "未命名分支"}</span>
                {git.isWorktree ? <span className="status-pill">工作树</span> : null}
              </button>
              {dirty || commitOpen ? (
                <button
                  className="status-row"
                  type="button"
                  onClick={() => setCommitOpen((v) => !v)}
                >
                  <span>提交或推送</span>
                </button>
              ) : git.remote ? (
                <button
                  className="status-row"
                  type="button"
                  disabled={busy || !cwd}
                  onClick={() => void run(() => window.grok.gitPush(cwd!))}
                >
                  <span>推送</span>
                </button>
              ) : null}
              {commitOpen ? (
                <form
                  className="status-commit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!cwd) return;
                    void run(async () => {
                      await window.grok.gitCommit(cwd, message);
                      setMessage("");
                      setCommitOpen(false);
                    });
                  }}
                >
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="提交说明"
                    rows={3}
                  />
                  <div className="status-commit-actions">
                    <button className="btn small" type="submit" disabled={busy || !message.trim()}>
                      提交
                    </button>
                    <button
                      className="btn small"
                      type="button"
                      disabled={busy || !cwd}
                      onClick={() => void run(() => window.grok.gitPush(cwd!))}
                    >
                      推送
                    </button>
                  </div>
                </form>
              ) : null}
              <div className="status-row-end">
                <button
                  className="status-more"
                  type="button"
                  aria-label="更多"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  …
                </button>
                {menuOpen ? (
                  <div className="status-menu">
                    {git.branch ? (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(git.branch!);
                          setMenuOpen(false);
                        }}
                      >
                        复制分支名
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        onOpenEditor();
                        setMenuOpen(false);
                      }}
                    >
                      在编辑器中打开
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenFolder();
                        setMenuOpen(false);
                      }}
                    >
                      打开所在目录
                    </button>
                    {canApply && onApply ? (
                      <button
                        type="button"
                        onClick={() => {
                          onApply();
                          setMenuOpen(false);
                        }}
                      >
                        应用回主仓
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
                </>
              )}
            </section>
          ) : null}

          {plan.length ? (
            <section className="status-section">
              <div className="status-kicker">
                进程
                <span>
                  {todos.done}/{todos.total}
                </span>
              </div>
              <ol className="status-todos">
                {plan.map((entry, i) => (
                  <li key={`${i}-${entry.content}`} className={entry.status || ""}>
                    {entry.content}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {agents.length ? (
            <section className="status-section">
              <div className="status-kicker">
                智能体
                <span>
                  {workingAgents.length} 工作 / {doneAgents.length} 完成
                </span>
              </div>
              <ul className="status-agents">
                {agents.map((agent) => (
                  <li key={agent.id} className={agentBusy(agent) ? "working" : "done"}>
                    <span>{agentLabel(agent)}</span>
                    <em>{agentBusy(agent) ? "工作中" : "完成"}</em>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
      <button className="status-mini" type="button" onClick={() => setOpen((v) => !v)}>
        <span className="status-mini-dot" />
        <span className="status-mini-text">{mini || "状态"}</span>
      </button>
    </div>
  );
}
