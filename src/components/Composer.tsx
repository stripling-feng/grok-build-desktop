import { useEffect, useRef, useState, type DragEvent } from "react";
import type {
  AppSettings,
  ContextUsage,
  GitStatus,
  PermissionMode,
  PermissionRequest,
  ProjectInfo,
  ReasoningEffort,
} from "../../electron/shared";
import type { QueuedFollowUp } from "../../electron/follow-ups";
import { permissionOptionLabel } from "../lib/i18n";

type Props = {
  value: string;
  busy: boolean;
  disabled: boolean;
  worktree: boolean;
  canChooseEnv: boolean;
  showWorktree?: boolean;
  showGoal?: boolean;
  planMode: boolean;
  goal: string;
  attachments: string[];
  queuedFollowUps: QueuedFollowUp[];
  settings: AppSettings | null;
  contextUsed?: number | null;
  contextUsage?: ContextUsage | null;
  permission: PermissionRequest | null;
  awaitingAnswer?: boolean;
  onChange: (v: string) => void;
  onEnvChange: (worktree: boolean) => void;
  onPlanMode: (on: boolean) => void;
  onGoal: (text: string) => void;
  onAttachments: (paths: string[]) => void;
  onRemoveFollowUp: (entryId: string) => void;
  onPermissionMode: (mode: PermissionMode) => void;
  onModel: (id: string) => void;
  onReasoningEffort: (effort: ReasoningEffort) => void;
  onSend: () => void;
  onStop: () => void;
  onPermission: (optionId: string) => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
  projects?: ProjectInfo[];
  selectedProject?: ProjectInfo | null;
  git?: GitStatus | null;
  onSelectProject?: (project: ProjectInfo | null) => void;
  onPickProject?: () => void;
  showProjectPicker?: boolean;
};

const PERM: { id: PermissionMode; label: string; hint: string; tone: "full" | "auto" | "ask" }[] = [
  { id: "always-approve", label: "完全访问", hint: "跳过普通授权，直接改文件、跑命令", tone: "full" },
  { id: "auto", label: "自动", hint: "安全操作自动通过，其余再问你", tone: "auto" },
  { id: "ask", label: "询问", hint: "改文件、跑命令前先问你", tone: "ask" },
];

const REASONING: { id: ReasoningEffort; label: string; hint: string }[] = [
  { id: "low", label: "低", hint: "更快，适合简单问题" },
  { id: "medium", label: "中", hint: "速度和深度折中" },
  { id: "high", label: "高", hint: "更充分的推理" },
  { id: "xhigh", label: "极高", hint: "最深推理，耗时更长" },
];

function shortRemote(url: string) {
  return url
    .replace(/\.git$/i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^https?:\/\//i, "");
}

function IconFolderChip() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        d="M2.2 4.2A1.4 1.4 0 0 1 3.6 2.8h2.6c.3 0 .6.12.8.34l.7.76c.2.22.5.34.8.34h3.9A1.4 1.4 0 0 1 14 5.64v6.76A1.4 1.4 0 0 1 12.6 13.8h-9A1.4 1.4 0 0 1 2.2 12.4V4.2z"
      />
    </svg>
  );
}

function IconBranchChip() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="5" cy="4" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5" cy="12" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.2" cy="8" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5 5.6v4.8M5 8h2.2a2.4 2.4 0 0 1 2.4 2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconClip() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M10.2 4.4 4.85 9.75a2.4 2.4 0 0 0 3.4 3.4l6.05-6.05a3.5 3.5 0 1 0-4.95-4.95L3.15 8.3a4.6 4.6 0 0 0 6.5 6.5l5.1-5.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconGoal() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}
function IconPlan() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.6 9.05 6.2 13.7 7.2 9.05 8.2 8 12.8 6.95 8.2 2.3 7.2l4.65-1L8 1.6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M7 2v10M2 7h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function IconPermInfo() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.2v4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="5.15" r="0.85" fill="currentColor" />
    </svg>
  );
}
function IconPermAuto() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M9.2 2.4 4.2 9.1h3.3L6.8 13.6l5-6.7H8.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconPermAsk() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M6.35 6.35a1.7 1.7 0 1 1 2.5 1.5c-.5.3-.85.7-.85 1.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.35" r="0.75" fill="currentColor" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3.6 8.2 6.5 11.1 12.4 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function permIcon(tone: "full" | "auto" | "ask") {
  if (tone === "full") return <IconPermInfo />;
  if (tone === "auto") return <IconPermAuto />;
  return <IconPermAsk />;
}
function IconSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 12.4V4.2M4.6 7.4 8 4l3.4 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatTokens(n: number) {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1000) {
    const v = n / 1000;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(Math.round(n));
}

function formatCount(n: number) {
  return Math.round(n).toLocaleString("zh-CN");
}

function formatCompact(n: number) {
  if (n >= 10_000) {
    const wan = n / 10_000;
    return `${wan >= 10 ? wan.toFixed(0) : wan.toFixed(1).replace(/\.0$/, "")}万`;
  }
  return formatTokens(n);
}

function formatPct(ratio: number) {
  const pct = ratio * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct >= 10 ? pct.toFixed(1) : pct.toFixed(1)}%`;
}

const PART_COLORS: Record<string, string> = {
  messages: "#3b6fd4",
  tools: "#2f9e8f",
  mcp: "#7a5af8",
  skills: "#d08a12",
  system: "#c45c9a",
  other: "#8d8d92",
};

function ContextRing({
  used,
  limit,
  usage,
}: {
  used: number;
  limit?: number;
  usage?: ContextUsage | null;
}) {
  const size = 16;
  const stroke = 2.2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = limit && limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  const pctText = (ratio * 100).toFixed(1);
  const tone = ratio >= 0.9 ? "hot" : ratio >= 0.7 ? "warm" : "ok";
  const cacheHit = usage?.cacheHitRate;
  const parts = usage?.parts ?? [];
  const label = limit
    ? `上下文容量 ${formatCompact(used)} / ${formatCompact(limit)}（${pctText}%）`
    : `上下文 ${formatCount(used)} tokens`;
  return (
    <span className={`context-ring ${tone}`} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="context-ring-track"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - (limit ? ratio : 0.08))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="context-ring-fill"
        />
      </svg>
      <span className="context-tip">
        <strong>上下文容量</strong>
        <span className="context-tip-head">
          {limit ? (
            <>
              {formatCompact(used)}/{formatCompact(limit)}
              <em>（{pctText}%）</em>
            </>
          ) : (
            <>已用 {formatCount(used)}</>
          )}
        </span>
        {parts.length ? (
          <span className="context-tip-stack" aria-hidden>
            {parts
              .filter((part) => part.tokens > 0)
              .map((part) => (
                <i
                  key={part.id}
                  style={{
                    width: `${Math.max(0.4, part.tokens * 100)}%`,
                    background: PART_COLORS[part.id] || PART_COLORS.other,
                  }}
                />
              ))}
          </span>
        ) : limit ? (
          <span className="context-tip-bar" aria-hidden>
            <i style={{ width: `${Math.max(2, ratio * 100)}%` }} />
          </span>
        ) : null}
        {parts.length ? (
          <span className="context-tip-parts">
            {parts.map((part) => (
              <span key={part.id} className="context-tip-part">
                <i style={{ background: PART_COLORS[part.id] || PART_COLORS.other }} />
                <b>{part.label}</b>
                <em>{formatPct(part.tokens)}</em>
              </span>
            ))}
          </span>
        ) : null}
        {cacheHit != null ? (
          <span className="context-tip-cache">
            平均缓存命中率 <em>{(cacheHit * 100).toFixed(1)}%</em>
          </span>
        ) : null}
      </span>
    </span>
  );
}

function fileName(p: string) {
  return p.replace(/^.*[\\/]/, "") || p;
}

function isImagePath(p: string) {
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(p);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取剪贴板图片失败"));
    reader.readAsDataURL(blob);
  });
}

function dropPaths(e: DragEvent): string[] {
  const files = [...e.dataTransfer.files];
  return files
    .map((f) => (f as File & { path?: string }).path || "")
    .filter(Boolean);
}

export function Composer({
  value,
  busy,
  disabled,
  worktree,
  canChooseEnv,
  showWorktree = true,
  showGoal = true,
  planMode,
  goal,
  attachments,
  queuedFollowUps,
  settings,
  contextUsed,
  contextUsage,
  permission,
  awaitingAnswer = false,
  onChange,
  onEnvChange,
  onPlanMode,
  onGoal,
  onAttachments,
  onRemoveFollowUp,
  onPermissionMode,
  onModel,
  onReasoningEffort,
  onSend,
  onStop,
  onPermission,
  onNewChat,
  onOpenSettings,
  selectedProject = null,
  git = null,
  onPickProject,
  showProjectPicker = false,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState(goal);
  const [dragOver, setDragOver] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => setGoalDraft(goal), [goal]);
  useEffect(() => setSlashIndex(0), [value]);
  useEffect(() => {
    setPreviews((cur) => {
      const next: Record<string, string> = {};
      for (const p of attachments) if (cur[p]) next[p] = cur[p];
      return next;
    });
  }, [attachments]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const minHeight = parseFloat(getComputedStyle(el).minHeight) || 36;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), 180)}px`;
  }, [value]);

  useEffect(() => {
    if (!awaitingAnswer || disabled || busy) return;
    const id = window.requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [awaitingAnswer, busy, disabled]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setPickOpen(false);
        setPermOpen(false);
        setModelOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setPickOpen(false);
        setPermOpen(false);
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const perm = settings?.permissionMode || "ask";
  const permMeta = PERM.find((p) => p.id === perm) || PERM[2];
  const model = settings?.models.find((m) => m.id === settings.model);
  const modelLabel = model?.name || settings?.model || "模型";
  const effort = settings?.reasoningEffort || "high";
  const effortMeta = REASONING.find((r) => r.id === effort) || REASONING[2];
  const contextWindow = model?.contextWindow;
  const showContext = contextUsed != null || Boolean(contextWindow);
  const slashQuery = value.startsWith("/") && !/\s/.test(value) ? value.slice(1) : null;
  const slashItems = (() => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();
    const builtins = [
      { id: "new", label: "/new", hint: "开始新对话", kind: "app" as const },
      { id: "settings", label: "/settings", hint: "打开设置", kind: "app" as const },
      { id: "plan", label: "/plan", hint: "切换计划模式", kind: "app" as const },
      { id: "loop", label: "/loop 5m", hint: "当前会话循环任务，不是系统定时", kind: "insert" as const },
    ];
    const skills = (settings?.skills ?? [])
      .filter((s) => !s.disabled && s.userInvocable !== false)
      .map((s) => ({
        id: `skill:${s.name}`,
        label: s.invocableAs || `/${s.name}`,
        hint: s.description || s.source,
        kind: "insert" as const,
      }));
    return [...builtins, ...skills].filter((item) => {
      const hay = `${item.label} ${item.hint}`.toLowerCase();
      return !q || hay.includes(q) || item.label.slice(1).toLowerCase().startsWith(q);
    });
  })();
  const slashOpen = slashItems.length > 0 && slashQuery !== null;

  function closeMenus() {
    setMenuOpen(false);
    setPickOpen(false);
    setPermOpen(false);
    setModelOpen(false);
  }

  function addPaths(paths: string[]) {
    if (!paths.length) return;
    onAttachments([...attachments, ...paths.filter((p) => !attachments.includes(p))]);
  }

  async function pasteImages(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = [...e.clipboardData.items];
    const files = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) {
      if (e.clipboardData.getData("text")) return;
      const native = await window.grok.saveClipboardImage();
      if (!native) return;
      setPreviews((cur) => ({ ...cur, [native.path]: native.dataUrl }));
      addPaths([native.path]);
      return;
    }
    const saved: string[] = [];
    for (const file of files) {
      try {
        const data = await blobToDataUrl(file);
        const next = await window.grok.savePastedImage({ data, mimeType: file.type || "image/png" });
        saved.push(next.path);
        setPreviews((cur) => ({ ...cur, [next.path]: data }));
      } catch {
        /* skip a bad clipboard item */
      }
    }
    addPaths(saved);
  }

  function applySlash(item: { id: string; label: string; kind: "app" | "insert" }) {
    if (item.id === "new") {
      onChange("");
      onNewChat?.();
      return;
    }
    if (item.id === "settings") {
      onChange("");
      onOpenSettings?.();
      return;
    }
    if (item.id === "plan") {
      onPlanMode(!planMode);
      onChange("");
      return;
    }
    onChange(item.label.endsWith(" ") ? item.label : `${item.label} `);
    requestAnimationFrame(() => ref.current?.focus());
  }

  async function pick(kind: "files" | "folder") {
    const paths = kind === "files" ? await window.grok.pickFiles() : await window.grok.pickFolder();
    addPaths(paths);
    closeMenus();
  }

  return (
    <div className="composer-wrap">
      {permission ? (
        <div className="permission">
          <h3>需要授权</h3>
          <p>{permission.title}</p>
          <div className="permission-actions">
            {permission.options.map((opt) => (
              <button
                key={opt.optionId}
                type="button"
                className={`btn small ${opt.kind.includes("reject") || opt.kind.includes("deny") ? "reject" : "allow"}`}
                onClick={() => onPermission(opt.optionId)}
              >
                {permissionOptionLabel(opt)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {queuedFollowUps.length ? (
        <div className="follow-up-queue" aria-live="polite">
          <div className="follow-up-queue-head">
            <span>已排队 {queuedFollowUps.length} 条</span>
            {busy ? <em>再次点发送，立即调整当前任务</em> : <em>等待当前任务继续</em>}
          </div>
          {queuedFollowUps.map((entry) => (
            <div className="follow-up-row" key={entry.id}>
              <span title={entry.text || `图片 ×${entry.images.length}`}>
                {entry.text.trim() || `图片 ×${entry.images.length}`}
              </span>
              <button type="button" onClick={() => onRemoveFollowUp(entry.id)} aria-label="移除排队消息">
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="composer-stack" ref={box}>
        {menuOpen ? (
          <div className="add-menu">
            <div className="add-label">添加</div>
            <button
              type="button"
              className={pickOpen ? "on" : ""}
              onClick={() => setPickOpen((v) => !v)}
            >
              <IconClip />
              <span className="add-row">
                <strong>文件和文件夹</strong>
              </span>
            </button>
            {pickOpen ? (
              <>
                <button type="button" className="add-sub" onClick={() => void pick("files")}>
                  选择文件
                </button>
                <button type="button" className="add-sub" onClick={() => void pick("folder")}>
                  选择文件夹
                </button>
              </>
            ) : null}
            {showGoal ? (
              <button
                type="button"
                onClick={() => {
                  closeMenus();
                  setGoalOpen(true);
                }}
              >
                <IconGoal />
                <span className="add-row">
                  <strong>目标</strong>
                  <em>设置要持续追求的目标</em>
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className={planMode ? "on" : ""}
              onClick={() => {
                onPlanMode(!planMode);
                closeMenus();
              }}
            >
              <IconPlan />
              <span className="add-row">
                <strong>计划模式</strong>
                <em>{planMode ? "已开启计划模式" : "开启计划模式"}</em>
              </span>
            </button>
          </div>
        ) : null}

        <div
          className={`composer${dragOver ? " drag" : ""}${awaitingAnswer ? " awaiting-answer" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addPaths(dropPaths(e));
          }}
        >
          {showProjectPicker ? (
          <div className="composer-context">
            <div className="context-chip-wrap">
              <button
                type="button"
                className="context-chip"
                onClick={() => {
                  setMenuOpen(false);
                  setPickOpen(false);
                  setPermOpen(false);
                  setModelOpen(false);
                  onPickProject?.();
                }}
              >
                <IconFolderChip />
                <span>{selectedProject?.name || "选择文件夹"}</span>
              </button>
            </div>
            {selectedProject && git?.isRepo ? (
              <span className="context-chip static" title={git.remote || git.branch || ""}>
                <IconBranchChip />
                <span>{git.branch || "HEAD"}</span>
                {git.remote ? <em className="context-remote">{shortRemote(git.remote)}</em> : null}
              </span>
            ) : null}
          </div>
          ) : null}
          {attachments.length || goal ? (
            <div className="composer-chips">
              {goal ? (
                <span className="chip" title={goal}>
                  目标：{goal}
                  <button type="button" onClick={() => onGoal("")}>
                    ×
                  </button>
                </span>
              ) : null}
              {attachments.map((p) => (
                <span className={`chip${isImagePath(p) ? " image" : ""}`} key={p} title={p}>
                  {previews[p] ? <img className="chip-thumb" src={previews[p]} alt="" /> : null}
                  {isImagePath(p) ? "截图" : fileName(p)}
                  <button type="button" onClick={() => onAttachments(attachments.filter((x) => x !== p))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {slashOpen ? (
            <div className="slash-menu">
              {slashItems.slice(0, 12).map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  className={`slash-item${i === slashIndex ? " on" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySlash(item);
                  }}
                >
                  <strong>{item.label}</strong>
                  <em>{item.hint}</em>
                </button>
              ))}
            </div>
          ) : null}
          {awaitingAnswer ? (
            <div className="composer-answer-hint" aria-live="polite">
              <strong>回答 Grok</strong>
              <span>在这里输入答案，按 Enter 发送并继续生成计划</span>
            </div>
          ) : null}
          <textarea
            ref={ref}
            value={value}
            disabled={disabled}
            placeholder={
              awaitingAnswer
                ? "请在这里回答上方的问题…"
                : busy && queuedFollowUps.length
                  ? "再次点发送，立即调整当前任务"
                  : busy
                    ? "输入后续要求，发送后先排队"
                    : "随心输入，输入 / 可调用技能"
            }
            aria-label={awaitingAnswer ? "回答 Grok 的问题" : "消息输入框"}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const hasImage = [...e.clipboardData.items].some(
                (item) => item.kind === "file" && item.type.startsWith("image/"),
              );
              if (hasImage || !e.clipboardData.getData("text")) e.preventDefault();
              void pasteImages(e);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (slashOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                const max = Math.min(slashItems.length, 12);
                setSlashIndex((i) =>
                  e.key === "ArrowDown" ? (i + 1) % max : (i - 1 + max) % max,
                );
                return;
              }
              if (slashOpen && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
                const item = slashItems[slashIndex];
                if (item) {
                  e.preventDefault();
                  applySlash(item);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <div className="composer-bar">
            <div className="composer-left">
              <button
                type="button"
                className={`plus-btn${menuOpen ? " open" : ""}`}
                disabled={disabled}
                aria-label="添加"
                onClick={() => {
                  setPermOpen(false);
                  setModelOpen(false);
                  setPickOpen(false);
                  setMenuOpen((v) => !v);
                }}
              >
                <IconPlus />
              </button>
              <div className="perm-wrap">
                <button
                  type="button"
                  className={`access-chip ${permMeta.tone}${permOpen ? " open" : ""}`}
                  onClick={() => {
                    setMenuOpen(false);
                    setPickOpen(false);
                    setModelOpen(false);
                    setPermOpen((v) => !v);
                  }}
                >
                  {permIcon(permMeta.tone)}
                  {permMeta.label}
                </button>
                {permOpen ? (
                  <div className="perm-menu">
                    <div className="perm-menu-label">权限模式</div>
                    {PERM.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`perm-option ${p.tone}${perm === p.id ? " on" : ""}`}
                        onClick={() => {
                          onPermissionMode(p.id);
                          setPermOpen(false);
                        }}
                      >
                        <span className={`perm-option-icon ${p.tone}`}>{permIcon(p.tone)}</span>
                        <span className="perm-option-copy">
                          <strong>{p.label}</strong>
                          <em>{p.hint}</em>
                        </span>
                        {perm === p.id ? (
                          <span className="perm-option-check">
                            <IconCheck />
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {planMode ? (
                <button
                  className="plan-mode-indicator"
                  type="button"
                  title="计划模式已开启，点击关闭"
                  aria-label="关闭计划模式"
                  onClick={() => onPlanMode(false)}
                >
                  <IconPlan />
                  <span>计划模式</span>
                  <span className="plan-mode-indicator-close" aria-hidden>
                    ×
                  </span>
                </button>
              ) : null}
              {showWorktree && (canChooseEnv || worktree) ? (
                <button
                  type="button"
                  className={`worktree-chip${worktree ? " on" : ""}`}
                  disabled={!canChooseEnv}
                  onClick={() => {
                    if (canChooseEnv) onEnvChange(!worktree);
                  }}
                >
                  工作树
                </button>
              ) : null}
            </div>
            <div className="composer-right">
              <div className="model-wrap">
                {showContext ? (
                  <ContextRing used={contextUsed ?? 0} limit={contextWindow} usage={contextUsage} />
                ) : null}
                <button
                  type="button"
                  className={`model-chip${modelOpen ? " open" : ""}`}
                  onClick={() => {
                    setMenuOpen(false);
                    setPickOpen(false);
                    setPermOpen(false);
                    setModelOpen((v) => !v);
                  }}
                >
                  <span className="model-chip-name">{modelLabel}</span>
                  <span className="model-chip-effort">{effortMeta.label}</span>
                </button>
                {modelOpen && settings ? (
                  <div className="model-menu">
                    <div className="model-menu-section">
                      <div className="model-menu-kicker">模型</div>
                      <div className="model-menu-list">
                        {settings.models.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`model-option${m.id === settings.model ? " on" : ""}`}
                            onClick={() => onModel(m.id)}
                          >
                            <span className={`model-radio${m.id === settings.model ? " on" : ""}`} />
                            <span className="perm-option-copy">
                              <strong>{m.name}</strong>
                              {m.name !== m.id ? <em>{m.id}</em> : null}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="model-menu-section">
                      <div className="model-menu-kicker">推理等级</div>
                      <div className="effort-seg">
                        <span
                          className="effort-thumb"
                          style={{
                            transform: `translateX(${REASONING.findIndex((r) => r.id === effort) * 100}%)`,
                          }}
                        />
                        {REASONING.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            className={effort === r.id ? "on" : ""}
                            title={r.hint}
                            onClick={() => onReasoningEffort(r.id)}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                      <p className="effort-hint">{effortMeta.hint}</p>
                    </div>
                  </div>
                ) : null}
              </div>
              {busy ? (
                <>
                  <button className="send-round stop" type="button" onClick={onStop} aria-label="停止">
                    ■
                  </button>
                  <button
                    className="send-round follow-up-send"
                    type="button"
                    disabled={disabled || (!value.trim() && !attachments.length && !queuedFollowUps.length)}
                    onClick={onSend}
                    aria-label={value.trim() || attachments.length ? "加入队列" : "调整当前任务"}
                    title={value.trim() || attachments.length ? "先加入队列" : "立即调整当前任务"}
                  >
                    <IconSend />
                  </button>
                </>
              ) : (
                <button
                  className="send-round"
                  type="button"
                  disabled={disabled || (!value.trim() && !attachments.length)}
                  onClick={onSend}
                  aria-label="发送"
                >
                  <IconSend />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {goalOpen ? (
        <div className="modal-backdrop" onClick={() => setGoalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>目标</h2>
              <button className="btn small ghost" type="button" onClick={() => setGoalOpen(false)}>
                关闭
              </button>
            </div>
            <p className="settings-hint">这个目标会一直带进当前项目的新会话。</p>
            <textarea
              className="goal-input"
              value={goalDraft}
              placeholder="例如：把登录流程做到能上线"
              onChange={(e) => setGoalDraft(e.target.value)}
            />
            <div className="permission-actions">
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  onGoal(goalDraft.trim());
                  setGoalOpen(false);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
