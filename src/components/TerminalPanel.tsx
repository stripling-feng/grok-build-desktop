import { useEffect, useRef, useState } from "react";

export function TerminalPanel({
  open,
  cwd,
  onClose,
}: {
  open: boolean;
  cwd: string | null;
  onClose: () => void;
}) {
  const [output, setOutput] = useState("");
  const [line, setLine] = useState("");
  const pre = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!cwd) {
      setOutput("");
      setLine("");
      return;
    }
    let cancelled = false;
    setOutput(`$ ${cwd}\n`);
    let off: (() => void) | null = null;
    void window.grok
      .terminalStart(cwd)
      .then(() => {
        if (cancelled) return;
        off = window.grok.onTerminalData((chunk) => {
          if (cancelled) return;
          setOutput((prev) => (prev + chunk).slice(-80_000));
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setOutput((prev) => (prev + `\n[无法启动终端：${err instanceof Error ? err.message : String(err)}]\n`).slice(-80_000));
      });
    return () => {
      cancelled = true;
      if (off) off();
      void window.grok.terminalKill();
    };
  }, [open, cwd]);

  useEffect(() => {
    pre.current?.scrollTo(0, pre.current.scrollHeight);
  }, [output]);

  if (!open) return null;

  return (
    <div className="terminal">
      <div className="terminal-head">
        <span>终端{cwd ? ` · ${cwd}` : ""}</span>
        <button className="btn small ghost" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <pre className="terminal-out" ref={pre}>
        {output || "启动中…"}
      </pre>
      <form
        className="terminal-in"
        onSubmit={(e) => {
          e.preventDefault();
          if (!line.trim()) return;
          setOutput((prev) => prev + (prev.endsWith("\n") ? "" : "\n") + `> ${line}\n`);
          void window.grok.terminalWrite(line);
          setLine("");
        }}
      >
        <span>❯</span>
        <input
          value={line}
          disabled={!cwd}
          placeholder={cwd ? "输入命令，回车执行" : "先选择一个项目"}
          onChange={(e) => setLine(e.target.value)}
        />
      </form>
    </div>
  );
}
