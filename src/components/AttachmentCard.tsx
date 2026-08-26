export type AttachmentKind =
  | "image"
  | "document"
  | "video"
  | "audio"
  | "code"
  | "archive"
  | "file";

export function attachmentFileName(filePath: string) {
  return filePath.replace(/^.*[\\/]/, "") || filePath;
}

export function attachmentMeta(filePath: string): {
  name: string;
  extension: string;
  kind: AttachmentKind;
} {
  const fullName = attachmentFileName(filePath);
  const dot = fullName.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < fullName.length - 1;
  const extension = hasExtension ? fullName.slice(dot + 1).toUpperCase() : "FILE";
  const name = hasExtension ? fullName.slice(0, dot) : fullName;
  const ext = extension.toLowerCase();
  const kind: AttachmentKind = /^(png|jpe?g|gif|webp|bmp|avif|svg)$/.test(ext)
    ? "image"
    : /^(docx?|pdf|pptx?|xlsx?|csv|txt|md|rtf)$/.test(ext)
      ? "document"
      : /^(mp4|mov|mkv|avi|webm|m4v)$/.test(ext)
        ? "video"
        : /^(mp3|wav|m4a|aac|flac|ogg)$/.test(ext)
          ? "audio"
          : /^(js|jsx|ts|tsx|json|html|css|scss|py|java|go|rs|c|cpp|h|sh|yml|yaml|xml|sql)$/.test(ext)
            ? "code"
            : /^(zip|rar|7z|tar|gz|bz2)$/.test(ext)
              ? "archive"
              : "file";
  return { name: name || fullName, extension, kind };
}

function AttachmentTypeIcon({ kind }: { kind: AttachmentKind }) {
  if (kind === "image") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="3.5" y="4" width="17" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="9" cy="9.5" r="1.7" fill="currentColor" />
        <path d="m5.5 17 4.2-4.2 3.2 3 2.2-2.2 3.4 3.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "video") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="4" y="5" width="16" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="m10 9 5 3-5 3z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "audio") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M9 17.5V7l9-2v10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <ellipse cx="6.5" cy="17.5" rx="2.5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <ellipse cx="15.5" cy="15.5" rx="2.5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  if (kind === "code") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="m9 7-4 5 4 5M15 7l4 5-4 5M13.5 5l-3 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "archive") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M5 7.5 12 4l7 3.5v9L12 20l-7-3.5zM5 7.5l7 3.5 7-3.5M12 11v9" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M7 3.5h6.7L18.5 8v12.5H7z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13.5 3.8V8h4.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      {kind === "document" ? <path d="M10 12h5M10 15h5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /> : null}
    </svg>
  );
}

export function AttachmentCard({
  filePath,
  preview,
  onOpen,
  onRemove,
}: {
  filePath: string;
  preview?: string;
  onOpen?: (filePath: string) => void;
  onRemove?: (filePath: string) => void;
}) {
  const meta = attachmentMeta(filePath);
  return (
    <div className={`attachment-card ${meta.kind}${onRemove ? " has-remove" : ""}`} title={filePath} role="listitem">
      <button
        className="attachment-open"
        type="button"
        aria-label={`打开文件 ${attachmentFileName(filePath)}`}
        disabled={!onOpen}
        onClick={() => onOpen?.(filePath)}
      >
        <span className="attachment-preview" aria-hidden>
          {preview ? <img src={preview} alt="" /> : <AttachmentTypeIcon kind={meta.kind} />}
        </span>
        <span className="attachment-copy">
          <strong>{meta.name}</strong>
          <small>{meta.extension}</small>
        </span>
      </button>
      {onRemove ? (
        <button
          className="attachment-remove"
          type="button"
          aria-label={`移除文件 ${attachmentFileName(filePath)}`}
          title="移除文件"
          onClick={() => onRemove(filePath)}
        >
          <svg viewBox="0 0 12 12" aria-hidden>
            <path d="m3.2 3.2 5.6 5.6M8.8 3.2 3.2 8.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
