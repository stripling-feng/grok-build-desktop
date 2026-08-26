import assert from "node:assert/strict";
import test from "node:test";
import type { StreamItem } from "../electron/shared";
import {
  applyUpdateToItems,
  extractContextUsage,
  extractModifiedFilePaths,
  mergeContextUsage,
  planDocumentWasUpdatedForTurn,
} from "../electron/shared";
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
import {
  agentModeForComposer,
  isSessionViewCurrent,
  updateRunningSessionIds,
  updateUnreadSessionIds,
} from "../src/lib/session-state";
import {
  appendTurnChanges,
  isPlanDocument,
  latestPlan,
  mergeTranscriptWithLiveItems,
  planRevisions,
} from "../src/lib/stream";
import { threadTitleForDisplay, threadTitleFromPrompt } from "../src/lib/thread-title";
import { FollowUpQueue, followUpDisplayText } from "../electron/follow-ups";
import { TurnCompletionTracker } from "../electron/turn-completion";
import { latestUpdateTimestamp, resolveThreadUpdatedAt } from "../electron/thread-activity";
import { modelsFromCachePayload } from "../electron/model-catalog";
import { SessionReplayGate } from "../electron/session-replay";
import { resolveReasoningEffortValue } from "../electron/reasoning-effort";
import { resolveAccountUsagePercent } from "../electron/account-usage";
import { normalizeProxySettings } from "../electron/proxy-config";
import { pathsFromClipboardBuffer } from "../electron/clipboard-files";
import {
  buildApiProviderConfig,
  buildOAuthConfig,
  buildRepairedApiConfig,
  detachSubagentModelOverrides,
  hasSelectedApiProvider,
  normalizeApiBaseUrl,
  preferredAuthMethod,
  readApiProviderConfig,
  removeLegacyApiKeyAuthEntry,
  restoreSubagentModelOverrides,
} from "../electron/account-config";

const firstTurn = 100;
const currentTurn = 200;

test("proxy settings normalize supported modes and reject unsafe manual URLs", () => {
  assert.deepEqual(normalizeProxySettings({ mode: "system", url: "http://ignored:7890" }), {
    mode: "system",
    url: "",
  });
  assert.deepEqual(normalizeProxySettings({ mode: "manual", url: "http://127.0.0.1:7897/" }), {
    mode: "manual",
    url: "http://127.0.0.1:7897",
  });
  assert.throws(
    () => normalizeProxySettings({ mode: "manual", url: "socks5://127.0.0.1:7897" }),
    /HTTP\/HTTPS/,
  );
  assert.throws(
    () => normalizeProxySettings({ mode: "manual", url: "http://name:secret@127.0.0.1:7897" }),
    /用户名和密码/,
  );
});

test("an OAuth billing period with omitted zero usage does not promote prepaid balance", () => {
  assert.equal(
    resolveAccountUsagePercent({
      hasCurrentPeriod: true,
      onDemandUsed: 0,
      onDemandCap: 0,
    }),
    0,
  );
  assert.equal(
    resolveAccountUsagePercent({
      reportedPercent: 36,
      hasCurrentPeriod: true,
      onDemandUsed: 0,
      onDemandCap: 0,
    }),
    36,
  );
});

test("a bare API origin is normalized to its OpenAI-compatible v1 path", () => {
  assert.equal(normalizeApiBaseUrl("https://api.example.com/"), "https://api.example.com/v1");
  assert.equal(normalizeApiBaseUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1");
  assert.throws(() => normalizeApiBaseUrl("not-a-url"), /有效的 Base URL/);
});

test("API login selects the custom model without corrupting OAuth credentials", () => {
  const config = buildApiProviderConfig(
    '[models]\ndefault = "grok-4.6"\n\n[endpoints]\nmodels_base_url = "https://old.example/v1"\nxai_api_base_url = "https://old.example/v1"\n',
    {
    baseUrl: "https://api.example.com/v1/",
    apiKey: "secret-test-key",
    model: "proxy-model",
    contextWindow: 131_072,
    },
  );
  assert.equal(preferredAuthMethod(config), "api_key");
  assert.equal(hasSelectedApiProvider(config), true);
  assert.match(config, /default = "desktop-api"/);
  assert.match(config, /base_url = "https:\/\/api\.example\.com\/v1"/);
  assert.match(config, /model = "proxy-model"/);
  assert.match(config, /context_window = 131072/);
  assert.match(config, /supports_reasoning_effort = true/);
  assert.match(config, /reasoning_efforts = \["low","medium","high","xhigh"\]/);
  assert.doesNotMatch(config, /models_base_url|xai_api_base_url/);

  const oauth = { key: "oauth-token", auth_mode: "oidc" };
  const repaired = removeLegacyApiKeyAuthEntry({
    "https://auth.x.ai::user": oauth,
    "xai::api_key": { key: "legacy-key" },
  });
  assert.equal(repaired.changed, true);
  assert.deepEqual(repaired.auth, { "https://auth.x.ai::user": oauth });
});

test("saved API provider configuration can be loaded back into the login form", () => {
  const config = buildApiProviderConfig("", {
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret-test-key",
    model: "proxy-model",
    contextWindow: 131_072,
  });
  assert.deepEqual(readApiProviderConfig(config), {
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret-test-key",
    model: "proxy-model",
    contextWindow: 131_072,
  });
  assert.equal(readApiProviderConfig(""), null);
});

test("API mode suspends OAuth subagent model overrides and restores them later", () => {
  const original = '[models]\ndefault = "grok-4.6"\n\n[subagents.models]\ngeneral-purpose = "grok-4.6"\nexplore = "grok-4.5"\n';
  const detached = detachSubagentModelOverrides(original);
  assert.doesNotMatch(detached.config, /\[subagents\.models\]/);
  assert.match(detached.table || "", /general-purpose = "grok-4\.6"/);

  const api = buildApiProviderConfig(detached.config, {
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret-test-key",
  });
  assert.doesNotMatch(api, /\[subagents\.models\]/);

  const restored = restoreSubagentModelOverrides(buildOAuthConfig(api), detached.table);
  assert.match(restored, /\[subagents\.models\]/);
  assert.match(restored, /explore = "grok-4\.5"/);
});

test("API context window must be a positive integer", () => {
  assert.throws(
    () => buildApiProviderConfig("", {
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-test-key",
      contextWindow: 0,
    }),
    /上下文长度/,
  );
});

test("legacy API config is migrated and OAuth switching restores a built-in model", () => {
  const legacy = buildApiProviderConfig("", {
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret-test-key",
  }).replace(/\[auth\][\s\S]*?\n\n/, "");
  const migrated = buildRepairedApiConfig(legacy);
  assert.equal(preferredAuthMethod(migrated), "api_key");

  const oauth = buildOAuthConfig(migrated);
  assert.equal(preferredAuthMethod(oauth), "oidc");
  assert.match(oauth, /\[models\]\s+default = "grok-4\.6"/);
});

test("API credential repair restores the fixed provider after another model was selected", () => {
  const selectedElsewhere = buildApiProviderConfig("", {
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret-test-key",
    model: "proxy-model",
  }).replace('default = "desktop-api"', 'default = "grok-4.6"');

  const repaired = buildRepairedApiConfig(selectedElsewhere);
  assert.equal(preferredAuthMethod(repaired), "api_key");
  assert.equal(hasSelectedApiProvider(repaired), true);
});

test("API reasoning effort maps to a value advertised by the live ACP session", () => {
  assert.equal(resolveReasoningEffortValue("low", ["low", "high", "max"]), "low");
  assert.equal(resolveReasoningEffortValue("xhigh", ["low", "high", "max"]), "max");
  assert.equal(resolveReasoningEffortValue("medium", ["low", "high"]), "low");
  assert.equal(resolveReasoningEffortValue("high", ["none"]), null);
});

test("Windows clipboard file formats are decoded into attachment paths", () => {
  assert.deepEqual(
    pathsFromClipboardBuffer("FileNameW", Buffer.from("C:\\docs\\menu.md\0", "utf16le")),
    ["C:\\docs\\menu.md"],
  );

  const names = Buffer.from("C:\\docs\\one.txt\0D:\\assets\\two.pdf\0\0", "utf16le");
  const fileDrop = Buffer.alloc(20 + names.length);
  fileDrop.writeUInt32LE(20, 0);
  fileDrop.writeUInt32LE(1, 16);
  names.copy(fileDrop, 20);
  assert.deepEqual(
    pathsFromClipboardBuffer("CF_HDROP", fileDrop),
    ["C:\\docs\\one.txt", "D:\\assets\\two.pdf"],
  );
});

test("a late transcript load preserves a locally submitted turn", () => {
  const transcript: StreamItem[] = [
    { kind: "user", text: "旧问题", startedAt: 100 },
    { kind: "agent", text: "旧回答" },
  ];
  const live: StreamItem[] = [
    { kind: "user", text: "刚发送的问题", startedAt: 200 },
    { kind: "thought", text: "处理中" },
  ];

  assert.deepEqual(mergeTranscriptWithLiveItems(transcript, live), [...transcript, ...live]);
});

test("a transcript containing the live user turn is merged without duplication", () => {
  const transcript: StreamItem[] = [
    { kind: "user", text: "旧问题", startedAt: 100 },
    { kind: "agent", text: "旧回答" },
    { kind: "user", text: "刚发送的问题", startedAt: 2_000 },
  ];
  const live: StreamItem[] = [
    { kind: "user", text: "刚发送的问题", startedAt: 2_100 },
    { kind: "thought", text: "处理中" },
  ];

  assert.deepEqual(mergeTranscriptWithLiveItems(transcript, live), [
    transcript[0],
    transcript[1],
    ...live,
  ]);
});

test("live and fallback turn completion publish exactly once", () => {
  const tracker = new TurnCompletionTracker();

  assert.equal(tracker.acceptLive("session-replayed", 50), false);

  tracker.start("session-live");
  assert.equal(tracker.acceptLive("session-live", 100), true);
  assert.equal(tracker.acceptLive("session-live", 100), false);
  assert.equal(tracker.settle("session-live", 101), false);

  tracker.start("session-fallback");
  assert.equal(tracker.settle("session-fallback", 200), true);
  assert.equal(tracker.acceptLive("session-fallback", 201), false);
  assert.equal(tracker.acceptLive("session-fallback", 3_000), false);
});

test("a suppressed late live completion still lets the next turn fall back", () => {
  const tracker = new TurnCompletionTracker(2_000);
  tracker.start("session-sequential");
  assert.equal(tracker.settle("session-sequential", 100), true);

  tracker.start("session-sequential");
  assert.equal(tracker.acceptLive("session-sequential", 101), false);
  assert.equal(tracker.settle("session-sequential", 102), true);
});

test("historical thread activity ignores timestamps overwritten while opening a session", () => {
  const actualActivity = Date.parse("2026-08-24T06:11:19.000Z");
  const overwrittenSummary = {
    created_at: "2026-08-24T05:55:59.000Z",
    last_active_at: "2026-08-25T13:24:50.000Z",
    updated_at: "2026-08-25T13:34:08.000Z",
  };

  assert.equal(resolveThreadUpdatedAt(overwrittenSummary, actualActivity), "2026-08-24T06:11:19.000Z");
});

test("a copied thread remains newer than the history copied into it", () => {
  assert.equal(
    resolveThreadUpdatedAt(
      { created_at: "2026-08-25T13:40:00.000Z" },
      Date.parse("2026-08-24T06:11:19.000Z"),
    ),
    "2026-08-25T13:40:00.000Z",
  );
});

test("the latest persisted update timestamp is recovered from a JSONL tail", () => {
  const raw = [
    "partial-json-line",
    JSON.stringify({ timestamp: 1787551800, params: { update: { sessionUpdate: "agent_message_chunk" } } }),
    JSON.stringify({ timestamp: 1787551879, params: { update: { sessionUpdate: "turn_completed" } } }),
  ].join("\n");
  assert.equal(latestUpdateTimestamp(raw), 1787551879_000);
});

test("cumulative billing usage does not overwrite current context occupancy", () => {
  const live = extractContextUsage(
    { sessionUpdate: "agent_message_chunk" },
    { totalTokens: 210_711 },
  );
  const completed = extractContextUsage({
    sessionUpdate: "turn_completed",
    usage: {
      inputTokens: 8_119_129,
      cachedReadTokens: 7_907_840,
      totalTokens: 8_145_879,
    },
  });
  const merged = mergeContextUsage(live, completed);

  assert.equal(completed?.used, null);
  assert.equal(merged?.used, 210_711);
  assert.equal(merged?.inputTokens, 8_119_129);
});

test("model cache context windows are exposed to the context progress ring", () => {
  assert.deepEqual(
    modelsFromCachePayload({
      models: {
        "grok-4.6": {
          info: {
            id: "grok-4.6",
            name: "Grok 4.6",
            context_window: 500_000,
          },
        },
      },
    }),
    [{ id: "grok-4.6", name: "Grok 4.6", contextWindow: 500_000 }],
  );
});

test("historical ACP replay updates are suppressed without hiding later live updates", () => {
  const gate = new SessionReplayGate();
  gate.begin("session-history");
  gate.begin("session-history");
  assert.equal(gate.shouldSuppress("session-history"), true);
  assert.equal(gate.end("session-history"), 0);
  assert.equal(gate.shouldSuppress("session-history"), true);
  assert.equal(gate.end("session-history"), 2);
  assert.equal(gate.shouldSuppress("session-history"), false);
});

test("follow-up messages stay FIFO and a failed steer can be restored to the front", () => {
  const queue = new FollowUpQueue();
  const first = queue.create("session-queue", "先调整接口");
  const second = queue.create("session-queue", "再补测试");
  queue.enqueue(first);
  queue.enqueue(second);

  assert.equal(queue.take("session-queue")?.id, first.id);
  queue.prepend(first);
  assert.deepEqual(queue.list("session-queue").map((entry) => entry.id), [first.id, second.id]);
  assert.equal(queue.remove("session-queue", first.id)?.id, first.id);
  assert.equal(queue.take("session-queue")?.id, second.id);
  assert.equal(queue.has("session-queue"), false);
});

test("image-only follow-ups have a visible queue label", () => {
  const queue = new FollowUpQueue();
  const entry = queue.create("session-images", "", [
    { path: "C:\\tmp\\one.png", mimeType: "image/png" },
    { path: "C:\\tmp\\two.jpg", mimeType: "image/jpeg" },
  ]);
  assert.equal(followUpDisplayText(entry), "图片 ×2");
});

test("a thread title is available from the first prompt before the turn completes", () => {
  assert.equal(
    threadTitleFromPrompt("请帮我修复新建任务后侧栏一直显示未命名会话的问题，并补充测试"),
    "修复新建任务后侧栏一直显示未命名会话的问题，并补充测试",
  );
  assert.equal(
    threadTitleFromPrompt("新建任务时先显示会话名称，现在需要等回复完成后才会变，这个体验需要优化"),
    "新建任务时先显示会话名称，现在需要等回复完成后才会变，这…",
  );
  assert.equal(threadTitleFromPrompt("token=secret-value https://example.com"), "新任务");
  assert.equal(threadTitleForDisplay("未命名会话", "立即显示侧栏名称"), "立即显示侧栏名称");
  assert.equal(threadTitleForDisplay("正式生成的会话名称", "立即显示侧栏名称"), "正式生成的会话名称");
});

test("ACP modification updates expose diff and mutating tool paths", () => {
  assert.deepEqual(
    extractModifiedFilePaths({
      kind: "edit",
      locations: [{ path: "C:\\repo\\src\\App.tsx" }],
      rawInput: { filePath: "C:\\repo\\src\\App.tsx" },
      content: [
        { type: "diff", path: "C:\\repo\\src\\App.tsx", oldText: "a", newText: "b" },
        { type: "diff", path: "C:\\repo\\src\\index.css", oldText: "", newText: ".x {}" },
      ],
    }).sort(),
    ["C:\\repo\\src\\App.tsx", "C:\\repo\\src\\index.css"],
  );
  assert.deepEqual(
    extractModifiedFilePaths({ kind: "read", locations: [{ path: "C:\\repo\\README.md" }] }),
    [],
  );
});

test("turn changes are appended once below the current answer", () => {
  const items: StreamItem[] = [
    { kind: "user", text: "修改界面" },
    { kind: "agent", text: "已经完成。" },
  ];
  const first = appendTurnChanges(items, ["src\\App.tsx", "src/index.css", "src/App.tsx"]);
  const second = appendTurnChanges(first, ["electron/main.ts", "src/App.tsx"]);
  assert.deepEqual(second.at(-1), {
    kind: "changes",
    files: ["electron/main.ts", "src/App.tsx", "src/index.css"],
  });
  assert.equal(second.filter((item) => item.kind === "changes").length, 1);
});

test("turn change line counts follow normalized file paths", () => {
  const items: StreamItem[] = [{ kind: "user", text: "修改界面" }];
  const next = appendTurnChanges(items, ["src\\App.tsx"], {
    "src\\App.tsx": { added: 18, removed: 4 },
  });
  assert.deepEqual(next.at(-1), {
    kind: "changes",
    files: ["src/App.tsx"],
    stats: { "src/App.tsx": { added: 18, removed: 4 } },
  });
});

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
    {
      kind: "plan",
      revision: 1,
      entries: [{ content: "旧步骤", status: "done" }],
      markdown: "# 旧计划",
    },
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

test("completed background sessions remain unread until selected", () => {
  const current = new Set(["session-a"]);
  const completed = updateUnreadSessionIds(current, { sessionId: "session-b", unread: true });
  assert.deepEqual([...completed], ["session-a", "session-b"]);
  assert.deepEqual([...current], ["session-a"]);

  const selected = updateUnreadSessionIds(completed, { sessionId: "session-b", unread: false });
  assert.deepEqual([...selected], ["session-a"]);
});

test("ordinary-mode plan progress is not treated as a plan document", () => {
  const progress: StreamItem = {
    kind: "plan",
    revision: 1,
    entries: [{ content: "定位代码", status: "in_progress" }],
  };
  const document: StreamItem = {
    kind: "plan",
    revision: 1,
    entries: [{ content: "修改并验证", status: "pending" }],
    markdown: "# 完整计划\n\n1. 修改并验证",
  };

  assert.equal(isPlanDocument(progress), false);
  assert.equal(isPlanDocument(document), true);
  assert.deepEqual(latestPlan([progress]), []);
  assert.equal(planRevisions([progress]).length, 0);
  assert.deepEqual(latestPlan([progress, document]), document.entries);
  assert.equal(planRevisions([progress, document]).length, 1);
});

test("ordinary-mode plan progress does not increment plan document numbering", () => {
  const items: StreamItem[] = [
    { kind: "user", text: "普通执行", startedAt: 100 },
    { kind: "plan", revision: 1, entries: [{ content: "内部步骤", status: "done" }] },
    { kind: "user", text: "生成计划", startedAt: 200 },
    { kind: "plan", revision: 1, entries: [{ content: "正式计划", status: "pending" }] },
  ];

  assert.equal(planRevisionsForFlow(items, 200, "生成计划")[0]?.revision, 1);
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
