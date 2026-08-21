import { useEffect, useMemo, useState } from "react";
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
  InstallForm,
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
  const [installOpen, setInstallOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [doctor, setDoctor] = useState("");
  const [available, setAvailable] = useState<AvailablePluginInfo[] | null>(null);
  const { busy, error, run } = useWorkspaceActions();

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
            onAvailable={setAvailable}
            onInstall={() => setInstallOpen(true)}
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
      {installOpen ? (
        <InstallForm
          cwd={cwd}
          onClose={() => setInstallOpen(false)}
          onChange={(next) => {
            onChange(next);
            setInstallOpen(false);
          }}
          run={run}
        />
      ) : null}
      {marketOpen ? (
        <MarketForm
          cwd={cwd}
          onClose={() => setMarketOpen(false)}
          onChange={(next) => {
            onChange(next);
            setMarketOpen(false);
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

const CHAT_CREATE_PROMPT = "每个工作日 9 点，汇总当前项目的代码变更和待跟进事项。";

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

function lifecycle(row: Automation) {
  if (row.lastStatus === "running") return { id: "running", label: "正在执行" };
  if (!row.enabled && row.lastStatus === "error") return { id: "failed", label: "已失败" };
  if (!row.enabled && (row.nextRunAt === 0 || Boolean(row.maxRuns && row.runCount >= row.maxRuns))) {
    return { id: "completed", label: "已完成" };
  }
  if (!row.enabled) return { id: "paused", label: "已暂停" };
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
    endsAt: row.endsAt ? new Date(row.endsAt).toISOString().slice(0, 10) : "",
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
  onCreateViaChat,
  onOpenSession,
}: {
  cwd?: string | null;
  projects: ProjectInfo[];
  createRequest?: number;
  onCreateViaChat: (prompt: string) => void;
  onOpenSession?: (sessionId: string, cwd: string) => void;
}) {
  const [rows, setRows] = useState<Automation[]>([]);
  const [now, setNow] = useState(Date.now());
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; row?: Automation; seed?: Partial<ScheduleDraft>; history?: boolean } | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
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
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
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

  return (
    <section className="workspace-page">
      <div className="workspace-head">
        <div className="workspace-head-copy">
          <h1>
            自动化 <span className="beta-badge">Beta</span>
          </h1>
        </div>
        <div className="workspace-head-actions">
          <button className="btn small ghost" type="button" onClick={() => onCreateViaChat(CHAT_CREATE_PROMPT)}>
            去会话中创建
          </button>
          <button className="btn small" type="button" onClick={() => setEditor({ mode: "create" })}>
            创建定时任务
          </button>
        </div>
      </div>
      <div className="workspace-body auto-page">
        <p className="settings-hint">
          {rows.length
            ? "按计划运行任务，或在需要时随时执行。电脑唤醒且应用开着时才会触发。"
            : "创建定时任务，到点后开一条会话执行指令。不选项目就是普通会话。"}
        </p>
        {error ? <p className="settings-error">{error}</p> : null}
        {busy ? <p className="settings-hint">{busy}…</p> : null}

        {rows.length === 0 ? (
          <div className="workspace-empty">
            <h2>还没有定时任务</h2>
            <p>创建一个任务，按周期自动运行你的指令。</p>
            <div className="auto-empty-actions">
              <button className="btn small ghost" type="button" onClick={() => onCreateViaChat(CHAT_CREATE_PROMPT)}>
                去会话中创建
              </button>
              <button className="btn small" type="button" onClick={() => setEditor({ mode: "create" })}>
                手动创建
              </button>
            </div>
          </div>
        ) : (
          <div className="auto-section">
            <h2 className="auto-section-title">定时任务</h2>
            <div className="auto-list">
              {rows.map((row) => {
                const life = lifecycle(row);
                return (
                  <article className={`auto-card${row.enabled ? "" : " off"}`} key={row.id}>
                    <div className="auto-card-top">
                      <div>
                        <h3>{row.title || "未命名定时任务"}</h3>
                        <p className="auto-schedule">{row.scheduleLabel}</p>
                      </div>
                      <span className={`auto-life ${life.id}`}>{life.label}</span>
                    </div>
                    <p className="auto-prompt">{row.prompt}</p>
                    <div className="auto-meta">
                      <span>{row.cwd ? projectName(row.cwd) : "普通会话"}</span>
                      {row.lastStatus === "running" ? (
                        <span>正在执行{row.runs?.find((item) => item.status === "running")?.trigger === "manual" ? "（手动）" : ""}</span>
                      ) : row.enabled && row.nextRunAt ? (
                        <span title={clockLabel(row.nextRunAt)}>下次运行 {relativeWhen(row.nextRunAt, now)}</span>
                      ) : row.lastRunAt ? (
                        <span title={clockLabel(row.lastRunAt)}>上次 {relativeWhen(row.lastRunAt, now)}</span>
                      ) : null}
                      <span>{row.maxRuns ? `已运行 ${row.runCount}/${row.maxRuns} 次` : `已运行 ${row.runCount} 次`}</span>
                    </div>
                    {row.lastError ? <p className="settings-error">{row.lastError}</p> : null}
                    <div className="auto-actions">
                      <button
                        className="btn small"
                        type="button"
                        disabled={row.lastStatus === "running"}
                        onClick={() => {
                          void window.grok.runAutomation(row.id).then((next) => {
                            if (next) {
                              setRows((cur) => cur.map((item) => (item.id === next.id ? next : item)));
                            }
                            return window.grok.listAutomations().then(setRows);
                          }).catch((err) => console.error(err));
                        }}
                      >
                        立即运行
                      </button>
                      <button
                        className="btn small ghost"
                        type="button"
                        onClick={() => {
                          void run(row.enabled ? "暂停" : "继续", () =>
                            window.grok.updateAutomation(row.id, { enabled: !row.enabled }).then(() =>
                              window.grok.listAutomations().then(setRows),
                            ),
                          );
                        }}
                      >
                        {row.enabled ? "暂停" : "继续"}
                      </button>
                      <div className="auto-more">
                        <button className="btn small ghost" type="button" onClick={() => setMenuId(menuId === row.id ? null : row.id)}>
                          更多操作
                        </button>
                        {menuId === row.id ? (
                          <div className="auto-menu">
                            <button type="button" onClick={() => { setMenuId(null); setEditor({ mode: "edit", row }); }}>
                              编辑
                            </button>
                            <button type="button" onClick={() => { setMenuId(null); setEditor({ mode: "edit", row, history: true }); }}>
                              查看历史
                            </button>
                            {row.lastSessionId && onOpenSession ? (
                              <button type="button" onClick={() => { setMenuId(null); onOpenSession(row.lastSessionId!, row.cwd); }}>
                                跳到会话
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="danger"
                              onClick={() => {
                                setMenuId(null);
                                if (!window.confirm(`确定删除“${row.title}”？此操作无法撤销。`)) return;
                                void run("删除", () => window.grok.deleteAutomation(row.id).then(() => window.grok.listAutomations().then(setRows)));
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
          run={run}
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
  run,
}: {
  cwd?: string | null;
  projects: ProjectInfo[];
  initial: ScheduleDraft;
  editing?: Automation;
  historyFirst?: boolean;
  onClose: () => void;
  onSaved: (rows: Automation[]) => void;
  onOpenSession?: (sessionId: string, cwd: string) => void;
  run: SettingsRun;
}) {
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<"settings" | "history">(historyFirst ? "history" : "settings");
  const preview = useMemo(() => schedulePreview(draft), [draft]);
  const showTime = draft.frequency !== "hourly" && !(draft.frequency === "custom" && draft.intervalUnit === "minute");
  const showMinute = draft.frequency === "hourly" || (draft.frequency === "custom" && draft.intervalUnit === "hourly");
  const showWeekdays = draft.frequency === "weekly" || (draft.frequency === "custom" && draft.intervalUnit === "weekly");
  const showMonthDay = draft.frequency === "monthly" || (draft.frequency === "custom" && draft.intervalUnit === "monthly");

  function patch(next: Partial<ScheduleDraft>) {
    setDraft((cur) => ({ ...cur, ...next }));
  }

  return (
    <div className="modal-backdrop nested" onClick={onClose}>
      <div className="modal settings-modal auto-form" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{editing ? "编辑定时任务" : "新建定时任务"}</h2>
            <p className="settings-hint">{editing ? "调整此任务的执行时间、指令和运行方式。" : "配置任务的执行时间、指令和运行方式。"}</p>
          </div>
          <button className="btn small ghost" type="button" onClick={onClose}>
            取消
          </button>
        </div>
        {editing ? (
          <div className="workspace-tabs">
            <button type="button" className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
              设置
            </button>
            <button type="button" className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
              历史
            </button>
          </div>
        ) : null}

        {tab === "history" && editing ? (
          <div className="auto-history">
            <p className="settings-hint">定时任务仅在电脑处于唤醒状态时运行。</p>
            {(editing.runs || []).length === 0 ? (
              <p className="workspace-empty">还没有运行记录。</p>
            ) : (
              <table className="auto-history-table">
                <thead>
                  <tr>
                    <th>触发时间</th>
                    <th>来源</th>
                    <th>状态</th>
                    <th>时长</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(editing.runs || []).map((item) => (
                    <tr key={item.id}>
                      <td>{clockLabel(item.at)}</td>
                      <td>{item.trigger === "manual" ? "手动" : "定时"}</td>
                      <td>{item.status === "running" ? "进行中" : item.status === "ok" ? "成功" : "失败"}</td>
                      <td>{formatDuration(item.durationMs)}</td>
                      <td>
                        {item.sessionId && onOpenSession ? (
                          <button className="btn small ghost" type="button" onClick={() => onOpenSession(item.sessionId!, editing.cwd)}>
                            跳到会话
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <>
            <label className="field">
              <span>任务标题</span>
              <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder="例如：每日站会摘要" />
            </label>
            <label className="field">
              <span>项目</span>
              <select value={draft.cwd} onChange={(e) => patch({ cwd: e.target.value })}>
                <option value="">普通会话</option>
                {projects.map((project) => (
                  <option key={project.cwd} value={project.cwd}>
                    {project.name}
                  </option>
                ))}
                {cwd && !projects.some((p) => p.cwd === cwd) ? <option value={cwd}>{cwd}</option> : null}
              </select>
            </label>
            {!draft.cwd ? <p className="settings-hint">不选项目时，到点后会开一条普通对话来执行。</p> : null}
            <label className="field">
              <span>调度</span>
              <select value={draft.frequency} onChange={(e) => patch({ frequency: e.target.value as AutomationFrequency })}>
                <option value="hourly">每小时</option>
                <option value="daily">每天</option>
                <option value="weekdays">每工作日</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            {draft.frequency === "custom" ? (
              <div className="auto-custom-row">
                <label className="field">
                  <span>每</span>
                  <input type="number" min={1} value={draft.interval} onChange={(e) => patch({ interval: Number(e.target.value) || 1 })} />
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
              </div>
            ) : null}
            {showTime ? (
              <label className="field">
                <span>于</span>
                <input type="time" value={draft.time} onChange={(e) => patch({ time: e.target.value })} />
              </label>
            ) : null}
            {showMinute ? (
              <label className="field">
                <span>第</span>
                <input type="number" min={0} max={59} value={draft.minute} onChange={(e) => patch({ minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })} />
                <span className="settings-hint">分钟</span>
              </label>
            ) : null}
            {showWeekdays ? (
              <div className="field">
                <span>选择星期</span>
                <div className="auto-weekdays">
                  {WEEKDAYS.map((day) => (
                    <label key={day.id} className={draft.weekdays.includes(day.id) ? "on" : ""}>
                      <input
                        type="checkbox"
                        checked={draft.weekdays.includes(day.id)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...draft.weekdays, day.id]
                            : draft.weekdays.filter((id) => id !== day.id);
                          patch({ weekdays: next.length ? next.sort() : [day.id] });
                        }}
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            {showMonthDay ? (
              <label className="field">
                <span>日期</span>
                <input type="number" min={1} max={31} value={draft.dayOfMonth} onChange={(e) => patch({ dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
              </label>
            ) : null}
            <p className="settings-hint">运行时间：{preview}</p>
            <label className="toggle">
              <input type="checkbox" checked={draft.recurring} onChange={(e) => patch({ recurring: e.target.checked })} />
              无限重复
            </label>
            <p className="settings-hint">关闭后，运行固定次数即停止。</p>
            {!draft.recurring ? (
              <label className="field">
                <span>最大运行次数</span>
                <input value={draft.maxRuns} onChange={(e) => patch({ maxRuns: e.target.value })} placeholder="例如：5" />
              </label>
            ) : (
              <label className="field">
                <span>结束</span>
                <input type="date" value={draft.endsAt} onChange={(e) => patch({ endsAt: e.target.value })} />
              </label>
            )}
            <label className="field">
              <span>指令</span>
              <textarea
                value={draft.prompt}
                onChange={(e) => patch({ prompt: e.target.value })}
                rows={6}
                placeholder="每次运行时这个任务要做什么？"
              />
            </label>
            <div className="permission-actions">
              <button
                className="btn primary"
                type="button"
                disabled={!draft.prompt.trim()}
                onClick={() => {
                  if (!draft.prompt.trim()) return;
                  if ((draft.frequency === "weekly" || (draft.frequency === "custom" && draft.intervalUnit === "weekly")) && !draft.weekdays.length) {
                    return;
                  }
                  void run(editing ? "保存" : "创建", async () => {
                    const input = toInput(draft);
                    if (editing) await window.grok.updateAutomation(editing.id, { ...input, enabled: editing.enabled });
                    else await window.grok.createAutomation(input);
                    const rows = await window.grok.listAutomations();
                    onSaved(rows);
                    return rows;
                  });
                }}
              >
                {editing ? "保存" : "创建定时任务"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
