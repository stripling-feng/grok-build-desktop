# Grok Build Desktop

Codex-style desktop command center for [Grok Build](https://github.com/xai-org/grok-build). The app is a thin Electron UI over the local `grok` CLI via ACP (`grok agent stdio`). It does not reimplement the agent.

## Prerequisites

- Node.js 22+
- Grok Build CLI on PATH or at `%USERPROFILE%\.grok\bin\grok.exe`

```powershell
irm https://x.ai/cli/install.ps1 | iex
grok --version
```

## Develop

```powershell
cd apps/desktop
npm install
npm run dev
```

The window talks to your existing Grok login, config, skills, and sessions under `~/.grok`.

## Windows installer

```powershell
cd apps/desktop
npm run pack:win
```

The NSIS installer lands in `apps/desktop/release/`. It does not bundle the grok CLI; first launch will offer the official install script if `grok` is missing. You can drop a `grok.exe` next to the packaged resources if you want a bundled binary.

Single-instance: opening the app twice focuses the existing window. Logs live under the Electron userData `logs` folder (设置 → 打开日志目录).

## What it does (v1)

- Project sidebar + threads (Grok sessions)
- Resume CLI/TUI history from `~/.grok/sessions`
- Streamed chat, tool cards, permission prompts
- Local vs git worktree threads
- Git status / diff panel
- Open folder in VS Code or Cursor
