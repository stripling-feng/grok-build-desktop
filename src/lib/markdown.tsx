import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatImageInfo = { path: string; dataUrl: string };

const imageCache = new Map<string, ChatImageInfo | null>();
const IMAGE_SOURCE_RE = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;

function cacheKey(src: string, sessionId?: string, cwd?: string) {
  return `${sessionId || ""}|${cwd || ""}|${src}`;
}

function isRemoteSrc(src: string) {
  return /^(data:|https?:|blob:)/i.test(src);
}

function isImageSrc(src?: string) {
  if (!src) return false;
  return /^data:image\//i.test(src) || IMAGE_SOURCE_RE.test(src.trim());
}

function ChatImage({
  src,
  alt,
  sessionId,
  cwd,
  fallback,
}: {
  src?: string;
  alt?: string;
  sessionId?: string;
  cwd?: string;
  fallback?: ReactNode;
}) {
  const [info, setInfo] = useState<ChatImageInfo | null>(null);
  const [remote, setRemote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) return;
    setFailed(false);
    setInfo(null);
    setRemote(null);
    if (isRemoteSrc(src)) {
      setRemote(src);
      return;
    }
    const key = cacheKey(src, sessionId, cwd);
    if (imageCache.has(key)) {
      setInfo(imageCache.get(key) || null);
      return;
    }
    if (!window.grok.resolveImage) return;
    let cancelled = false;
    void window.grok.resolveImage({ src, sessionId, cwd }).then((next) => {
      imageCache.set(key, next);
      if (!cancelled) setInfo(next);
    });
    return () => {
      cancelled = true;
    };
  }, [src, sessionId, cwd]);

  const url = remote || info?.dataUrl;
  if (!url || failed) {
    return fallback ? <>{fallback}</> : alt ? <span>{alt}</span> : null;
  }
  return (
    <img
      className="md-img"
      src={url}
      alt={alt || ""}
      loading="lazy"
      onError={() => setFailed(true)}
      onClick={() => {
        if (info?.path) void window.grok.openPath(info.path);
      }}
    />
  );
}

function MarkdownLink({
  href,
  sessionId,
  cwd,
  children,
}: {
  href?: string;
  sessionId?: string;
  cwd?: string;
  children?: ReactNode;
}) {
  async function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!href || /^(https?:|mailto:)/i.test(href)) return;
    e.preventDefault();
    if (!window.grok.resolveImage) return;
    const resolved = await window.grok.resolveImage({ src: href, sessionId, cwd });
    if (resolved?.path) await window.grok.openPath(resolved.path);
  }

  const link = (
    <a href={href} target="_blank" rel="noreferrer" onClick={onClick}>
      {children}
    </a>
  );
  if (isImageSrc(href)) {
    return (
      <ChatImage
        src={href}
        alt={typeof children === "string" ? children : href}
        sessionId={sessionId}
        cwd={cwd}
        fallback={link}
      />
    );
  }
  return link;
}

export function Markdown({
  text,
  sessionId,
  cwd,
}: {
  text: string;
  sessionId?: string;
  cwd?: string;
}) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <MarkdownLink href={href} sessionId={sessionId} cwd={cwd}>
              {children}
            </MarkdownLink>
          ),
          img: ({ src, alt }) => <ChatImage src={src} alt={alt} sessionId={sessionId} cwd={cwd} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
