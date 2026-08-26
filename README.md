<div align="center">
  <a href="https://tcboys.de/">
    <img src="docs/tcboys-banner.png" alt="天才少年中转站" width="100%">
  </a>
</div>

> [!IMPORTANT]
> ### 📣 广告推荐｜天才少年中转站
> AI 服务中转站访问入口：**[https://tcboys.de/](https://tcboys.de/)**

<div align="center">

# Grok Build 桌面端

面向 Windows 的 Grok Build 图形化客户端，通过 ACP 调用本机 Grok CLI，提供项目管理、多会话对话、计划模式、插件市场和自动化任务等桌面能力。

[![版本](https://img.shields.io/github/v/release/stripling-feng/grok-build-desktop?label=%E7%89%88%E6%9C%AC)](https://github.com/stripling-feng/grok-build-desktop/releases/latest)
[![平台](https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-Windows%20x64-0078D4)](#系统要求)
[![Electron](https://img.shields.io/badge/Electron-36-47848F)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)

[下载最新版](https://github.com/stripling-feng/grok-build-desktop/releases/latest) · [反馈问题](https://github.com/stripling-feng/grok-build-desktop/issues) · [查看源码](https://github.com/stripling-feng/grok-build-desktop)

</div>

![Grok Build 桌面端界面](docs/screenshot.jpg)

## 项目简介

Grok Build 桌面端是一个社区维护的桌面界面。应用不重新实现 Agent，而是通过 ACP（`grok agent stdio`）连接本机 Grok CLI，在保留原有账号、配置、Skills、MCP 和历史会话的基础上，提供更直观的 Windows 使用体验。

> 本项目并非 xAI 官方产品。Grok、Grok Build 以及相关名称的权利归其各自权利人所有。

## 主要功能

| 模块 | 功能 |
| --- | --- |
| 项目与会话 | 管理本地项目、创建或恢复会话、搜索历史内容、分叉会话和重命名会话 |
| 多会话执行 | 每个会话独立保存运行状态和流式消息，切换会话不会混淆任务输出 |
| 计划模式 | 先澄清问题，再生成可审阅的完整计划；每次重写都会保留为新的计划版本 |
| 对话体验 | 流式响应、Markdown 渲染、图片展示、工具调用卡片和上下文用量提示 |
| 权限控制 | 支持不同权限模式和推理强度；执行敏感操作前展示确认信息 |
| 账号登录 | 支持 xAI 账号授权和 API 登录，并可查看账号用量信息 |
| 开发工具 | Git 状态与 Diff、内置终端，以及使用 VS Code 或 Cursor 打开工作区 |
| 扩展能力 | 管理插件、Skills、MCP 和市场源，并兼容部分 Windows 不支持的市场文件名 |
| 自动化 | 创建定时任务或当前会话循环任务，在独立会话中执行并保留结果 |

## 工作方式

```text
React 桌面界面
       │
Electron 主进程
       │ ACP
本机 Grok CLI（grok agent stdio）
       │
工作区、Git、~/.grok 配置与历史会话
```

应用会优先寻找系统 `PATH` 中的 `grok`，也会检查 `%USERPROFILE%\.grok\bin\grok.exe`。安装包默认不捆绑 Grok CLI。

## 系统要求

- Windows 10 或 Windows 11，x64 架构
- 已安装 Grok Build CLI
- 能够访问 xAI 登录及 API 服务
- 使用源码开发时需要 Node.js 22 或更高版本
- Git、VS Code 和 Cursor 为可选依赖，仅在使用对应功能时需要

## 快速开始

### 1. 安装 Grok Build CLI

在 PowerShell 中运行：

```powershell
irm https://x.ai/cli/install.ps1 | iex
grok --version
```

如果已经安装，请确认 `grok --version` 能够正常输出版本信息。

### 2. 安装桌面端

从 [Releases](https://github.com/stripling-feng/grok-build-desktop/releases/latest) 下载最新版 Windows 安装程序：

**[Grok-Build-Setup-0.1.6.exe](https://github.com/stripling-feng/grok-build-desktop/releases/download/v0.1.6/Grok-Build-Setup-0.1.6.exe)**

当前安装包尚未配置代码签名证书，Windows 可能显示“未知发布者”。请只从本仓库的 Releases 页面下载安装包，并在安装前核对文件信息。

`v0.1.6` 安装包 SHA-256：

```text
8216542734D5C86922E3181BE07446035532BA9DEE8B39492E7EAA2861C296A3
```

### 3. 登录并开始使用

1. 启动 Grok Build 桌面端。
2. 点击左下角账号图标，选择“账号登录”或“API 登录”。
3. 添加一个本地项目目录，或直接创建普通会话。
4. 选择权限模式、模型和推理强度后发送任务。
5. 需要先讨论方案时开启“计划模式”，确认计划后再开始执行。

## 计划模式

计划模式用于“先讨论、后执行”的任务：

1. Grok 判断是否需要补充信息，并在对话中展示待回答的问题。
2. 你回答后，系统生成一份完整计划文档。
3. 如果要求重写，会生成新的计划版本，旧版本仍保留在会话中。
4. 只有点击“开始执行”后，才会按照选中的计划版本进入执行阶段。
5. 关闭计划模式后，普通消息会恢复为执行模式，不会自动生成计划。

## 本地开发

```powershell
git clone https://github.com/stripling-feng/grok-build-desktop.git
cd grok-build-desktop\apps\desktop
npm install
npm run dev
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 与 Electron 开发环境 |
| `npm run typecheck` | 执行 TypeScript 类型检查 |
| `npm test` | 运行会话和计划流程测试 |
| `npm run build` | 构建前端与 Electron 主进程 |
| `npm run pack:win` | 构建 Windows x64 NSIS 安装包 |
| `npm run release:win` | 构建并发布安装包与应用内更新元数据（需要 `GH_TOKEN`） |

Windows 安装包会输出到 `release/`。

发布新版本时，先同步修改 `package.json` 中的版本号，再推送同名标签（例如版本
`0.1.6` 对应标签 `v0.1.6`）。GitHub Actions 会自动上传 NSIS 安装包、blockmap 和
`latest.yml`；已安装的客户端随后可以在应用内下载，并通过“重启并安装”完成升级。

## 项目结构

```text
grok-build-desktop/
├─ apps/desktop/
│  ├─ electron/        # Electron 主进程、ACP、账号与会话管理
│  ├─ src/             # React 界面与业务状态
│  ├─ tests/           # 会话和计划流程测试
│  └─ build/           # 应用图标等构建资源
├─ docs/               # 文档图片
└─ README.md
```

## 数据与安全

- Grok 账号、配置、Skills、MCP 和会话数据由本机 Grok CLI 管理，主要位于 `~/.grok`。
- 应用不会为了提供界面而重新实现或转发 Agent 协议；请求由本机 CLI 与对应服务通信。
- “完全访问”模式可能允许 Agent 读取、修改工作区文件或执行命令，请仅对可信项目启用。
- 应用以单实例运行；重复启动时会聚焦已有窗口。
- 日志位于 Electron 的用户数据目录，可通过“设置 → 打开日志目录”查看。

## 常见问题

### 提示“未找到 Grok CLI”

先在 PowerShell 中执行 `grok --version`。如果命令不存在，请安装 Grok CLI，然后完全退出并重新启动桌面端。

### 浏览器完成登录后，客户端仍显示登录未完成

确认 Grok CLI 已更新、网络或代理能够访问 `auth.x.ai`，然后重新发起授权。仍无法完成时，可以切换到 API 登录方式。

### 账号用量显示“暂无用量数据”

用量接口通常只对支持的 OAuth 账号返回数据。API 登录、接口暂不可用或账号未返回计费字段时，桌面端不会虚构用量。

### Windows 阻止运行安装包

当前版本尚未签名。请确认文件来自本仓库 Releases，并核对上方 SHA-256；如果无法确认来源，请不要运行。

## 参与贡献

欢迎通过 [Issues](https://github.com/stripling-feng/grok-build-desktop/issues) 提交错误报告和功能建议。提交代码前，请至少运行：

```powershell
cd apps/desktop
npm run typecheck
npm test
```

提交问题时建议附上系统版本、Grok CLI 版本、复现步骤和已脱敏的日志片段。

## 致谢

- [Grok Build](https://github.com/xai-org/grok-build)
- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Vite](https://vite.dev/)
