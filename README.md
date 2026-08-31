<div align="center">
  <a href="https://tcboys.de/"><img src="docs/tcboys-banner.png" alt="天才少年中转站" width="100%"></a>
</div>

<div align="center">

# Grok Build Desktop

### 把 Grok CLI，变成真正好用的 Windows AI 编程工作台。

[![最新版本](https://img.shields.io/github/v/release/stripling-feng/grok-build-desktop?label=最新版本&color=00a8ff)](https://github.com/stripling-feng/grok-build-desktop/releases/latest)
[![系统](https://img.shields.io/badge/系统-Windows%2010%20%7C%2011-0078D4)](#本地开发)
[![开源](https://img.shields.io/badge/项目-开源-success)](https://github.com/stripling-feng/grok-build-desktop)

[立即下载](https://github.com/stripling-feng/grok-build-desktop/releases/latest) · [提交问题](https://github.com/stripling-feng/grok-build-desktop/issues) · [查看源码](https://github.com/stripling-feng/grok-build-desktop)

</div>

## 最新截图

![Grok Build Desktop 界面预览](docs/screenshot.jpg)

![Grok Build Desktop 最新 Logo](src/assets/grok-logo-transparent.png)

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

## 参与贡献

欢迎提交 Bug 报告、功能建议、界面改进、文档修改和 Pull Request。

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

<div align="center">如果这个项目对你有帮助，欢迎点一个 ⭐ Star。</div>
