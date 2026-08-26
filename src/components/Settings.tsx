import { useEffect, useState, type ReactNode } from "react";
import type {
  AppSettings,
  AppUpdateInfo,
  AvailablePluginInfo,
  PermissionMode,
  ProxyMode,
  ProxySettings,
  ProxyTestResult,
  ReasoningEffort,
} from "../../electron/shared";
import { Markdown } from "../lib/markdown";

const MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: "ask", label: "询问", hint: "改文件、跑命令前先问你" },
  { id: "auto", label: "自动", hint: "安全操作自动过，其余再问" },
  { id: "always-approve", label: "始终允许", hint: "跳过普通授权（deny 规则仍生效）" },
];

const REASONING: { id: ReasoningEffort; label: string; hint: string }[] = [
  { id: "low", label: "低", hint: "更快，适合简单问题" },
  { id: "medium", label: "中", hint: "速度和深度折中" },
  { id: "high", label: "高", hint: "更充分的推理" },
  { id: "xhigh", label: "极高", hint: "最深推理，耗时更长" },
];

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
];

export type SettingsRun = <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;

type SettingsPane = "general" | "features" | "network" | "about";

const NAV: { id: SettingsPane; label: string; hint: string }[] = [
  { id: "general", label: "常规", hint: "模型、推理与权限" },
  { id: "features", label: "功能", hint: "浏览器、电脑与子智能体" },
  { id: "network", label: "网络与代理", hint: "连接方式与网络测试" },
  { id: "about", label: "关于", hint: "版本更新与运行日志" },
];

function SettingsPaneIcon({ pane }: { pane: SettingsPane }) {
  if (pane === "general") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 3.2v2.1M12 18.7v2.1M3.2 12h2.1M18.7 12h2.1M5.8 5.8l1.5 1.5M16.7 16.7l1.5 1.5M18.2 5.8l-1.5 1.5M7.3 16.7l-1.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (pane === "features") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M16.75 13.5v6.5M13.5 16.75H20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (pane === "network") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 10.7v5.5M12 7.6v.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function formatUpdateBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${Math.round(bytes)} B`;
}

export function Settings({
  open,
  settings,
  cwd,
  sessionId,
  modelSelectionLocked = false,
  onClose,
  onChange,
}: {
  open: boolean;
  settings: AppSettings | null;
  cwd?: string | null;
  sessionId?: string | null;
  modelSelectionLocked?: boolean;
  onClose: () => void;
  onChange: (next: AppSettings) => void;
}) {
  const [pane, setPane] = useState<SettingsPane>("general");
  useEffect(() => {
    if (open) setPane("general");
  }, [open]);
  if (!open) return null;

  return (
    <div className="settings-overlay" role="dialog" aria-label="设置">
      <header className="settings-top">
        <div className="settings-top-title">
          <span className="settings-top-icon" aria-hidden>
            <SettingsPaneIcon pane="general" />
          </span>
          <strong>设置</strong>
        </div>
        <button className="settings-close" type="button" aria-label="关闭设置" title="关闭" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="m4.1 4.1 7.8 7.8M11.9 4.1l-7.8 7.8" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="设置分类">
          <div className="settings-nav-heading">Grok 设置</div>
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item${pane === item.id ? " on" : ""}`}
              onClick={() => setPane(item.id)}
            >
              <span className={`settings-nav-icon ${item.id}`} aria-hidden>
                <SettingsPaneIcon pane={item.id} />
              </span>
              <span className="settings-nav-copy">
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
              <svg className="settings-nav-chevron" viewBox="0 0 12 12" aria-hidden>
                <path d="m4.5 2.5 3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </nav>
        <div className={`settings-body ${pane}`}>
          {pane === "general" ? (
            settings ? <GeneralPane settings={settings} sessionId={sessionId} modelSelectionLocked={modelSelectionLocked} onChange={onChange} /> : <p className="settings-hint">正在读取配置…</p>
          ) : pane === "features" ? (
            settings ? <FeaturesPane settings={settings} cwd={cwd} onChange={onChange} /> : <p className="settings-hint">正在读取配置…</p>
          ) : pane === "network" ? (
            <NetworkPane />
          ) : pane === "about" ? (
            <AboutPane />
          ) : (
            <p className="settings-hint">未知设置页。</p>
          )}
        </div>
      </div>
    </div>
  );
}

function GeneralPane({
  settings,
  sessionId,
  modelSelectionLocked,
  onChange,
}: {
  settings: AppSettings;
  sessionId?: string | null;
  modelSelectionLocked: boolean;
  onChange: (next: AppSettings) => void;
}) {
  return (
    <>
      <div className="settings-page-head">
        <h1>常规</h1>
        <p>设置新会话的默认行为。</p>
      </div>
      <section className="settings-section">
        <h3>默认模型</h3>
        {modelSelectionLocked ? (
          <p className="settings-hint">API 模式下模型由 API 配置固定，无需选择。</p>
        ) : (
          <>
            <p className="settings-hint">选择新会话默认使用的模型。</p>
            <select
              value={settings.model}
              onChange={(e) => {
                void window.grok.setModel(e.target.value).then(onChange);
              }}
            >
              {settings.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name === m.id ? m.id : `${m.name}（${m.id}）`}
                </option>
              ))}
            </select>
          </>
        )}
      </section>
      <section className="settings-section">
        <h3>推理等级</h3>
        <p className="settings-hint">等级越高，思考更充分，但响应也会更慢。</p>
        <div className="mode-list">
          {REASONING.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`mode-item${settings.reasoningEffort === item.id ? " on" : ""}`}
              onClick={() => {
                onChange({ ...settings, reasoningEffort: item.id });
                void window.grok.setReasoningEffort(item.id, sessionId || undefined).then(onChange);
              }}
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <h3>权限模式</h3>
        <p className="settings-hint">控制执行命令和修改文件时是否需要先征得你的同意。</p>
        <div className="mode-list">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`mode-item${settings.permissionMode === mode.id ? " on" : ""}`}
              onClick={() => {
                void window.grok.setPermission(mode.id).then(onChange);
              }}
            >
              <strong>{mode.label}</strong>
              <span>{mode.hint}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function FeaturesPane({
  settings,
  cwd,
  onChange,
}: {
  settings: AppSettings;
  cwd?: string | null;
  onChange: (next: AppSettings) => void;
}) {
  return (
    <>
      <div className="settings-page-head">
        <h1>功能</h1>
        <p>只开启你会使用的扩展能力，新会话生效。</p>
      </div>
      <section className="settings-section">
        <h3>操作能力</h3>
        <div className="control-toggles">
          <label className="toggle-row">
            <span>
              <strong>浏览器控制</strong>
              <em>允许打开网页、点击、输入和截图</em>
            </span>
            <input
              type="checkbox"
              checked={settings.browserControl}
              onChange={(e) => {
                void window.grok.setBrowserControl(e.target.checked, cwd).then(onChange);
              }}
            />
          </label>
          <label className="toggle-row">
            <span>
              <strong>电脑控制</strong>
              <em>允许操作本机前台窗口，使用时请留意屏幕内容</em>
            </span>
            <input
              type="checkbox"
              checked={settings.computerControl}
              onChange={(e) => {
                void window.grok.setComputerControl(e.target.checked, cwd).then(onChange);
              }}
            />
          </label>
          <label className="toggle-row">
            <span>
              <strong>子智能体</strong>
              <em>允许为复杂任务并行处理独立子任务</em>
            </span>
            <input
              type="checkbox"
              checked={settings.subagentsEnabled}
              onChange={(e) => {
                void window.grok.setSubagentsEnabled(e.target.checked, cwd).then(onChange);
              }}
            />
          </label>
        </div>
      </section>
    </>
  );
}

const PROXY_MODES: Array<{ id: ProxyMode; label: string; hint: string }> = [
  { id: "system", label: "跟随系统", hint: "使用 Windows 系统代理或代理环境变量" },
  { id: "direct", label: "直连", hint: "不通过代理连接 Grok 和 API" },
  { id: "manual", label: "手动代理", hint: "使用指定的 HTTP/HTTPS 代理地址" },
];

function NetworkPane() {
  const [draft, setDraft] = useState<ProxySettings>({ mode: "system", url: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "oauth" | "api" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);

  useEffect(() => {
    let disposed = false;
    void window.grok
      .proxySettings()
      .then((settings) => {
        if (!disposed) setDraft(settings);
      })
      .catch((err) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const test = (target: "oauth" | "api") => {
    setBusy(target);
    setError("");
    setNotice("");
    setTestResult(null);
    void window.grok
      .testProxy(draft, target)
      .then(setTestResult)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  };

  const save = () => {
    setBusy("save");
    setError("");
    setNotice("");
    void window.grok
      .setProxySettings(draft)
      .then((result) => {
        setDraft(result.settings);
        setNotice(result.pending ? "已保存，将在当前任务结束后自动应用。" : `已应用：${result.route}`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  };

  return (
    <>
      <div className="settings-page-head">
        <h1>网络与代理</h1>
        <p>统一控制 Grok CLI、OAuth 和 API 请求使用的连接方式。</p>
      </div>
      <section className="settings-section">
        <h3>代理模式</h3>
        <p className="settings-hint">修改后会重新连接 Grok 代理，正在运行的任务不会被中断。</p>
        {loading ? <p className="settings-hint">正在读取代理配置…</p> : null}
        <div className="mode-list">
          {PROXY_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`mode-item${draft.mode === mode.id ? " on" : ""}`}
              disabled={loading || Boolean(busy)}
              onClick={() => {
                setDraft((current) => ({ ...current, mode: mode.id }));
                setError("");
                setNotice("");
                setTestResult(null);
              }}
            >
              <strong>{mode.label}</strong>
              <span>{mode.hint}</span>
            </button>
          ))}
        </div>
        {draft.mode === "manual" ? (
          <label className="field proxy-url-field">
            代理地址
            <input
              type="url"
              value={draft.url}
              placeholder="http://127.0.0.1:7897"
              disabled={Boolean(busy)}
              onChange={(event) => {
                setDraft((current) => ({ ...current, url: event.target.value }));
                setError("");
                setNotice("");
                setTestResult(null);
              }}
            />
            <small>第一版支持 HTTP/HTTPS 代理，不支持用户名和密码。</small>
          </label>
        ) : null}
        {error ? <p className="settings-error">{error}</p> : null}
        {notice ? <p className="proxy-notice" role="status">{notice}</p> : null}
        {testResult ? (
          <div className={`proxy-test-result${testResult.ok ? " ok" : " error"}`} role="status">
            <strong>{testResult.target === "oauth" ? "OAuth" : "当前 API"}</strong>
            <span>{testResult.message}</span>
            <small>{testResult.route}{testResult.durationMs ? ` · ${testResult.durationMs} ms` : ""}</small>
          </div>
        ) : null}
        <div className="settings-actions proxy-actions">
          <button className="btn" type="button" disabled={Boolean(busy) || loading} onClick={() => test("oauth")}>
            {busy === "oauth" ? "测试中…" : "测试 OAuth"}
          </button>
          <button className="btn" type="button" disabled={Boolean(busy) || loading} onClick={() => test("api")}>
            {busy === "api" ? "测试中…" : "测试当前 API"}
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={Boolean(busy) || loading || (draft.mode === "manual" && !draft.url.trim())}
            onClick={save}
          >
            {busy === "save" ? "应用中…" : "保存并重新连接"}
          </button>
        </div>
      </section>
    </>
  );
}

function AboutPane() {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = (manual = false) => {
    setBusy(true);
    setError("");
    if (manual) setNotice("");
    void window.grok
      .checkUpdate()
      .then((next) => {
        setInfo(next);
        if (manual && !next.hasUpdate) setNotice("当前已是最新版");
      })
      .catch((err) => {
        setNotice("");
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    return window.grok.onAppUpdateState(setInfo);
  }, []);

  return (
    <>
      <div className="settings-page-head">
        <h1>关于</h1>
        <p>查看版本信息，或在遇到问题时打开运行日志。</p>
      </div>
      <section className="settings-section">
        <h3>版本更新</h3>
        {error ? <p className="settings-error">{error}</p> : null}
        {notice ? <div className="settings-check-notice" role="status">{notice}</div> : null}
        {info ? (
          <div className="settings-kv">
            <div>
              <span>当前版本</span>
              <strong>{info.current}</strong>
            </div>
            <div>
              <span>最新版本</span>
              <strong>{info.latest || "—"}</strong>
            </div>
          </div>
        ) : (
          <p className="settings-hint">{busy ? "正在检查…" : "暂时无法读取版本信息。"}</p>
        )}
        {info?.hasUpdate ? <p className="settings-hint">有新版本可用。</p> : null}
        {info?.notes ? (
          <div className="settings-update-notes">
            <strong>更新内容</strong>
            <Markdown text={info.notes} />
          </div>
        ) : null}
        {info?.status === "downloading" ? (
          <div className="update-download" role="status">
            <div className="update-download-head">
              <span>正在应用内下载更新…</span>
              <strong>{Math.round(info.progress || 0)}%</strong>
            </div>
            <div className="update-progress-track" aria-label="更新下载进度">
              <span style={{ width: `${Math.max(0, Math.min(100, info.progress || 0))}%` }} />
            </div>
            <p>
              {formatUpdateBytes(info.transferred)}
              {info.total ? ` / ${formatUpdateBytes(info.total)}` : ""}
              {info.bytesPerSecond ? ` · ${formatUpdateBytes(info.bytesPerSecond)}/s` : ""}
            </p>
          </div>
        ) : null}
        {info?.status === "downloaded" ? (
          <div className="update-ready" role="status">更新已下载完成，重启应用即可自动安装。</div>
        ) : null}
        {info?.error ? <p className="settings-error">{info.error}</p> : null}
        <div className="settings-actions">
          <button className="btn" type="button" disabled={busy || info?.status === "downloading"} onClick={() => refresh(true)}>
            {busy ? "检查中…" : "检查更新"}
          </button>
          {info?.hasUpdate ? (
            <button
              className="btn primary"
              type="button"
              disabled={info.dev || info.status === "downloading"}
              onClick={() => {
                if (info.status === "downloaded") {
                  void window.grok.installUpdate();
                  return;
                }
                void window.grok.downloadUpdate().then(setInfo);
              }}
            >
              {info.dev
                ? "正式安装版支持应用内更新"
                : info.status === "downloading"
                  ? `下载中 ${Math.round(info.progress || 0)}%`
                  : info.status === "downloaded"
                    ? "重启并安装"
                    : info.status === "error"
                      ? "重新下载"
                      : "在应用内下载"}
            </button>
          ) : null}
        </div>
      </section>
      <section className="settings-section">
        <h3>运行日志</h3>
        <p className="settings-hint">应用异常时，可打开日志目录查看记录或提供给开发者排查。</p>
        <button className="btn" type="button" onClick={() => void window.grok.openLogs()}>
          打开日志目录
        </button>
      </section>
    </>
  );
}

export function SkillsTab({
  settings,
  cwd,
  onChange,
  run,
}: {
  settings: AppSettings;
  cwd?: string | null;
  onChange: (next: AppSettings) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  return (
    <section className="settings-section">
      <h3>Skills</h3>
      <p className="settings-hint">
        扫描本地 SKILL.md，并与 grok inspect 对齐。关闭后写入 [skills] disabled，不删文件。新会话生效。
      </p>
      <div className="settings-actions">
        <button
          className="btn"
          type="button"
          onClick={() => void run("打开 Skills 目录", () => window.grok.openSkillsDir())}
        >
          打开 ~/.grok/skills
        </button>
      </div>
      {settings.skills.length === 0 ? (
        <p className="settings-hint">还没有 Skills。把带 SKILL.md 的目录放到 ~/.grok/skills/ 或项目的 .grok/skills/。</p>
      ) : (
        <ul className="skill-list">
          {settings.skills.map((skill) => (
            <li key={`${skill.source}:${skill.path || skill.name}`}>
              <div>
                <strong>{skill.name}</strong>
                <span className="skill-src">{skill.source}</span>
                {skill.invocableAs ? <span className="skill-src">{skill.invocableAs}</span> : null}
                {skill.description ? <p>{skill.description}</p> : null}
              </div>
              <div className="row-actions">
                {skill.path ? (
                  <button
                    className="btn small ghost"
                    type="button"
                    onClick={() => void window.grok.openPath(skill.path)}
                  >
                    打开
                  </button>
                ) : null}
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={!skill.disabled}
                    onChange={(e) => {
                      void window.grok.setSkillDisabled(skill.name, !e.target.checked, cwd).then(onChange);
                    }}
                  />
                  {skill.disabled ? "已关闭" : "启用"}
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function McpTab({
  settings,
  cwd,
  doctor,
  onDoctor,
  onOpenAdd,
  onChange,
  run,
}: {
  settings: AppSettings;
  cwd?: string | null;
  doctor: string;
  onDoctor: (text: string) => void;
  onOpenAdd: () => void;
  onChange: (next: AppSettings) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  return (
    <section className="settings-section">
      <h3>MCP</h3>
      <p className="settings-hint">
        列表来自 grok inspect（含 Claude / Cursor 兼容源）。添加、删除走 grok mcp，写入 config.toml。空的
        ACP mcpServers 表示沿用这些磁盘配置。新会话生效。
      </p>
      {settings.inspectError ? <p className="settings-error">{settings.inspectError}</p> : null}
      {!settings.projectTrusted && cwd ? (
        <div className="settings-banner">
          <p>当前项目尚未信任，项目级 MCP / Hooks 会被跳过。</p>
          <button
            className="btn"
            type="button"
            onClick={() => void run("信任项目", () => window.grok.trustProject(cwd).then(onChange))}
          >
            信任此文件夹
          </button>
        </div>
      ) : null}
      <div className="settings-actions">
        <button className="btn" type="button" onClick={onOpenAdd}>
          添加服务器
        </button>
        <button
          className="btn"
          type="button"
          onClick={() =>
            void run("诊断", async () => {
              const text = await window.grok.mcpDoctor(undefined, cwd);
              onDoctor(text);
              return text;
            })
          }
        >
          诊断全部
        </button>
      </div>
      {settings.mcpServers.length === 0 ? (
        <p className="settings-hint">还没有发现 MCP 服务器。可用 stdio 命令或 HTTP 地址添加。</p>
      ) : (
        <ul className="skill-list">
          {settings.mcpServers.map((server) => (
            <li key={`${server.source}:${server.name}`}>
              <div>
                <strong>{server.name}</strong>
                <span className="skill-src">{server.source}</span>
                <span className="skill-src">{server.transport}</span>
                {server.target ? <p>{server.target}</p> : null}
              </div>
              <div className="row-actions">
                <button
                  className="btn small ghost"
                  type="button"
                  onClick={() =>
                    void run("诊断", async () => {
                      const text = await window.grok.mcpDoctor(server.name, cwd);
                      onDoctor(text);
                      return text;
                    })
                  }
                >
                  诊断
                </button>
                {server.native ? (
                  <button
                    className="btn small ghost"
                    type="button"
                    onClick={() =>
                      void run("删除", () =>
                        window.grok
                          .mcpRemove(server.name, server.source === "项目" ? "project" : "user", cwd)
                          .then(onChange),
                      )
                    }
                  >
                    删除
                  </button>
                ) : null}
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={(e) => {
                      void run("更新 MCP", () =>
                        window.grok.mcpSetEnabled(server.name, e.target.checked, cwd).then(onChange),
                      );
                    }}
                  />
                  {server.enabled ? "启用" : "已关闭"}
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
      {doctor ? <pre className="settings-pre">{doctor}</pre> : null}
    </section>
  );
}

export function PluginsTab({
  settings,
  cwd,
  available,
  loading,
  onRefresh,
  onMarket,
  onChange,
  run,
}: {
  settings: AppSettings;
  cwd?: string | null;
  available: AvailablePluginInfo[] | null;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  onMarket: () => void;
  onChange: (next: AppSettings) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  return (
    <>
      <section className="settings-section">
        <h3>已安装</h3>
        <p className="settings-hint">安装和开关走 grok plugin。项目插件需要信任文件夹后才会加载 MCP / Hooks。</p>
        <div className="settings-actions">
          <button className="btn" type="button" onClick={onMarket}>
            添加市场源
          </button>
        </div>
        {settings.plugins.length === 0 ? (
          <p className="settings-hint">还没有已安装插件。</p>
        ) : (
          <ul className="skill-list">
            {settings.plugins.map((plugin) => (
              <li key={`${plugin.scope}:${plugin.name}`}>
                <div>
                  <strong>{plugin.name}</strong>
                  <span className="skill-src">{plugin.scope}</span>
                  <p>
                    skills {plugin.skills} · agents {plugin.agents}
                    {plugin.hooks ? " · hooks" : ""}
                    {plugin.mcpServers ? ` · mcp ${plugin.mcpServers}` : ""}
                  </p>
                </div>
                <div className="row-actions">
                  <button
                    className="btn small ghost"
                    type="button"
                    onClick={() =>
                      void run("卸载", () => window.grok.pluginUninstall(plugin.name, cwd).then(onChange))
                    }
                  >
                    卸载
                  </button>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={plugin.enabled}
                      onChange={(e) => {
                        void run("更新插件", () =>
                          window.grok.pluginSetEnabled(plugin.name, e.target.checked, cwd).then(onChange),
                        );
                      }}
                    />
                    {plugin.enabled ? "启用" : "已关闭"}
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="settings-section">
        <h3>市场源</h3>
        {settings.marketplaces.length === 0 ? (
          <p className="settings-hint">还没有市场源。可添加 GitHub 仓库、Git URL 或本地目录。</p>
        ) : (
          <ul className="skill-list">
            {settings.marketplaces.map((item) => (
              <li key={item.url || item.name}>
                <div>
                  <strong>{item.name}</strong>
                  <span className="skill-src">{item.kind}</span>
                  {item.url ? <p>{item.url}</p> : null}
                </div>
                {item.url ? (
                  <button
                    className="btn small ghost"
                    type="button"
                    onClick={() =>
                      void run("移除市场", () =>
                        window.grok.marketplaceRemove(item.url, cwd).then(async (next) => {
                          onChange(next);
                          await onRefresh();
                          return next;
                        }),
                      )
                    }
                  >
                    移除
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="settings-section plugin-browser">
        <div className="plugin-section-head">
          <div>
            <h3>可安装插件</h3>
            <p className="settings-hint">从已添加的市场源中选择插件。</p>
          </div>
          <button className="btn small ghost" type="button" onClick={onRefresh}>
            刷新
          </button>
        </div>
        {available === null && loading ? <p className="settings-hint">正在读取市场…</p> : null}
        {available && available.length === 0 ? <p className="settings-hint">市场里暂时没有条目。</p> : null}
        {available && available.length ? (
          <ul className="plugin-card-grid">
            {available.map((item) => {
              const installed =
                item.status === "installed" || settings.plugins.some((plugin) => plugin.name === item.name);
              return (
                <li className="plugin-card" key={`${item.marketplace}:${item.name}`}>
                  <div className="plugin-card-body">
                    <div className="plugin-card-title">
                      <strong>{item.name}</strong>
                      {item.version ? <span>{item.version}</span> : null}
                    </div>
                    <span className="plugin-card-market">{item.marketplace}</span>
                    <p>{item.description || "暂无插件说明。"}</p>
                  </div>
                  <button
                    className={`btn small plugin-card-install${installed ? "" : " primary"}`}
                    type="button"
                    disabled={installed}
                    onClick={() =>
                      void run("安装", () => window.grok.pluginInstall(item.name, true, cwd).then(onChange))
                    }
                  >
                    {installed ? "已安装" : "安装并信任"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </>
  );
}

export function AutoTab({
  settings,
  cwd,
  onAddHook,
  onChange,
  run,
}: {
  settings: AppSettings;
  cwd?: string | null;
  onAddHook: () => void;
  onChange: (next: AppSettings) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  return (
    <>
      <section className="settings-section">
        <h3>Hooks</h3>
        <p className="settings-hint">
          执行仍由 Grok CLI 负责。用户级 hooks 始终可信；项目 hooks 需要信任文件夹。添加会写入 ~/.grok/hooks/*.json。
        </p>
        {!settings.projectTrusted && cwd ? (
          <div className="settings-banner">
            <p>当前项目尚未信任，项目级 hooks 不会运行。</p>
            <button
              className="btn"
              type="button"
              onClick={() => void run("信任项目", () => window.grok.trustProject(cwd).then(onChange))}
            >
              信任此文件夹
            </button>
          </div>
        ) : null}
        <div className="settings-actions">
          <button className="btn" type="button" onClick={onAddHook}>
            添加命令钩子
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void run("打开 Hooks 目录", () => window.grok.openHooksDir())}
          >
            打开 ~/.grok/hooks
          </button>
        </div>
        {settings.hooks.length === 0 ? (
          <p className="settings-hint">还没有发现 hooks。</p>
        ) : (
          <ul className="skill-list">
            {settings.hooks.map((hook, i) => (
              <li key={`${hook.event}:${hook.path}:${i}`}>
                <div>
                  <strong>{hook.event}</strong>
                  <span className="skill-src">{hook.source}</span>
                  {hook.matcher ? <span className="skill-src">{hook.matcher}</span> : null}
                  {hook.command ? <p>{hook.command}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="settings-section">
        <h3>会话循环</h3>
        <p className="settings-hint">
          Grok 没有系统定时任务。在输入框发送 <code>/loop 5m 检查测试</code> 即可在当前会话里循环（最短 60 秒，最多 50
          条，约 7 天过期）。关闭会话即停止。
        </p>
      </section>
    </>
  );
}

function NestedModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-backdrop nested"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn small ghost" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function McpForm({
  cwd,
  onClose,
  onChange,
  run,
}: {
  cwd?: string | null;
  onClose: () => void;
  onChange: (next: AppSettings) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">("stdio");
  const [scope, setScope] = useState<"user" | "project">("user");
  const [commandOrUrl, setCommandOrUrl] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");

  return (
    <NestedModal title="添加 MCP" onClose={onClose}>
      <label className="field">
        <span>名称</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="filesystem" />
      </label>
      <label className="field">
        <span>传输</span>
        <select value={transport} onChange={(e) => setTransport(e.target.value as "stdio" | "http" | "sse")}>
          <option value="stdio">stdio</option>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
      </label>
      <label className="field">
        <span>范围</span>
        <select value={scope} onChange={(e) => setScope(e.target.value as "user" | "project")}>
          <option value="user">用户 ~/.grok/config.toml</option>
          <option value="project">项目 .grok/config.toml</option>
        </select>
      </label>
      <label className="field">
        <span>{transport === "stdio" ? "命令" : "URL"}</span>
        <input
          value={commandOrUrl}
          onChange={(e) => setCommandOrUrl(e.target.value)}
          placeholder={transport === "stdio" ? "npx" : "https://…"}
        />
      </label>
      {transport === "stdio" ? (
        <label className="field">
          <span>参数（空格分隔）</span>
          <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @scope/server ." />
        </label>
      ) : null}
      <label className="field">
        <span>{transport === "stdio" ? "环境变量 KEY=value，一行一个" : "请求头 Name: Value，一行一个"}</span>
        <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} />
      </label>
      <div className="permission-actions">
        <button
          className="btn primary"
          type="button"
          disabled={!name.trim() || !commandOrUrl.trim()}
          onClick={() => {
            const extra = env
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean);
            void run("添加 MCP", () =>
              window.grok
                .mcpAdd(
                  {
                    name: name.trim(),
                    transport,
                    scope,
                    commandOrUrl: commandOrUrl.trim(),
                    args: args.trim() ? args.trim().split(/\s+/) : [],
                    env: transport === "stdio" ? extra : [],
                    headers: transport === "stdio" ? [] : extra,
                  },
                  cwd,
                )
                .then(onChange),
            );
          }}
        >
          添加
        </button>
      </div>
    </NestedModal>
  );
}

export function HookForm({
  cwd,
  onClose,
  onChange,
  run,
}: {
  cwd?: string | null;
  onClose: () => void;
  onChange: (next: AppSettings) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [name, setName] = useState("");
  const [event, setEvent] = useState("PreToolUse");
  const [matcher, setMatcher] = useState("");
  const [command, setCommand] = useState("");
  return (
    <NestedModal title="添加钩子" onClose={onClose}>
      <label className="field">
        <span>文件名</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="safety-check" />
      </label>
      <label className="field">
        <span>事件</span>
        <select value={event} onChange={(e) => setEvent(e.target.value)}>
          {HOOK_EVENTS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>匹配（可选，如 Bash）</span>
        <input value={matcher} onChange={(e) => setMatcher(e.target.value)} />
      </label>
      <label className="field">
        <span>命令</span>
        <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="echo started" />
      </label>
      <div className="permission-actions">
        <button
          className="btn primary"
          type="button"
          disabled={!name.trim() || !command.trim()}
          onClick={() => {
            void run("添加钩子", () =>
              window.grok
                .addHook(
                  { name: name.trim(), event, matcher: matcher.trim() || undefined, command: command.trim() },
                  cwd,
                )
                .then(onChange),
            );
          }}
        >
          保存
        </button>
      </div>
    </NestedModal>
  );
}

export function MarketForm({
  cwd,
  onClose,
  onChange,
  run,
}: {
  cwd?: string | null;
  onClose: () => void;
  onChange: (next: AppSettings) => void | Promise<void>;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [url, setUrl] = useState("");
  return (
    <NestedModal title="添加市场源" onClose={onClose}>
      <p className="settings-hint">
        支持 GitHub 仓库页面、owner/repo、Git URL、marketplace.json 地址或本地目录。远程仓库会自动生成 Windows 兼容副本。
      </p>
      <label className="field">
        <span>市场源地址</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/plugins"
          autoFocus
        />
      </label>
      <div className="permission-actions">
        <button
          className="btn primary"
          type="button"
          disabled={!url.trim()}
          onClick={() => {
            void run("添加市场", () => window.grok.marketplaceAdd(url.trim(), cwd).then(onChange));
          }}
        >
          添加
        </button>
      </div>
    </NestedModal>
  );
}
