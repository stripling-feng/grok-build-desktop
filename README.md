<div align="center">
  <a href="https://tcboys.de/">
    <img src="docs/tcboys-banner.png" alt="天才少年中转站" width="100%">
  </a>
</div>

<div align="center">

# Grok Build Desktop

### 把 Grok CLI，变成真正好用的 Windows AI 编程工作台。

管理项目、同时运行多个任务、审阅执行计划、查看代码变化。<br>
从提出需求到完成修改，一个窗口就够了。

[![最新版本](https://img.shields.io/github/v/release/stripling-feng/grok-build-desktop?label=最新版本&color=00a8ff)](https://github.com/stripling-feng/grok-build-desktop/releases/latest)
[![系统](https://img.shields.io/badge/系统-Windows%2010%20%7C%2011-0078D4)](#安装使用)
[![平台](https://img.shields.io/badge/架构-x64-555555)](#系统要求)
[![开源](https://img.shields.io/badge/项目-开源-success)](https://github.com/stripling-feng/grok-build-desktop)

[立即下载](https://github.com/stripling-feng/grok-build-desktop/releases/latest)
·
[提交问题](https://github.com/stripling-feng/grok-build-desktop/issues)
·
[查看源码](https://github.com/stripling-feng/grok-build-desktop)

</div>

![Grok Build Desktop 界面](docs/screenshot.jpg)

## 这是什么？

Grok CLI 很强，但它不一定只能在终端里使用。

**Grok Build Desktop** 为 Grok CLI 提供了一个完整的 Windows 图形界面。你可以在一个应用里添加项目、创建任务、与 Grok 对话、确认执行计划、查看文件变化，并管理插件和自动化任务。

它不会重新实现 Grok Agent，也不会取代 Grok CLI。

桌面端通过 ACP 连接本机的 Grok CLI，因此可以继续使用你原来的：

- Grok 账号
- 历史会话
- CLI 配置
- Skills
- MCP 服务
- 插件与市场源

> Grok Build Desktop 是社区维护项目，并非 xAI 官方产品。

## 为什么选择它？

### 不用一直盯着终端

任务、回答、工具调用、计划和代码变化，都以更清楚的方式显示在界面中。

### 多个任务同时进行

每个会话都有独立状态。你可以让一个任务继续运行，同时切换到另一个项目处理新需求。

### 动手之前先看计划

遇到复杂任务，可以让 Grok 先提问、再生成计划。确认计划没有问题后，再开始修改代码。

### 保留完整 CLI 能力

桌面端连接的是本机 Grok CLI。原有配置、Skills、MCP 和会话仍然可以继续使用。

## 主要功能

| 功能 | 最简单的说明 |
| --- | --- |
| 项目管理 | 添加本地文件夹，快速进入不同项目 |
| 多会话任务 | 同时运行多个任务，切换会话不会丢失进度 |
| 历史搜索 | 搜索所有会话，快速找到以前的讨论 |
| 计划模式 | 先讨论方案，确认计划后再执行 |
| 后续要求排队 | 任务运行时继续发送要求，系统按顺序处理 |
| 图片支持 | 发送图片、粘贴截图，并在对话中直接预览 |
| 实时代码变化 | 查看本次任务修改了哪些文件和多少行 |
| Git Diff | 直接查看文件修改前后的差异 |
| 内置终端 | 不离开应用即可执行项目命令 |
| 编辑器跳转 | 使用 VS Code 或 Cursor 打开当前项目 |
| OAuth 登录 | 使用 Grok 账号授权登录 |
| API 登录 | 使用 Base URL、API Key 和自定义模型 |
| 模型设置 | 选择模型、推理等级和权限模式 |
| 插件市场 | 浏览、安装、更新和启用插件 |
| Skills 与 MCP | 管理本机或项目级扩展能力 |
| 自动化任务 | 按时间自动运行任务，并保存执行结果 |
| 网络代理 | 支持系统代理、直连和手动 HTTP/HTTPS 代理 |
| 应用内更新 | 检查、下载并安装新版本 |

## 适合用来做什么？

- 阅读和理解陌生代码
- 修复 Bug
- 开发新功能
- 重构项目
- 补充测试
- 检查代码变化
- 生成执行计划
- 整理项目文档
- 定时检查项目状态
- 同时处理多个开发任务

## 计划模式

复杂任务最怕“还没想清楚就开始改”。

计划模式把任务分为四步：

```text
提出需求
   ↓
Grok 补充提问
   ↓
生成完整计划
   ↓
你确认后开始执行
```

每次修改计划都会生成一个新版本，旧计划仍然保留。

你可以先完整查看即将执行的步骤，再决定是否开始。特别适合重构、跨文件修改和较复杂的功能开发。

## 多会话与任务排队

不同任务可以拥有自己的运行状态。

即使切换到其他项目，后台任务也可以继续执行。任务完成后，侧边栏会显示未读状态。

当 Grok 正在工作时，你还可以继续发送新的要求。这些要求会先进入队列，然后按照发送顺序继续处理。

## Git 与代码变化

Grok Build Desktop 会读取当前项目的 Git 状态，并在界面中显示：

- 新增了哪些文件
- 修改了哪些文件
- 删除了哪些文件
- 每个文件增加或删除了多少行
- 文件的完整 Diff

你不需要等任务结束后再去终端里寻找修改内容。

## 插件、Skills 与 MCP

在桌面端中可以统一管理 Grok 的扩展能力：

- 查看并启用 Skills
- 添加 stdio 或 HTTP MCP 服务
- 安装和更新插件
- 添加 GitHub 或本地插件市场
- 管理项目级与用户级配置
- 兼容部分 Windows 无法直接使用的市场文件名

项目级插件、MCP 和 Hooks 只有在项目获得信任后才会加载。

## 自动化任务

自动化功能可以让 Grok 按照指定时间执行任务。

例如：

- 每天汇总项目进展
- 定期检查代码风险
- 生成每周开发报告
- 检查文档是否需要更新
- 定时整理待办事项

每次运行都会创建独立会话，并保留执行结果。

> 自动化功能目前为 Beta。应用需要保持运行，并且电脑处于唤醒状态。

## 安装使用

### 第一步：安装 Grok CLI

打开 PowerShell：

```powershell
irm https://x.ai/cli/install.ps1 | iex
grok --version
```

如果 `grok --version` 能正常显示版本，说明安装成功。

### 第二步：安装桌面端

前往 Releases 页面下载最新版 Windows 安装程序：

### [下载 Grok Build Desktop](https://github.com/stripling-feng/grok-build-desktop/releases/latest)

当前安装包暂未配置代码签名，因此 Windows 可能提示“未知发布者”。

请只从本项目的 GitHub Releases 页面下载安装包。

### 第三步：开始任务

1. 启动 Grok Build Desktop
2. 使用 Grok 账号或 API Key 登录
3. 添加一个本地项目
4. 创建新任务并输入要求
5. 根据需要选择模型、推理等级和权限
6. 等待 Grok 完成任务并查看代码变化

## 系统要求

- Windows 10 或 Windows 11
- x64 处理器
- 已安装 Grok CLI
- 能够连接 Grok 或对应 API 服务
- Git、VS Code 和 Cursor 为可选安装

从源码运行还需要：

- Node.js 22 或更高版本
- npm

## 它是如何工作的？

```text
Grok Build Desktop
        │
        │ ACP
        ▼
本机 Grok CLI
        │
        ├── 项目文件
        ├── Git 仓库
        ├── 历史会话
        ├── Skills
        ├── MCP
        └── 插件与配置
```

应用会优先寻找系统 `PATH` 中的 `grok`，同时也会检查：

```text
%USERPROFILE%\.grok\bin\grok.exe
```

安装包默认不会捆绑 Grok CLI。

## 数据与安全

- 项目文件保留在你的电脑上
- Grok 配置和会话主要由本机 CLI 管理
- 桌面端不会额外搭建中转服务器保存你的项目
- API Key 不会显示在会话内容中
- 敏感操作会根据权限模式请求确认
- 项目级扩展只会在信任项目后加载

开启“完全访问”后，Grok 可能读取或修改文件并执行命令。请只对可信项目启用。

## 网络与代理

应用支持三种连接方式：

| 模式 | 说明 |
| --- | --- |
| 跟随系统 | 使用 Windows 系统代理或代理环境变量 |
| 直连 | 不经过代理连接服务 |
| 手动代理 | 填写 HTTP/HTTPS 代理地址 |

修改代理后，应用会重新连接 Grok，但不会主动中断已经运行的任务。

## 常见问题

### 提示“未找到 Grok CLI”

在 PowerShell 中运行：

```powershell
grok --version
```

如果命令不存在，请先安装 Grok CLI，然后完全退出并重新启动桌面端。

### 浏览器登录完成，但客户端没有登录成功

请检查网络或代理是否允许访问 `auth.x.ai`，并确认 Grok CLI 已更新。

如果 OAuth 暂时无法使用，也可以切换到 API 登录。

### 可以使用自己的 API 地址吗？

可以。

选择 API 登录后，填写：

- Base URL
- API Key
- 模型名称
- 上下文窗口大小

应用支持兼容 OpenAI 接口格式的 API 地址。

### 为什么 Windows 提示未知发布者？

当前安装包暂未使用代码签名证书。

请确认安装包来自本仓库的 Releases 页面。如果无法确认文件来源，请不要运行。

## 本地开发

```powershell
git clone https://github.com/stripling-feng/grok-build-desktop.git
cd grok-build-desktop
npm install
npm run dev
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发环境 |
| `npm run typecheck` | 检查 TypeScript 类型 |
| `npm test` | 运行自动化测试 |
| `npm run build` | 构建应用 |
| `npm run pack:win` | 生成 Windows 安装包 |
| `npm run release:win` | 构建并发布新版本 |

## 项目结构

```text
grok-build-desktop/
├─ electron/       # Electron 主进程、ACP、会话和账号
├─ src/            # React 界面
├─ tests/          # 自动化测试
├─ scripts/        # 构建脚本
├─ build/          # 应用图标和构建资源
├─ docs/           # README 图片
└─ package.json
```

## 参与贡献

欢迎提交：

- Bug 报告
- 功能建议
- 界面改进
- 文档修改
- Pull Request

提交代码前，请运行：

```powershell
npm run typecheck
npm test
npm run build
```

## 免责声明

本项目是社区维护的第三方桌面客户端，不属于 xAI 官方产品。

Grok、Grok Build 以及相关名称和商标的权利归其各自权利人所有。

## 致谢

- [Grok Build](https://github.com/xai-org/grok-build)
- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Vite](https://vite.dev/)

---

<div align="center">

**让 Grok 不只停留在终端里。**

如果这个项目对你有帮助，欢迎点一个 ⭐ Star。

</div>
