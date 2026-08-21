# Grok Build 桌面接入 MCP / Skills / Plugins / 自动化

原则：**桌面永远是 ACP 客户端**，不重写 agent、不自己拉起 MCP、不自己跑 hooks。执行全部交给已安装的 Grok CLI 1.0.5（`grok mcp` / `grok plugin` / `grok inspect` / `grok agent stdio`）。桌面只做发现、开关、安装 UI，以及把配置送进会话。

本地现状：

- CLI 已支持 MCP、Skills、Plugins、Hooks、`/loop` 调度；本机 `~/.grok/config.toml` 里还没有 `[mcp_servers]` / `[skills]` / `[plugins]`。
- 桌面 Settings 只有 Skills 开关；`session/new` 和 `session/load` **写死** `mcpServers: []`。文档没写空数组是「沿用磁盘配置」还是「清空 MCP」，第一期必须先验证，避免把 CLI 已发现的服务器抹掉。
- Grok **没有 OS cron**。所谓自动化 = Hooks + 会话内 `/loop`（最短 60s，最多 50 条，7 天过期）+ headless `grok -p`。不要做一套和 CLI 平行的定时引擎。

---

## 第 0 期：探明协议（1 天，先做再写 UI）

1. 跑 `grok inspect --json`、`grok mcp list --json`、`grok plugin list --json`，把 JSON 形状固化成 TypeScript 类型（不要猜字段）。
2. 对照实验 ACP：`mcpServers` 省略 / `[]` / 填一条 stdio 服务器，看会话里 MCP 是合并还是替换。
3. 结论写入 `acp.ts`：
   - 若 `[]` 会清空 → **省略该字段**，让 CLI 读 `config.toml` + compat（Cursor/Claude/`.mcp.json`）。
   - 若需要显式注入 → 只在用户从桌面「本次会话附加」时传入，默认仍走磁盘。
4. `loadSession` 与 `newSession` 用同一套 MCP 策略，恢复对话不能丢服务器。

插入点已经存在：`apps/desktop/electron/acp.ts` 的 `newSession` / `loadSession`，以及 `main.ts` 的 `grok:newThread`（今天只合并 `_meta.yoloMode` / `autoMode` / `rules`）。

---

## 架构：CLI 当源，不要继续手写 TOML

现有 `config.ts` 是行级 TOML 补丁，撑不住 `[mcp_servers.<name>]`、`[[hooks.PreToolUse]]`、插件 enabled/disabled。

新增 `apps/desktop/electron/grok-cli.ts`：

- `inspect(cwd)` → `grok inspect --json`
- `mcp list|add|remove|enable|disable`（`--scope user|project`）
- `plugin list|install|uninstall|enable|disable|marketplace …`
- 超时、stderr 进现有日志目录；失败把 CLI 原文回给 UI

Skills 开关可继续写 `[skills] disabled`（已验证能用）。MCP / 插件的增删改 **只调用 CLI**，避免和官方解析器打架。

IPC 沿用现有模式：`ipcMain.handle("grok:…")` → `preload` → `window.grok.*` → Settings `onChange(AppSettings)`。`AppSettings` 扩展 mcp / plugins / hooks / marketplace，不新开窗口。

---

## UI：设置改成页内标签

`Settings.tsx` 现在是单列 modal（`min(520px)`）。ZCode 那套塞进去会溢出，改成页内标签，入口仍是标题栏「设置」，**不要进 Sidebar / Composer 芯片**。

标签：**通用 | Skills | MCP | 插件 | 自动化**

复用 `skill-list` + `toggle` + `settings-hint` + 二级 modal（与 Composer 目标对话框同款）。

- **通用**：现有模型 / 推理 / 权限 / 日志不动。
- **Skills**：保留扫描 + 开关；加「打开目录」、空状态引导 `~/.grok/skills` 与项目 `.grok/skills`；不在应用内做 SKILL.md 编辑器。
- **MCP**：名称、来源徽章（用户 / 项目 / cursor / claude / 插件）、stdio|http、启用开关、添加（command+args 或 url）、删除、`grok mcp doctor` 结果。密码只写 CLI，UI 不回显。
- **插件**：已安装列表（enable/disable/uninstall）+ 市场源（`grok plugin marketplace list/add`）+ 安装（需勾选信任，对应 CLI `--trust`）。项目 `.grok/plugins/` 未信任时显示「信任此文件夹」。
- **自动化**：Hooks 列表（事件、matcher、来源、是否受 folder trust 限制）+ 打开 hooks 目录；会话调度说明（`/loop`，不是系统定时任务）。不做 OS crontab。

信任模型原样交给 CLI：`~/.grok/plugins/` 自动信任；项目插件 / 项目 hooks / 项目 MCP 需要 `trusted_folders.toml`。桌面只提供「信任当前项目」按钮（调用与 `/hooks-trust` 等价的能力，或写 trusted_folders——优先找 CLI，找不到再文档化最小写入）。

---

## Composer：`/` 面板（ZCode 手感）

TUI 的 slash 有几十条 pager 命令，ACP 里大部分不存在。桌面只做两层：

1. **桌面自己处理**：`/new`（新对话）、计划模式、打开设置。不要伪造 `/dashboard`、`/fork` 等没有 ACP 方法的命令。
2. **发给 agent**：所有 `user-invocable` skill → 发送原文 `/name args`（CLI 会当 slash/skill 执行）。重名时用 inspect 的 `invocableAs`（`/user:name` 等）。

输入 `/` 弹出过滤列表（skill 名 + 描述 + 来源）。不要在 Composer 里做 MCP 开关。

---

## 分期交付（按这个顺序合，每一期都能用）

### 一期：会话真用上 + MCP 管理（核心）

- 第 0 期实验结论落到 `acp.ts`。
- `grok inspect --json` 填满设置 MCP 页；enable/disable/add/remove 走 `grok mcp`。
- 新会话 / 恢复会话与 CLI 磁盘配置一致。
- Settings 改标签，MCP + 现有 Skills 先上。

验收：在设置里加一个 stdio MCP → 新开对话 → 工具卡里能看到该服务器的 tool call；关掉后再开新对话不再出现。

### 二期：Skills 补齐 + slash

- Skills 打开目录、来源徽章与 inspect 对齐（含 compat `.claude` / `.cursor`）。
- Composer `/` 列表。
- 可选：把 `user-invocable` 技能名插进输入框，不自动发送。

### 三期：插件 + 市场

- `grok plugin list/install/uninstall/enable/disable`。
- marketplace add/list/update；安装必须明确 `--trust`。
- 安装后 `inspect` 刷新 Skills/MCP（插件可带 skill 和 `.mcp.json`）。
- 不在 520px 里做完整市场浏览页：列表 + 粘贴 git URL / `owner/repo` 即可。

### 四期：Hooks + 会话调度

- 列出 user `~/.grok/hooks/*.json`、config.toml `[[hooks.*]]`、项目 hooks、插件 hooks。
- 添加命令型 hook：写 user JSON 或提示用户把文件放到 `~/.grok/hooks/`（TOML 数组手写风险高，优先 JSON 文件）。
- Composer 增加「循环任务」：把 `/loop 5m …` 作为快捷发送（执行仍在 agent 内）。
- 明确文案：不是开机定时，关会话即停（除非 CLI durable，且文档如此）。

---

## 明确不做（避免做成第二个 agent）

- 不在 Electron 里 spawn MCP、实现 OAuth、实现 `search_tool`/`use_tool`。
- 不自己跑 PreToolUse / 权限引擎。
- 不把 ZCode 的 `mcp.json` 当成 Grok 主配置；Grok 主配置是 `[mcp_servers.<name>]`。Compat 扫描由 CLI 完成，桌面只展示来源。
- 不把 ACP `mcpServers: []` 继续写死；也不在没验证前改成随便塞对象。
- 不实现完整 TUI slash（`/dashboard`、`/rewind` 等无 ACP）。
- 不做系统级 cron / 后台常驻 worker。

---

## 主要改动文件

- `electron/acp.ts` — session/new、session/load 的 MCP 字段
- `electron/grok-cli.ts`（新）— inspect / mcp / plugin 封装
- `electron/config.ts` — Skills 保持；不要用它写 mcp 嵌套表
- `electron/main.ts` + `preload.ts` + `vite-env.d.ts` + `shared.ts` — IPC 与类型
- `src/components/Settings.tsx` + `index.css` — 标签页与列表
- `src/components/Composer.tsx` — `/` 面板（二期）
- `src/App.tsx` — 打开设置时带 cwd，slash 发送

主进程改完后按现有约定 **自行重启桌面**（不要 `taskkill /T`）。

---

## 风险

- **空 `mcpServers` 语义未知**：第 0 期不通过，后面全是错的。
- **`inspect --json` 无稳定 schema 文档**：类型以本机 1.0.5 实测为准，CLI 升级可能要跟。
- **项目 MCP 写入 `.grok/config.toml`**：和用户级分离，UI 必须选 scope。
- **Folder trust**：项目 hooks/MCP 配了也不跑，UI 要显示未信任，而不是报「功能没接上」。
