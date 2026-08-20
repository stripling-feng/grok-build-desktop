import type { AppSettings, PermissionMode } from "../../electron/shared";

const MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: "ask", label: "询问", hint: "改文件、跑命令前先问你" },
  { id: "auto", label: "自动", hint: "安全操作自动过，其余再问" },
  { id: "always-approve", label: "始终允许", hint: "跳过普通授权（deny 规则仍生效）" },
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
  if (!open || !settings) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>设置</h2>
          <button className="btn small ghost" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
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
        <section className="settings-section">
          <h3>日志</h3>
          <p className="settings-hint">崩溃和主进程记录写在用户数据目录。单实例运行，重复打开会唤起现有窗口。</p>
          <button className="btn" type="button" onClick={() => void window.grok.openLogs()}>
            打开日志目录
          </button>
        </section>
        <section className="settings-section">
          <h3>Skills</h3>
          <p className="settings-hint">只读扫描本地目录。关闭后写入 [skills] disabled，不删文件。</p>
          {settings.skills.length === 0 ? (
            <p className="settings-hint">还没有 Skills。把带 SKILL.md 的目录放到 ~/.grok/skills/ 或项目的 .grok/skills/。</p>
          ) : (
            <ul className="skill-list">
              {settings.skills.map((skill) => (
                <li key={skill.path}>
                  <div>
                    <strong>{skill.name}</strong>
                    <span className="skill-src">{skill.source}</span>
                    {skill.description ? <p>{skill.description}</p> : null}
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={!skill.disabled}
                      onChange={(e) => {
                        void window.grok
                          .setSkillDisabled(skill.name, !e.target.checked, cwd)
                          .then(onChange);
                      }}
                    />
                    {skill.disabled ? "已关闭" : "启用"}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
