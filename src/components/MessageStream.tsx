import { useEffect, useRef, useState } from "react";
import type { FileLineStats, GitStatus, StreamItem } from "../../electron/shared";
import grokLogo from "../assets/grok-logo-transparent.png";
import { Markdown } from "../lib/markdown";
import { toolStatusLabel } from "../lib/i18n";
import { planFlowLabel, type PlanActivity, type PlanFlowPhase } from "../lib/plan-flow";
import { isPlanDocument, type PlanRevision } from "../lib/stream";
import { AttachmentCard } from "./AttachmentCard";

type UserItem = Extract<StreamItem, { kind: "user" }>;
type ThoughtItem = Extract<StreamItem, { kind: "thought" }>;
type ToolItem = Extract<StreamItem, { kind: "tool" }>;

type PlanConsole = {
  activity: PlanActivity;
  phase: PlanFlowPhase;
  revision: PlanRevision | null;
  question?: string | null;
  error?: string;
  busy: boolean;
  onApprove: (revision: PlanRevision) => void;
  onReject: () => void;
  onRetry: () => void;
  onReload: () => void;
};

type Turn = {
  user?: UserItem;
  thought?: ThoughtItem;
  tool?: ToolItem;
  rest: StreamItem[];
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatAskTime(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return clock;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${clock}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${clock}`;
}

function formatWorked(ms: number) {
  const total = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `已工作 ${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `已工作 ${minutes} 分 ${seconds} 秒`;
  return `已工作 ${seconds} 秒`;
}

function WorkedLabel({
  startedAt,
  durationMs,
  live,
}: {
  startedAt?: number;
  durationMs?: number;
  live?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live || !startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live, startedAt]);
  const ms = durationMs ?? (startedAt ? now - startedAt : 0);
  if (!ms && !startedAt) return null;
  return (
    <div className={`worked${live ? " live" : ""}`}>
      <span>{formatWorked(ms)}</span>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M3.2 1.6 7 5 3.2 8.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function groupTurns(items: StreamItem[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn = { rest: [] };
  const flush = () => {
    if (cur.user || cur.thought || cur.tool || cur.rest.length) turns.push(cur);
  };
  for (const item of items) {
    if (item.kind === "user") {
      flush();
      cur = { user: item, rest: [] };
    } else if (item.kind === "thought") {
      cur.thought = item;
    } else if (item.kind === "tool") {
      if (cur.tool) cur.rest.push(cur.tool);
      cur.tool = item;
    } else {
      cur.rest.push(item);
    }
  }
  flush();
  return turns;
}

function ToolCard({
  item,
  onOpenFile,
}: {
  item: Extract<StreamItem, { kind: "tool" }>;
  onOpenFile?: (path: string) => void;
}) {
  const open = Boolean(item.path && onOpenFile);
  return (
    <div
      className={`tool${open ? " clickable" : ""}`}
      onClick={() => {
        if (item.path && onOpenFile) onOpenFile(item.path);
      }}
    >
      <div className="tool-top">
        <span className="tool-name" title={item.path || item.title}>
          {item.title}
        </span>
        <span className={`tool-status ${item.status}`}>{toolStatusLabel(item.status)}</span>
      </div>
    </div>
  );
}

function PlanDocumentCard({
  plan,
  planConsole,
  sessionId,
  cwd,
  onOpenPlan,
}: {
  plan: PlanRevision;
  planConsole?: PlanConsole;
  sessionId?: string;
  cwd?: string;
  onOpenPlan?: (plan: PlanRevision) => void;
}) {
  const actionable = Boolean(planConsole && planConsole.phase !== "executing");
  return (
    <section
      className={`plan-document-card${onOpenPlan ? " clickable" : ""}`}
      aria-label="计划文档，点击查看完整计划"
      role={onOpenPlan ? "button" : undefined}
      tabIndex={onOpenPlan ? 0 : undefined}
      onClick={() => onOpenPlan?.(plan)}
      onKeyDown={(event) => {
        if (!onOpenPlan || event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenPlan(plan);
        }
      }}
    >
      <div className="plan-document-head">
        <strong>计划文档</strong>
        <span>
          第 {plan.revision} 份
          {planConsole ? ` · ${planFlowLabel(planConsole.phase)}` : ""}
        </span>
      </div>
      <div className="plan-document-preview">
        <div className="plan-document-body">
          <Markdown text={plan.markdown ?? ""} sessionId={sessionId} cwd={cwd} />
        </div>
      </div>
      {planConsole?.error ? <div className="plan-document-error">{planConsole.error}</div> : null}
      {actionable ? (
        <div className="plan-document-foot">
          <span>点击计划，在右侧查看完整内容</span>
          <div>
            <button
              className="btn primary small"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (planConsole!.revision) planConsole!.onApprove(planConsole!.revision);
              }}
              disabled={planConsole!.busy || !planConsole!.revision}
            >
              开始执行
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PlanConsoleStatus({ planConsole }: { planConsole: PlanConsole }) {
  const loadingDocument = planConsole.phase === "awaiting_approval" && !planConsole.revision?.markdown;
  return (
    <section className={`plan-console-status ${planConsole.activity.stage}`} aria-live="polite">
      <span className="plan-console-dot" aria-hidden="true" />
      <div className="plan-console-copy">
        <strong>{loadingDocument ? "计划已完成" : planConsole.activity.label}</strong>
        <span>{loadingDocument ? "正在读取 plan.md 并放入对话区。" : planConsole.activity.detail}</span>
        {planConsole.phase === "discussing" && planConsole.question ? (
          <div className="plan-console-question">
            <b>Grok 想确认：</b>
            <span>{planConsole.question}</span>
          </div>
        ) : null}
        {planConsole.error ? <em>{planConsole.error}</em> : null}
      </div>
      {!planConsole.busy && (planConsole.phase === "failed" || loadingDocument) ? (
        <div className="plan-console-actions">
          <button className="btn small reject" type="button" onClick={planConsole.onReject}>放弃计划</button>
          <button
            className="btn primary small"
            type="button"
            onClick={loadingDocument ? planConsole.onReload : planConsole.onRetry}
          >
            {loadingDocument ? "重新读取" : "重试生成"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function TurnChangesCard({
  files,
  stats,
  git,
  onOpenFile,
}: {
  files: string[];
  stats?: Record<string, FileLineStats>;
  git: GitStatus;
  onOpenFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const initiallyVisible = 3;
  const visibleFiles = expanded ? files : files.slice(0, initiallyVisible);
  const remaining = Math.max(0, files.length - initiallyVisible);
  const currentStats = new Map(
    git.files.map((file) => [file.path.replace(/\\/g, "/"), { added: file.added, removed: file.removed }]),
  );

  return (
    <section className="turn-changes" aria-label={`已编辑 ${files.length} 个文件`}>
      <div className="turn-changes-head">
        <span className="turn-changes-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18">
            <rect x="2.5" y="2.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M6.2 9h5.6M9 6.2v5.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <strong>已编辑 {files.length} 个文件</strong>
      </div>
      <div className="turn-changes-list">
        {visibleFiles.map((filePath) => {
          const normalizedPath = filePath.replace(/\\/g, "/");
          const lineStats = stats?.[normalizedPath] ?? currentStats.get(normalizedPath);
          return (
            <button
              key={filePath}
              className="turn-changes-file"
              type="button"
              title={filePath}
              disabled={!onOpenFile}
              onClick={() => onOpenFile?.(filePath)}
            >
              <span className="turn-changes-path">{filePath}</span>
              {lineStats ? (
                <span className="turn-changes-stats" aria-label={`新增 ${lineStats.added} 行，删除 ${lineStats.removed} 行`}>
                  <span className="add">+{lineStats.added}</span>
                  <span className="del">-{lineStats.removed}</span>
                </span>
              ) : null}
            </button>
          );
        })}
        {remaining > 0 ? (
          <button
            className="turn-changes-more"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <span>{expanded ? "收起文件" : `再显示 ${remaining} 个文件`}</span>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d={expanded ? "m3.5 8.5 3.5-3 3.5 3" : "m3.5 5.5 3.5 3 3.5-3"} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ThoughtBlock({
  text,
  sessionId,
  cwd,
  live = false,
}: {
  text: string;
  sessionId?: string;
  cwd?: string;
  live?: boolean;
}) {
  const [expanded, setExpanded] = useState(live);

  useEffect(() => {
    // Live reasoning is useful while a turn is running; once it completes,
    // leave a compact title so the transcript stays scannable.
    setExpanded(live);
  }, [live]);

  return (
    <section className={`msg thought${expanded ? " expanded" : ""}${live ? " live" : ""}`}>
      <button
        className="thought-toggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="msg-role">思考过程</span>
        <span className="thought-state">{live ? "生成中" : "已完成"}</span>
        <svg className="thought-chevron" viewBox="0 0 12 12" aria-hidden>
          <path d="m4.25 3.5 3.5 2.5-3.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className={`thought-body${expanded ? " open" : ""}`} aria-hidden={!expanded}>
        <div className="body">
          <Markdown text={text} sessionId={sessionId} cwd={cwd} />
        </div>
      </div>
    </section>
  );
}

function RestItem({
  item,
  onOpenFile,
  sessionId,
  cwd,
  git,
  planConsole,
  onOpenPlan,
  planNumber,
}: {
  item: StreamItem;
  onOpenFile?: (path: string) => void;
  sessionId?: string;
  cwd?: string;
  git?: GitStatus | null;
  planConsole?: PlanConsole;
  onOpenPlan?: (plan: PlanRevision) => void;
  planNumber?: number;
}) {
  if (item.kind === "agent") {
    return (
      <div className="msg agent">
        <div className="msg-role">Grok</div>
        <div className="body">
          <Markdown text={item.text} sessionId={sessionId} cwd={cwd} />
        </div>
      </div>
    );
  }
  if (item.kind === "plan") {
    if (!isPlanDocument(item)) return null;
    return (
      <PlanDocumentCard
        plan={{ revision: planNumber ?? item.revision, entries: item.entries, markdown: item.markdown }}
        planConsole={planConsole}
        sessionId={sessionId}
        cwd={cwd}
        onOpenPlan={onOpenPlan}
      />
    );
  }
  if (item.kind === "changes") {
    if (!git?.isRepo) return null;
    return <TurnChangesCard files={item.files} stats={item.stats} git={git} onOpenFile={onOpenFile} />;
  }
  if (item.kind === "tool") {
    return <ToolCard item={item} onOpenFile={onOpenFile} />;
  }
  if (item.kind === "subagent") {
    const done = /complet|success|fail|error|cancel|done/i.test(item.status);
    return (
      <div className={`tool${done ? "" : ""}`}>
        <div className="tool-top">
          <span className="tool-name" title={item.detail || item.title}>
            {item.title}
            {item.type ? ` · ${item.type}` : ""}
          </span>
          <span className={`tool-status ${done ? "completed" : item.status}`}>
            {done ? "完成" : "工作中"}
          </span>
        </div>
      </div>
    );
  }
  if (item.kind === "thought") {
    return <ThoughtBlock text={item.text} sessionId={sessionId} cwd={cwd} />;
  }
  return <div className="msg thought">{item.kind === "status" ? item.text : ""}</div>;
}

function railPreview(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}

export function MessageStream({
  items,
  busy,
  error,
  onRetryError,
  onDismissError,
  emptyTitle,
  onOpenFile,
  onOpenAttachment,
  sessionId,
  cwd,
  git,
  planConsole,
  onOpenPlan,
}: {
  items: StreamItem[];
  busy?: boolean;
  error?: string | null;
  onRetryError?: () => void;
  onDismissError?: () => void;
  emptyTitle: string;
  onOpenFile?: (path: string) => void;
  onOpenAttachment?: (path: string) => void;
  sessionId?: string;
  cwd?: string;
  git?: GitStatus | null;
  planConsole?: PlanConsole;
  onOpenPlan?: (plan: PlanRevision) => void;
}) {
  const streamRef = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const turnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const followRef = useRef(true);
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const turns = groupTurns(items);
  const latestPlanDocument = [...items]
    .reverse()
    .find(isPlanDocument);
  const planNumbers = new Map<StreamItem, number>();
  for (const item of items) {
    if (isPlanDocument(item)) {
      planNumbers.set(item, planNumbers.size + 1);
    }
  }
  const showPlanStatus = Boolean(
    planConsole &&
      (planConsole.phase === "generating" ||
        planConsole.phase === "revising" ||
        planConsole.phase === "discussing" ||
        (planConsole.phase === "awaiting_approval" && !planConsole.revision?.markdown) ||
        (planConsole.phase === "failed" && !planConsole.revision?.markdown)),
  );
  const railTurns = turns
    .map((turn, index) => ({ turn, index }))
    .filter((row) => Boolean(row.turn.user?.text.trim()));

  useEffect(() => {
    if (followRef.current) end.current?.scrollIntoView({ block: "end" });
  }, [items, error, planConsole?.phase]);

  useEffect(() => {
    const root = streamRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const idx = Number((visible[0]?.target as HTMLElement | undefined)?.dataset.turn);
        if (Number.isFinite(idx)) setActive(idx);
      },
      { root, rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.08, 0.4] },
    );
    for (const el of turnRefs.current) if (el) obs.observe(el);
    return () => obs.disconnect();
  }, [turns.length]);

  function jumpTo(index: number) {
    followRef.current = false;
    setActive(index);
    turnRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!items.length) {
    return (
      <div className="stream-shell">
        <div className="stream">
          <div className="empty">
            <img className="empty-logo" src={grokLogo} alt={emptyTitle} />
            {busy ? (
              <div className="run-status">
                <svg className="spinner" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                  <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.22" />
                  <path
                    d="M13.4 8a5.4 5.4 0 0 0-5.4-5.4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                <span>正在运行</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stream-shell">
      {railTurns.length ? (
        <div className="stream-rail" aria-label="对话回合">
          {railTurns.map(({ turn, index }) => {
            const preview = railPreview(turn.user!.text);
            return (
              <button
                key={`rail-${index}`}
                type="button"
                className={`rail-tick${active === index ? " on" : ""}`}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover((cur) => (cur === index ? null : cur))}
                onFocus={() => setHover(index)}
                onBlur={() => setHover((cur) => (cur === index ? null : cur))}
                onClick={() => jumpTo(index)}
              >
                <span className="sr-only">{preview}</span>
                {hover === index ? <span className="rail-tip">{preview}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        className="stream"
        ref={streamRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="stream-col">
          {turns.map((turn, ti) => {
            const last = ti === turns.length - 1;
            const live = Boolean(busy && last && turn.user?.startedAt && !turn.user.durationMs);
            const showWorked = Boolean(turn.user?.durationMs || live);
            return (
              <div
                className="turn"
                key={turn.user ? `u-${ti}-${turn.user.text.slice(0, 24)}-${turn.user.attachments?.[0] ?? ""}` : `t-${ti}`}
                data-turn={ti}
                ref={(node) => {
                  turnRefs.current[ti] = node;
                }}
              >
                {turn.user ? (
                  <div className="msg user">
                    {turn.user.startedAt ? <span className="msg-time">{formatAskTime(turn.user.startedAt)}</span> : null}
                    <div className="user-message-stack">
                      {turn.user.attachments?.length ? (
                        <div className="message-attachments" role="list" aria-label="消息附件">
                          {turn.user.attachments.map((filePath) => (
                            <AttachmentCard
                              key={filePath}
                              filePath={filePath}
                              onOpen={onOpenAttachment}
                            />
                          ))}
                        </div>
                      ) : null}
                      {turn.user.text ? <div className="bubble">{turn.user.text}</div> : null}
                    </div>
                  </div>
                ) : null}
                {showWorked ? (
                  <WorkedLabel
                    startedAt={turn.user?.startedAt}
                    durationMs={turn.user?.durationMs}
                    live={live}
                  />
                ) : null}
                {turn.thought || turn.tool ? (
                  <div className={`turn-live${live ? " live" : ""}`}>
                    {turn.thought ? (
                      <ThoughtBlock text={turn.thought.text} sessionId={sessionId} cwd={cwd} live={live} />
                    ) : null}
                    {turn.tool ? <ToolCard item={turn.tool} onOpenFile={onOpenFile} /> : null}
                  </div>
                ) : null}
                {turn.rest.map((item, i) => (
                  <RestItem
                    key={`${ti}-${item.kind}-${i}`}
                    item={item}
                    onOpenFile={onOpenFile}
                    sessionId={sessionId}
                    cwd={cwd}
                    git={git}
                    planConsole={
                      item === latestPlanDocument && planConsole?.revision?.markdown
                        ? planConsole
                        : undefined
                    }
                    onOpenPlan={onOpenPlan}
                    planNumber={planNumbers.get(item)}
                  />
                ))}
              </div>
            );
          })}
          {showPlanStatus && planConsole ? <PlanConsoleStatus planConsole={planConsole} /> : null}
          {busy && !showPlanStatus ? (
            <div className="run-status">
              <svg className="spinner" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.22" />
                <path
                  d="M13.4 8a5.4 5.4 0 0 0-5.4-5.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              <span>正在运行</span>
            </div>
          ) : null}
          {error ? (
            <div className="chat-error" role="alert">
              <div className="chat-error-head">
                <strong>任务未完成</strong>
                <div>
                  {onRetryError ? <button type="button" onClick={onRetryError}>重试</button> : null}
                  <button type="button" onClick={() => void navigator.clipboard.writeText(error)}>复制详情</button>
                  {onDismissError ? <button type="button" onClick={onDismissError}>关闭</button> : null}
                </div>
              </div>
              <pre>{error}</pre>
            </div>
          ) : null}
        </div>
        <div ref={end} />
      </div>
    </div>
  );
}
