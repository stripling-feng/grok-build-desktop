import grokMark from "../assets/grok-mark.jpg";

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
        <img className="titlebar-mark" src={grokMark} alt="" />
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
