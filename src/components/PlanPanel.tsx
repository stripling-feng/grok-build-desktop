import { useEffect, useMemo, useRef, useState } from "react";
import { normalizePlanStatus, type PlanEntryStatus } from "../../electron/shared";
import type { PlanEntry, PlanRevision } from "../lib/stream";
import { planFlowLabel, type PlanActivity, type PlanFlowPhase } from "../lib/plan-flow";

type Props = {
  open: boolean;
  revisions: PlanRevision[];
  phase: PlanFlowPhase;
  activity: PlanActivity;
  error?: string;
  busy: boolean;
  onApprove: (revision: PlanRevision) => void;
  onReject: () => void;
  onRetry: () => void;
  onClose: () => void;
};

function revisionHasUnfinished(entries: PlanEntry[]): boolean {
  return entries.some((e) => {
    const s = normalizePlanStatus(e.status);
    return s !== "done" && s !== "failed" && s !== "cancelled";
  });
}

export function PlanPanel({
  open,
  revisions,
  phase,
  activity,
  error,
  busy,
  onApprove,
  onReject,
  onRetry,
  onClose,
}: Props) {
  const [activeRevision, setActiveRevision] = useState<number | null>(null);
  const userPickedRef = useRef(false);
  const lastSeenRevisionRef = useRef<number | null>(null);

  const sortedRevisions = useMemo(
    () => [...revisions].sort((a, b) => a.revision - b.revision),
    [revisions],
  );
  const latestRevision = sortedRevisions.at(-1)?.revision ?? null;
  const resolvedActive =
    activeRevision != null && sortedRevisions.some((r) => r.revision === activeRevision)
      ? activeRevision
      : latestRevision;
  const currentEntries = useMemo(() => {
    const target = sortedRevisions.find((r) => r.revision === resolvedActive);
    return target?.entries ?? [];
  }, [sortedRevisions, resolvedActive]);
  const currentRevision = useMemo(
    () => sortedRevisions.find((r) => r.revision === resolvedActive) ?? null,
    [sortedRevisions, resolvedActive],
  );

  useEffect(() => {
    if (!open) return;
    if (
      lastSeenRevisionRef.current === null ||
      latestRevision === null ||
      lastSeenRevisionRef.current !== latestRevision
    ) {
      lastSeenRevisionRef.current = latestRevision;
      if (!userPickedRef.current) {
        setActiveRevision(latestRevision);
      }
    }
  }, [open, latestRevision]);

  useEffect(() => {
    if (!open) {
      userPickedRef.current = false;
      setActiveRevision(null);
      lastSeenRevisionRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="plan-panel">
      <div className="plan-head">
        <span>
          计划{latestRevision != null ? ` · 第 ${latestRevision} 份` : ""}
          <em className={`plan-phase ${phase}`}>{planFlowLabel(phase)}</em>
        </span>
        <div className="plan-actions">
          <button className="btn small ghost" type="button" onClick={onClose}>
            收起
          </button>
        </div>
      </div>
      {sortedRevisions.length > 1 ? (
        <div className="plan-revisions">
          {sortedRevisions.map((r) => {
            const isActive = r.revision === resolvedActive;
            const unfinished = revisionHasUnfinished(r.entries);
            return (
              <button
                key={r.revision}
                type="button"
                className={
                  "chip" +
                  (isActive ? " active" : "") +
                  (unfinished && !isActive ? " has-unfinished" : "")
                }
                onClick={() => {
                  userPickedRef.current = true;
                  setActiveRevision(r.revision);
                }}
              >
                <span className="dot" aria-hidden="true" />
                第 {r.revision} 份
              </button>
            );
          })}
        </div>
      ) : null}
      <div className={`plan-progress ${activity.stage}`}>
        <span className="plan-progress-dot" aria-hidden="true" />
        <span className="plan-progress-copy">
          <strong>{activity.label}</strong>
          <small>{activity.detail}</small>
        </span>
      </div>
      <ol className="plan-list">
        {currentEntries.length === 0 ? (
          <li className="plan-empty">
            {phase === "discussing"
              ? "请在对话输入框中回答问题或继续补充要求。"
              : phase === "failed"
                ? "这次计划对话没有完成。"
                : "正在分析需求；如有关键疑问，智能体会先在对话中提问。"}
          </li>
        ) : (
          currentEntries.map((entry, i) => {
            const status: PlanEntryStatus = normalizePlanStatus(entry.status);
            return (
              <li key={`${resolvedActive ?? "x"}-${i}-${entry.content}`} className={status}>
                <span className="plan-idx">{i + 1}</span>
                <span className="plan-text">{entry.content}</span>
              </li>
            );
          })
        )}
      </ol>
      {error ? <div className="plan-error">{error}</div> : null}
      <div className="plan-foot">
        <div className="plan-chat-hint">
          {currentEntries.length > 0
            ? "要调整计划，直接在对话输入框中说明；确认后再开始执行。"
            : "计划模式保持可对话，你可以继续回答或补充。"}
        </div>
        <div className="plan-decide">
          <button className="btn small reject" type="button" onClick={onReject} disabled={busy}>
            放弃计划
          </button>
          {phase === "failed" && currentEntries.length === 0 ? (
            <button className="btn primary small" type="button" onClick={onRetry} disabled={busy}>
              重试生成
            </button>
          ) : (
            <button
              className="btn primary small"
              type="button"
              onClick={() => currentRevision && onApprove(currentRevision)}
              disabled={busy || !currentRevision || currentEntries.length === 0}
            >
              开始执行第 {currentRevision?.revision ?? "—"} 份
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
