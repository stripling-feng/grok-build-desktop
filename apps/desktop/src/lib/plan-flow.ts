import type { StreamItem } from "../../electron/shared";
import type { PlanEntry, PlanRevision } from "./stream";

export type PlanFlowPhase =
  | "generating"
  | "awaiting_approval"
  | "revising"
  | "approving"
  | "executing"
  | "failed";

export type PlanImage = { path: string; mimeType: string };

export type PlanFlow = {
  planId: string;
  turnId: string;
  sessionId: string;
  open: boolean;
  phase: PlanFlowPhase;
  pendingPrompt: string;
  userText: string;
  pendingImages: PlanImage[];
  userStartedAt: number;
  hasPlan: boolean;
  error?: string;
};

export const PLAN_FLOW_STORAGE_KEY = "grok.pendingPlanFlows.v1";

export function planFlowBusy(phase: PlanFlowPhase): boolean {
  return phase === "generating" || phase === "revising" || phase === "approving" || phase === "executing";
}

export function planFlowLabel(phase: PlanFlowPhase): string {
  if (phase === "generating") return "正在生成";
  if (phase === "revising") return "正在重新计划";
  if (phase === "approving") return "正在切换到执行模式";
  if (phase === "executing") return "正在执行";
  if (phase === "failed") return "需要处理";
  return "等待确认";
}

function flowStartIndex(items: StreamItem[], userStartedAt: number, userText?: string): number {
  let index = items.findIndex(
    (item) => item.kind === "user" && item.startedAt === userStartedAt,
  );
  if (index < 0 && userText) {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.kind === "user" && item.text.trim() === userText.trim()) {
        index = i;
        break;
      }
    }
  }
  return index < 0 ? items.length : index + 1;
}

/**
 * ACP revisions are not guaranteed to be present or monotonic. Each plan item
 * in the scoped turn is therefore exposed as a stable, client-side revision.
 */
export function planRevisionsForFlow(
  items: StreamItem[],
  userStartedAt: number,
  userText?: string,
): PlanRevision[] {
  const start = flowStartIndex(items, userStartedAt, userText);
  const revisions: PlanRevision[] = [];
  for (let i = start; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== "plan") continue;
    revisions.push({
      revision: revisions.length + 1,
      entries: item.entries.map((entry) => ({ ...entry })),
    });
  }
  return revisions;
}

export function latestPlanForFlow(
  items: StreamItem[],
  userStartedAt: number,
  userText?: string,
): PlanRevision | null {
  return planRevisionsForFlow(items, userStartedAt, userText).at(-1) ?? null;
}

export function markFlowPlans(
  items: StreamItem[],
  userStartedAt: number,
  status: PlanEntry["status"],
  userText?: string,
): StreamItem[] {
  const start = flowStartIndex(items, userStartedAt, userText);
  return items.map((item, index) => {
    if (index < start || item.kind !== "plan") return item;
    return {
      ...item,
      entries: item.entries.map((entry) => ({ ...entry, status })),
    };
  });
}

export function buildPlanExecutionPrompt(
  originalPrompt: string,
  revision: PlanRevision,
): string {
  const steps = revision.entries
    .map((entry, index) => `${index + 1}. ${entry.content}`)
    .join("\n");
  const original = originalPrompt.trim();
  return [
    `计划已批准。请严格执行下面的第 ${revision.revision} 版计划，不要重新规划。`,
    steps,
    original ? `原始任务：\n${original}` : "",
    "执行过程中请持续更新每一步的真实状态；只有实际完成后才能标记为完成。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function restorePlanFlow(flow: PlanFlow, items: StreamItem[]): PlanFlow {
  if (flow.phase === "executing") {
    return {
      ...flow,
      open: true,
      phase: "failed",
      error: "上次执行被应用退出打断或未能确认完成。请先检查实际改动，再决定重新执行或拒绝。",
    };
  }
  if (flow.phase !== "generating" && flow.phase !== "revising" && flow.phase !== "approving") {
    return flow;
  }
  const hasPlan = planRevisionsForFlow(items, flow.userStartedAt, flow.userText).length > 0;
  if (hasPlan) {
    return {
      ...flow,
      open: true,
      phase: "awaiting_approval",
      hasPlan: true,
      error: undefined,
    };
  }
  return {
    ...flow,
    open: true,
    phase: "failed",
    hasPlan: false,
    error: "上次计划生成或修订已中断，请重试或拒绝该计划。",
  };
}

export function isPlanFlow(value: unknown): value is PlanFlow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PlanFlow>;
  const phases: PlanFlowPhase[] = [
    "generating",
    "awaiting_approval",
    "revising",
    "approving",
    "executing",
    "failed",
  ];
  return Boolean(
    typeof row.planId === "string" &&
      typeof row.turnId === "string" &&
      typeof row.sessionId === "string" &&
      typeof row.pendingPrompt === "string" &&
      typeof row.userText === "string" &&
      typeof row.userStartedAt === "number" &&
      Array.isArray(row.pendingImages) &&
      typeof row.phase === "string" &&
      phases.includes(row.phase as PlanFlowPhase),
  );
}
