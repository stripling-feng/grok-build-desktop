import assert from "node:assert/strict";
import test from "node:test";
import type { StreamItem } from "../electron/shared";
import { applyUpdateToItems } from "../electron/shared";
import {
  buildPlanExecutionPrompt,
  markFlowPlans,
  planRevisionsForFlow,
  restorePlanFlow,
  type PlanFlow,
} from "../src/lib/plan-flow";

const firstTurn = 100;
const currentTurn = 200;

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

test("plan revisions are scoped to the active plan turn and get stable client revisions", () => {
  const revisions = planRevisionsForFlow(fixture(), currentTurn);
  assert.deepEqual(
    revisions.map((row) => ({ revision: row.revision, step: row.entries[0]?.content })),
    [
      { revision: 1, step: "当前步骤 A" },
      { revision: 2, step: "当前步骤 B" },
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
  assert.match(prompt, /第 1 版计划/);
  assert.match(prompt, /当前步骤 A/);
  assert.match(prompt, /原始任务：\n实现当前任务/);
  assert.doesNotMatch(prompt, /当前步骤 B/);
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
