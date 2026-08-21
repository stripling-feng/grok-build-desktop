import { useEffect, useState } from "react";
import type { GitFile, GitStatus } from "../../electron/shared";

function statusLabel(file: GitFile): string {
  if (file.untracked) return "新";
  if (file.status === "D") return "删";
  if (file.status === "A") return "加";
  if (file.status === "R") return "改名";
  return "改";
}

export function DiffPanel({
  git,
  cwd,
  open,
  selectedPath,
  onSelectFile,
  onToggle,
  onOpenEditor,
  onApply,
  canApply,
  onRefresh,
  onError,
}: {
  git: GitStatus | null;
  cwd: string | null;
  open: boolean;
  selectedPath: string | null;
  onSelectFile: (path: string | null) => void;
  onToggle: () => void;
  onOpenEditor: (filePath?: string) => void;
  onApply?: () => void;
  canApply?: boolean;
  onRefresh: () => void;
  onError?: (message: string) => void;
}) {
  const [diff, setDiff] = useState("");
  const [busy, setBusy] = useState(false);

  const files = git?.files ?? [];
  const selected =
    files.find((f) => f.path === selectedPath) ??
    (selectedPath ? null : files[0] ?? null);
  const activePath = selected?.path ?? selectedPath;

  useEffect(() => {
    if (!open || !cwd || !activePath) {
      setDiff("");
      return;
    }
    let cancelled = false;
    void window.grok.gitFileDiff(cwd, activePath).then((text) => {
      if (!cancelled) setDiff(text);
    });
    return () => {
      cancelled = true;
    };
  }, [open, cwd, activePath, git]);

  async function run(action: () => Promise<void>) {
    if (!cwd || !activePath) return;
    setBusy(true);
    try {
      await action();
      onRefresh();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <aside className="right collapsed" />;

  return (
    <aside className="right">
      <div className="right-head">
        <span>
          {git?.isRepo ? git.branch || "git" : "审阅"}
          {git?.isWorktree ? " · 工作树" : ""}
          {files.length ? ` · ${files.length}` : ""}
        </span>
        <span style={{ display: "flex", gap: 4 }}>
          {canApply && onApply ? (
            <button className="btn small" type="button" onClick={onApply}>
              应用回主仓
            </button>
          ) : null}
          <button className="btn small" type="button" onClick={() => onOpenEditor()}>
            编辑器
          </button>
          <button className="btn small ghost" type="button" onClick={onToggle}>
            关闭
          </button>
        </span>
      </div>
      <div className="file-list">
        {!git?.isRepo ? (
          <div className="thread-meta" style={{ padding: 8 }}>
            不是 Git 仓库
          </div>
        ) : files.length === 0 ? (
          <div className="thread-meta" style={{ padding: 8 }}>
            工作区是干净的
          </div>
        ) : (
          files.map((f) => (
            <button
              key={f.path}
              type="button"
              className={`file${f.path === activePath ? " selected" : ""}`}
              onClick={() => onSelectFile(f.path)}
            >
              <span className={`st ${f.status}${f.untracked ? " U" : ""}`}>{statusLabel(f)}</span>
              <code title={f.path}>
                {f.staged && !f.untracked ? "· " : ""}
                {f.path}
              </code>
            </button>
          ))
        )}
      </div>
      {selected ? (
        <div className="diff-actions">
          <span className="diff-file-name" title={selected.path}>
            {selected.path}
          </span>
          {selected.staged && !selected.untracked ? (
            <button
              className="btn small"
              type="button"
              disabled={busy}
              onClick={() => void run(() => window.grok.gitUnstage(cwd!, selected.path))}
            >
              取消暂存
            </button>
          ) : (
            <button
              className="btn small"
              type="button"
              disabled={busy || !cwd}
              onClick={() => void run(() => window.grok.gitStage(cwd!, selected.path))}
            >
              暂存
            </button>
          )}
          <button
            className="btn small"
            type="button"
            disabled={busy || !cwd}
            onClick={() =>
              void run(async () => {
                await window.grok.gitDiscard(cwd!, selected.path);
                onSelectFile(null);
              })
            }
          >
            丢弃
          </button>
          <button
            className="btn small"
            type="button"
            onClick={() => onOpenEditor(selected.path)}
          >
            打开
          </button>
        </div>
      ) : null}
      {diff ? (
        <pre className="diff">
          {diff.split("\n").map((line, i) => (
            <div
              key={i}
              className={
                line.startsWith("+") && !line.startsWith("+++")
                  ? "add"
                  : line.startsWith("-") && !line.startsWith("---")
                    ? "del"
                    : line.startsWith("@@")
                      ? "hunk"
                      : ""
              }
            >
              {line || " "}
            </div>
          ))}
        </pre>
      ) : selected ? (
        <div className="thread-meta" style={{ padding: 10 }}>
          没有可显示的差异
        </div>
      ) : null}
    </aside>
  );
}
