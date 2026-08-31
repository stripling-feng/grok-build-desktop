import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AccountInfo,
  AccountUsage,
  AppUpdateInfo,
  ProjectInfo,
  ThreadInfo,
  ThreadSearchResult,
} from "../../electron/shared";
import { relativeTime } from "../lib/i18n";
import { Markdown } from "../lib/markdown";
import { ModalPortal } from "./ModalPortal";

type Props = {
  projects: ProjectInfo[];
  threads: ThreadInfo[];
  selectedProjectCwd: string | null;
  activeId: string | null;
  activeCwd: string | null;
  runningIds: Set<string>;
  unreadIds: Set<string>;
  grokLabel: string;
  account: AccountInfo | null;
  onOpenProject: () => void;
  onNewChat?: () => void;
  onSelectProject: (project: ProjectInfo) => void;
  onSelectThread: (thread: ThreadInfo) => void;
  onRenameProject: (project: ProjectInfo, name: string) => void;
  onRemoveProject: (project: ProjectInfo) => void;
  onRemoveProjectThreads: (project: ProjectInfo) => void;
  onOpenProjectFolder: (project: ProjectInfo) => void;
  onRenameThread: (thread: ThreadInfo, title: string) => void;
  onForkThread: (thread: ThreadInfo) => void;
  onForkThreads: (threads: ThreadInfo[]) => void;
  onRemoveThread: (thread: ThreadInfo) => void;
  onRemoveThreads: (threads: ThreadInfo[]) => void;
  page?: "chat" | "marketplace" | "automation";
  onOpenMarketplace?: () => void;
  onOpenAutomation?: () => void;
  onOpenNewTask?: () => void;
  onSettings?: () => void;
  onAccountChange?: (account: AccountInfo) => void;
};

type MenuState =
  | { kind: "project"; project: ProjectInfo; x: number; y: number }
  | { kind: "thread"; thread: ThreadInfo; x: number; y: number };

type RenameState =
  | { kind: "project"; cwd: string; value: string }
  | { kind: "thread"; id: string; value: string };

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function same(a: string, b: string) {
  return a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
}

function ThreadActivityTime({ updatedAt }: { updatedAt: string }) {
  const label = relativeTime(updatedAt);
  if (!label) return null;
  const timestamp = new Date(updatedAt);
  const title = Number.isNaN(timestamp.getTime())
    ? undefined
    : `最近对话：${timestamp.toLocaleString("zh-CN", { hour12: false })}`;
  return (
    <time className="thread-time" dateTime={updatedAt} title={title}>
      {label}
    </time>
  );
}

function Icon({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {children}
    </svg>
  );
}

function FolderIcon() {
  return (
    <Icon className="row-icon folder-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        d="M2.2 4.2A1.4 1.4 0 0 1 3.6 2.8h2.6c.3 0 .6.12.8.34l.7.76c.2.22.5.34.8.34h3.9A1.4 1.4 0 0 1 14 5.64v6.76A1.4 1.4 0 0 1 12.6 13.8h-9A1.4 1.4 0 0 1 2.2 12.4V4.2z"
      />
    </Icon>
  );
}

function PlusIcon() {
  return (
    <Icon>
      <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </Icon>
  );
}

function MoreIcon() {
  return (
    <Icon>
      <circle cx="3.5" cy="8" r="1" fill="currentColor" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1" fill="currentColor" />
    </Icon>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={`spinner ${className ?? ""}`} width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.22" />
      <path
        d="M13.4 8a5.4 5.4 0 0 0-5.4-5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RenameIcon() {
  return (
    <Icon className="menu-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13h10M4.8 10.4 11.2 4a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4L6.8 12.4 3.6 13z"
      />
    </Icon>
  );
}

function OpenFolderIcon() {
  return (
    <Icon className="menu-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        d="M2.5 4.3A1.1 1.1 0 0 1 3.6 3.2h2.2c.3 0 .5.1.7.3l.5.6c.2.2.4.3.7.3h4.3A1.1 1.1 0 0 1 13.1 5.5v6.2A1.1 1.1 0 0 1 12 12.8H4A1.1 1.1 0 0 1 2.9 11.7V4.3z"
      />
      <path
        d="M9.4 7.4 12.2 4.6M12.2 4.6H9.8M12.2 4.6V7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

function ForkIcon() {
  return (
    <Icon className="menu-icon">
      <circle cx="5" cy="4" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="12" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11.2" cy="8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 5.6v4.8M5 8h2.4a2.4 2.4 0 0 1 2.4 2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

function TrashIcon() {
  return (
    <Icon className="menu-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.2 4.5h9.6M6.3 4.5V3.3h3.4v1.2M5.2 4.5l.5 8.2h4.6l.5-8.2M6.8 7v4M9.2 7v4"
      />
    </Icon>
  );
}

function MarketIcon() {
  return (
    <Icon className="nav-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        d="M3 4.2h10v8.4H3zM3 7.2h10M8 4.2v8.4"
      />
    </Icon>
  );
}

function NewTaskIcon() {
  return (
    <Icon className="nav-icon">
      <path
        d="M8 3.2v9.6M3.2 8h9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Icon>
  );
}

function SearchIcon() {
  return (
    <Icon className="nav-icon">
      <circle cx="7" cy="7" r="3.8" fill="none" stroke="currentColor" strokeWidth="1.35" />
      <path d="m10 10 3 3" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </Icon>
  );
}

function AutoIcon() {
  return (
    <Icon className="nav-icon">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 3.2v2.2M8 10.6v2.2M3.2 8h2.2M10.6 8h2.2M4.6 4.6l1.5 1.5M9.9 9.9l1.5 1.5M11.4 4.6 9.9 6.1M6.1 9.9 4.6 11.4"
      />
      <circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  );
}

function SettingsIcon() {
  return (
    <Icon>
      <path
        d="M8 10.1A2.1 2.1 0 1 0 8 5.9a2.1 2.1 0 0 0 0 4.2zM3.2 8.7l-1 .6.8 1.6 1.1-.2c.2.3.5.6.8.8l-.2 1.1 1.6.8.6-1c.3 0 .7.1 1 .1s.7 0 1-.1l.6 1 1.6-.8-.2-1.1c.3-.2.6-.5.8-.8l1.1.2.8-1.6-1-.6c0-.3.1-.7.1-1s0-.7-.1-1l1-.6-.8-1.6-1.1.2a4.7 4.7 0 0 0-.8-.8l.2-1.1-1.6-.8-.6 1c-.3 0-.7-.1-1-.1s-.7 0-1 .1l-.6-1-1.6.8.2 1.1c-.3.2-.6.5-.8.8l-1.1-.2-.8 1.6 1 .6c0 .3-.1.7-.1 1s0 .7.1 1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

function UpdateIcon() {
  return (
    <Icon>
      <path
        d="M12.4 8.2A4.4 4.4 0 1 1 11 4.7M12.4 3.4v2.6H9.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

function UserIcon() {
  return (
    <Icon className="account-icon">
      <circle cx="8" cy="5.4" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M3.4 13c.6-2.3 2.3-3.4 4.6-3.4s4 1.1 4.6 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </Icon>
  );
}

function UsageIcon() {
  return (
    <Icon>
      <path
        d="M3 11.8a5.3 5.3 0 1 1 10 0M8 8l2.5-2.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </Icon>
  );
}

function SwitchLoginIcon() {
  return (
    <Icon>
      <path
        d="M3 5.2h8.7M9.7 3.2l2 2-2 2M13 10.8H4.3M6.3 8.8l-2 2 2 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

function AccountLoginChoiceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="8.2" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5.8 19c.7-3.6 3-5.4 6.2-5.4s5.5 1.8 6.2 5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ApiLoginChoiceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="8.2" cy="11.2" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="m11.2 14.2 6.7 6.7M15 18l2.1-2.1M17 20l2.1-2.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoginChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="m6 3.5 4.5 4.5L6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoginCheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="m3.2 8.3 3 3 6.6-6.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoginLockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <rect x="3.3" y="7" width="9.4" height="6.4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7V5.4a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <Icon>
      <path
        d="M7 3H4.2A1.2 1.2 0 0 0 3 4.2v7.6A1.2 1.2 0 0 0 4.2 13H7M9.2 5.2 12 8l-2.8 2.8M6.2 8H12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

function accountLabel(account: AccountInfo | null): string {
  if (!account) return "检测登录…";
  if (account.method === "none") return "未登录";
  return account.name;
}

function clampMenu(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

function formatUpdateBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${Math.round(bytes)} B`;
}

type CcSwitchProvider = { id: string; name: string; baseUrl: string; apiKey: string };

type ApiLoginViewProps = {
  baseUrl: string;
  setBaseUrl: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  contextWindow: string;
  setContextWindow: (v: string) => void;
  sessionId: string | null;
  cwd: string | null;
  loginBusy: boolean;
  setLoginBusy: (v: boolean) => void;
  loginError: string;
  setLoginError: (v: string) => void;
  ccSwitchProviders: CcSwitchProvider[];
  ccSwitchLoading: boolean;
  showManualEntry: boolean;
  setShowManualEntry: (v: boolean) => void;
  selectedProviderId: string | null;
  setSelectedProviderId: (v: string | null) => void;
  onBack: () => void;
  onSuccess: (account: AccountInfo) => void;
};

function ApiLoginView({
  baseUrl,
  setBaseUrl,
  apiKey,
  setApiKey,
  model,
  setModel,
  contextWindow,
  setContextWindow,
  sessionId,
  cwd,
  loginBusy,
  setLoginBusy,
  loginError,
  setLoginError,
  ccSwitchProviders,
  ccSwitchLoading,
  showManualEntry,
  setShowManualEntry,
  selectedProviderId,
  setSelectedProviderId,
  onBack,
  onSuccess,
}: ApiLoginViewProps) {
  const parsedContextWindow = () => {
    if (!contextWindow.trim()) return undefined;
    const value = Number(contextWindow);
    if (!Number.isSafeInteger(value) || value <= 0) {
      setLoginError("上下文长度必须是大于 0 的整数");
      return null;
    }
    return value;
  };

  const submitManual = () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setLoginError("请填写 Base URL 和 API Key");
      return;
    }
    const contextWindowValue = parsedContextWindow();
    if (contextWindowValue === null) return;
    setLoginBusy(true);
    setLoginError("");
    void window.grok
      .loginApiKey({
        baseUrl,
        apiKey,
        model,
        contextWindow: contextWindowValue,
        sessionId: sessionId || undefined,
        cwd: cwd || undefined,
      })
      .then((result) => {
        if (!result.ok) {
          setLoginError(result.message || "保存失败");
          return;
        }
        onSuccess(result.account);
      })
      .catch((err) => {
        setLoginError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoginBusy(false));
  };

  const submitCcSwitch = (id: string) => {
    const contextWindowValue = parsedContextWindow();
    if (contextWindowValue === null) return;
    setLoginBusy(true);
    setLoginError("");
    void window.grok
      .loginApiKey({
        fromCcSwitchId: id,
        model,
        contextWindow: contextWindowValue,
        sessionId: sessionId || undefined,
        cwd: cwd || undefined,
      })
      .then((result) => {
        if (!result.ok) {
          setLoginError(result.message || "切换失败");
          return;
        }
        onSuccess(result.account);
      })
      .catch((err) => {
        setLoginError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoginBusy(false));
  };

  const hasProviders = ccSwitchProviders.length > 0;

  return (
    <div className="api-login-view">
      <div className="login-security-note">
        <LoginLockIcon />
        <span>凭据仅保存在本机 ~/.grok，不会上传</span>
      </div>
      {loginError ? <p className="settings-error">{loginError}</p> : null}

      {ccSwitchLoading ? (
        <p className="settings-hint">正在读取 cc-switch 供应商…</p>
      ) : null}

      {hasProviders ? (
        <>
          <p className="ccswitch-section-title">来自 cc-switch 的中转站</p>
          <ul className="ccswitch-list">
            {ccSwitchProviders.map((p) => {
              const selected = selectedProviderId === p.id;
              return (
                <li key={p.id} className={`ccswitch-item${selected ? " on" : ""}`}>
                  <div className="ccswitch-meta">
                    <strong>{p.name}</strong>
                    <span>{p.baseUrl}</span>
                  </div>
                  <button
                    className="btn small primary"
                    type="button"
                    disabled={loginBusy}
                    onClick={() => {
                      setSelectedProviderId(p.id);
                      submitCcSwitch(p.id);
                    }}
                  >
                    {loginBusy && selected ? "切换中…" : "使用"}
                  </button>
                </li>
              );
            })}
          </ul>
          {!showManualEntry ? (
            <div className="permission-actions">
              <button
                className="btn small ghost"
                type="button"
                disabled={loginBusy}
                onClick={() => setShowManualEntry(true)}
              >
                手动填写 Base URL + API Key
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {showManualEntry ? (
        <>
          <p className="ccswitch-section-title">手动填写</p>
          <label className="field">
            Base URL
            <input
              type="url"
              value={baseUrl}
              autoFocus
              placeholder="https://api.x.ai/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label className="field">
            模型
            <input
              type="text"
              value={model}
              placeholder="grok-4.6"
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <label className="field">
            上下文长度（tokens，可选）
            <input
              type="number"
              min="1"
              step="1"
              value={contextWindow}
              placeholder="例如 131072"
              onChange={(e) => setContextWindow(e.target.value)}
            />
            <small>填写后会显示上下文容量和使用百分比。</small>
          </label>
          <label className="field">
            API Key
            <input
              type="password"
              value={apiKey}
              placeholder="sk-... 或 xai-..."
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                submitManual();
              }}
            />
          </label>
        </>
      ) : null}

      <div className="permission-actions">
        <button
          className="btn"
          type="button"
          disabled={loginBusy}
          onClick={onBack}
        >
          返回
        </button>
        {showManualEntry ? (
          <button
            className="btn primary"
            type="button"
            disabled={loginBusy || !baseUrl.trim() || !apiKey.trim()}
            onClick={submitManual}
          >
            {loginBusy ? "保存中…" : "保存并登录"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Sidebar({
  projects,
  threads,
  selectedProjectCwd,
  activeId,
  activeCwd,
  runningIds,
  unreadIds,
  grokLabel,
  account,
  onOpenProject,
  onNewChat,
  onSelectProject,
  onSelectThread,
  onRenameProject,
  onRemoveProject,
  onRemoveProjectThreads,
  onOpenProjectFolder,
  onRenameThread,
  onForkThread,
  onForkThreads,
  onRemoveThread,
  onRemoveThreads,
  page = "chat",
  onOpenMarketplace,
  onOpenAutomation,
  onOpenNewTask,
  onSettings,
  onAccountChange,
}: Props) {
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginView, setLoginView] = useState<"choose" | "api">("choose");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.x.ai/v1");
  const [apiModel, setApiModel] = useState("grok-4.6");
  const [apiContextWindow, setApiContextWindow] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [ccSwitchProviders, setCcSwitchProviders] = useState<
    Array<{ id: string; name: string; baseUrl: string; apiKey: string }>
  >([]);
  const [ccSwitchLoading, setCcSwitchLoading] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ThreadSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(() => new Set());
  const [, setTimeTick] = useState(0);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const updateRequestRef = useRef<Promise<AppUpdateInfo> | null>(null);
  const savedApiProviderRef = useRef(false);
  const selectionAnchorRef = useRef<string | null>(null);

  const requestUpdateCheck = () => {
    if (updateRequestRef.current) return updateRequestRef.current;
    const request = window.grok.checkUpdate().finally(() => {
      if (updateRequestRef.current === request) updateRequestRef.current = null;
    });
    updateRequestRef.current = request;
    return request;
  };

  useEffect(() => {
    const timer = window.setInterval(() => setTimeTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void requestUpdateCheck()
        .then((next) => {
          if (!disposed) setUpdate(next);
        })
        .catch(() => {
          // Automatic checks stay silent. Manual checks still surface errors.
        });
    };
    refresh();
    const timer = window.setInterval(refresh, UPDATE_CHECK_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    return window.grok.onAppUpdateState((next) => setUpdate(next));
  }, []);
  const accountTriggerRef = useRef<HTMLDivElement>(null);
  const usageRequestRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);

  const closeLogin = () => {
    if (loginBusy) void window.grok.cancelAccountLogin();
    setLoginBusy(false);
    setLoginOpen(false);
    setLoginError("");
    setLoginView("choose");
    setApiKey("");
    setBaseUrl("https://api.x.ai/v1");
    setApiModel("grok-4.6");
    setApiContextWindow("");
    setSelectedProviderId(null);
    setShowManualEntry(false);
  };

  const openLogin = () => {
    setAccountMenuOpen(false);
    setLoginError("");
    setLoginView("choose");
    setApiKey("");
    setBaseUrl("https://api.x.ai/v1");
    setApiModel("grok-4.6");
    setApiContextWindow("");
    setSelectedProviderId(null);
    setShowManualEntry(false);
    setLoginOpen(true);
  };

  useEffect(() => {
    if (!loginOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLogin();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loginOpen, loginBusy]);

  useEffect(() => {
    if (!updateOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUpdateOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [updateOpen]);

  const grouped = useMemo(() => {
    return projects.map((project) => ({
      project,
      threads: threads.filter((t) => !t.unattached && t.projectCwd && same(t.projectCwd, project.cwd)),
    }));
  }, [projects, threads]);

  const projectThreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of grouped) {
      for (const t of group.threads) ids.add(t.id);
    }
    return ids;
  }, [grouped]);

  const chatThreads = useMemo(
    () =>
      threads.filter(
        (t) => t.unattached === true && !t.projectCwd && !projectThreadIds.has(t.id),
      ),
    [threads, projectThreadIds],
  );

  const visibleThreadIds = useMemo(
    () => [
      ...grouped.flatMap((group) => group.threads.map((thread) => thread.id)),
      ...chatThreads.map((thread) => thread.id),
    ],
    [grouped, chatThreads],
  );

  const selectedThreads = useMemo(() => {
    if (selectedThreadIds.size === 0) return [];
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    return visibleThreadIds
      .filter((id) => selectedThreadIds.has(id))
      .map((id) => byId.get(id))
      .filter((thread): thread is ThreadInfo => Boolean(thread));
  }, [selectedThreadIds, threads, visibleThreadIds]);

  useEffect(() => {
    const visibleIds = new Set(visibleThreadIds);
    setSelectedThreadIds((current) => {
      if ([...current].every((id) => visibleIds.has(id))) return current;
      return new Set([...current].filter((id) => visibleIds.has(id)));
    });
    if (selectionAnchorRef.current && !visibleIds.has(selectionAnchorRef.current)) {
      selectionAnchorRef.current = null;
    }
  }, [visibleThreadIds]);

  useEffect(() => {
    if (rename) renameRef.current?.focus();
  }, [rename]);

  useEffect(() => {
    if (!searchOpen) return;
    requestAnimationFrame(() => searchInputRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const query = searchQuery.trim();
    const requestId = ++searchRequestRef.current;
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void window.grok
        .searchThreads(query)
        .then((results) => {
          if (searchRequestRef.current === requestId) setSearchResults(results);
        })
        .catch(() => {
          if (searchRequestRef.current === requestId) setSearchResults([]);
        })
        .finally(() => {
          if (searchRequestRef.current === requestId) setSearchLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchQuery]);

  useEffect(() => {
    if (!loginOpen || loginView !== "api") return;
    let disposed = false;
    savedApiProviderRef.current = false;
    void window.grok
      .apiProvider()
      .then((saved) => {
        if (disposed || !saved) return;
        savedApiProviderRef.current = true;
        setBaseUrl(saved.baseUrl);
        setApiKey(saved.apiKey);
        setApiModel(saved.model);
        setApiContextWindow(saved.contextWindow ? String(saved.contextWindow) : "");
        setShowManualEntry(true);
      })
      .catch(() => {
        // Keep the blank manual form available if the local config cannot be read.
      });
    return () => {
      disposed = true;
    };
  }, [loginOpen, loginView]);

  useEffect(() => {
    if (!loginOpen || loginView !== "api" || ccSwitchProviders.length > 0 || ccSwitchLoading) return;
    setCcSwitchLoading(true);
    void window.grok
      .listCcSwitchProviders()
      .then((providers) => {
        setCcSwitchProviders(providers);
        setShowManualEntry(savedApiProviderRef.current || providers.length === 0);
      })
      .catch(() => {
        setCcSwitchProviders([]);
        setShowManualEntry(true);
      })
      .finally(() => setCcSwitchLoading(false));
  }, [loginOpen, loginView, ccSwitchProviders.length, ccSwitchLoading]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onDismiss = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onDismiss);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (accountMenuRef.current?.contains(target) || accountTriggerRef.current?.contains(target)) return;
      setAccountMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    const onDismiss = () => setAccountMenuOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onDismiss);
    window.addEventListener("resize", onDismiss);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("resize", onDismiss);
    };
  }, [accountMenuOpen]);

  const commitRename = () => {
    if (!rename) return;
    const value = rename.value.trim();
    if (rename.kind === "project") {
      const project = projects.find((p) => same(p.cwd, rename.cwd));
      if (project && value && value !== project.name) onRenameProject(project, value);
    } else {
      const thread = threads.find((t) => t.id === rename.id);
      if (thread && value && value !== thread.title) onRenameThread(thread, value);
    }
    setRename(null);
  };

  const clearThreadSelection = () => {
    setSelectedThreadIds(new Set());
    selectionAnchorRef.current = null;
  };

  const handleThreadClick = (event: React.MouseEvent<HTMLButtonElement>, thread: ThreadInfo) => {
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      const anchorIndex = selectionAnchorRef.current
        ? visibleThreadIds.indexOf(selectionAnchorRef.current)
        : -1;
      const threadIndex = visibleThreadIds.indexOf(thread.id);
      if (anchorIndex >= 0 && threadIndex >= 0) {
        const start = Math.min(anchorIndex, threadIndex);
        const end = Math.max(anchorIndex, threadIndex);
        const range = visibleThreadIds.slice(start, end + 1);
        setSelectedThreadIds((current) => new Set(additive ? [...current, ...range] : range));
      } else {
        setSelectedThreadIds(new Set([thread.id]));
        selectionAnchorRef.current = thread.id;
      }
      return;
    }
    if (additive) {
      setSelectedThreadIds((current) => {
        const next = new Set(current);
        if (next.has(thread.id)) next.delete(thread.id);
        else next.add(thread.id);
        return next;
      });
      selectionAnchorRef.current = thread.id;
      return;
    }
    setSelectedThreadIds(new Set([thread.id]));
    selectionAnchorRef.current = thread.id;
    onSelectThread(thread);
  };

  const openThreadMenu = (event: React.MouseEvent<HTMLButtonElement>, thread: ThreadInfo) => {
    event.preventDefault();
    event.stopPropagation();
    const selectionCount = selectedThreadIds.has(thread.id) ? selectedThreadIds.size : 1;
    if (!selectedThreadIds.has(thread.id)) {
      setSelectedThreadIds(new Set([thread.id]));
      selectionAnchorRef.current = thread.id;
    }
    openMenu(
      { kind: "thread", thread, x: event.clientX, y: event.clientY },
      selectionCount > 1 ? 96 : 128,
    );
  };

  const openMenu = (next: MenuState, height: number) => {
    const pos = clampMenu(next.x, next.y, 176, height);
    setMenu({ ...next, ...pos });
  };

  const checkUpdate = async () => {
    if (updateLoading) return;
    setUpdateLoading(true);
    try {
      const next = await requestUpdateCheck();
      setUpdate(next);
      setUpdateOpen(true);
    } catch {
      setUpdate({
        current: "",
        latest: null,
        hasUpdate: false,
        url: "",
        notes: "",
        status: "error",
        error: "检测失败",
      });
      setUpdateOpen(true);
    } finally {
      setUpdateLoading(false);
    }
  };

  const canShowUsage = account?.method === "oauth";
  const usageTitle = canShowUsage
    ? usageLoading
      ? "正在获取用量…"
      : usage?.text || "悬停查看用量"
    : grokLabel;
  const usageSummary = usageLoading
    ? "获取中…"
    : usage?.percent != null
      ? `剩余 ${Math.max(0, 100 - Math.round(usage.percent))}%`
      : usage?.text.split(/\r?\n/, 1)[0] || "查看";
  const refreshUsage = () => {
    if (!canShowUsage || usageRequestRef.current) return;
    usageRequestRef.current = true;
    setUsageLoading(true);
    void window.grok
      .accountUsage()
      .then(setUsage)
      .catch(() => setUsage({ text: "无法获取用量" }))
      .finally(() => {
        usageRequestRef.current = false;
        setUsageLoading(false);
      });
  };
  const toggleAccountMenu = () => {
    const next = !accountMenuOpen;
    setAccountMenuOpen(next);
    if (next) refreshUsage();
  };
  const logoutAccount = () => {
    setAccountMenuOpen(false);
    void window.grok
      .logout()
      .then((next) => {
        setUsage(null);
        onAccountChange?.(next);
      })
      .catch((error) => {
        openLogin();
        setLoginError(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <aside className="sidebar" onContextMenu={(e) => e.preventDefault()}>
      <div className="sidebar-nav">
        <button
          type="button"
          className="sidebar-nav-item sidebar-search-button"
          onClick={() => {
            setSearchQuery("");
            setSearchResults([]);
            setSearchOpen(true);
          }}
        >
          <SearchIcon />
          搜索会话
        </button>
        <button
          type="button"
          className="btn primary block"
          onClick={() => {
            clearThreadSelection();
            onOpenNewTask?.();
          }}
        >
          <NewTaskIcon />
          新建任务
        </button>
        <button
          type="button"
          className={`sidebar-nav-item${page === "automation" ? " on" : ""}`}
          onClick={() => {
            clearThreadSelection();
            onOpenAutomation?.();
          }}
        >
          <AutoIcon />
          自动化
        </button>
        <button
          type="button"
          className={`sidebar-nav-item${page === "marketplace" ? " on" : ""}`}
          onClick={() => {
            clearThreadSelection();
            onOpenMarketplace?.();
          }}
        >
          <MarketIcon />
          插件市场
        </button>
      </div>
      <div className="sidebar-list">
        <div className="sidebar-title-row">
          <span className="sidebar-title">项目</span>
          <button
            className="icon-btn"
            type="button"
            title="打开项目"
            onClick={() => {
              clearThreadSelection();
              onOpenProject();
            }}
          >
            <PlusIcon />
          </button>
        </div>
        {grouped.map(({ project, threads: list }) => {
          const isSelected = !!selectedProjectCwd && same(project.cwd, selectedProjectCwd);
          return (
            <div className={`project${isSelected ? " selected" : ""}`} key={project.cwd}>
              {rename?.kind === "project" && same(rename.cwd, project.cwd) ? (
                <div className="project-head renaming">
                  <FolderIcon />
                  <input
                    ref={renameRef}
                    className="rename-input"
                    value={rename.value}
                    onChange={(e) => setRename({ ...rename, value: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setRename(null);
                      }
                    }}
                  />
                </div>
              ) : (
                <button
                  className="project-head"
                  type="button"
                  title={project.cwd}
                  onClick={() => {
                    clearThreadSelection();
                    onSelectProject(project);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearThreadSelection();
                    onSelectProject(project);
                    openMenu({ kind: "project", project, x: e.clientX, y: e.clientY }, 164);
                  }}
                >
                  <FolderIcon />
                  <span className="project-name">{project.name}</span>
                </button>
              )}
              {rename?.kind !== "project" || !same(rename.cwd, project.cwd) ? (
                <button
                  className={`project-action${menu?.kind === "project" && same(menu.project.cwd, project.cwd) ? " on" : ""}`}
                  type="button"
                  title={`更多项目操作：${project.name}`}
                  aria-label={`打开项目「${project.name}」的操作菜单`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.kind === "project" && same(menu.project.cwd, project.cwd)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearThreadSelection();
                    onSelectProject(project);
                    const rect = e.currentTarget.getBoundingClientRect();
                    openMenu({ kind: "project", project, x: rect.right - 176, y: rect.bottom + 4 }, 164);
                  }}
                >
                  <MoreIcon />
                </button>
              ) : null}
              {list.map((t) =>
                rename?.kind === "thread" && rename.id === t.id ? (
                  <div key={t.id} className="thread renaming">
                    <input
                      ref={renameRef}
                      className="rename-input"
                      value={rename.value}
                      onChange={(e) => setRename({ ...rename, value: e.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRename(null);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    key={t.id}
                    type="button"
                    className={`thread${activeId === t.id ? " active" : ""}${selectedThreadIds.has(t.id) ? " selected" : ""}${runningIds.has(t.id) ? " running" : ""}${unreadIds.has(t.id) ? " unread" : ""}`}
                    title={t.title}
                    aria-label={`${t.title}${unreadIds.has(t.id) ? "，未读" : ""}`}
                    aria-pressed={selectedThreadIds.has(t.id)}
                    onClick={(event) => handleThreadClick(event, t)}
                    onContextMenu={(event) => openThreadMenu(event, t)}
                  >
                    <span className="thread-name">{t.title}</span>
                    {unreadIds.has(t.id) ? <span className="thread-unread" title="未读" aria-label="未读" /> : null}
                    {runningIds.has(t.id) ? (
                      <SpinnerIcon className="thread-spinner" />
                    ) : (
                      <ThreadActivityTime updatedAt={t.updatedAt} />
                    )}
                  </button>
                ),
              )}
              {list.length === 0 ? <div className="sidebar-list-empty nested">暂无对话</div> : null}
            </div>
          );
        })}
        {grouped.length === 0 ? <div className="sidebar-list-empty">暂无项目</div> : null}
        <div className="sidebar-title-row chats-label">
          <span className="sidebar-title">对话</span>
          <button
            className="icon-btn"
            type="button"
            title="新对话"
            onClick={() => {
              clearThreadSelection();
              onNewChat?.();
            }}
          >
            <PlusIcon />
          </button>
        </div>
        <div className="chats">
          {chatThreads.map((t) =>
            rename?.kind === "thread" && rename.id === t.id ? (
              <div key={t.id} className="thread chat-thread renaming">
                <input
                  ref={renameRef}
                  className="rename-input"
                  value={rename.value}
                  onChange={(e) => setRename({ ...rename, value: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setRename(null);
                    }
                  }}
                />
              </div>
            ) : (
              <button
                key={t.id}
                type="button"
                className={`thread chat-thread${activeId === t.id ? " active" : ""}${selectedThreadIds.has(t.id) ? " selected" : ""}${runningIds.has(t.id) ? " running" : ""}${unreadIds.has(t.id) ? " unread" : ""}`}
                title={t.title}
                aria-label={`${t.title}${unreadIds.has(t.id) ? "，未读" : ""}`}
                aria-pressed={selectedThreadIds.has(t.id)}
                onClick={(event) => handleThreadClick(event, t)}
                onContextMenu={(event) => openThreadMenu(event, t)}
              >
                <span className="thread-name">{t.title}</span>
                {unreadIds.has(t.id) ? <span className="thread-unread" title="未读" aria-label="未读" /> : null}
                <ThreadActivityTime updatedAt={t.updatedAt} />
              </button>
            ),
          )}
          {chatThreads.length === 0 ? <div className="sidebar-list-empty">暂无对话</div> : null}
        </div>
      </div>
      <div className="sidebar-foot">
        {accountMenuOpen ? (
          <div className="account-menu" ref={accountMenuRef} role="menu">
            <div className="account-menu-head">
              <span className="account-menu-avatar">
                <UserIcon />
              </span>
              <span className="account-menu-identity">
                <strong>{accountLabel(account)}</strong>
                <small>
                  {account?.method === "oauth"
                    ? "xAI 账号"
                    : account?.method === "api-key"
                      ? "API 登录"
                      : "尚未登录"}
                </small>
              </span>
            </div>
            <div className="account-menu-items">
              {canShowUsage ? (
                <button type="button" role="menuitem" disabled={usageLoading} onClick={refreshUsage}>
                  <UsageIcon />
                  <span>OAuth 使用情况</span>
                  <em>{usageSummary}</em>
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  openLogin();
                }}
              >
                <SwitchLoginIcon />
                <span>{account?.method === "none" ? "登录" : "切换登录方式"}</span>
              </button>
              {onSettings ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onSettings();
                  }}
                >
                  <SettingsIcon />
                  <span>设置</span>
                </button>
              ) : null}
              {account?.method !== "none" ? (
                <button className="danger" type="button" role="menuitem" onClick={logoutAccount}>
                  <LogoutIcon />
                  <span>退出登录</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="sidebar-foot-actions">
          <div
            ref={accountTriggerRef}
            className={`account-pill${accountMenuOpen ? " open" : ""}`}
            role="button"
            tabIndex={0}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            title={account?.method === "none" ? "点击登录" : `${usageTitle}；点击切换登录方式`}
            onClick={toggleAccountMenu}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              toggleAccountMenu();
            }}
          >
            <UserIcon />
            <span className="account-name">{accountLabel(account)}</span>
            {account?.method === "oauth" ? <span className="account-kind">OAuth</span> : null}
          </div>
          {onSettings ? (
            <button className="update-btn" type="button" title="设置" aria-label="设置" onClick={onSettings}>
              <SettingsIcon />
            </button>
          ) : null}
          <button
            className={`update-btn${update?.hasUpdate ? " has-update" : ""}`}
            type="button"
            title="检查更新"
            aria-label="检查更新"
            disabled={updateLoading}
            onClick={() => void checkUpdate()}
          >
            {updateLoading ? <SpinnerIcon /> : <UpdateIcon />}
          </button>
        </div>
      </div>
      {searchOpen ? (
        <ModalPortal>
          <div className="modal-backdrop" onClick={() => setSearchOpen(false)}>
            <div className="modal thread-search-modal" role="dialog" aria-modal="true" aria-labelledby="thread-search-dialog-title" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h2 id="thread-search-dialog-title">搜索所有会话</h2>
                <button className="btn small ghost" type="button" onClick={() => setSearchOpen(false)}>
                  关闭
                </button>
              </div>
              <label className="thread-search-box">
                <SearchIcon />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  placeholder="输入会话内容关键词"
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                {searchLoading ? <SpinnerIcon /> : null}
              </label>
              <div className="thread-search-results">
                {!searchQuery.trim() ? <div className="thread-search-empty">输入关键词搜索全部会话内容</div> : null}
                {searchQuery.trim() && !searchLoading && searchResults.length === 0 ? (
                  <div className="thread-search-empty">没有找到匹配的会话</div>
                ) : null}
                {searchResults.map((result) => (
                  <button
                    key={result.thread.id}
                    type="button"
                    className="thread-search-result"
                    onClick={() => {
                      setSearchOpen(false);
                      onSelectThread(result.thread);
                    }}
                  >
                    <span className="thread-search-result-head">
                      <strong>{result.thread.title}</strong>
                      <em>{result.matchCount} 处匹配</em>
                    </span>
                    <span className="thread-search-snippet">{result.snippet}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
      {loginOpen ? (
        <ModalPortal>
          <div
            className="modal-backdrop login-backdrop"
            onClick={closeLogin}
          >
            <div
              className={`modal login-modal login-modal-${loginView}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="login-dialog-title"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="login-window-bar">
              <span className="login-window-title">Grok Build</span>
              <button
                className="login-window-close"
                type="button"
                aria-label={loginBusy ? "取消登录" : "关闭"}
                title={loginBusy ? "取消登录" : "关闭"}
                onClick={closeLogin}
              >
                <svg viewBox="0 0 16 16" aria-hidden>
                  <path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="login-modal-content">
              <div className="login-hero">
                <div className={`login-hero-icon ${loginView === "api" ? "api" : "account"}`}>
                  {loginView === "api" ? <ApiLoginChoiceIcon /> : <AccountLoginChoiceIcon />}
                </div>
                <h2 id="login-dialog-title">
                  {loginView === "api"
                    ? "使用 API 密钥"
                    : !account || account.method === "none"
                      ? "登录 Grok Build"
                      : "切换登录方式"}
                </h2>
                <p>
                  {loginView === "api"
                    ? "选择已有供应商，或手动配置连接信息"
                    : "选择最适合你的方式，稍后也可以随时切换"}
                </p>
                {loginView === "choose" && account && account.method !== "none" ? (
                  <div className="login-current-account">
                    <span aria-hidden />
                    当前登录：{accountLabel(account)}
                  </div>
                ) : null}
              </div>

              {loginView === "choose" ? (
                <>
                  {loginError && !loginBusy ? <p className="settings-error">{loginError}</p> : null}
                  <div className="login-choices">
                    <button
                      className={`login-choice${account?.method === "oauth" ? " current" : ""}`}
                      type="button"
                      aria-pressed={account?.method === "oauth"}
                      disabled={loginBusy}
                      onClick={() => {
                        setLoginBusy(true);
                        setLoginError("正在打开授权页，请在浏览器中完成 xAI 账号登录…");
                        void window.grok
                          .loginAccount()
                          .then((result) => {
                            if (result.ok) {
                              onAccountChange?.(result.account);
                              setLoginError("");
                              setLoginOpen(false);
                              return;
                            }
                            setLoginError(result.message || "账号登录未完成");
                          })
                          .catch((err) => {
                            setLoginError(err instanceof Error ? err.message : String(err));
                          })
                          .finally(() => setLoginBusy(false));
                      }}
                    >
                      <span className="login-choice-icon account">
                        <AccountLoginChoiceIcon />
                      </span>
                      <span className="login-choice-copy">
                        <span className="login-choice-heading">
                          <strong>xAI 账号登录</strong>
                          {account?.method === "oauth" ? <em>当前使用</em> : null}
                        </span>
                        <span className="login-choice-description">在浏览器中安全完成账号授权</span>
                      </span>
                      <span className={`login-choice-action${account?.method === "oauth" ? " selected" : ""}`}>
                        {loginBusy ? <SpinnerIcon /> : account?.method === "oauth" ? <LoginCheckIcon /> : <LoginChevronIcon />}
                      </span>
                    </button>
                    <button
                      className={`login-choice${account?.method === "api-key" ? " current" : ""}`}
                      type="button"
                      aria-pressed={account?.method === "api-key"}
                      disabled={loginBusy}
                      onClick={() => {
                        setLoginError("");
                        setLoginView("api");
                      }}
                    >
                      <span className="login-choice-icon api">
                        <ApiLoginChoiceIcon />
                      </span>
                      <span className="login-choice-copy">
                        <span className="login-choice-heading">
                          <strong>API 密钥登录</strong>
                          {account?.method === "api-key" ? <em>当前使用</em> : null}
                        </span>
                        <span className="login-choice-description">使用 Base URL 与 API Key 连接</span>
                      </span>
                      <span className={`login-choice-action${account?.method === "api-key" ? " selected" : ""}`}>
                        {account?.method === "api-key" ? <LoginCheckIcon /> : <LoginChevronIcon />}
                      </span>
                    </button>
                  </div>
                  {loginBusy ? (
                    <div className="login-progress" role="status">
                      <SpinnerIcon />
                      <span>授权页已打开，请在浏览器中完成登录</span>
                      <button type="button" onClick={closeLogin}>取消</button>
                    </div>
                  ) : null}
                  <p className="login-privacy-note">
                    <LoginLockIcon />
                    登录信息由 Grok CLI 安全保存在本机
                  </p>
                </>
              ) : (
                <ApiLoginView
                  baseUrl={baseUrl}
                  setBaseUrl={setBaseUrl}
                  apiKey={apiKey}
                  setApiKey={setApiKey}
                  model={apiModel}
                  setModel={setApiModel}
                  contextWindow={apiContextWindow}
                  setContextWindow={setApiContextWindow}
                  sessionId={activeId}
                  cwd={activeCwd}
                  loginBusy={loginBusy}
                  setLoginBusy={setLoginBusy}
                  loginError={loginError}
                  setLoginError={setLoginError}
                  ccSwitchProviders={ccSwitchProviders}
                  ccSwitchLoading={ccSwitchLoading}
                  showManualEntry={showManualEntry}
                  setShowManualEntry={setShowManualEntry}
                  selectedProviderId={selectedProviderId}
                  setSelectedProviderId={setSelectedProviderId}
                  onBack={() => {
                    setLoginError("");
                    setLoginView("choose");
                  }}
                  onSuccess={(account) => {
                    onAccountChange?.(account);
                    setLoginOpen(false);
                    setApiKey("");
                    setApiModel("grok-4.6");
                    setApiContextWindow("");
                    setSelectedProviderId(null);
                  }}
                />
              )}
            </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
      {updateOpen && update ? (
        <ModalPortal>
          <div className="modal-backdrop" onClick={() => setUpdateOpen(false)}>
            <div className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 id="update-dialog-title">检查更新</h2>
              <button className="btn small ghost" type="button" onClick={() => setUpdateOpen(false)}>
                关闭
              </button>
            </div>
            {update.hasUpdate ? (
              <>
                <p>
                  当前 {update.current}，最新 {update.latest}。
                </p>
                {update.dev ? <p className="settings-hint">开发环境仅检查版本，请在正式安装版中测试应用内更新。</p> : null}
                {update.notes ? (
                  <div className="update-notes">
                    <Markdown text={update.notes} allowHtml />
                  </div>
                ) : null}
                {update.status === "downloading" ? (
                  <div className="update-download" role="status">
                    <div className="update-download-head">
                      <span>正在应用内下载更新…</span>
                      <strong>{Math.round(update.progress || 0)}%</strong>
                    </div>
                    <div className="update-progress-track" aria-label="更新下载进度">
                      <span style={{ width: `${Math.max(0, Math.min(100, update.progress || 0))}%` }} />
                    </div>
                    <p>
                      {formatUpdateBytes(update.transferred)}
                      {update.total ? ` / ${formatUpdateBytes(update.total)}` : ""}
                      {update.bytesPerSecond ? ` · ${formatUpdateBytes(update.bytesPerSecond)}/s` : ""}
                    </p>
                  </div>
                ) : null}
                {update.status === "downloaded" ? (
                  <div className="update-ready" role="status">
                    更新已下载完成，重启应用即可自动安装。
                  </div>
                ) : null}
                {update.error ? <p className="settings-error">{update.error}</p> : null}
                <div className="permission-actions">
                  <button
                    className="btn primary"
                    type="button"
                    disabled={update.dev || update.status === "downloading"}
                    onClick={() => {
                      if (update.status === "downloaded") {
                        void window.grok.installUpdate();
                        return;
                      }
                      void window.grok.downloadUpdate().then(setUpdate);
                    }}
                  >
                    {update.dev
                      ? "正式安装版支持应用内更新"
                      : update.status === "downloading"
                        ? `下载中 ${Math.round(update.progress || 0)}%`
                        : update.status === "downloaded"
                          ? "重启并安装"
                          : update.status === "error"
                            ? "重新下载"
                            : "在应用内下载"}
                  </button>
                </div>
              </>
            ) : null}
            {update.error && !update.hasUpdate ? <p className="settings-error">{update.error}</p> : null}
            {!update.error && !update.hasUpdate ? (
              <p>已是最新版本{update.current ? ` ${update.current}` : ""}。</p>
            ) : null}
            </div>
          </div>
        </ModalPortal>
      ) : null}
      {menu ? (
        <ModalPortal>
          <div
            ref={menuRef}
            className="ctx-menu"
            role="menu"
            aria-label={menu.kind === "project" ? "项目操作" : "会话操作"}
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {menu.kind === "project" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setRename({ kind: "project", cwd: menu.project.cwd, value: menu.project.name });
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <RenameIcon />
                </span>
                重命名
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenProjectFolder(menu.project);
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <OpenFolderIcon />
                </span>
                打开所在目录
              </button>
              <div className="ctx-sep" />
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onRemoveProjectThreads(menu.project);
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <TrashIcon />
                </span>
                移除全部聊天
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onRemoveProject(menu.project);
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <TrashIcon />
                </span>
                移除项目
              </button>
            </>
          ) : selectedThreads.length > 1 && selectedThreadIds.has(menu.thread.id) ? (
            <>
              <div className="ctx-menu-label">已选择 {selectedThreads.length} 个会话</div>
              <button
                type="button"
                onClick={() => {
                  onForkThreads(selectedThreads);
                  clearThreadSelection();
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <ForkIcon />
                </span>
                分叉所选会话
              </button>
              <div className="ctx-sep" />
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onRemoveThreads(selectedThreads);
                  clearThreadSelection();
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <TrashIcon />
                </span>
                移除所选会话
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  onForkThread(menu.thread);
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <ForkIcon />
                </span>
                分叉对话
              </button>
              <button
                type="button"
                onClick={() => {
                  setRename({ kind: "thread", id: menu.thread.id, value: menu.thread.title });
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <RenameIcon />
                </span>
                重命名
              </button>
              <div className="ctx-sep" />
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onRemoveThread(menu.thread);
                  setMenu(null);
                }}
              >
                <span className="ctx-icon">
                  <TrashIcon />
                </span>
                移除
              </button>
            </>
            )}
          </div>
        </ModalPortal>
      ) : null}
    </aside>
  );
}
