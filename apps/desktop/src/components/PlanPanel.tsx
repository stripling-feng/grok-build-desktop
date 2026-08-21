import { useEffect, useMemo, useRef, useState } from "react";
import { normalizePlanStatus, type PlanEntryStatus } from "../../electron/shared";
import type { PlanEntry, PlanRevision } from "../lib/stream";

type Props = {
  open: boolean;
  revisions: PlanRevision[];
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRevise: (note: string) => void;
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
  busy,
  onApprove,
  onReject,
  onRevise,
  onClose,
}: Props) {
  const [note, setNote] = useState("");
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
        <span>计划{latestRevision != null ? ` · 第 ${latestRevision} 版` : ""}</span>
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
                第 {r.revision} 版
              </button>
            );
          })}
        </div>
      ) : null}
      <ol className="plan-list">
        {currentEntries.length === 0 ? (
          <li className="plan-empty">正在生成计划…</li>
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
      <div className="plan-foot">
        <form
          className="plan-revise"
          onSubmit={(e) => {
            e.preventDefault();
            const value = note.trim();
            if (!value) return;
            onRevise(value);
            setNote("");
          }}
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="调整意见，例如：先别动 package.json"
            disabled={busy}
          />
          <button className="btn small" type="submit" disabled={busy || !note.trim()}>
            重新计划
          </button>
        </form>
        <div className="plan-decide">
          <button className="btn small reject" type="button" onClick={onReject} disabled={busy}>
            拒绝
          </button>
          <button className="btn primary small" type="button" onClick={onApprove} disabled={busy}>
            接受并执行
          </button>
        </div>
      </div>
    </div>
  );
}
