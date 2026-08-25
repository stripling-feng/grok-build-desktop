import { Markdown } from "../lib/markdown";
import { planFlowLabel, type PlanFlowPhase } from "../lib/plan-flow";
import type { PlanRevision } from "../lib/stream";

export function PlanSidebar({
  plan,
  phase,
  sessionId,
  cwd,
  canExecute,
  busy,
  onClose,
  onExecute,
}: {
  plan: PlanRevision;
  phase?: PlanFlowPhase;
  sessionId?: string;
  cwd?: string;
  canExecute: boolean;
  busy: boolean;
  onClose: () => void;
  onExecute: () => void;
}) {
  return (
    <aside className="plan-sidebar" aria-label="完整计划">
      <div className="plan-sidebar-head">
        <div>
          <strong>完整计划</strong>
          <span>
            第 {plan.revision} 份{phase ? ` · ${planFlowLabel(phase)}` : ""}
          </span>
        </div>
        <button className="plan-sidebar-close" type="button" aria-label="关闭完整计划" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="plan-sidebar-body">
        <Markdown text={plan.markdown ?? ""} sessionId={sessionId} cwd={cwd} />
      </div>
      {canExecute ? (
        <div className="plan-sidebar-foot">
          <button className="btn primary" type="button" disabled={busy} onClick={onExecute}>
            开始执行
          </button>
        </div>
      ) : null}
    </aside>
  );
}
