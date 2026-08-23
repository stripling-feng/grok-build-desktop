import grokMark from "../assets/grok-mark.jpg";

function TerminalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3.2 3.4A1.4 1.4 0 0 1 4.6 2h6.8A1.4 1.4 0 0 1 12.8 3.4v9.2A1.4 1.4 0 0 1 11.4 14H4.6A1.4 1.4 0 0 1 3.2 12.6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="m5.4 7 2.2 1.6L5.4 10.2M9 10.4h2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M2 6.5h8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="2.25" y="2.25" width="7.5" height="7.5" rx="0.7" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="m2.75 2.75 6.5 6.5m0-6.5-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

export function TitleBar({
  subtitle,
  onTerminal,
  terminalActive,
}: {
  subtitle?: string;
  onTerminal?: () => void;
  terminalActive?: boolean;
}) {
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <img className="titlebar-mark" src={grokMark} alt="" />
        <span>Grok Build 桌面端</span>
        {subtitle ? <span>· {subtitle}</span> : null}
      </div>
      {onTerminal ? (
        <div className="titlebar-actions">
          <button
            type="button"
            className={`titlebar-icon-btn${terminalActive ? " on" : ""}`}
            onClick={onTerminal}
            aria-label="终端"
            title="终端"
          >
            <TerminalIcon />
          </button>
        </div>
      ) : (
        <div />
      )}
      <div className="win-controls">
        <button type="button" onClick={() => void window.grok.windowControl("min")} aria-label="最小化">
          <MinimizeIcon />
        </button>
        <button type="button" onClick={() => void window.grok.windowControl("max")} aria-label="最大化">
          <MaximizeIcon />
        </button>
        <button
          type="button"
          className="close"
          onClick={() => void window.grok.windowControl("close")}
          aria-label="关闭"
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
