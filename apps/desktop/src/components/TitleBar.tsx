export function TitleBar({
  subtitle,
  onSettings,
  onTerminal,
}: {
  subtitle?: string;
  onSettings?: () => void;
  onTerminal?: () => void;
}) {
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <svg className="titlebar-mark" viewBox="0 0 16 16" aria-hidden>
          <path
            fill="currentColor"
            d="M8 1.2 9.7 6.3 15 8 9.7 9.7 8 14.8 6.3 9.7 1 8l5.3-1.7L8 1.2z"
          />
        </svg>
        <span>Grok Build 桌面端</span>
        {subtitle ? <span>· {subtitle}</span> : null}
      </div>
      {onSettings || onTerminal ? (
        <div className="titlebar-actions">
          {onTerminal ? (
            <button type="button" onClick={onTerminal}>
              终端
            </button>
          ) : null}
          {onSettings ? (
            <button type="button" onClick={onSettings}>
              设置
            </button>
          ) : null}
        </div>
      ) : (
        <div />
      )}
      <div className="win-controls">
        <button type="button" onClick={() => void window.grok.windowControl("min")} aria-label="最小化">
          –
        </button>
        <button type="button" onClick={() => void window.grok.windowControl("max")} aria-label="最大化">
          □
        </button>
        <button
          type="button"
          className="close"
          onClick={() => void window.grok.windowControl("close")}
          aria-label="关闭"
        >
          ×
        </button>
      </div>
    </header>
  );
}
