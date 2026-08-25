import assert from "node:assert/strict";
import test from "node:test";
import type { StreamItem } from "../electron/shared";
import { applyUpdateToItems, planDocumentWasUpdatedForTurn } from "../electron/shared";
import { planEntriesFromMarkdown } from "../electron/plan-document";
import {
  buildPlanConversationPrompt,
  buildPlanExecutionPrompt,
  latestPlanDocument,
  latestPlanClarification,
  latestPlanForFlow,
  markFlowPlans,
  mergeRecoveredPlan,
  planActivityForFlow,
  planRevisionsForFlow,
  recoverAwaitingPlanFlow,
  restorePlanFlow,
  settlePlanTurn,
  type PlanFlow,
} from "../src/lib/plan-flow";
import { agentModeForComposer, isSessionViewCurrent, updateRunningSessionIds } from "../src/lib/session-state";

const firstTurn = 100;
const currentTurn = 200;

test("background completion only clears its own session", () => {
  const running = new Set(["session-a", "session-b"]);
  const next = updateRunningSessionIds(running, { sessionId: "session-a", running: false });
  assert.deepEqual([...next], ["session-b"]);
  assert.deepEqual([...running], ["session-a", "session-b"]);
});

test("live updates are accepted only by their owning session view", () => {
  assert.equal(isSessionViewCurrent("session-b", "session-a"), false);
  assert.equal(isSessionViewCurrent("session-a", "session-a"), true);
  assert.equal(isSessionViewCurrent(null, "session-a"), false);
});

test("composer mode always maps ordinary messages back to act mode", () => {
  assert.equal(agentModeForComposer(true), "plan");
  assert.equal(agentModeForComposer(false), "act");
});

test("a plan clarification exposes the latest Grok question for the answer card", () => {
  const items: StreamItem[] = [
    { kind: "agent", text: "旧会话问题" },
    { kind: "user", text: "帮我制定迁移计划", startedAt: currentTurn },
    { kind: "thought", text: "检查需求" },
    { kind: "agent", text: "请确认：旧数据是否需要保留？" },
  ];
  assert.equal(
    latestPlanClarification(items, { userStartedAt: currentTurn, userText: "帮我制定迁移计划" }),
    "请确认：旧数据是否需要保留？",
  );
});

test("plan progress prose is not presented as a question", () => {
  const items: StreamItem[] = [
    { kind: "user", text: "帮我制定迁移计划", startedAt: currentTurn },
    { kind: "agent", text: "先做最少必要调查，接下来写入整体计划。" },
  ];
  assert.equal(
    latestPlanClarification(items, { userStartedAt: currentTurn, userText: "帮我制定迁移计划" }),
    null,
  );
});

test("an unchanged old plan file does not belong to a newer clarification turn", () => {
  assert.equal(planDocumentWasUpdatedForTurn(1_000, 2_000), false);
  assert.equal(planDocumentWasUpdatedForTurn(2_001, 2_000), true);
});

test("a clarification turn cannot reuse a plan from before the question", () => {
  const items: StreamItem[] = [
    { kind: "user", text: "第一次规划", startedAt: firstTurn },
    { kind: "plan", revision: 1, entries: [{ content: "旧计划", status: "pending" }] },
    { kind: "user", text: "这个计划不行，重新做", startedAt: currentTurn },
    { kind: "agent", text: "请选择范围 A 或 B。" },
  ];
  assert.equal(
    latestPlanForFlow(items, currentTurn, "这个计划不行，重新做"),
    null,
  );
});

function fixture(): StreamItem[] {
  return [
    { kind: "user", text: "旧任务", startedAt: firstTurn },
    { kind: "plan", revision: 1, entries: [{ content: "旧步骤", status: "done" }] },
    { kind: "user", text: "当前任务", startedAt: currentTurn },
    { kind: "plan", revision: 1, entries: [{ content: "当前步骤 A", status: "pending" }] },
    { kind: "user", text: "[计划修订] 增加测试", startedAt: 201 },
    { kind: "plan", revision: 1, entries: [{ content: "当前步骤 B", status: "pending" }] },
  ];
}

test("plans keep stable conversation-wide numbers across plan turns", () => {
  const revisions = planRevisionsForFlow(fixture(), currentTurn);
  assert.deepEqual(
    revisions.map((row) => ({ revision: row.revision, step: row.entries[0]?.content })),
    [
      { revision: 2, step: "当前步骤 A" },
      { revision: 3, step: "当前步骤 B" },
    ],
  );
});

test("rejecting a plan does not mutate historical plans", () => {
  const next = markFlowPlans(fixture(), currentTurn, "cancelled");
  const plans = next.filter((item) => item.kind === "plan");
  assert.equal(plans[0]?.kind === "plan" && plans[0].entries[0]?.status, "done");
  assert.equal(plans[1]?.kind === "plan" && plans[1].entries[0]?.status, "cancelled");
  assert.equal(plans[2]?.kind === "plan" && plans[2].entries[0]?.status, "cancelled");
});

test("execution prompt pins the selected revision and its exact steps", () => {
  const revision = planRevisionsForFlow(fixture(), currentTurn)[0];
  const prompt = buildPlanExecutionPrompt("实现当前任务", revision);
  assert.match(prompt, /第 2 份计划/);
  assert.match(prompt, /当前步骤 A/);
  assert.match(prompt, /原始任务：\n实现当前任务/);
  assert.doesNotMatch(prompt, /当前步骤 B/);
});

test("the first plan prompt allows clarification before generating a plan", () => {
  const prompt = buildPlanConversationPrompt("实现搜索功能");
  assert.match(prompt, /不要修改文件或执行实现/);
  assert.match(prompt, /关键信息缺失/);
  assert.match(prompt, /等待我回答/);
  assert.match(prompt, /不要调用交互式问答工具/);
  assert.match(prompt, /实现搜索功能/);
});

test("a plan turn without a plan remains conversational", () => {
  const flow: PlanFlow = {
    planId: "plan-discussion",
    turnId: "turn-discussion",
    sessionId: "session-discussion",
    open: true,
    phase: "generating",
    pendingPrompt: "实现搜索功能",
    userText: "实现搜索功能",
    pendingImages: [],
    userStartedAt: currentTurn,
    hasPlan: false,
  };
  const settled = settlePlanTurn(flow);
  assert.equal(settled.phase, "discussing");
  assert.equal(settled.open, true);
  assert.equal(settled.error, undefined);
});

test("a plan turn with a plan becomes ready for approval", () => {
  const flow: PlanFlow = {
    planId: "plan-ready",
    turnId: "turn-ready",
    sessionId: "session-ready",
    open: false,
    phase: "revising",
    pendingPrompt: "实现搜索功能",
    userText: "实现搜索功能",
    pendingImages: [],
    userStartedAt: currentTurn,
    hasPlan: true,
  };
  const settled = settlePlanTurn(flow);
  assert.equal(settled.phase, "awaiting_approval");
  assert.equal(settled.open, true);
});

test("an interrupted generation restores to approval when a plan was persisted in transcript", () => {
  const flow: PlanFlow = {
    planId: "plan-1",
    turnId: "turn-1",
    sessionId: "session-1",
    open: false,
    phase: "generating",
    pendingPrompt: "当前任务",
    userText: "当前任务",
    pendingImages: [],
    userStartedAt: currentTurn,
    hasPlan: false,
  };
  const restored = restorePlanFlow(flow, fixture());
  assert.equal(restored.phase, "awaiting_approval");
  assert.equal(restored.hasPlan, true);
  assert.equal(restored.open, true);
});

test("a stale discussion restores to approval once its plan exists", () => {
  const flow: PlanFlow = {
    planId: "plan-stale-discussion",
    turnId: "turn-stale-discussion",
    sessionId: "session-stale-discussion",
    open: true,
    phase: "discussing",
    pendingPrompt: "当前任务",
    userText: "当前任务",
    pendingImages: [],
    userStartedAt: currentTurn,
    hasPlan: false,
  };
  const restored = restorePlanFlow(flow, fixture());
  assert.equal(restored.phase, "awaiting_approval");
  assert.equal(restored.hasPlan, true);
  assert.equal(restored.error, undefined);
});

test("a stale approval restores to discussion when a newer question is unanswered", () => {
  const flow: PlanFlow = {
    planId: "plan-stale-approval",
    turnId: "turn-stale-approval",
    sessionId: "session-stale-approval",
    open: true,
    phase: "awaiting_approval",
    pendingPrompt: "营养食谱",
    userText: "第一次规划",
    pendingImages: [],
    userStartedAt: firstTurn,
    hasPlan: true,
  };
  const transcript: StreamItem[] = [
    { kind: "user", text: "第一次规划", startedAt: firstTurn },
    { kind: "plan", revision: 1, entries: [{ content: "旧计划", status: "pending" }] },
    { kind: "user", text: "这个计划不行，重新做", startedAt: currentTurn },
    { kind: "agent", text: "请直接回复选择：1B 2A。" },
  ];
  const restored = restorePlanFlow(flow, transcript);
  assert.equal(restored.phase, "discussing");
  assert.equal(restored.hasPlan, false);
  assert.equal(restored.userStartedAt, currentTurn);
  assert.equal(restored.userText, "这个计划不行，重新做");
});

test("restoration falls back to user text when transcript timestamps differ", () => {
  const flow: PlanFlow = {
    planId: "plan-2",
    turnId: "turn-2",
    sessionId: "session-2",
    open: false,
    phase: "generating",
    pendingPrompt: "当前任务",
    userText: "当前任务",
    pendingImages: [],
    userStartedAt: 999,
    hasPlan: false,
  };
  const restored = restorePlanFlow(flow, fixture());
  assert.equal(restored.phase, "awaiting_approval");
});

test("restoration finds a user request inside the desktop plan wrapper", () => {
  const flow: PlanFlow = {
    planId: "plan-wrapped",
    turnId: "turn-wrapped",
    sessionId: "session-wrapped",
    open: true,
    phase: "generating",
    pendingPrompt: "右侧边栏",
    userText: "右侧边栏",
    pendingImages: [],
    userStartedAt: 999,
    hasPlan: false,
  };
  const transcript: StreamItem[] = [
    { kind: "user", text: "计划模式说明\n\n用户需求：\n右侧边栏", startedAt: 1000 },
    { kind: "plan", revision: 1, entries: [{ content: "实现布局", status: "pending" }] },
  ];
  assert.equal(restorePlanFlow(flow, transcript).phase, "awaiting_approval");
});

test("plan activity reports live project checks", () => {
  const activity = planActivityForFlow(
    [
      { kind: "user", text: "当前任务", startedAt: currentTurn },
      { kind: "tool", id: "a", title: "读取 App.tsx", status: "completed" },
      { kind: "tool", id: "b", title: "搜索布局样式", status: "pending" },
    ],
    { phase: "generating", userStartedAt: currentTurn, userText: "当前任务" },
  );
  assert.equal(activity.stage, "exploring");
  assert.match(activity.detail, /1\/2/);
  assert.match(activity.detail, /搜索布局样式/);
});

test("recovered detailed plan replaces the temporary summary", () => {
  const merged = mergeRecoveredPlan(
    fixture().slice(0, 4),
    { userStartedAt: currentTurn, userText: "当前任务" },
    {
      revision: 1,
      entries: [{ content: "P0 壳层\n• 三栏布局", status: "pending" }],
      markdown: "# 计划\n\n### P0 壳层\n- 三栏布局",
    },
  );
  const plans = merged.filter((item) => item.kind === "plan");
  assert.equal(plans.length, 2);
  assert.equal(plans[1]?.kind === "plan" && plans[1].entries[0]?.content, "P0 壳层\n• 三栏布局");
  assert.match(plans[1]?.kind === "plan" ? plans[1].markdown ?? "" : "", /# 计划/);
});

test("a newly generated plan is appended without replacing the previous plan card", () => {
  const items: StreamItem[] = [
    { kind: "user", text: "第一次规划", startedAt: currentTurn },
    {
      kind: "plan",
      revision: 1,
      entries: [{ content: "旧计划", status: "pending" }],
      markdown: "# 旧计划",
    },
    { kind: "user", text: "重新生成一份计划", startedAt: currentTurn + 1 },
  ];
  const merged = mergeRecoveredPlan(
    items,
    { userStartedAt: currentTurn, userText: "第一次规划" },
    {
      revision: 1,
      entries: [{ content: "新计划", status: "pending" }],
      markdown: "# 新计划",
    },
  );
  const plans = merged.filter((item) => item.kind === "plan");
  assert.equal(plans.length, 2);
  assert.equal(plans[0]?.kind === "plan" ? plans[0].markdown : "", "# 旧计划");
  assert.equal(plans[1]?.kind === "plan" ? plans[1].markdown : "", "# 新计划");
  assert.equal(plans[1]?.kind === "plan" ? plans[1].revision : 0, 2);
});

test("plan revisions retain the complete markdown document", () => {
  const items: StreamItem[] = [
    { kind: "user", text: "当前任务", startedAt: currentTurn },
    {
      kind: "plan",
      revision: 1,
      entries: [{ content: "P0 壳层", status: "pending" }],
      markdown: "# 完整计划\n\n### P0 壳层",
    },
  ];
  assert.match(planRevisionsForFlow(items, currentTurn)[0]?.markdown ?? "", /完整计划/);
  assert.match(latestPlanDocument(items)?.markdown ?? "", /完整计划/);
});

test("a retried identical prompt does not hide the earlier completed plan", () => {
  const items: StreamItem[] = [
    { kind: "user", text: "计划说明\n\n用户需求：\n实现右侧边栏", startedAt: 1_000 },
    {
      kind: "plan",
      revision: 1,
      entries: [{ content: "P0 壳层", status: "pending" }],
      markdown: "# 完整计划\n\n### P0 壳层",
    },
    { kind: "user", text: "计划说明\n\n用户需求：\n实现右侧边栏", startedAt: 8_000 },
  ];
  const revisions = planRevisionsForFlow(items, 1_050, "实现右侧边栏");
  assert.equal(revisions.length, 1);
  assert.match(revisions[0]?.markdown ?? "", /完整计划/);
});

test("markdown plan phases become executable plan entries", () => {
  const entries = planEntriesFromMarkdown(`# 右侧边栏\n\n## 分阶段\n\n### P0 壳层\n- 三栏布局\n- 保存宽度\n\n验收：刷新后保留\n\n### P1 更改\n- 迁移 DiffPanel`);
  assert.equal(entries.length, 2);
  assert.match(entries[0]?.content ?? "", /P0 壳层/);
  assert.match(entries[0]?.content ?? "", /三栏布局/);
  assert.equal(entries[0]?.status, "pending");
});

test("an awaiting plan can be recovered even when local storage is missing", () => {
  const recovered = recoverAwaitingPlanFlow("session-recovered", [
    { kind: "user", text: "计划说明\n\n用户需求：\n实现右侧边栏", startedAt: currentTurn },
    { kind: "plan", revision: 1, entries: [{ content: "P0 壳层", status: "pending" }] },
  ]);
  assert.equal(recovered?.phase, "awaiting_approval");
  assert.equal(recovered?.open, true);
  assert.equal(recovered?.pendingPrompt, "实现右侧边栏");
});

test("a delayed pending update cannot regress an executing plan step", () => {
  const items: StreamItem[] = [
    {
      kind: "plan",
      revision: 1,
      entries: [{ content: "运行测试", status: "in_progress" }],
    },
  ];
  applyUpdateToItems(items, new Map(), "plan", {
    revision: 1,
    entries: [{ content: "运行测试", status: "pending" }],
  });
  const plan = items[0];
  assert.equal(plan.kind === "plan" && plan.entries[0]?.status, "in_progress");
});

test("an execution interrupted by app restart requires review instead of automatic re-execution", () => {
  const flow: PlanFlow = {
    planId: "plan-3",
    turnId: "turn-3",
    sessionId: "session-3",
    open: false,
    phase: "executing",
    pendingPrompt: "当前任务",
    userText: "当前任务",
    pendingImages: [],
    userStartedAt: currentTurn,
    hasPlan: true,
  };
  const restored = restorePlanFlow(flow, fixture());
  assert.equal(restored.phase, "failed");
  assert.match(restored.error || "", /检查实际改动/);
});
