import { useEffect, useRef, useState } from "react";
import type { StreamItem } from "../../electron/shared";
import grokLogo from "../assets/grok-logo.jpg";
import { Markdown } from "../lib/markdown";
import { toolStatusLabel } from "../lib/i18n";

type UserItem = Extract<StreamItem, { kind: "user" }>;
type ThoughtItem = Extract<StreamItem, { kind: "thought" }>;
type ToolItem = Extract<StreamItem, { kind: "tool" }>;

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

function RestItem({
  item,
  onOpenFile,
}: {
  item: StreamItem;
  onOpenFile?: (path: string) => void;
}) {
  if (item.kind === "agent") {
    return (
      <div className="msg agent">
        <div className="msg-role">Grok</div>
        <div className="body">
          <Markdown text={item.text} />
        </div>
      </div>
    );
  }
  if (item.kind === "plan") {
    return null;
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
    return (
      <div className="msg thought">
        <div className="msg-role">思考</div>
        <div className="body">{item.text}</div>
      </div>
    );
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
}: {
  items: StreamItem[];
  busy?: boolean;
  error?: string | null;
  onRetryError?: () => void;
  onDismissError?: () => void;
  emptyTitle: string;
  onOpenFile?: (path: string) => void;
}) {
  const streamRef = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const turnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const followRef = useRef(true);
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const turns = groupTurns(items);
  const railTurns = turns
    .map((turn, index) => ({ turn, index }))
    .filter((row) => Boolean(row.turn.user?.text.trim()));

  useEffect(() => {
    if (followRef.current) end.current?.scrollIntoView({ block: "end" });
  }, [items, error]);

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
                key={turn.user ? `u-${ti}-${turn.user.text.slice(0, 24)}` : `t-${ti}`}
                data-turn={ti}
                ref={(node) => {
                  turnRefs.current[ti] = node;
                }}
              >
                {turn.user ? (
                  <div className="msg user">
                    {turn.user.startedAt ? <span className="msg-time">{formatAskTime(turn.user.startedAt)}</span> : null}
                    <div className="bubble">{turn.user.text}</div>
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
                  <div className="turn-live">
                    {turn.thought ? (
                      <div className="msg thought">
                        <div className="msg-role">思考</div>
                        <div className="body">{turn.thought.text}</div>
                      </div>
                    ) : null}
                    {turn.tool ? <ToolCard item={turn.tool} onOpenFile={onOpenFile} /> : null}
                  </div>
                ) : null}
                {turn.rest.map((item, i) => (
                  <RestItem key={`${ti}-${item.kind}-${i}`} item={item} onOpenFile={onOpenFile} />
                ))}
              </div>
            );
          })}
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
