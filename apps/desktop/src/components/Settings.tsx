import { useEffect, useState, type ReactNode } from "react";
import type {
  AccountInfo,
  AccountUsage,
  AppSettings,
  AppUpdateInfo,
  AvailablePluginInfo,
  PermissionMode,
  ReasoningEffort,
} from "../../electron/shared";

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

type SettingsPane = "general" | "controls" | "subagents" | "usage" | "update" | "logs";

const NAV: { group: string; items: { id: SettingsPane; label: string }[] }[] = [
  { group: "基础设置", items: [{ id: "general", label: "常规" }] },
  {
    group: "Agent 能力",
    items: [
      { id: "controls", label: "浏览器与电脑控制" },
      { id: "subagents", label: "子智能体" },
    ],
  },
  {
    group: "数据与统计",
    items: [
      { id: "usage", label: "用量" },
      { id: "update", label: "更新" },
      { id: "logs", label: "日志" },
    ],
  },
];

export function Settings({
  open,
  settings,
  cwd,
  onClose,
  onChange,
}: {
  open: boolean;
  settings: AppSettings | null;
  cwd?: string | null;
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
        <button className="btn small ghost" type="button" onClick={onClose}>
          返回工作区
        </button>
      </header>
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="设置分类">
          {NAV.map((group) => (
            <div className="settings-nav-group" key={group.group}>
              <div className="settings-nav-label">{group.group}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item${pane === item.id ? " on" : ""}`}
                  onClick={() => setPane(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-body">
          {pane === "general" ? (
            settings ? <GeneralPane settings={settings} onChange={onChange} /> : <p className="settings-hint">正在读取配置…</p>
          ) : pane === "controls" ? (
            settings ? <ControlsPane settings={settings} cwd={cwd} onChange={onChange} /> : <p className="settings-hint">正在读取配置…</p>
          ) : pane === "subagents" ? (
            settings ? <SubagentsPane settings={settings} cwd={cwd} onChange={onChange} /> : <p className="settings-hint">正在读取配置…</p>
          ) : pane === "usage" ? (
            <UsagePane />
          ) : pane === "update" ? (
            <UpdatePane />
          ) : pane === "logs" ? (
            <LogsPane />
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
  onChange,
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
}) {
  return (
    <>
      <section className="settings-section">
        <h3>模型</h3>
        <p className="settings-hint">写入 ~/.grok/config.toml 的 [models] default，新会话生效。</p>
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
      </section>
      <section className="settings-section">
        <h3>推理等级</h3>
        <p className="settings-hint">写入 ~/.grok/config.toml 的 [models] default_reasoning_effort，新会话生效。</p>
        <div className="mode-list">
          {REASONING.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`mode-item${settings.reasoningEffort === item.id ? " on" : ""}`}
              onClick={() => {
                onChange({ ...settings, reasoningEffort: item.id });
                void window.grok.setReasoningEffort(item.id).then(onChange);
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

function ControlsPane({
  settings,
  cwd,
  onChange,
}: {
  settings: AppSettings;
  cwd?: string | null;
  onChange: (next: AppSettings) => void;
}) {
  return (
    <section className="settings-section">
      <h3>浏览器与电脑控制</h3>
      <p className="settings-hint">
        打开后，Grok 可以通过 MCP 控制浏览器，或通过 Computer Use 操作本机窗口。新会话生效。
      </p>
      <div className="control-toggles">
        <label className="toggle-row">
          <span>
            <strong>浏览器控制</strong>
            <em>用 Playwright / browser MCP 打开网页、点击、输入、截图</em>
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
            <strong>控制本地电脑</strong>
            <em>允许操作本机前台窗口，权限更重</em>
          </span>
          <input
            type="checkbox"
            checked={settings.computerControl}
            onChange={(e) => {
              void window.grok.setComputerControl(e.target.checked, cwd).then(onChange);
            }}
          />
        </label>
      </div>
    </section>
  );
}

function SubagentsPane({
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
      <section className="settings-section">
        <h3>子智能体</h3>
        <p className="settings-hint">
          主会话可以并行拉起独立子会话。默认开启。写入 ~/.grok/config.toml 的 [subagents]，新会话生效。
        </p>
        <div className="control-toggles">
          <label className="toggle-row">
            <span>
              <strong>允许派生子智能体</strong>
              <em>关闭后主会话不再调用 spawn_subagent，也不再出现探索 / 规划 / 通用子会话</em>
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
      <section className="settings-section">
        <h3>类型</h3>
        <p className="settings-hint">
          这是角色模板，不是同时只能跑三个。同类型可以并行多个；子会话不能再派生子会话。自定义类型放在 ~/.grok/agents/ 或项目 .grok/agents/。
        </p>
        <div className="settings-actions">
          <button className="btn" type="button" onClick={() => void window.grok.openAgentsDir()}>
            打开 ~/.grok/agents
          </button>
        </div>
        <ul className="skill-list">
          {settings.subagentTypes.map((agent) => (
            <li key={agent.id}>
              <div>
                <strong>{agent.name}</strong>
                <span className="skill-src">{agent.id}</span>
                {agent.builtin ? <span className="skill-src">内置</span> : null}
                {agent.source ? <span className="skill-src">{agent.source}</span> : null}
                {agent.description ? <p>{agent.description}</p> : null}
                <label className="toggle">
                  模型
                  <select
                    value={agent.model || ""}
                    disabled={!settings.subagentsEnabled || !agent.enabled}
                    onChange={(e) => {
                      const next = e.target.value || null;
                      void window.grok.setSubagentTypeModel(agent.id, next, cwd).then(onChange);
                    }}
                  >
                    <option value="">跟随主会话</option>
                    {settings.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name === m.id ? m.id : `${m.name}（${m.id}）`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={agent.enabled}
                  disabled={!settings.subagentsEnabled}
                  onChange={(e) => {
                    void window.grok.setSubagentTypeEnabled(agent.id, e.target.checked, cwd).then(onChange);
                  }}
                />
                启用
              </label>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function UsagePane() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void Promise.all([window.grok.account(), window.grok.accountUsage()])
      .then(([nextAccount, nextUsage]) => {
        if (!alive) return;
        setAccount(nextAccount);
        setUsage(nextUsage);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const methodLabel =
    account?.method === "oauth" ? "xAI 登录" : account?.method === "api-key" ? "本地配置" : "未登录";

  return (
    <section className="settings-section">
      <h3>用量</h3>
      <p className="settings-hint">来自当前账号或本地 API 配置。Grok 没有独立的桌面额度面板，这里只展示 CLI 能读到的信息。</p>
      {error ? <p className="settings-error">{error}</p> : null}
      <div className="settings-kv">
        <div>
          <span>账号</span>
          <strong>{account?.name || "—"}</strong>
        </div>
        {account?.email ? (
          <div>
            <span>邮箱</span>
            <strong>{account.email}</strong>
          </div>
        ) : null}
        <div>
          <span>方式</span>
          <strong>{methodLabel}</strong>
        </div>
        {usage?.tier ? (
          <div>
            <span>套餐</span>
            <strong>{usage.tier}</strong>
          </div>
        ) : null}
        {typeof usage?.percent === "number" ? (
          <div>
            <span>已用</span>
            <strong>{Math.round(usage.percent)}%</strong>
          </div>
        ) : null}
        {typeof usage?.used === "number" && typeof usage?.limit === "number" ? (
          <div>
            <span>额度</span>
            <strong>
              {usage.used} / {usage.limit}
            </strong>
          </div>
        ) : null}
      </div>
      {usage?.text ? <p className="settings-hint">{usage.text}</p> : null}
    </section>
  );
}

function UpdatePane() {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = () => {
    setBusy(true);
    setError("");
    void window.grok
      .checkUpdate()
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="settings-section">
      <h3>更新</h3>
      <p className="settings-hint">对照 GitHub Releases 检查桌面端版本。不会自动下载安装。</p>
      {error ? <p className="settings-error">{error}</p> : null}
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
        <p className="settings-hint">{busy ? "正在检查…" : "还没有检查结果。"}</p>
      )}
      {info?.hasUpdate ? <p className="settings-hint">有新版本可用。</p> : null}
      {info?.notes ? <pre className="settings-pre">{info.notes}</pre> : null}
      {info?.error ? <p className="settings-error">{info.error}</p> : null}
      <div className="settings-actions">
        <button className="btn" type="button" disabled={busy} onClick={refresh}>
          {busy ? "检查中…" : "检查更新"}
        </button>
        {info?.hasUpdate ? (
          <button className="btn primary" type="button" onClick={() => void window.grok.openUpdate(info.url)}>
            打开发布页
          </button>
        ) : null}
      </div>
    </section>
  );
}

function LogsPane() {
  return (
    <section className="settings-section">
      <h3>日志</h3>
      <p className="settings-hint">崩溃和主进程记录写在用户数据目录。单实例运行，重复打开会唤起现有窗口。</p>
      <button className="btn" type="button" onClick={() => void window.grok.openLogs()}>
        打开日志目录
      </button>
    </section>
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
  onAvailable,
  onInstall,
  onMarket,
  onChange,
  run,
}: {
  settings: AppSettings;
  cwd?: string | null;
  available: AvailablePluginInfo[] | null;
  onAvailable: (rows: AvailablePluginInfo[]) => void;
  onInstall: () => void;
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
          <button className="btn" type="button" onClick={onInstall}>
            安装插件
          </button>
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
          <p className="settings-hint">还没有市场源。粘贴 git URL 或 owner/repo。</p>
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
                      void run("移除市场", () => window.grok.marketplaceRemove(item.url, cwd).then(onChange))
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
      <section className="settings-section">
        <h3>可安装</h3>
        <div className="settings-actions">
          <button
            className="btn"
            type="button"
            onClick={() =>
              void run("读取市场", async () => {
                const rows = await window.grok.availablePlugins();
                onAvailable(rows);
                return rows;
              })
            }
          >
            刷新可安装列表
          </button>
        </div>
        {available && available.length === 0 ? <p className="settings-hint">市场里暂时没有条目。</p> : null}
        {available && available.length ? (
          <ul className="skill-list">
            {available.slice(0, 40).map((item) => (
              <li key={`${item.marketplace}:${item.name}`}>
                <div>
                  <strong>{item.name}</strong>
                  <span className="skill-src">{item.marketplace}</span>
                  {item.description ? <p>{item.description}</p> : null}
                </div>
                <button
                  className="btn small"
                  type="button"
                  onClick={() =>
                    void run("安装", () => window.grok.pluginInstall(item.name, true, cwd).then(onChange))
                  }
                >
                  安装并信任
                </button>
              </li>
            ))}
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

export function InstallForm({
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
  const [source, setSource] = useState("");
  const [trust, setTrust] = useState(true);
  return (
    <NestedModal title="安装插件" onClose={onClose}>
      <p className="settings-hint">Git URL、GitHub shorthand（user/repo）或本地路径。安装会执行第三方代码。</p>
      <label className="field">
        <span>来源</span>
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="owner/repo" />
      </label>
      <label className="toggle">
        <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
        立即信任（--trust）
      </label>
      <div className="permission-actions">
        <button
          className="btn primary"
          type="button"
          disabled={!source.trim()}
          onClick={() => {
            void run("安装插件", () => window.grok.pluginInstall(source.trim(), trust, cwd).then(onChange));
          }}
        >
          安装
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
  onChange: (next: AppSettings) => void;
  run: <T>(label: string, work: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [url, setUrl] = useState("");
  return (
    <NestedModal title="添加市场源" onClose={onClose}>
      <label className="field">
        <span>git URL 或 owner/repo</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} />
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
