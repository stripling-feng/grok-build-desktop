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
    if (!open || !cwd) return;
    setOutput(`$ ${cwd}\n`);
    void window.grok.terminalStart(cwd);
    const off = window.grok.onTerminalData((chunk) => {
      setOutput((prev) => (prev + chunk).slice(-80_000));
    });
    return () => {
      off();
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
