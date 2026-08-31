import { useEffect, useState, type ReactNode } from "react";
import type {
  AppSettings,
  AppUpdateInfo,
  AvailablePluginInfo,
  McpServerInfo,
  PermissionMode,
  ProxyMode,
  ProxySettings,
  ProxyTestResult,
  ReasoningEffort,
  SkillCatalog,
  SkillCreateInput,
} from "../../electron/shared";
import { parseMcpArguments, parseMcpLines, parseMcpToolTimeouts } from "../../electron/mcp-commands";
import { Markdown } from "../lib/markdown";
import { ConfirmDialog, ModalPortal } from "./ModalPortal";

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
  onPermissionMode,
}: {
  open: boolean;
  settings: AppSettings | null;
  cwd?: string | null;
  sessionId?: string | null;
  modelSelectionLocked?: boolean;
  onClose: () => void;
  onChange: (next: AppSettings) => void;
  onPermissionMode?: (mode: PermissionMode) => void;
}) {
  const [pane, setPane] = useState<SettingsPane>("general");
  useEffect(() => {
    if (open) setPane("general");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(".modal-backdrop.nested")) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <ModalPortal>
      <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <header className="settings-top">
        <button className="settings-close" type="button" aria-label="关闭设置" title="关闭" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="m4.1 4.1 7.8 7.8M11.9 4.1l-7.8 7.8" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
          </svg>
        </button>
        <div className="settings-top-title">
          <strong>设置</strong>
        </div>
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
            settings ? <GeneralPane settings={settings} sessionId={sessionId} modelSelectionLocked={modelSelectionLocked} onChange={onChange} onPermissionMode={onPermissionMode} /> : <p className="settings-hint">正在读取配置…</p>
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
    </ModalPortal>
  );
}

function GeneralPane({
  settings,
  sessionId,
  modelSelectionLocked,
  onChange,
  onPermissionMode,
}: {
  settings: AppSettings;
  sessionId?: string | null;
  modelSelectionLocked: boolean;
  onChange: (next: AppSettings) => void;
  onPermissionMode?: (mode: PermissionMode) => void;
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
              aria-pressed={settings.reasoningEffort === item.id}
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
              aria-pressed={settings.permissionMode === mode.id}
              onClick={() => {
                if (onPermissionMode) {
                  onPermissionMode(mode.id);
                  return;
                }
                const previous = settings;
                onChange({ ...settings, permissionMode: mode.id });
                void window.grok.setPermission(mode.id).catch(() => onChange(previous));
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
              aria-pressed={draft.mode === mode.id}
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
            <Markdown text={info.notes} allowHtml />
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
  catalog,
  cwd,
  onCatalog,
  onRefresh,
  onCreate,
  run,
}: {
  settings: AppSettings;
  catalog: SkillCatalog | null;
  cwd?: string | null;
  onCatalog: (next: SkillCatalog) => void;
  onRefresh: () => void;
  onCreate: () => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const skills = catalog?.skills ?? settings.skills;
  const bridgeReady = typeof window === "undefined" || typeof window.grok.skillsCatalog === "function";
  const projectDirReady = typeof window === "undefined" || typeof window.grok.openProjectSkillsDir === "function";
  const [confirmAction, setConfirmAction] = useState<"reset" | { type: "path"; path: string } | null>(null);
  return (
    <>
      <section className="settings-section">
      <h3>Skills</h3>
      <p className="settings-hint">
        来自 Grok 原生 Skills 目录，包括项目、用户、插件、内置、Claude、Cursor 与额外路径。同名技能保留限定调用名。
      </p>
      <div className="settings-actions">
        <button className="btn primary" type="button" disabled={!bridgeReady} onClick={onCreate}>创建 Skill</button>
        <button className="btn" type="button" onClick={onRefresh}>刷新</button>
        <button
          className="btn"
          type="button"
          onClick={() => void run("打开 Skills 目录", () => window.grok.openSkillsDir())}
        >
          打开 ~/.grok/skills
        </button>
        {cwd ? (
          <button className="btn" type="button" disabled={!projectDirReady} onClick={() => void run("打开项目 Skills", () => window.grok.openProjectSkillsDir(cwd))}>
            打开项目 Skills
          </button>
        ) : null}
        <button
          className="btn"
          type="button"
          disabled={!bridgeReady}
          onClick={() => void run("添加 Skills 路径", async () => {
            const paths = await window.grok.pickFolder();
            if (!paths[0]) return catalog ?? { skills, paths: [], ignore: [], message: "" };
            const next = await window.grok.skillsAddPath(paths[0], cwd);
            onCatalog(next);
            return next;
          })}
        >
          添加目录
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={!bridgeReady}
          onClick={() => setConfirmAction("reset")}
        >重置配置</button>
      </div>
      {catalog?.paths.length ? (
        <div className="extension-config-block">
          <strong>额外搜索路径</strong>
          {catalog.paths.map((skillPath) => (
            <div className="extension-config-row" key={skillPath}>
              <code>{skillPath}</code>
              <button
                className="btn small ghost"
                type="button"
                onClick={() => setConfirmAction({ type: "path", path: skillPath })}
              >移除</button>
            </div>
          ))}
        </div>
      ) : null}
      {catalog?.ignore.length ? <p className="settings-hint">忽略路径：{catalog.ignore.join("、")}</p> : null}
      {skills.length === 0 ? (
        <p className="settings-hint">还没有 Skills。把带 SKILL.md 的目录放到 ~/.grok/skills/ 或项目的 .grok/skills/。</p>
      ) : (
        <ul className="skill-list">
          {skills.map((skill) => (
            <li key={skill.id}>
              <div>
                <strong>{skill.displayName || skill.name}</strong>
                <span className="skill-src">{skill.source}</span>
                {skill.invocableAs ? <span className="skill-src">{skill.invocableAs}</span> : null}
                {skill.pluginVersion ? <span className="skill-src">v{skill.pluginVersion}</span> : null}
                {skill.collidesWith ? <span className="skill-src warn">同名：/{skill.collidesWith}</span> : null}
                {skill.userInvocable === false ? <span className="skill-src">仅模型</span> : null}
                {skill.disableModelInvocation ? <span className="skill-src">仅手动</span> : null}
                {skill.shortDescription || skill.description ? <p>{skill.shortDescription || skill.description}</p> : null}
                {(skill.whenToUse || skill.argumentHint || skill.author || skill.allowedTools?.length || skill.compatibility) ? (
                  <details className="extension-details">
                    <summary>完整信息</summary>
                    {skill.description && skill.shortDescription ? <p>{skill.description}</p> : null}
                    {skill.whenToUse ? <p><b>触发：</b>{skill.whenToUse}</p> : null}
                    {skill.argumentHint ? <p><b>参数：</b>{skill.argumentHint}</p> : null}
                    {skill.author ? <p><b>作者：</b>{skill.author}</p> : null}
                    {skill.allowedTools?.length ? <p><b>工具：</b>{skill.allowedTools.join("、")}</p> : null}
                    {skill.compatibility ? <p><b>环境：</b>{skill.compatibility}</p> : null}
                    {skill.license ? <p><b>许可：</b>{skill.license}</p> : null}
                  </details>
                ) : null}
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
                      const enabled = e.target.checked;
                      void run("更新 Skill", async () => {
                        if (typeof window.grok.skillsSetEnabled === "function") {
                          const next = await window.grok.skillsSetEnabled(skill.name, enabled, cwd);
                          onCatalog(next);
                          return next;
                        }
                        const next = await window.grok.setSkillDisabled(skill.name, !enabled, cwd);
                        const fallback = {
                          skills: next.skills,
                          paths: catalog?.paths ?? [],
                          ignore: catalog?.ignore ?? [],
                          message: "兼容模式",
                        };
                        onCatalog(fallback);
                        return fallback;
                      });
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
      {confirmAction ? (
        <ConfirmDialog
          title={confirmAction === "reset" ? "重置 Skills 配置" : "移除 Skills 搜索路径"}
          message={confirmAction === "reset"
            ? "将重置自定义路径、忽略项和禁用状态；磁盘中的 SKILL.md 不会被删除。"
            : `将从搜索范围移除：\n${confirmAction.path}\n不会删除磁盘文件。`}
          confirmLabel={confirmAction === "reset" ? "重置配置" : "移除路径"}
          danger
          onClose={() => setConfirmAction(null)}
          onConfirm={() => {
            const action = confirmAction;
            setConfirmAction(null);
            if (action === "reset") {
              void run("重置 Skills", () => window.grok.skillsReset(cwd).then((next) => {
                onCatalog(next);
                return next;
              }));
              return;
            }
            void run("移除 Skills 路径", () => window.grok.skillsRemovePath(action.path, cwd).then((next) => {
              onCatalog(next);
              return next;
            }));
          }}
        />
      ) : null}
    </>
  );
}

export function McpTab({
  settings,
  servers,
  cwd,
  sessionId,
  doctor,
  onDoctor,
  onOpenAdd,
  onRefresh,
  onSetup,
  onServers,
  onChange,
  run,
}: {
  settings: AppSettings;
  servers: McpServerInfo[];
  cwd?: string | null;
  sessionId?: string | null;
  doctor: string;
  onDoctor: (text: string) => void;
  onOpenAdd: () => void;
  onRefresh: () => void;
  onSetup: (server: McpServerInfo) => void;
  onServers: (servers: McpServerInfo[]) => void;
  onChange: (next: AppSettings) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [removeServer, setRemoveServer] = useState<McpServerInfo | null>(null);

  async function refreshAfterSettings(next: AppSettings) {
    onChange(next);
    if (typeof window.grok.mcpCatalog !== "function") {
      onServers(next.mcpServers);
      return next.mcpServers;
    }
    const rows = await window.grok.mcpCatalog(sessionId, cwd, true);
    onServers(rows);
    return rows;
  }

  return (
    <>
      <section className="settings-section">
      <h3>MCP</h3>
      <p className="settings-hint">
        同时读取磁盘配置和当前 Grok 会话。可管理服务器、OAuth、初始化字段、单个工具开关与超时配置；
        Claude / Cursor 兼容源也会列出。
      </p>
      {!sessionId ? <p className="settings-hint">打开一个对话后可判断实时认证状态并管理单个工具。</p> : null}
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
        <button className="btn primary" type="button" onClick={onOpenAdd}>
          添加服务器
        </button>
        <button className="btn" type="button" onClick={onRefresh}>刷新</button>
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
      {servers.length === 0 ? (
        <p className="settings-hint">还没有发现 MCP 服务器。可用 stdio 命令或 HTTP 地址添加。</p>
      ) : (
        <ul className="skill-list">
          {servers.map((server) => (
            <li key={`${server.source}:${server.name}`}>
              <div className="extension-main">
                <strong>{server.name}</strong>
                <span className="skill-src">{server.source}</span>
                <span className="skill-src">{server.transport}</span>
                <span className={`skill-src ${server.status && !/connected|ready|enabled|configured/i.test(server.status) ? "warn" : ""}`}>
                  {server.status || (server.enabled ? "configured" : "disabled")}
                </span>
                {server.live ? <span className="skill-src live">实时</span> : null}
                {server.toolCount !== undefined ? <span className="skill-src">{server.toolCount} 个工具</span> : null}
                {server.authRequired ? <span className="skill-src warn">需要认证</span> : null}
                {server.setupRequired ? <span className="skill-src warn">需要初始化</span> : null}
                {server.target ? <p>{server.target}</p> : null}
                {server.tools?.length ? (
                  <details className="extension-details mcp-tools">
                    <summary>工具 ({server.tools.length})</summary>
                    <div className="extension-tool-list">
                      {server.tools.map((tool) => (
                        <div className="extension-tool-row" key={tool.name}>
                          <div>
                            <strong>{tool.displayName || tool.name}</strong>
                            {tool.description ? <p>{tool.description}</p> : null}
                          </div>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={tool.enabled}
                              disabled={!sessionId}
                              onChange={(event) => {
                                if (!sessionId) return;
                                void run("更新 MCP 工具", async () => {
                                  const rows = await window.grok.mcpSetToolEnabled(
                                    sessionId,
                                    server.name,
                                    tool.name,
                                    event.target.checked,
                                    cwd,
                                  );
                                  onServers(rows);
                                  return rows;
                                });
                              }}
                            />
                            {tool.enabled ? "启用" : "关闭"}
                          </label>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
              <div className="row-actions plugin-row-actions">
                {server.authRequired ? (
                  <button
                    className="btn small"
                    type="button"
                    disabled={!sessionId || !server.enabled}
                    title={!sessionId ? "请先打开一个对话，再进行 MCP 认证" : undefined}
                    onClick={() => void run("MCP 认证", async () => {
                      if (!sessionId) throw new Error("请先打开一个对话，再进行 MCP 认证");
                      const result = await window.grok.mcpAuthenticate(sessionId, server.name, cwd);
                      onServers(result.servers);
                      return result;
                    })}
                  >认证</button>
                ) : null}
                {server.setupRequired && server.setup?.fields.length && sessionId ? (
                  <button className="btn small" type="button" onClick={() => onSetup(server)}>初始化</button>
                ) : null}
                {server.path ? (
                  <button className="btn small ghost" type="button" onClick={() => void window.grok.openPath(server.path)}>打开配置</button>
                ) : null}
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
                    onClick={() => setRemoveServer(server)}
                  >
                    删除
                  </button>
                ) : null}
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={(e) => {
                      void run("更新 MCP", async () => {
                        const next = await window.grok.mcpSetEnabled(server.name, e.target.checked, cwd, sessionId);
                        return refreshAfterSettings(next);
                      });
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
      {removeServer ? (
        <ConfirmDialog
          title={`删除 MCP 服务器“${removeServer.name}”`}
          message="此操作会从当前配置中移除服务器及其工具入口。"
          confirmLabel="删除服务器"
          danger
          onClose={() => setRemoveServer(null)}
          onConfirm={() => {
            const server = removeServer;
            setRemoveServer(null);
            const projectSource = /项目|project|仓库/i.test(server.source);
            void run("删除", async () => {
              const next = await window.grok.mcpRemove(
                server.name,
                projectSource ? "project" : "user",
                cwd,
                sessionId,
              );
              return refreshAfterSettings(next);
            });
          }}
        />
      ) : null}
    </>
  );
}

function PluginTileIcon() {
  return (
    <span className="plugin-tile-icon" aria-hidden>
      <svg viewBox="0 0 24 24">
        <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
        <path d="M4 7.5v9L12 21l8-4.5v-9M12 12v9" />
      </svg>
    </span>
  );
}

function MarketplaceSectionIcon({ kind }: { kind: "source" | "catalog" }) {
  if (kind === "source") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="6" cy="12" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="18" cy="6" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="18" cy="18" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="m8.1 11 7.8-4M8.1 13l7.8 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4 7.5v9L12 21l8-4.5v-9M12 12v9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function MarketplaceStateIcon({ kind }: { kind: "empty" | "loading" }) {
  if (kind === "loading") {
    return (
      <span className="marketplace-state-icon is-loading" aria-hidden>
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" opacity=".24" />
          <path d="M20 12a8 8 0 0 0-8-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="marketplace-state-icon" aria-hidden>
      <svg viewBox="0 0 24 24">
        <path d="M5 7.5h14M5 12h9M5 16.5h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="m17 14.5 3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function PluginsTab({
  settings,
  cwd,
  sessionId,
  available,
  loading,
  error,
  onRefresh,
  onMarket,
  onInstall,
  onUninstall,
  onChange,
  run,
}: {
  settings: AppSettings;
  cwd?: string | null;
  sessionId?: string | null;
  available: AvailablePluginInfo[] | null;
  loading: boolean;
  error?: string;
  onRefresh: () => void | Promise<void>;
  onMarket: () => void;
  onInstall: () => void;
  onUninstall: (name: string) => void;
  onChange: (next: AppSettings) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [selectedMarketplace, setSelectedMarketplace] = useState("all");
  const [installingPlugin, setInstallingPlugin] = useState("");
  const [installingDependency, setInstallingDependency] = useState("");
  const [installedDependencies, setInstalledDependencies] = useState<Set<string>>(() => new Set());
  const [removeMarketplaceName, setRemoveMarketplaceName] = useState("");
  const marketplaceTabs = Array.from(new Set([
    ...settings.marketplaces.map((item) => item.name),
    ...(available || []).map((item) => item.marketplace),
  ].filter(Boolean)));
  const selectedSource = selectedMarketplace === "all"
    ? null
    : settings.marketplaces.find((item) => item.name === selectedMarketplace) || null;
  const visiblePlugins = (available || []).filter((item) =>
    selectedMarketplace === "all" || item.marketplace === selectedMarketplace,
  );
  const marketplaceToRemove = removeMarketplaceName
    ? settings.marketplaces.find((item) => item.name === removeMarketplaceName) || null
    : null;

  useEffect(() => {
    if (selectedMarketplace !== "all" && !marketplaceTabs.includes(selectedMarketplace)) {
      setSelectedMarketplace("all");
    }
  }, [selectedMarketplace, marketplaceTabs.join("\u0000")]);

  async function installMarketplacePlugin(item: AvailablePluginInfo) {
    if (installingPlugin) return;
    setInstallingPlugin(item.name);
    try {
      const next = await run(`安装并验证 ${item.name}`, () => window.grok.pluginInstall(item.name, true, cwd, sessionId));
      if (next) onChange(next);
    } finally {
      setInstallingPlugin("");
    }
  }

  async function installDependency(pluginName: string, command: string) {
    const key = `${pluginName}:${command}`;
    if (installingDependency) return;
    setInstallingDependency(key);
    try {
      const result = await run(`安装 ${command} 运行环境`, () => window.grok.pluginInstallDependency(command));
      if (result) setInstalledDependencies((current) => new Set(current).add(key));
    } finally {
      setInstallingDependency("");
    }
  }

  return (
    <>
      <section className="settings-section marketplace-panel market-source-section">
        <div className="plugin-section-head marketplace-section-head">
          <div className="marketplace-section-title">
            <span className="marketplace-section-icon" aria-hidden>
              <MarketplaceSectionIcon kind="source" />
            </span>
            <div>
              <span className="marketplace-section-eyebrow">CATALOG SOURCES</span>
              <h3>市场源 <span className="marketplace-section-count">{settings.marketplaces.length}</span></h3>
              <p className="settings-hint">更新会重新同步远程仓库；Windows 兼容镜像也会重新生成。</p>
            </div>
          </div>
          <div className="row-actions marketplace-section-actions">
            <button className="btn small" type="button" onClick={onMarket}>
              添加市场源
            </button>
            <button
              className="btn small ghost"
              type="button"
              disabled={settings.marketplaces.length === 0}
              onClick={() =>
                void run("更新全部市场源", () =>
                  window.grok.marketplaceUpdate(undefined, cwd).then(async (next) => {
                    onChange(next);
                    await onRefresh();
                    return next;
                  }),
                )
              }
            >
              更新全部源
            </button>
          </div>
        </div>
        {settings.marketplaces.length === 0 ? (
          <div className="marketplace-empty-state marketplace-empty-source" role="status">
            <MarketplaceStateIcon kind="empty" />
            <div>
              <strong>还没有市场源</strong>
              <p>可添加 GitHub 仓库、Git URL 或本地目录，插件目录会在同步后出现在下方。</p>
            </div>
            <button className="btn small primary" type="button" onClick={onMarket}>
              添加第一个市场源
            </button>
          </div>
        ) : (
          <>
            <div className="market-source-tabs" role="tablist" aria-label="市场源">
              <button
                className={selectedMarketplace === "all" ? "on" : ""}
                type="button"
                role="tab"
                aria-selected={selectedMarketplace === "all"}
                id="market-source-tab-all"
                aria-controls="market-source-panel"
                onClick={() => setSelectedMarketplace("all")}
              >
                <span className="market-source-tab-mark" aria-hidden>
                  <MarketplaceSectionIcon kind="catalog" />
                </span>
                <strong>全部</strong>
                <span>{available?.length || 0}</span>
              </button>
              {marketplaceTabs.map((name) => (
                <button
                  className={selectedMarketplace === name ? "on" : ""}
                  type="button"
                  role="tab"
                  aria-selected={selectedMarketplace === name}
                  id={`market-source-tab-${name}`}
                  aria-controls="market-source-panel"
                  title={name}
                  key={name}
                  onClick={() => setSelectedMarketplace(name)}
                >
                  <span className="market-source-tab-mark" aria-hidden>
                    <MarketplaceSectionIcon kind="source" />
                  </span>
                  <strong>{name}</strong>
                  <span>{(available || []).filter((item) => item.marketplace === name).length}</span>
                </button>
              ))}
            </div>
            {selectedSource ? (
              <div className="market-source-detail" id="market-source-panel" role="tabpanel" aria-label={`${selectedSource.name} 市场源`}>
                <div className="market-source-detail-copy">
                  <div className="market-source-detail-title">
                    <span className="market-source-detail-mark" aria-hidden>
                      <MarketplaceSectionIcon kind="source" />
                    </span>
                    <strong>{selectedSource.name}</strong>
                    <span>{selectedSource.kind}</span>
                  </div>
                  {selectedSource.url ? <p>{selectedSource.url}</p> : null}
                </div>
                <span className="market-source-detail-status"><i aria-hidden />已连接目录</span>
                {selectedSource.url ? (
                  <div className="row-actions market-source-detail-actions">
                    <button
                      className="btn small ghost"
                      type="button"
                      onClick={() =>
                        void run("更新市场源", () =>
                          window.grok.marketplaceUpdate(selectedSource.name, cwd).then(async (next) => {
                            onChange(next);
                            await onRefresh();
                            return next;
                          }),
                        )
                      }
                    >
                      更新当前源
                    </button>
                    <button
                      className="btn small ghost danger"
                      type="button"
                      onClick={() => setRemoveMarketplaceName(selectedSource.name)}
                    >
                      移除当前源
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="market-source-summary"><i aria-hidden />当前显示全部市场，共 <strong>{available?.length || 0}</strong> 个插件。</p>
            )}
          </>
        )}
      </section>
      <section className="settings-section marketplace-panel plugin-browser plugin-browser-section">
        <div className="plugin-section-head marketplace-section-head">
          <div className="marketplace-section-title">
            <span className="marketplace-section-icon" aria-hidden>
              <MarketplaceSectionIcon kind="catalog" />
            </span>
            <div>
              <span className="marketplace-section-eyebrow">DISCOVER &amp; INSTALL</span>
              <h3>可安装插件{selectedMarketplace === "all" ? "" : ` · ${selectedMarketplace}`} <span className="marketplace-section-count">{available ? visiblePlugins.length : "—"}</span></h3>
              <p className="settings-hint">使用上方市场 Tab 筛选插件；这里的刷新只重读目录，远程同步请使用“更新”。</p>
            </div>
          </div>
          <div className="row-actions marketplace-section-actions">
            <button className="btn small" type="button" onClick={onInstall}>
              从来源安装
            </button>
            <button
              className="btn small ghost"
              type="button"
              disabled={settings.plugins.length === 0}
              onClick={() =>
                void run("更新全部插件", () =>
                  window.grok.pluginUpdate(undefined, cwd).then(async (next) => {
                    onChange(next);
                    await onRefresh();
                    return next;
                  }),
                )
              }
            >
              更新全部插件
            </button>
            <button
              className="btn small ghost"
              type="button"
              onClick={() =>
                void run("重读插件目录", () =>
                  window.grok.settings(cwd).then(async (next) => {
                    onChange(next);
                    await onRefresh();
                    return next;
                  }),
                )
              }
            >
              重读目录
            </button>
          </div>
        </div>
        {available === null && error ? (
          <div className="marketplace-state-card marketplace-error-state" role="alert">
            <MarketplaceStateIcon kind="empty" />
            <div>
              <strong>市场目录读取失败</strong>
              <span>{error}</span>
            </div>
            <button className="btn small" type="button" onClick={onRefresh}>重试</button>
          </div>
        ) : null}
        {available === null && !error && loading ? (
          <div className="marketplace-state-card marketplace-loading-state" role="status" aria-live="polite">
            <MarketplaceStateIcon kind="loading" />
            <div>
              <strong>正在读取市场…</strong>
              <span>整理来源和插件信息，马上就好。</span>
            </div>
            <div className="marketplace-loading-lines" aria-hidden><i /><i /><i /></div>
          </div>
        ) : null}
        {available === null && !error && loading ? (
          <div className="marketplace-skeleton-grid" aria-hidden>
            {[0, 1, 2].map((item) => (
              <div className="marketplace-skeleton-card" key={item}>
                <i className="skeleton-icon" />
                <i className="skeleton-title" />
                <i className="skeleton-line" />
                <i className="skeleton-line short" />
                <i className="skeleton-action" />
              </div>
            ))}
          </div>
        ) : null}
        {available && visiblePlugins.length === 0 ? (
          <div className="marketplace-state-card marketplace-empty-filter" role="status">
            <MarketplaceStateIcon kind="empty" />
            <div>
              <strong>当前市场里暂时没有条目</strong>
              <span>{selectedMarketplace === "all" ? "更新市场源或从来源安装一个插件。" : `“${selectedMarketplace}”暂时没有可展示的插件。`}</span>
            </div>
            {selectedMarketplace !== "all" ? (
              <button className="btn small ghost" type="button" onClick={() => setSelectedMarketplace("all")}>查看全部市场</button>
            ) : null}
          </div>
        ) : null}
        {available && visiblePlugins.length ? (
          <ul className="plugin-card-grid plugin-available-grid">
            {visiblePlugins.map((item) => {
              const installedPlugin = settings.plugins.find((plugin) => plugin.name === item.name);
              const installed = item.status === "installed" || Boolean(installedPlugin);
              const description = item.description || installedPlugin?.description || "暂无插件说明。";
              const installing = installingPlugin === item.name;
              const missingDependencies = (installedPlugin?.dependencies || []).filter((dependency) => !dependency.available);
              const capabilities = [
                item.skillCount > 0 ? `${item.skillCount} 个 Skill` : "基础扩展",
                item.hasMcp ? "MCP" : null,
                item.hasAgents ? "Agent" : null,
                item.hasHooks ? "Hooks" : null,
                item.commandCount > 0 ? `${item.commandCount} 个命令` : null,
                item.hasLsp ? "LSP" : null,
              ].filter((value): value is string => Boolean(value)).slice(0, 4);
              return (
                <li
                  className={`plugin-card plugin-available-card${installing ? " installing" : ""}${missingDependencies.length ? " has-runtime-warning" : ""}`}
                  data-plugin-name={item.name}
                  data-marketplace={item.marketplace}
                  key={`${item.marketplace}:${item.name}`}
                >
                  <div className="plugin-card-topline">
                    <PluginTileIcon />
                    <span className={`plugin-card-state${installed ? " installed" : ""}`}>
                      <i aria-hidden />
                      {installed ? "已安装" : "可安装"}
                    </span>
                  </div>
                  <div className="plugin-card-heading">
                    <strong className="plugin-tile-name" title={item.name}>{item.name}</strong>
                    <span className="plugin-card-source" title={item.marketplace}>{item.marketplace}</span>
                  </div>
                  <p className="plugin-tile-description" title={description}>
                    {description}
                  </p>
                  <div className="plugin-card-capabilities" aria-label="插件能力">
                    {capabilities.map((capability) => <span key={capability}>{capability}</span>)}
                  </div>
                  {missingDependencies.map((dependency) => {
                    const key = `${item.name}:${dependency.command}`;
                    const installingRuntime = installingDependency === key;
                    const installedRuntime = installedDependencies.has(key);
                    return (
                      <div className="plugin-runtime-warning" role="status" key={dependency.command}>
                        <span>
                          {installedRuntime
                            ? `${dependency.packageName || dependency.command} 已安装，重启后生效`
                            : `缺少运行环境 ${dependency.command}`}
                        </span>
                        {!installedRuntime && dependency.installable ? (
                          <button
                            type="button"
                            disabled={Boolean(installingDependency)}
                            onClick={() => void installDependency(item.name, dependency.command)}
                          >
                            {installingRuntime ? "安装中…" : dependency.installLabel || "安装依赖"}
                          </button>
                        ) : !installedRuntime ? (
                          <button
                            type="button"
                            disabled={Boolean(installingDependency)}
                            onClick={() => void run("重新检测运行环境", () => window.grok.settings(cwd).then(onChange))}
                          >
                            重新检测
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  <div className="plugin-card-footer">
                    <span className="plugin-card-footnote">{installed ? "已加入工作台" : "安装后可在会话中调用"}</span>
                    <button
                      className={`btn small plugin-card-install plugin-tile-action plugin-available-install${installed ? " is-installed" : ""}${installing ? " installing" : ""}`}
                      type="button"
                      disabled={Boolean(installingPlugin)}
                      aria-busy={installing}
                      aria-label={installing ? `正在配置 ${item.name}` : installed ? `卸载 ${item.name}` : `安装 ${item.name}`}
                      onClick={() => installed ? onUninstall(item.name) : void installMarketplacePlugin(item)}
                    >
                      {installing ? (
                        <>
                          <svg className="spinner" width="13" height="13" viewBox="0 0 16 16" aria-hidden>
                            <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.24" />
                            <path
                              d="M13.4 8a5.4 5.4 0 0 0-5.4-5.4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                            />
                          </svg>
                          安装配置中…
                        </>
                      ) : installed ? (
                        <>
                          <svg viewBox="0 0 16 16" aria-hidden>
                            <path d="M3.5 4.5h9M6 4.5V3.2h4v1.3M5 6.2l.5 6.3h5l.5-6.3" />
                          </svg>
                          已安装 · 卸载
                        </>
                      ) : (
                        <>
                          <svg viewBox="0 0 16 16" aria-hidden>
                            <path d="M8 2.5v7M5.5 7.2 8 9.7l2.5-2.5M3 12.5h10" />
                          </svg>
                          安装并完成配置
                        </>
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
      {marketplaceToRemove ? (
        <ConfirmDialog
          title={`移除市场源「${marketplaceToRemove.name}」`}
          message={`Grok CLI 会同时卸载从该来源安装的插件。此操作不会删除本地项目文件。`}
          confirmLabel="移除市场源"
          danger
          onClose={() => setRemoveMarketplaceName("")}
          onConfirm={() => {
            const source = marketplaceToRemove;
            setRemoveMarketplaceName("");
            void run("移除市场", () =>
              window.grok.marketplaceRemove(source.url, cwd).then(async (next) => {
                onChange(next);
                setSelectedMarketplace("all");
                await onRefresh();
                return next;
              }),
            );
          }}
        />
      ) : null}
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <ModalPortal>
      <div
        className="modal-backdrop nested"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="btn small ghost" type="button" onClick={onClose}>
              关闭
            </button>
          </div>
          {children}
        </div>
      </div>
    </ModalPortal>
  );
}

export function McpForm({
  cwd,
  sessionId,
  onClose,
  onChange,
  run,
}: {
  cwd?: string | null;
  sessionId?: string | null;
  onClose: () => void;
  onChange: (next: AppSettings) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">("stdio");
  const [scope, setScope] = useState<"user" | "project">("user");
  const [commandOrUrl, setCommandOrUrl] = useState("");
  const [args, setArgs] = useState("");
  const [connectionLines, setConnectionLines] = useState("");
  const [serverCwd, setServerCwd] = useState("");
  const [bearerTokenEnvVar, setBearerTokenEnvVar] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecretEnvVar, setOauthClientSecretEnvVar] = useState("");
  const [oauthScopes, setOauthScopes] = useState("");
  const [startupTimeout, setStartupTimeout] = useState("");
  const [toolTimeout, setToolTimeout] = useState("");
  const [toolTimeouts, setToolTimeouts] = useState("");
  const [exposeImageBase64, setExposeImageBase64] = useState(false);

  useEffect(() => {
    if (!cwd && scope === "project") setScope("user");
  }, [cwd, scope]);

  function optionalSeconds(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("超时必须是正整数秒数");
    return parsed;
  }

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
          <option value="project" disabled={!cwd}>项目 .grok/config.toml</option>
        </select>
        {!cwd ? <small>选择项目后才能写入项目级配置。</small> : null}
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
          <span>参数（支持引号；也可每行一个参数）</span>
          <textarea className="resize-none" value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'-y "@scope/server" .'} rows={2} />
        </label>
      ) : null}
      <label className="field">
        <span>{transport === "stdio" ? "环境变量 KEY=value，一行一个" : "请求头 Name: Value，一行一个"}</span>
        <textarea className="resize-none" value={connectionLines} onChange={(e) => setConnectionLines(e.target.value)} rows={3} />
      </label>
      <details className="extension-details form-details">
        <summary>高级配置</summary>
        {transport === "stdio" ? (
          <label className="field">
            <span>服务器工作目录</span>
            <input value={serverCwd} onChange={(e) => setServerCwd(e.target.value)} placeholder="C:\\path\\to\\server" />
          </label>
        ) : (
          <>
            <label className="field">
              <span>Bearer Token 环境变量名</span>
              <input value={bearerTokenEnvVar} onChange={(e) => setBearerTokenEnvVar(e.target.value)} placeholder="MCP_TOKEN" />
            </label>
            <label className="field">
              <span>OAuth Client ID</span>
              <input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} />
            </label>
            <label className="field">
              <span>OAuth Client Secret 环境变量名</span>
              <input value={oauthClientSecretEnvVar} onChange={(e) => setOauthClientSecretEnvVar(e.target.value)} placeholder="MCP_CLIENT_SECRET" />
            </label>
            <label className="field">
              <span>OAuth Scopes（空格或逗号分隔）</span>
              <input value={oauthScopes} onChange={(e) => setOauthScopes(e.target.value)} placeholder="read write" />
            </label>
          </>
        )}
        <div className="extension-form-grid">
          <label className="field">
            <span>启动超时（秒）</span>
            <input type="number" min={1} value={startupTimeout} onChange={(e) => setStartupTimeout(e.target.value)} />
          </label>
          <label className="field">
            <span>默认工具超时（秒）</span>
            <input type="number" min={1} value={toolTimeout} onChange={(e) => setToolTimeout(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>单工具超时，一行一个 tool_name=秒数</span>
          <textarea className="resize-none" value={toolTimeouts} onChange={(e) => setToolTimeouts(e.target.value)} rows={3} />
        </label>
        <label className="check-row compact">
          <input type="checkbox" checked={exposeImageBase64} onChange={(e) => setExposeImageBase64(e.target.checked)} />
          <span><strong>向模型暴露图片 Base64</strong><small>仅在服务器和模型确实需要原始图片数据时开启。</small></span>
        </label>
      </details>
      <div className="permission-actions">
        <button
          className="btn primary"
          type="button"
          disabled={!name.trim() || !commandOrUrl.trim()}
          onClick={() => {
            void run("添加 MCP", async () => {
              const connection = parseMcpLines(connectionLines);
              const next = await window.grok.mcpAdd(
                {
                  name: name.trim(),
                  transport,
                  scope,
                  commandOrUrl: commandOrUrl.trim(),
                  args: transport === "stdio" ? parseMcpArguments(args) : [],
                  env: transport === "stdio" ? connection : [],
                  headers: transport === "stdio" ? [] : connection,
                  serverCwd: serverCwd.trim() || undefined,
                  bearerTokenEnvVar: bearerTokenEnvVar.trim() || undefined,
                  oauthClientId: oauthClientId.trim() || undefined,
                  oauthClientSecretEnvVar: oauthClientSecretEnvVar.trim() || undefined,
                  oauthScopes: oauthScopes.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean),
                  startupTimeoutSec: optionalSeconds(startupTimeout),
                  toolTimeoutSec: optionalSeconds(toolTimeout),
                  toolTimeouts: parseMcpToolTimeouts(toolTimeouts),
                  exposeImageBase64,
                },
                cwd,
                sessionId,
              );
              onChange(next);
              return next;
            });
          }}
        >
          添加或更新
        </button>
      </div>
    </NestedModal>
  );
}

export function McpSetupForm({
  server,
  sessionId,
  cwd,
  onClose,
  onServers,
  run,
}: {
  server: McpServerInfo;
  sessionId: string;
  cwd?: string | null;
  onClose: () => void;
  onServers: (servers: McpServerInfo[]) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const fields = server.setup?.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    fields.map((field) => [field.id, server.setupValues?.[field.id] ?? field.default ?? field.options[0]?.value ?? ""]),
  ));
  const complete = fields.every((field) => !field.required || Boolean(values[field.id]?.trim()));

  return (
    <NestedModal title={`初始化 MCP · ${server.displayName || server.name}`} onClose={onClose}>
      <p className="settings-hint">这些值会提交给当前 Grok 会话的 MCP 初始化流程。</p>
      {fields.map((field) => (
        <label className="field" key={field.id}>
          <span>{field.label}{field.required ? " *" : ""}</span>
          {field.options.length ? (
            <select
              value={values[field.id] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
            >
              {!field.required ? <option value="">未设置</option> : null}
              {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : (
            <input
              type={/secret|password|token/i.test(field.type) ? "password" : "text"}
              value={values[field.id] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
            />
          )}
        </label>
      ))}
      <div className="permission-actions">
        <button
          className="btn primary"
          type="button"
          disabled={!complete}
          onClick={() => void run("初始化 MCP", async () => {
            const rows = await window.grok.mcpSetup(sessionId, server.name, values, cwd);
            onServers(rows);
            return rows;
          })}
        >保存并连接</button>
      </div>
    </NestedModal>
  );
}

export function SkillCreateForm({
  cwd,
  onClose,
  onCreated,
  run,
}: {
  cwd?: string | null;
  onClose: () => void;
  onCreated: (catalog: SkillCatalog) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<SkillCreateInput["scope"]>(cwd ? "project" : "user");
  const [body, setBody] = useState("");
  const [whenToUse, setWhenToUse] = useState("");
  const [argumentHint, setArgumentHint] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [userInvocable, setUserInvocable] = useState(true);
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);
  const [author, setAuthor] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [license, setLicense] = useState("");
  const [compatibility, setCompatibility] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");

  useEffect(() => {
    if (!cwd && scope === "project") setScope("user");
  }, [cwd, scope]);

  return (
    <NestedModal title="创建 Skill" onClose={onClose}>
      <label className="field">
        <span>名称</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="release-check" autoFocus />
        <small>保存时会标准化为小写连字符名称。</small>
      </label>
      <label className="field">
        <span>描述</span>
        <textarea className="resize-none" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="说明这个 Skill 做什么，以及什么时候应该使用。" />
      </label>
      <label className="field">
        <span>范围</span>
        <select value={scope} onChange={(e) => setScope(e.target.value as SkillCreateInput["scope"])}>
          <option value="user">用户 ~/.grok/skills</option>
          <option value="project" disabled={!cwd}>项目 .grok/skills</option>
        </select>
      </label>
      <label className="field">
        <span>指令正文</span>
        <textarea className="resize-none" value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="# 工作流程&#10;&#10;1. 检查…&#10;2. 修改…&#10;3. 验证…" />
      </label>
      <details className="extension-details form-details">
        <summary>调用与元数据</summary>
        <label className="field"><span>何时使用</span><input value={whenToUse} onChange={(e) => setWhenToUse(e.target.value)} /></label>
        <label className="field"><span>参数提示</span><input value={argumentHint} onChange={(e) => setArgumentHint(e.target.value)} placeholder="[target] [--fix]" /></label>
        <label className="field"><span>允许的工具（空格、逗号或换行分隔）</span><textarea className="resize-none" value={allowedTools} onChange={(e) => setAllowedTools(e.target.value)} rows={2} /></label>
        <label className="check-row compact">
          <input type="checkbox" checked={userInvocable} onChange={(e) => setUserInvocable(e.target.checked)} />
          <span><strong>允许用户手动调用</strong><small>关闭后不显示为用户可调用的 /skill。</small></span>
        </label>
        <label className="check-row compact">
          <input type="checkbox" checked={disableModelInvocation} onChange={(e) => setDisableModelInvocation(e.target.checked)} />
          <span><strong>禁止模型自动调用</strong><small>只允许用户显式调用。</small></span>
        </label>
        <div className="extension-form-grid">
          <label className="field"><span>作者</span><input value={author} onChange={(e) => setAuthor(e.target.value)} /></label>
          <label className="field"><span>短描述</span><input value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} /></label>
          <label className="field"><span>许可证</span><input value={license} onChange={(e) => setLicense(e.target.value)} /></label>
          <label className="field"><span>兼容性</span><input value={compatibility} onChange={(e) => setCompatibility(e.target.value)} /></label>
          <label className="field"><span>模型</span><input value={model} onChange={(e) => setModel(e.target.value)} /></label>
          <label className="field"><span>推理强度</span><input value={effort} onChange={(e) => setEffort(e.target.value)} placeholder="high" /></label>
        </div>
      </details>
      <div className="permission-actions">
        <button
          className="btn primary"
          type="button"
          disabled={!name.trim() || !description.trim()}
          onClick={() => void run("创建 Skill", async () => {
            const result = await window.grok.skillsCreate({
              name,
              description,
              scope,
              body,
              whenToUse,
              argumentHint,
              allowedTools: allowedTools.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean),
              userInvocable,
              disableModelInvocation,
              author,
              shortDescription,
              license,
              compatibility,
              model,
              effort,
            }, cwd);
            onCreated(result.catalog);
            return result;
          })}
        >创建 SKILL.md</button>
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

export function PluginOutputModal({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <NestedModal title={title} onClose={onClose}>
      <pre className="settings-pre plugin-output">{text}</pre>
    </NestedModal>
  );
}

export function PluginInstallForm({
  cwd,
  sessionId,
  onClose,
  onChange,
  run,
}: {
  cwd?: string | null;
  sessionId?: string | null;
  onClose: () => void;
  onChange: (next: AppSettings) => void | Promise<void>;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [source, setSource] = useState("");
  const [trusted, setTrusted] = useState(false);
  return (
    <NestedModal title="从来源安装插件" onClose={onClose}>
      <p className="settings-hint">
        支持市场插件名、Git URL、owner/repo、本地目录，以及 <code>@ref</code> 和 <code>#subdir</code>。
      </p>
      <p className="settings-hint">
        安装会自动补齐运行环境、加载并验证 MCP；需要 OAuth 时会立即打开认证。任何一步失败都会回滚插件。
      </p>
      <label className="field">
        <span>插件来源</span>
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="plugin-name 或 owner/repo@v1.0#packages/plugin"
          autoFocus
        />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} />
        <span>
          <strong>信任并安装</strong>
          <small>插件可能包含 Hooks、MCP 和可执行脚本；确认来源可信后再继续。</small>
        </span>
      </label>
      <div className="permission-actions">
        <button
          className="btn primary"
          type="button"
          disabled={!source.trim() || !trusted}
          onClick={() => {
            void run("安装并验证插件", () => window.grok.pluginInstall(source.trim(), true, cwd, sessionId).then(onChange));
          }}
        >
          安装并完成配置
        </button>
      </div>
    </NestedModal>
  );
}

export function PluginUninstallForm({
  name,
  cwd,
  onClose,
  onChange,
  run,
}: {
  name: string;
  cwd?: string | null;
  onClose: () => void;
  onChange: (next: AppSettings) => void | Promise<void>;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [keepData, setKeepData] = useState(true);
  return (
    <NestedModal title={`卸载 ${name}`} onClose={onClose}>
      <div className="settings-banner danger">
        <p>如果它来自包含多个插件的仓库，Grok CLI 可能同时卸载该仓库中的相关插件。</p>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={keepData} onChange={(e) => setKeepData(e.target.checked)} />
        <span>
          <strong>保留插件数据</strong>
          <small>对应 grok plugin uninstall --keep-data；建议保留，方便以后重新安装。</small>
        </span>
      </label>
      <div className="permission-actions">
        <button
          className="btn danger"
          type="button"
          onClick={() => {
            void run("卸载插件", () => window.grok.pluginUninstall(name, keepData, cwd).then(onChange));
          }}
        >
          确认卸载
        </button>
      </div>
    </NestedModal>
  );
}

export function PluginToolsForm({
  cwd,
  onClose,
  run,
}: {
  cwd?: string | null;
  onClose: () => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [targetPath, setTargetPath] = useState(".");
  const [dryRun, setDryRun] = useState(true);
  const [force, setForce] = useState(false);
  const [push, setPush] = useState(false);
  const [output, setOutput] = useState("");
  const [confirmTag, setConfirmTag] = useState(false);

  return (
    <>
      <NestedModal title="插件开发工具" onClose={onClose}>
      <p className="settings-hint">对插件目录执行清单校验，或按照 manifest 版本创建 Git 标签。</p>
      <label className="field">
        <span>插件目录</span>
        <input value={targetPath} onChange={(e) => setTargetPath(e.target.value)} placeholder="." autoFocus />
      </label>
      <div className="settings-actions">
        <button
          className="btn"
          type="button"
          onClick={() => {
            void run("校验插件", async () => {
              const text = await window.grok.pluginValidate(targetPath.trim() || ".", cwd);
              setOutput(text || "插件清单校验通过。");
              return text;
            });
          }}
        >
          校验 manifest
        </button>
      </div>
      <div className="plugin-tool-options">
        <label className="check-row compact">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          <span><strong>仅预览标签</strong><small>对应 --dry-run，不创建 Git 标签。</small></span>
        </label>
        <label className="check-row compact">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          <span><strong>强制创建</strong><small>允许工作区不干净或标签已存在。</small></span>
        </label>
        <label className="check-row compact">
          <input
            type="checkbox"
            checked={push}
            disabled={dryRun}
            onChange={(e) => setPush(e.target.checked)}
          />
          <span><strong>推送到远程</strong><small>创建后执行推送；仅在关闭预览时可用。</small></span>
        </label>
      </div>
      <div className="permission-actions">
        <button
          className={`btn${dryRun ? "" : " danger"}`}
          type="button"
          onClick={() => {
            if (!dryRun) {
              setConfirmTag(true);
              return;
            }
            void run(dryRun ? "预览标签" : "创建标签", async () => {
              const text = await window.grok.pluginTag(
                { path: targetPath.trim() || ".", dryRun, force, push: dryRun ? false : push },
                cwd,
              );
              setOutput(text || (dryRun ? "预览完成。" : "标签创建完成。"));
              return text;
            });
          }}
        >
          {dryRun ? "预览标签" : push ? "创建并推送标签" : "创建标签"}
        </button>
      </div>
      {output ? <pre className="settings-pre plugin-output">{output}</pre> : null}
      </NestedModal>
      {confirmTag ? (
        <ConfirmDialog
          title="创建 Git 标签"
          message={`将根据插件 manifest 创建 Git 标签${push ? "并推送到远程" : ""}。请确认工作区和版本信息无误。`}
          confirmLabel={push ? "创建并推送" : "创建标签"}
          danger={push}
          onClose={() => setConfirmTag(false)}
          onConfirm={() => {
            setConfirmTag(false);
            void run("创建标签", async () => {
              const text = await window.grok.pluginTag(
                { path: targetPath.trim() || ".", dryRun: false, force, push },
                cwd,
              );
              setOutput(text || "标签创建完成。");
              return text;
            });
          }}
        />
      ) : null}
    </>
  );
}

export function MarketForm({
  cwd,
  onClose,
  onChange,
  run,
}: {
  cwd?: string | null;
  marketplaces?: AppSettings["marketplaces"];
  onClose: () => void;
  onChange: (next: AppSettings) => void | Promise<void>;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [url, setUrl] = useState("");
  const [force, setForce] = useState(false);
  return (
    <NestedModal title="添加市场源" onClose={onClose}>
      <p className="settings-hint">
        支持 GitHub 仓库页面、owner/repo、Git URL、marketplace.json 地址或本地目录。通过 Grok marketplace 注册；兼容源会自动生成 Windows 副本。
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
      <label className="check-row">
        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
        <span>
          <strong>跳过可达性探测</strong>
          <small>对应 --force，适用于只能通过 VPN 或特殊网络访问的 Git 主机。</small>
        </span>
      </label>
      <div className="permission-actions">
        <button
          className="btn primary"
          type="button"
          disabled={!url.trim()}
          onClick={() => {
            void run("添加市场", () => window.grok.marketplaceAdd(url.trim(), force, cwd).then(onChange));
          }}
        >
          添加
        </button>
      </div>
    </NestedModal>
  );
}
