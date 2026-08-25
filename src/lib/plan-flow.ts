import type { StreamItem } from "../../electron/shared";
import { isPlanDocument, type PlanEntry, type PlanRevision } from "./stream";

export type PlanFlowPhase =
  | "generating"
  | "discussing"
  | "awaiting_approval"
  | "revising"
  | "approving"
  | "executing"
  | "failed";

export type PlanImage = { path: string; mimeType: string };

export type PlanActivity = {
  stage: "understanding" | "exploring" | "drafting" | "waiting" | "ready" | "executing" | "failed";
  label: string;
  detail: string;
};

export type PlanFlow = {
  planId: string;
  turnId: string;
  sessionId: string;
  open: boolean;
  phase: PlanFlowPhase;
  pendingPrompt: string;
  userText: string;
  pendingImages: PlanImage[];
  retryPrompt?: string;
  retryImages?: PlanImage[];
  userStartedAt: number;
  hasPlan: boolean;
  error?: string;
};

export const PLAN_FLOW_STORAGE_KEY = "grok.pendingPlanFlows.v1";

export function planFlowBusy(phase: PlanFlowPhase): boolean {
  return phase === "generating" || phase === "revising" || phase === "approving" || phase === "executing";
}

export function planFlowLabel(phase: PlanFlowPhase): string {
  if (phase === "generating") return "正在分析";
  if (phase === "discussing") return "等待你的回复";
  if (phase === "revising") return "正在更新计划";
  if (phase === "approving") return "正在切换到执行模式";
  if (phase === "executing") return "正在执行";
  if (phase === "failed") return "需要处理";
  return "等待确认";
}

export function buildPlanConversationPrompt(prompt: string): string {
  const request = prompt.trim() || "请根据我附带的内容规划这个任务。";
  return [
    "请以计划模式协助我梳理这个任务，此阶段只调查、分析和规划，不要修改文件或执行实现。",
    "先做最少量的必要检查。如果存在会实质影响实现方案的关键信息缺失，请直接在普通对话回复中提出简短、明确的问题，然后结束本轮等待我回答；不要调用交互式问答工具，也不要为了提问而提问。需求已经明确时，直接给出简洁、可执行、可验证的计划。",
    `用户需求：\n${request}`,
  ].join("\n\n");
}

export function settlePlanTurn(flow: PlanFlow): PlanFlow {
  if (flow.phase !== "generating" && flow.phase !== "revising") return flow;
  if (flow.hasPlan) {
    return {
      ...flow,
      open: true,
      phase: "awaiting_approval",
      error: undefined,
    };
  }
  return {
    ...flow,
    open: true,
    phase: "discussing",
    error: undefined,
  };
}

function flowStartIndex(items: StreamItem[], userStartedAt: number, userText?: string): number {
  let index = items.findIndex(
    (item) => item.kind === "user" && item.startedAt === userStartedAt,
  );
  if (index < 0) {
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind !== "user" || typeof item.startedAt !== "number") continue;
      const delta = Math.abs(item.startedAt - userStartedAt);
      if (delta <= 2 * 60_000 && delta < nearestDelta) {
        nearestDelta = delta;
        index = i;
      }
    }
  }
  if (index < 0 && userText) {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (
        item.kind === "user" &&
        (item.text.trim() === userText.trim() || item.text.includes(userText.trim()))
      ) {
        index = i;
        break;
      }
    }
  }
  return index < 0 ? items.length : index + 1;
}

export function planActivityForFlow(
  items: StreamItem[],
  flow: Pick<PlanFlow, "phase" | "userStartedAt" | "userText">,
): PlanActivity {
  if (flow.phase === "discussing") {
    return {
      stage: "waiting",
      label: "等待你的回答",
      detail: "请在页面底部高亮的“回答 Grok”输入框中作答，按 Enter 继续生成计划。",
    };
  }
  if (flow.phase === "awaiting_approval") {
    return {
      stage: "ready",
      label: "计划已生成",
      detail: "可以继续补充修改，也可以确认后开始执行。",
    };
  }
  if (flow.phase === "executing" || flow.phase === "approving") {
    return {
      stage: "executing",
      label: flow.phase === "approving" ? "正在切换到执行模式" : "正在执行计划",
      detail: "计划已经确认，接下来会按步骤更新真实进度。",
    };
  }
  if (flow.phase === "failed") {
    return {
      stage: "failed",
      label: "计划过程需要处理",
      detail: "可以继续输入补充内容，或使用下方按钮重试。",
    };
  }

  const start = flowStartIndex(items, flow.userStartedAt, flow.userText);
  const tools = items
    .slice(start)
    .filter((item): item is Extract<StreamItem, { kind: "tool" }> => item.kind === "tool");
  const latest = tools.at(-1);
  const settled = tools.filter((tool) => /completed|success|failed|cancelled/i.test(tool.status)).length;
  const isDrafting = Boolean(
    latest && /plan(?:\.md)?|计划|exit_plan|Plan: Exit/i.test(`${latest.title} ${latest.detail ?? ""}`),
  );

  if (flow.phase === "revising" || isDrafting) {
    return {
      stage: "drafting",
      label: flow.phase === "revising" ? "正在更新计划" : "正在整理计划",
      detail: tools.length > 0 ? `已完成 ${settled}/${tools.length} 项调查或整理操作。` : "正在根据你的补充调整步骤。",
    };
  }
  if (tools.length === 0) {
    return {
      stage: "understanding",
      label: "正在理解需求",
      detail: "正在判断是否有必须向你确认的问题；没有关键歧义时会直接规划。",
    };
  }
  const activeTool = [...tools].reverse().find((tool) => !/completed|success|failed|cancelled/i.test(tool.status));
  return {
    stage: "exploring",
    label: "正在检查项目",
    detail: activeTool
      ? `已完成 ${settled}/${tools.length} 项检查 · 当前：${activeTool.title}`
      : `已完成 ${settled}/${tools.length} 项检查，正在汇总结果。`,
  };
}

export function latestPlanClarification(
  items: StreamItem[],
  flow: Pick<PlanFlow, "userStartedAt" | "userText">,
): string | null {
  const start = flowStartIndex(items, flow.userStartedAt, flow.userText);
  for (let index = items.length - 1; index >= start; index -= 1) {
    const item = items[index];
    if (item?.kind !== "agent") continue;
    const text = item.text.trim();
    if (
      text &&
      (/[?？]/.test(text) ||
        /请(?:你)?(?:直接)?(?:回复|确认|选择|提供|说明|告诉)|请问|需要你(?:确认|决定|选择|提供|说明|回复)|想(?:向你)?确认|请选择|是否|哪(?:一|个|些|种)|什么|能否|可否/.test(text))
    ) {
      return text;
    }
  }
  return null;
}

export function mergeRecoveredPlan(
  items: StreamItem[],
  flow: Pick<PlanFlow, "userStartedAt" | "userText">,
  revision: PlanRevision,
): StreamItem[] {
  const start = flowStartIndex(items, flow.userStartedAt, flow.userText);
  let latestUserIndex = start - 1;
  for (let i = start; i < items.length; i += 1) {
    if (items[i]?.kind === "user") latestUserIndex = i;
  }
  for (let i = items.length - 1; i >= start; i -= 1) {
    if (items[i]?.kind !== "plan") continue;
    // A plan update already emitted in the current user turn is only missing
    // its full plan.md body, so enrich that card in place. If the latest plan
    // belongs to an earlier turn, preserve it and append a brand-new card.
    if (i <= latestUserIndex) break;
    const next = [...items];
    next[i] = {
      kind: "plan",
      revision: (items[i] as Extract<StreamItem, { kind: "plan" }>).revision,
      entries: revision.entries.map((entry) => ({ ...entry })),
      markdown: revision.markdown,
    };
    return next;
  }
  const nextRevision = items.filter((item) => item.kind === "plan").length + 1;
  return [
    ...items,
    {
      kind: "plan",
      revision: nextRevision,
      entries: revision.entries.map((entry) => ({ ...entry })),
      markdown: revision.markdown,
    },
  ];
}

export function recoverAwaitingPlanFlow(
  sessionId: string,
  items: StreamItem[],
): PlanFlow | null {
  let planIndex = -1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i]?.kind === "plan") {
      planIndex = i;
      break;
    }
  }
  if (planIndex < 0) return null;

  let userIndex = -1;
  for (let i = planIndex - 1; i >= 0; i -= 1) {
    if (items[i]?.kind === "user") {
      userIndex = i;
      break;
    }
  }
  const user = userIndex >= 0 && items[userIndex]?.kind === "user"
    ? (items[userIndex] as Extract<StreamItem, { kind: "user" }>)
    : null;
  const wrapped = user?.text ?? "";
  const request = wrapped.match(/用户需求：\s*([\s\S]+)$/)?.[1]?.trim() || wrapped.trim() || "继续完成当前计划";
  const startedAt = user?.startedAt ?? Date.now();
  return {
    planId: `recovered-plan-${sessionId}`,
    turnId: `recovered-turn-${sessionId}`,
    sessionId,
    open: true,
    phase: "awaiting_approval",
    pendingPrompt: request,
    userText: request,
    pendingImages: [],
    userStartedAt: startedAt,
    hasPlan: true,
  };
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
  const revisionBase = items.slice(0, start).filter(isPlanDocument).length;
  const revisions: PlanRevision[] = [];
  for (let i = start; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== "plan") continue;
    revisions.push({
      revision: revisionBase + revisions.length + 1,
      entries: item.entries.map((entry) => ({ ...entry })),
      markdown: item.markdown,
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

export function latestPlanDocument(items: StreamItem[]): PlanRevision | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.kind !== "plan" || !item.markdown) continue;
    return {
      revision: item.revision,
      entries: item.entries.map((entry) => ({ ...entry })),
      markdown: item.markdown,
    };
  }
  return null;
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
    `计划已批准。请严格执行下面的第 ${revision.revision} 份计划，不要重新规划。`,
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
  let latestPlanIndex = -1;
  let latestUserIndex = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (items[i]?.kind === "plan") latestPlanIndex = i;
    if (items[i]?.kind === "user") latestUserIndex = i;
  }
  if (latestUserIndex > latestPlanIndex) {
    const latestUser = items[latestUserIndex];
    if (latestUser?.kind === "user") {
      const clarificationScope = {
        userStartedAt: latestUser.startedAt ?? flow.userStartedAt,
        userText: latestUser.text,
      };
      if (latestPlanClarification(items, clarificationScope)) {
        return {
          ...flow,
          open: true,
          phase: "discussing",
          userStartedAt: clarificationScope.userStartedAt,
          userText: clarificationScope.userText,
          hasPlan: false,
          error: undefined,
        };
      }
    }
  }
  const hasPlan = planRevisionsForFlow(items, flow.userStartedAt, flow.userText).length > 0;
  if (flow.phase === "discussing" && hasPlan) {
    return {
      ...flow,
      open: true,
      phase: "awaiting_approval",
      hasPlan: true,
      error: undefined,
    };
  }
  if (flow.phase !== "generating" && flow.phase !== "revising" && flow.phase !== "approving") {
    return flow;
  }
  return settlePlanTurn({ ...flow, hasPlan });
}

export function isPlanFlow(value: unknown): value is PlanFlow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PlanFlow>;
  const phases: PlanFlowPhase[] = [
    "generating",
    "discussing",
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
