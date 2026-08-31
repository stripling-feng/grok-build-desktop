import { useEffect, useMemo, useState } from "react";
import { normalizePlanStatus, type GitStatus, type PermissionRequest, type StreamItem } from "../../electron/shared";
import { latestPlan, type PlanEntry } from "../lib/stream";
type AgentItem = Extract<StreamItem, { kind: "subagent" }>;

function agentsFrom(items: StreamItem[]): AgentItem[] {
  const seen = new Map<string, AgentItem>();
  for (const item of items) {
    if (item.kind === "subagent") seen.set(item.id, item);
  }
  return [...seen.values()];
}

function planCounts(entries: PlanEntry[]) {
  let done = 0;
  let running: PlanEntry | undefined;
  for (const e of entries) {
    const status = normalizePlanStatus(e.status);
    if (status === "done") done += 1;
    else if (!running && status === "in_progress") running = e;
  }
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

function statusOpenKey(scopeId: string) {
  return `grok.statusFloatOpen.v2.${scopeId}`;
}

function initialOpen(scopeId: string) {
  try {
    const stored = localStorage.getItem(statusOpenKey(scopeId));
    return stored == null ? true : stored === "1";
  } catch {
    return false;
  }
}

export function StatusCard({
  scopeId,
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
  permission,
}: {
  scopeId: string;
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
  permission: PermissionRequest | null;
}) {
  const [open, setOpen] = useState(() => initialOpen(scopeId));
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
  const summary = permission
    ? "等待授权"
    : dirty
      ? "Git 状态"
      : plan.length
        ? `计划 ${todos.done}/${todos.total}`
        : "会话状态";
  const tone = permission ? "attention" : workingAgents.length > 0 ? "working" : "ready";

  useEffect(() => {
    try {
      localStorage.setItem(statusOpenKey(scopeId), open ? "1" : "0");
    } catch {
      /* persistence is best-effort */
    }
    if (!open) {
      setMenuOpen(false);
      setCommitOpen(false);
    }
  }, [open, scopeId]);

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
          <button className="status-card-head" type="button" onClick={() => setOpen(false)} aria-label="收起状态悬浮窗" aria-expanded="true">
            <span className={`status-mini-dot ${tone}`} aria-hidden />
            <strong>{summary}</strong>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="m3.5 8.5 3.5-3 3.5 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {permission ? (
            <section className="status-section status-attention">
              <div className="status-notice attention">
                <strong>等待授权</strong>
                <span>{permission.title || "智能体需要你的确认，请在输入区处理。"}</span>
              </div>
            </section>
          ) : null}

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
                  noValidate
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
                    className="resize-none"
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
                  <li key={`${i}-${entry.content}`} className={normalizePlanStatus(entry.status)}>
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
      ) : (
        <button className={`status-mini ${tone}`} type="button" onClick={() => setOpen(true)} aria-label={`展开状态悬浮窗：${summary}`} aria-expanded="false">
          <span className={`status-mini-dot ${tone}`} aria-hidden />
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
            <path d="m3.5 5.5 3.5 3 3.5-3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
