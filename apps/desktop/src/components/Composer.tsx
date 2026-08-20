import { useEffect, useRef, useState, type DragEvent } from "react";
import type { AppSettings, PermissionMode, PermissionRequest } from "../../electron/shared";
import { permissionOptionLabel } from "../lib/i18n";

type Props = {
  value: string;
  busy: boolean;
  disabled: boolean;
  worktree: boolean;
  canChooseEnv: boolean;
  planMode: boolean;
  goal: string;
  attachments: string[];
  settings: AppSettings | null;
  permission: PermissionRequest | null;
  onChange: (v: string) => void;
  onEnvChange: (worktree: boolean) => void;
  onPlanMode: (on: boolean) => void;
  onGoal: (text: string) => void;
  onAttachments: (paths: string[]) => void;
  onPermissionMode: (mode: PermissionMode) => void;
  onModel: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPermission: (optionId: string) => void;
};

const PERM: { id: PermissionMode; label: string }[] = [
  { id: "always-approve", label: "完全访问" },
  { id: "auto", label: "自动" },
  { id: "ask", label: "询问" },
];

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
function IconSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 12.2V3.8M4.2 7.4 8 3.8l3.8 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fileName(p: string) {
  return p.replace(/^.*[\\/]/, "") || p;
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
  planMode,
  goal,
  attachments,
  settings,
  permission,
  onChange,
  onEnvChange,
  onPlanMode,
  onGoal,
  onAttachments,
  onPermissionMode,
  onModel,
  onSend,
  onStop,
  onPermission,
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

  useEffect(() => setGoalDraft(goal), [goal]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), 180)}px`;
  }, [value]);

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
  const permLabel = PERM.find((p) => p.id === perm)?.label || "询问";
  const model = settings?.models.find((m) => m.id === settings.model);
  const modelLabel = model?.name || settings?.model || "模型";

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
          className={`composer${dragOver ? " drag" : ""}`}
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
          {attachments.length || goal || planMode ? (
            <div className="composer-chips">
              {planMode ? (
                <span className="chip">
                  计划模式
                  <button type="button" onClick={() => onPlanMode(false)}>
                    ×
                  </button>
                </span>
              ) : null}
              {goal ? (
                <span className="chip" title={goal}>
                  目标：{goal}
                  <button type="button" onClick={() => onGoal("")}>
                    ×
                  </button>
                </span>
              ) : null}
              {attachments.map((p) => (
                <span className="chip" key={p} title={p}>
                  {fileName(p)}
                  <button type="button" onClick={() => onAttachments(attachments.filter((x) => x !== p))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            ref={ref}
            value={value}
            disabled={disabled}
            placeholder={disabled ? "先选择一个项目" : "随心输入"}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (busy) onStop();
                else onSend();
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
                  className={`access-chip${perm === "always-approve" ? " full" : ""}`}
                  onClick={() => {
                    setMenuOpen(false);
                    setPickOpen(false);
                    setModelOpen(false);
                    setPermOpen((v) => !v);
                  }}
                >
                  <span className="access-dot">i</span>
                  {permLabel}
                </button>
                {permOpen ? (
                  <div className="mini-menu">
                    {PERM.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={perm === p.id ? "on" : ""}
                        onClick={() => {
                          onPermissionMode(p.id);
                          setPermOpen(false);
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {canChooseEnv || worktree ? (
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
                <button
                  type="button"
                  className="model-chip"
                  onClick={() => {
                    setMenuOpen(false);
                    setPickOpen(false);
                    setPermOpen(false);
                    setModelOpen((v) => !v);
                  }}
                >
                  {modelLabel}
                </button>
                {modelOpen && settings ? (
                  <div className="mini-menu right">
                    {settings.models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={m.id === settings.model ? "on" : ""}
                        onClick={() => {
                          onModel(m.id);
                          setModelOpen(false);
                        }}
                      >
                        {m.name === m.id ? m.id : `${m.name}（${m.id}）`}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {busy ? (
                <button className="send-round stop" type="button" onClick={onStop} aria-label="停止">
                  ■
                </button>
              ) : (
                <button
                  className="send-round"
                  type="button"
                  disabled={disabled || !value.trim()}
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
