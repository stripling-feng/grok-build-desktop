import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

export function TerminalPanel({
  open,
  cwd,
  onClose,
}: {
  open: boolean;
  cwd: string | null;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!open || !host || !cwd) return;

    let disposed = false;
    let resizeFrame = 0;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Cascadia Code", "SF Mono", Consolas, ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 10_000,
      theme: {
        background: "#171717",
        foreground: "#e8e8e8",
        cursor: "#f4f4f4",
        cursorAccent: "#171717",
        selectionBackground: "#4a6a8a99",
        black: "#1f1f1f",
        brightBlack: "#777777",
        red: "#e06c75",
        brightRed: "#ff7b86",
        green: "#98c379",
        brightGreen: "#b5e890",
        yellow: "#e5c07b",
        brightYellow: "#ffd68a",
        blue: "#61afef",
        brightBlue: "#79c0ff",
        magenta: "#c678dd",
        brightMagenta: "#dc8cf2",
        cyan: "#56b6c2",
        brightCyan: "#6ed5df",
        white: "#d7dae0",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);

    const fitAndResize = () => {
      if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fitAddon.fit();
        void window.grok.terminalResize(terminal.cols, terminal.rows);
      } catch {
        // The panel can disappear between ResizeObserver and this animation frame.
      }
    };

    try {
      fitAddon.fit();
    } catch {
      // The first ResizeObserver callback will retry once layout is available.
    }

    const dataSubscription = terminal.onData((data) => {
      void window.grok.terminalWrite(data);
    });
    const offData = window.grok.onTerminalData((chunk) => {
      if (!disposed) terminal.write(chunk);
    });
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fitAndResize);
    });
    resizeObserver.observe(host);

    void window.grok
      .terminalStart(cwd, terminal.cols, terminal.rows)
      .then(() => {
        if (!disposed) terminal.focus();
      })
      .catch((err) => {
        if (disposed) return;
        terminal.write(
          `\r\n\x1b[31m[无法启动终端：${err instanceof Error ? err.message : String(err)}]\x1b[0m\r\n`,
        );
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      offData();
      dataSubscription.dispose();
      terminal.dispose();
      void window.grok.terminalKill();
    };
  }, [open, cwd]);

  if (!open) return null;

  return (
    <div className="terminal">
      <div className="terminal-head">
        <span title={cwd || undefined}>终端{cwd ? ` · ${cwd}` : ""}</span>
        <button className="btn small ghost" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      {cwd ? (
        <div
          ref={hostRef}
          className="terminal-xterm"
          role="application"
          aria-label={`项目终端：${cwd}`}
        />
      ) : (
        <div className="terminal-empty">先选择一个项目以启动终端</div>
      )}
    </div>
  );
}
