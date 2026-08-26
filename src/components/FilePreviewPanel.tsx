import { useCallback, useEffect, useState } from "react";
import type { FilePreview } from "../../electron/shared";

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePreviewPanel({
  cwd,
  filePath,
  onClose,
  onOpenEditor,
}: {
  cwd: string;
  filePath: string;
  onClose: () => void;
  onOpenEditor: () => void;
}) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setPreview(null);
    void window.grok.readFilePreview(cwd, filePath)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, filePath, reloadKey]);

  return (
    <aside className="right file-preview-panel" aria-label={`文件内容：${filePath}`}>
      <div className="right-head">
        <span title={filePath}>文件内容 · {filePath}</span>
        <span className="file-preview-head-actions">
          <button className="btn small" type="button" onClick={reload} disabled={loading}>
            刷新
          </button>
          <button className="btn small" type="button" onClick={onOpenEditor}>
            打开
          </button>
          <button className="btn small ghost" type="button" onClick={onClose}>
            关闭
          </button>
        </span>
      </div>
      {preview ? (
        <div className="file-preview-meta">
          <code title={preview.path}>{preview.path}</code>
          <span>{formatBytes(preview.size)}</span>
        </div>
      ) : null}
      <div className="file-preview-body">
        {loading ? <div className="file-preview-message">正在读取文件…</div> : null}
        {!loading && error ? <div className="file-preview-message error">{error}</div> : null}
        {!loading && preview && !preview.exists ? (
          <div className="file-preview-message">文件不存在或已被删除</div>
        ) : null}
        {!loading && preview?.binary ? (
          <div className="file-preview-message">这是二进制文件，无法显示文本内容</div>
        ) : null}
        {!loading && preview?.exists && !preview.binary ? (
          <>
            {preview.truncated ? (
              <div className="file-preview-notice">文件较大，仅显示前 1 MB</div>
            ) : null}
            <pre className="file-preview-content"><code>{preview.content || " "}</code></pre>
          </>
        ) : null}
      </div>
    </aside>
  );
}
