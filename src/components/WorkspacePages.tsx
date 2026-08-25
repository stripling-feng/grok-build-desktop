import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  Automation,
  AutomationFrequency,
  AutomationInput,
  AvailablePluginInfo,
  IntervalUnit,
  ProjectInfo,
} from "../../electron/shared";
import {
  MarketForm,
  McpForm,
  McpTab,
  PluginsTab,
  SkillsTab,
  type SettingsRun,
} from "./Settings";

export type WorkspacePage = "chat" | "marketplace" | "automation";
export type MarketplaceTab = "market" | "mcp" | "skills";

const MARKET_TABS: { id: MarketplaceTab; label: string }[] = [
  { id: "market", label: "市场" },
  { id: "mcp", label: "MCP" },
  { id: "skills", label: "Skills" },
];

function useWorkspaceActions() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function run<T>(label: string, work: () => Promise<T>) {
    setBusy(label);
    setError("");
    try {
      return await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setBusy("");
    }
  }

  return { busy, error, run: run as SettingsRun };
}

export function MarketplacePage({
  settings,
  cwd,
  onChange,
}: {
  settings: AppSettings | null;
  cwd?: string | null;
  onChange: (next: AppSettings) => void;
}) {
  const [tab, setTab] = useState<MarketplaceTab>("market");
  const [mcpOpen, setMcpOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [doctor, setDoctor] = useState("");
  const [available, setAvailable] = useState<AvailablePluginInfo[] | null>(null);
  const marketLoadStarted = useRef(false);
  const { busy, error, run } = useWorkspaceActions();

  async function refreshAvailable() {
    const rows = await run("读取市场", () => window.grok.availablePlugins());
    if (rows) setAvailable(rows);
  }

  useEffect(() => {
    if (!settings || marketLoadStarted.current) return;
    marketLoadStarted.current = true;
    void refreshAvailable();
  }, [settings]);

  if (!settings) {
    return (
      <section className="workspace-page">
        <div className="workspace-empty">正在读取插件与 MCP 配置…</div>
      </section>
    );
  }

  return (
    <section className="workspace-page">
      <div className="workspace-head">
        <h1>插件市场</h1>
      </div>
      <div className="workspace-tabs">
        {MARKET_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "on" : ""}
            onClick={() => {
              setTab(item.id);
              setDoctor("");
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="workspace-body">
        {error ? <p className="settings-error">{error}</p> : null}
        {busy ? <p className="settings-hint">{busy}…</p> : null}
        {tab === "market" ? (
          <PluginsTab
            settings={settings}
            cwd={cwd}
            available={available}
            loading={busy === "读取市场"}
            onRefresh={refreshAvailable}
            onMarket={() => setMarketOpen(true)}
            onChange={onChange}
            run={run}
          />
        ) : null}
        {tab === "mcp" ? (
          <McpTab
            settings={settings}
            cwd={cwd}
            doctor={doctor}
            onDoctor={setDoctor}
            onOpenAdd={() => setMcpOpen(true)}
            onChange={onChange}
            run={run}
          />
        ) : null}
        {tab === "skills" ? (
          <SkillsTab settings={settings} cwd={cwd} onChange={onChange} run={run} />
        ) : null}
      </div>
      {mcpOpen ? (
        <McpForm
          cwd={cwd}
          onClose={() => setMcpOpen(false)}
          onChange={(next) => {
            onChange(next);
            setMcpOpen(false);
          }}
          run={run}
        />
      ) : null}
      {marketOpen ? (
        <MarketForm
          cwd={cwd}
          onClose={() => setMarketOpen(false)}
          onChange={async (next) => {
            onChange(next);
            setMarketOpen(false);
            await refreshAvailable();
          }}
          run={run}
        />
      ) : null}
    </section>
  );
}

type ScheduleDraft = {
  title: string;
  prompt: string;
  cwd: string;
  frequency: AutomationFrequency;
  time: string;
  minute: number;
  weekdays: number[];
  dayOfMonth: number;
  interval: number;
  intervalUnit: IntervalUnit;
  recurring: boolean;
  maxRuns: string;
  endsAt: string;
};

type Template = {
  id: string;
  title: string;
  description: string;
  schedule: string;
  prompt: string;
  draft: Partial<ScheduleDraft>;
};

const WEEKDAYS = [
  { id: 0, label: "日" },
  { id: 1, label: "一" },
  { id: 2, label: "二" },
  { id: 3, label: "三" },
  { id: 4, label: "四" },
  { id: 5, label: "五" },
  { id: 6, label: "六" },
];

const TEMPLATES: Template[] = [
  {
    id: "weeklyReview",
    title: "每周回顾",
    description: "每周五总结这一周发生的事情。",
    schedule: "每周五 16:00",
    prompt: "基于当前项目中可验证的活动生成精简周五回顾，汇总本周变更和待跟进事项；无法获取的信息明确标注，不修改代码或外部状态。",
    draft: { frequency: "weekly", time: "16:00", weekdays: [5] },
  },
  {
    id: "meetingPrep",
    title: "会议准备",
    description: "开会前整理参会人、背景和议程。",
    schedule: "每周五 16:00",
    prompt: "基于可用的日历和项目信息生成精简会议简报，覆盖参会人、背景和议程；无法获取的信息明确标注，不修改外部状态。",
    draft: { frequency: "weekly", time: "16:00", weekdays: [5] },
  },
  {
    id: "contentIdeas",
    title: "内容灵感",
    description: "每周根据行业最新动态，草拟几条选题灵感。",
    schedule: "每周一 9:00",
    prompt: "基于可验证的近期行业和项目信息草拟几条内容灵感，注明使用的事实依据；无法获取的信息明确标注，不发布内容或修改外部状态。",
    draft: { frequency: "weekly", time: "09:00", weekdays: [1] },
  },
  {
    id: "morningDevBrief",
    title: "晨会动态",
    description: "汇总上一个工作日以来的提交、模块变化与待跟进事项。",
    schedule: "工作日 09:00",
    prompt: "汇总上一个工作日以来的提交、模块变化、CI 状态和待跟进事项，最终生成不超过 5 条的晨会口述摘要。只读分析，只使用可验证的仓库事实；证据不足时明确说明，不推测，也不修改代码或外部状态。",
    draft: { frequency: "weekdays", time: "09:00" },
  },
  {
    id: "dailyRiskScan",
    title: "风险扫描",
    description: "检查最近 24 小时的代码变更，报告有直接证据的高置信风险。",
    schedule: "每天 10:00",
    prompt: "检查最近 24 小时的代码变更，识别运行错误、数据丢失、权限绕过、资源泄漏及跨端兼容等高置信风险，并附代码和 commit/diff 证据。只读分析，只使用可验证的仓库事实；证据不足时明确说明，不推测，也不修改代码或外部状态。",
    draft: { frequency: "daily", time: "10:00" },
  },
  {
    id: "weeklyReleaseBrief",
    title: "发布简报",
    description: "整理本周已合并变更，生成团队版与用户版发布摘要。",
    schedule: "每周五 16:00",
    prompt: "整理本周合并的 PR 和 commit，按功能、修复、体验及工程改进分类，同时生成团队版和面向用户的精简发布说明。只读分析，只使用可验证的仓库事实；证据不足时明确说明，不推测，也不修改代码或外部状态。",
    draft: { frequency: "weekly", time: "16:00", weekdays: [5] },
  },
  {
    id: "documentationSyncCheck",
    title: "文档同步检查",
    description: "对照近期实现变更，找出可能遗漏的文档更新。",
    schedule: "每周三 15:00",
    prompt: "对照最近 7 天的代码、配置、接口与文档变更，识别已改变公开行为但文档尚未同步的高置信差异，并附文件路径和 commit/diff 证据，给出应更新的文档位置与要点。只读分析，只使用可验证的仓库事实；证据不足时明确说明，不推测，也不修改代码或外部状态。",
    draft: { frequency: "weekly", time: "15:00", weekdays: [3] },
  },
];

const QUICK_CREATE_DRAFT: Partial<ScheduleDraft> = {
  title: "工作日项目摘要",
  prompt: "汇总当前项目的代码变更和待跟进事项。",
  frequency: "weekdays",
  time: "09:00",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatDuration(ms?: number) {
  if (!ms || ms < 0) return "—";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function clockLabel(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateInputLabel(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function relativeWhen(ms?: number | null, now = Date.now()) {
  if (!ms) return "未安排";
  const delta = ms - now;
  const abs = Math.abs(delta);
  if (abs < 60_000) return delta >= 0 ? "1 分钟内" : "刚刚";
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) {
    const amount = `${minutes} 分钟`;
    return delta >= 0 ? `${amount}后` : `${amount}前`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    const amount = `${hours} 小时`;
    return delta >= 0 ? `${amount}后` : `${amount}前`;
  }
  const days = Math.round(hours / 24);
  const amount = `${days} 天`;
  return delta >= 0 ? `${amount}后` : `${amount}前`;
}

function isFinished(row: Automation, now = Date.now()) {
  const runLimit = row.maxRuns ?? (row.recurring ? null : 1);
  return Boolean(
    (runLimit != null && row.runCount >= runLimit) ||
      (row.endsAt != null && row.endsAt <= now),
  );
}

function lifecycle(row: Automation, now = Date.now()) {
  if (row.lastStatus === "running") return { id: "running", label: "正在执行" };
  if (!row.enabled && isFinished(row, now)) {
    if (row.lastStatus === "error") return { id: "failed", label: "执行失败" };
    return { id: "completed", label: "已完成" };
  }
  if (!row.enabled) return { id: "paused", label: "已暂停" };
  if (row.lastStatus === "error") return { id: "failed", label: "上次失败" };
  return { id: "active", label: "已启用" };
}

function emptyDraft(cwd?: string | null): ScheduleDraft {
  return {
    title: "",
    prompt: "",
    cwd: cwd || "",
    frequency: "daily",
    time: "09:00",
    minute: 0,
    weekdays: [5],
    dayOfMonth: 1,
    interval: 1,
    intervalUnit: "daily",
    recurring: true,
    maxRuns: "",
    endsAt: "",
  };
}

function draftFromRow(row: Automation): ScheduleDraft {
  return {
    title: row.title,
    prompt: row.prompt,
    cwd: row.cwd || "",
    frequency: row.frequency || "daily",
    time: row.time || "09:00",
    minute: row.minute ?? 0,
    weekdays: row.weekdays?.length ? row.weekdays : [5],
    dayOfMonth: row.dayOfMonth || 1,
    interval: row.interval || 1,
    intervalUnit: row.intervalUnit || "daily",
    recurring: row.recurring,
    maxRuns: row.maxRuns ? String(row.maxRuns) : "",
    endsAt: row.endsAt ? dateInputLabel(row.endsAt) : "",
  };
}

function toInput(draft: ScheduleDraft): AutomationInput {
  return {
    title: draft.title.trim() || "未命名定时任务",
    prompt: draft.prompt.trim(),
    cwd: draft.cwd,
    enabled: true,
    recurring: draft.recurring,
    frequency: draft.frequency,
    time: draft.time,
    minute: draft.minute,
    weekdays: draft.frequency === "weekly" || (draft.frequency === "custom" && draft.intervalUnit === "weekly") ? draft.weekdays : null,
    dayOfMonth: draft.frequency === "monthly" || (draft.frequency === "custom" && draft.intervalUnit === "monthly") ? draft.dayOfMonth : null,
    interval: draft.frequency === "custom" ? Math.max(1, draft.interval || 1) : null,
    intervalUnit: draft.frequency === "custom" ? draft.intervalUnit : null,
    maxRuns: draft.recurring ? null : Math.max(1, Number(draft.maxRuns) || 1),
    endsAt: draft.endsAt ? new Date(`${draft.endsAt}T23:59:59`).getTime() : null,
  };
}

function schedulePreview(draft: ScheduleDraft) {
  const input = toInput(draft);
  if (draft.frequency === "hourly") return `每小时的第 ${draft.minute} 分`;
  if (draft.frequency === "daily") return `每天 ${draft.time}`;
  if (draft.frequency === "weekdays") return `每工作日 ${draft.time}`;
  if (draft.frequency === "weekly") {
    const days = draft.weekdays.map((d) => WEEKDAYS.find((w) => w.id === d)?.label || String(d)).join("、");
    return `每周${days} ${draft.time}`;
  }
  if (draft.frequency === "monthly") return `每月 ${draft.dayOfMonth} 号 ${draft.time}`;
  if (draft.frequency === "custom") {
    const n = Math.max(1, draft.interval || 1);
    if (draft.intervalUnit === "minute") return `每 ${n} 分钟`;
    if (draft.intervalUnit === "hourly") return n === 1 ? `每小时的第 ${draft.minute} 分` : `每 ${n} 小时的第 ${draft.minute} 分`;
    if (draft.intervalUnit === "daily") return n === 1 ? `每天 ${draft.time}` : `每 ${n} 天 ${draft.time}`;
    if (draft.intervalUnit === "weekly") {
      const days = draft.weekdays.map((d) => WEEKDAYS.find((w) => w.id === d)?.label || String(d)).join("、");
      return n === 1 ? `每周${days} ${draft.time}` : `每 ${n} 周的周${days}，${draft.time}`;
    }
    if (draft.intervalUnit === "monthly") return n === 1 ? `每月 ${draft.dayOfMonth} 号 ${draft.time}` : `每 ${n} 个月的 ${draft.dayOfMonth} 日，${draft.time}`;
    if (draft.intervalUnit === "yearly") return `每 ${n} 年`;
  }
  return input.title;
}

export function AutomationPage({
  cwd,
  projects,
  createRequest = 0,
  onOpenSession,
}: {
  cwd?: string | null;
  projects: ProjectInfo[];
  createRequest?: number;
  onOpenSession?: (sessionId: string, cwd: string) => void;
}) {
  const [rows, setRows] = useState<Automation[]>([]);
  const [now, setNow] = useState(Date.now());
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; row?: Automation; seed?: Partial<ScheduleDraft>; history?: boolean } | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; action: "run" | "toggle" | "delete" } | null>(null);
  const { busy, error, run } = useWorkspaceActions();

  useEffect(() => {
    let off = () => {};
    void window.grok
      .listAutomations()
      .then(setRows)
      .catch((err) => {
        setRows([]);
        console.error(err);
      });
    if (typeof window.grok.onAutomations === "function") {
      off = window.grok.onAutomations((next) => setRows(Array.isArray(next) ? next : []));
    }
    return () => off();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!menuId) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest(".auto-more")) return;
      setMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuId(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  useEffect(() => {
    if (createRequest) setEditor({ mode: "create" });
  }, [createRequest]);

  useEffect(() => {
    setEditor((cur) => {
      if (!cur?.row) return cur;
      const next = rows.find((row) => row.id === cur.row?.id);
      if (!next || next === cur.row) return cur;
      return { ...cur, row: next };
    });
  }, [rows]);

  const projectName = (path: string) => projects.find((p) => p.cwd.toLowerCase() === path.toLowerCase())?.name || path || "普通会话";
  const counts = useMemo(() => {
    let active = 0;
    let paused = 0;
    let running = 0;
    for (const row of rows) {
      const state = lifecycle(row, now).id;
      if (state === "running") running += 1;
      else if (row.enabled) active += 1;
      else if (state === "paused") paused += 1;
    }
    return { active, paused, running };
  }, [rows, now]);

  async function perform(
    row: Automation,
    action: "run" | "toggle" | "delete",
    label: string,
    work: () => Promise<Automation[]>,
  ) {
    if (pending) return;
    setPending({ id: row.id, action });
    try {
      const next = await run(label, work);
      if (next) setRows(next);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="workspace-page">
      <div className="workspace-head">
        <div className="workspace-head-copy">
          <h1>
            自动化 <span className="beta-badge">Beta</span>
          </h1>
        </div>
        <div className="workspace-head-actions">
          <button
            className="btn small ghost"
            type="button"
            onClick={() => setEditor({ mode: "create", seed: { ...QUICK_CREATE_DRAFT, cwd: cwd || "" } })}
          >
            快速创建
          </button>
          <button className="btn small primary" type="button" onClick={() => setEditor({ mode: "create" })}>
            创建定时任务
          </button>
        </div>
      </div>
      <div className="workspace-body auto-page">
        <div className="auto-intro">
          <div>
            <h2>让任务按计划自动执行</h2>
            <p>应用保持运行且电脑处于唤醒状态时，任务会在独立会话中执行。</p>
          </div>
          {rows.length ? (
            <div className="auto-summary" aria-label="任务概览">
              <span><strong>{counts.active}</strong> 已启用</span>
              <span><strong>{counts.running}</strong> 执行中</span>
              <span><strong>{counts.paused}</strong> 已暂停</span>
            </div>
          ) : null}
        </div>
        {error ? <p className="auto-feedback error" role="alert">{error}</p> : null}
        {busy ? <p className="auto-feedback" role="status">{busy}…</p> : null}

        {rows.length === 0 ? (
          <div className="workspace-empty">
            <div className="auto-empty-icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 7.6v4.9l3.2 1.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2>还没有自动化任务</h2>
            <p>从空白任务开始，或直接使用下方模板。</p>
            <div className="auto-empty-actions">
              <button
                className="btn small ghost"
                type="button"
                onClick={() => setEditor({ mode: "create", seed: { ...QUICK_CREATE_DRAFT, cwd: cwd || "" } })}
              >
                快速创建
              </button>
              <button className="btn small primary" type="button" onClick={() => setEditor({ mode: "create" })}>
                手动创建
              </button>
            </div>
          </div>
        ) : (
          <div className="auto-section">
            <h2 className="auto-section-title">定时任务</h2>
            <div className="auto-list">
              {rows.map((row) => {
                const life = lifecycle(row, now);
                const isPending = pending?.id === row.id;
                const timing = row.lastStatus === "running"
                  ? `正在执行${row.runs?.find((item) => item.status === "running")?.trigger === "manual" ? "（手动）" : ""}`
                  : row.enabled && row.nextRunAt
                    ? `下次运行 ${relativeWhen(row.nextRunAt, now)}`
                    : row.lastRunAt
                      ? `上次 ${relativeWhen(row.lastRunAt, now)}`
                      : "";
                return (
                  <article className={`auto-card${row.enabled ? "" : " off"}`} key={row.id}>
                    <div className="auto-card-top">
                      <div className={`auto-state-icon ${life.id}`} aria-hidden>
                        {life.id === "running" ? (
                          <span className="auto-spinner" />
                        ) : (
                          <svg width="17" height="17" viewBox="0 0 20 20">
                            <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                            <path d="M10 5.8v4.5l2.9 1.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div className="auto-card-main">
                        <div className="auto-title-row">
                          <h3>{row.title || "未命名定时任务"}</h3>
                          <span className={`auto-life ${life.id}`}>{life.label}</span>
                        </div>
                        <p className="auto-schedule">{row.scheduleLabel}</p>
                      </div>
                    </div>
                    <p className="auto-prompt" title={row.prompt}>{row.prompt}</p>
                    <div className="auto-meta" aria-label="任务信息">
                      <span className="auto-meta-project" title={row.cwd || "普通会话"}>{row.cwd ? projectName(row.cwd) : "普通会话"}</span>
                      {timing ? <><span className="auto-meta-sep" aria-hidden>·</span><span title={row.lastStatus === "running" ? undefined : clockLabel((row.enabled && row.nextRunAt) || row.lastRunAt || 0)}>{timing}</span></> : null}
                      <span className="auto-meta-sep" aria-hidden>·</span>
                      <span>{row.maxRuns ? `已运行 ${row.runCount}/${row.maxRuns} 次` : `已运行 ${row.runCount} 次`}</span>
                    </div>
                    {row.lastError ? <p className="auto-card-error" title={row.lastError}>{row.lastError}</p> : null}
                    <div className="auto-actions">
                      <button
                        className="btn small auto-run"
                        type="button"
                        disabled={row.lastStatus === "running" || Boolean(pending)}
                        onClick={() => {
                          void perform(row, "run", "正在启动任务", async () => {
                            await window.grok.runAutomation(row.id);
                            return window.grok.listAutomations();
                          });
                        }}
                      >
                        {isPending && pending.action === "run" ? "启动中…" : row.lastStatus === "running" ? "执行中" : "立即运行"}
                      </button>
                      {life.id === "active" || life.id === "paused" || (life.id === "failed" && row.enabled) ? (
                        <button
                          className="btn small ghost"
                          type="button"
                          disabled={row.lastStatus === "running" || Boolean(pending)}
                          onClick={() => {
                            void perform(row, "toggle", row.enabled ? "正在暂停任务" : "正在启用任务", async () => {
                              await window.grok.updateAutomation(row.id, { enabled: !row.enabled });
                              return window.grok.listAutomations();
                            });
                          }}
                        >
                          {isPending && pending.action === "toggle" ? "处理中…" : row.enabled ? "暂停" : "继续"}
                        </button>
                      ) : null}
                      {row.lastSessionId && onOpenSession ? (
                        <button className="btn small ghost" type="button" onClick={() => onOpenSession(row.lastSessionId!, row.cwd)}>
                          打开结果
                        </button>
                      ) : null}
                      <div className="auto-more">
                        <button
                          className="auto-more-button"
                          type="button"
                          aria-label={`更多操作：${row.title || "未命名定时任务"}`}
                          aria-haspopup="menu"
                          aria-expanded={menuId === row.id}
                          disabled={Boolean(pending)}
                          onClick={() => setMenuId(menuId === row.id ? null : row.id)}
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                            <circle cx="3" cy="8" r="1.1" fill="currentColor" />
                            <circle cx="8" cy="8" r="1.1" fill="currentColor" />
                            <circle cx="13" cy="8" r="1.1" fill="currentColor" />
                          </svg>
                        </button>
                        {menuId === row.id ? (
                          <div className="auto-menu" role="menu">
                            <button role="menuitem" type="button" disabled={row.lastStatus === "running"} onClick={() => { setMenuId(null); setEditor({ mode: "edit", row }); }}>
                              编辑
                            </button>
                            <button role="menuitem" type="button" onClick={() => { setMenuId(null); setEditor({ mode: "edit", row, history: true }); }}>
                              查看历史
                            </button>
                            <div className="auto-menu-sep" role="separator" />
                            <button
                              role="menuitem"
                              type="button"
                              className="danger"
                              disabled={row.lastStatus === "running"}
                              onClick={() => {
                                setMenuId(null);
                                if (!window.confirm(`确定删除“${row.title}”？此操作无法撤销。`)) return;
                                void perform(row, "delete", "正在删除任务", async () => {
                                  await window.grok.deleteAutomation(row.id);
                                  return window.grok.listAutomations();
                                });
                              }}
                            >
                              删除
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        <div className="auto-section">
          <h2 className="auto-section-title">定时任务模板</h2>
          <div className="auto-templates">
            {TEMPLATES.map((item) => (
              <button
                key={item.id}
                type="button"
                className="auto-template"
                onClick={() =>
                  setEditor({
                    mode: "create",
                    seed: {
                      title: item.title,
                      prompt: item.prompt,
                      cwd: cwd || "",
                      ...item.draft,
                    },
                  })
                }
              >
                <strong>{item.title}</strong>
                <span className="auto-template-schedule">{item.schedule}</span>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {editor ? (
        <AutomationForm
          cwd={cwd}
          projects={projects}
          initial={editor.row ? draftFromRow(editor.row) : { ...emptyDraft(cwd), ...editor.seed }}
          editing={editor.row}
          historyFirst={Boolean(editor.history)}
          onClose={() => setEditor(null)}
          onSaved={(next) => {
            setRows(next);
            setEditor(null);
          }}
          onOpenSession={onOpenSession}
        />
      ) : null}
    </section>
  );
}

function AutomationForm({
  cwd,
  projects,
  initial,
  editing,
  historyFirst,
  onClose,
  onSaved,
  onOpenSession,
}: {
  cwd?: string | null;
  projects: ProjectInfo[];
  initial: ScheduleDraft;
  editing?: Automation;
  historyFirst?: boolean;
  onClose: () => void;
  onSaved: (rows: Automation[]) => void;
  onOpenSession?: (sessionId: string, cwd: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<"settings" | "history">(historyFirst ? "history" : "settings");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const preview = useMemo(() => schedulePreview(draft), [draft]);
  const showTime = draft.frequency !== "hourly" && !(draft.frequency === "custom" && draft.intervalUnit === "minute");
  const showMinute = draft.frequency === "hourly" || (draft.frequency === "custom" && draft.intervalUnit === "hourly");
  const showWeekdays = draft.frequency === "weekly" || (draft.frequency === "custom" && draft.intervalUnit === "weekly");
  const showMonthDay = draft.frequency === "monthly" || (draft.frequency === "custom" && draft.intervalUnit === "monthly");

  function patch(next: Partial<ScheduleDraft>) {
    setDraft((cur) => ({ ...cur, ...next }));
    setFormError("");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function save() {
    if (saving) return;
    if (!draft.prompt.trim()) {
      setFormError("请填写每次运行时要执行的指令。");
      return;
    }
    if (showWeekdays && !draft.weekdays.length) {
      setFormError("请至少选择一个星期。");
      return;
    }
    if (!Number.isInteger(draft.interval) || draft.interval < 1) {
      setFormError("执行间隔必须是大于 0 的整数。");
      return;
    }
    if (!draft.recurring) {
      const maxRuns = Number(draft.maxRuns);
      if (!Number.isInteger(maxRuns) || maxRuns < 1) {
        setFormError("固定运行次数必须是大于 0 的整数。");
        return;
      }
    }
    if (draft.endsAt && new Date(`${draft.endsAt}T23:59:59`).getTime() < Date.now()) {
      setFormError("截止日期不能早于今天。");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const input = toInput(draft);
      if (editing) await window.grok.updateAutomation(editing.id, { ...input, enabled: editing.enabled });
      else await window.grok.createAutomation(input);
      onSaved(await window.grok.listAutomations());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop nested" onClick={() => { if (!saving) onClose(); }}>
      <div className="modal settings-modal auto-form" role="dialog" aria-modal="true" aria-labelledby="automation-form-title" onClick={(e) => e.stopPropagation()}>
        <div className="auto-form-head">
          <div>
            <h2 id="automation-form-title">{editing ? "编辑定时任务" : "新建定时任务"}</h2>
            <p className="settings-hint">{editing ? "调整此任务的执行时间、指令和运行方式。" : "配置任务的执行时间、指令和运行方式。"}</p>
          </div>
          <button className="auto-form-close" type="button" aria-label="关闭" disabled={saving} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {editing ? (
          <div className="auto-form-tabs" role="tablist" aria-label="任务详情">
            <button role="tab" aria-selected={tab === "settings"} type="button" className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
              设置
            </button>
            <button role="tab" aria-selected={tab === "history"} type="button" className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
              历史
            </button>
          </div>
        ) : null}

        {tab === "history" && editing ? (
          <div className="auto-history">
            {(editing.runs || []).length === 0 ? (
              <div className="auto-history-empty">
                <strong>还没有运行记录</strong>
                <span>手动运行或到达计划时间后，结果会显示在这里。</span>
              </div>
            ) : (
              <div className="auto-history-list">
                {(editing.runs || []).map((item) => (
                  <div className="auto-history-row" key={item.id}>
                    <span className={`auto-history-status ${item.status}`} aria-hidden />
                    <div className="auto-history-main">
                      <strong>{item.status === "running" ? "正在执行" : item.status === "ok" ? "运行成功" : "运行失败"}</strong>
                      <span>{clockLabel(item.at)} · {item.trigger === "manual" ? "手动触发" : "定时触发"} · {formatDuration(item.durationMs)}</span>
                      {item.error ? <em>{item.error}</em> : null}
                    </div>
                    {item.sessionId && onOpenSession ? (
                      <button className="btn small ghost" type="button" onClick={() => onOpenSession(item.sessionId!, editing.cwd)}>
                        打开会话
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="auto-form-body">
              <section className="auto-form-section">
                <div className="auto-form-section-head">
                  <h3>任务内容</h3>
                  <p>给任务起名，并说明每次需要完成什么。</p>
                </div>
                <div className="auto-form-grid two">
                  <label className="field">
                    <span>任务标题</span>
                    <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder="例如：每日站会摘要" autoFocus />
                  </label>
                  <label className="field">
                    <span>运行位置</span>
                    <select value={draft.cwd} onChange={(e) => patch({ cwd: e.target.value })}>
                      <option value="">普通会话</option>
                      {projects.map((project) => (
                        <option key={project.cwd} value={project.cwd}>{project.name}</option>
                      ))}
                      {cwd && !projects.some((p) => p.cwd === cwd) ? <option value={cwd}>{cwd}</option> : null}
                    </select>
                  </label>
                </div>
                <label className="field auto-prompt-field">
                  <span>执行指令 <em>必填</em></span>
                  <textarea value={draft.prompt} onChange={(e) => patch({ prompt: e.target.value })} rows={5} placeholder="清楚描述每次运行时要检查、整理或生成什么。" />
                </label>
              </section>

              <section className="auto-form-section">
                <div className="auto-form-section-head">
                  <h3>运行计划</h3>
                  <p>所有时间均使用本机时区。</p>
                </div>
                <div className="auto-form-grid schedule">
                  <label className="field">
                    <span>频率</span>
                    <select value={draft.frequency} onChange={(e) => patch({ frequency: e.target.value as AutomationFrequency })}>
                      <option value="hourly">每小时</option>
                      <option value="daily">每天</option>
                      <option value="weekdays">每工作日</option>
                      <option value="weekly">每周</option>
                      <option value="monthly">每月</option>
                      <option value="custom">自定义间隔</option>
                    </select>
                  </label>
                  {draft.frequency === "custom" ? (
                    <>
                      <label className="field">
                        <span>间隔</span>
                        <input type="number" min={1} step={1} value={draft.interval} onChange={(e) => patch({ interval: Number(e.target.value) })} />
                      </label>
                      <label className="field">
                        <span>单位</span>
                        <select value={draft.intervalUnit} onChange={(e) => patch({ intervalUnit: e.target.value as IntervalUnit })}>
                          <option value="minute">分钟</option>
                          <option value="hourly">小时</option>
                          <option value="daily">天</option>
                          <option value="weekly">周</option>
                          <option value="monthly">个月</option>
                        </select>
                      </label>
                    </>
                  ) : null}
                  {showTime ? (
                    <label className="field">
                      <span>时间</span>
                      <input type="time" value={draft.time} onChange={(e) => patch({ time: e.target.value })} />
                    </label>
                  ) : null}
                  {showMinute ? (
                    <label className="field">
                      <span>小时内第几分钟</span>
                      <input type="number" min={0} max={59} value={draft.minute} onChange={(e) => patch({ minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })} />
                    </label>
                  ) : null}
                  {showMonthDay ? (
                    <label className="field">
                      <span>每月日期</span>
                      <input type="number" min={1} max={31} value={draft.dayOfMonth} onChange={(e) => patch({ dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
                    </label>
                  ) : null}
                </div>
                {showWeekdays ? (
                  <div className="field auto-weekday-field">
                    <span>星期</span>
                    <div className="auto-weekdays">
                      {WEEKDAYS.map((day) => (
                        <label key={day.id} className={draft.weekdays.includes(day.id) ? "on" : ""}>
                          <input
                            type="checkbox"
                            checked={draft.weekdays.includes(day.id)}
                            onChange={(e) => {
                              const next = e.target.checked ? [...draft.weekdays, day.id] : draft.weekdays.filter((id) => id !== day.id);
                              patch({ weekdays: next.sort((a, b) => a - b) });
                            }}
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="auto-preview">
                  <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden>
                    <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M10 5.8v4.5l2.9 1.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  <span><strong>运行时间</strong>{preview}</span>
                </div>
              </section>

              <section className="auto-form-section">
                <div className="auto-form-section-head">
                  <h3>停止条件</h3>
                  <p>可以持续运行，也可以在指定次数或日期后停止。</p>
                </div>
                <div className="auto-repeat-options" role="group" aria-label="运行次数">
                  <button type="button" aria-pressed={draft.recurring} className={draft.recurring ? "on" : ""} onClick={() => patch({ recurring: true })}>
                    <strong>持续运行</strong><span>保持启用，直到手动暂停</span>
                  </button>
                  <button type="button" aria-pressed={!draft.recurring} className={!draft.recurring ? "on" : ""} onClick={() => patch({ recurring: false, maxRuns: draft.maxRuns || "1" })}>
                    <strong>固定次数</strong><span>达到运行次数后自动停用</span>
                  </button>
                </div>
                <div className="auto-form-grid two">
                  {!draft.recurring ? (
                    <label className="field">
                      <span>运行次数</span>
                      <input type="number" min={1} step={1} value={draft.maxRuns} onChange={(e) => patch({ maxRuns: e.target.value })} />
                    </label>
                  ) : null}
                  <label className="field">
                    <span>截止日期 <em>可选</em></span>
                    <input type="date" value={draft.endsAt} onChange={(e) => patch({ endsAt: e.target.value })} />
                  </label>
                </div>
              </section>

              {formError ? <p className="auto-form-error" role="alert">{formError}</p> : null}
            </div>
            <div className="auto-form-footer">
              <span>{editing ? (editing.enabled ? "保存后任务保持启用" : "保存后任务仍保持暂停") : "创建后将立即启用任务"}</span>
              <div>
                <button className="btn" type="button" disabled={saving} onClick={onClose}>取消</button>
                <button className="btn primary" type="button" disabled={saving} onClick={() => void save()}>
                  {saving ? "正在保存…" : editing ? "保存更改" : "创建定时任务"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
