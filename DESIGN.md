---
version: alpha
name: "Grok Build Desktop"
description: "A focused Windows AI coding workbench with a calm macOS-inspired surface, electric azure actions, and precise developer-grade feedback."
colors:
  primary: "#0A84FF"
  primary-strong: "#0066D6"
  primary-tint: "#E8F3FF"
  canvas: "#F4F6FA"
  sidebar: "#EDF1F7"
  surface: "#FFFFFF"
  surface-soft: "#F8FAFD"
  ink: "#172033"
  ink-muted: "#5F6B7A"
  ink-subtle: "#8994A5"
  success: "#2FA36B"
  warning: "#D98A1C"
  danger: "#B93838"
  info: "#4B5BC1"
  terminal: "#141922"
typography:
  sans:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter Variable', 'PingFang SC', 'Microsoft YaHei UI', system-ui, sans-serif"
  mono:
    fontFamily: "'SF Mono', 'Cascadia Code', Consolas, ui-monospace, monospace"
rounded:
  DEFAULT: "0.75rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
spacing:
  section-gap: "2rem"
  page-max: "84rem"
components:
  button:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1rem"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.xl}"
  input:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
  navigation:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  message:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  composer:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.xl}"
  status:
    backgroundColor: "{colors.terminal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
  chrome:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.DEFAULT}"
  meta:
    backgroundColor: "{colors.terminal}"
    textColor: "{colors.ink-subtle}"
    rounded: "{rounded.sm}"
  state-success:
    backgroundColor: "{colors.terminal}"
    textColor: "{colors.success}"
    rounded: "{rounded.sm}"
  state-warning:
    backgroundColor: "{colors.terminal}"
    textColor: "{colors.warning}"
    rounded: "{rounded.sm}"
  state-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
  state-info:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.info}"
    rounded: "{rounded.sm}"
---

# Grok Build Desktop Design System

## Overview

### Creative North Star

The visual reference is a **quiet developer cockpit**: the material calm of macOS utility panels, the information density of a modern code editor, and a single electric-azure signal that moves through the workspace when work is active. Surfaces should feel layered and intentional, never glossy or toy-like.

### Product context and register

- **Audience and primary job:** Developers and technical teams use one Windows desktop window to manage projects, converse with Grok CLI, review plans, inspect diffs, run terminals, and manage extensions.
- **Target market(s) and evidence:** Windows 10/11 desktop; the repository README explicitly positions the product as a Windows AI programming workbench.
- **Locale(s) and language policy:** Simplified Chinese is the current product language. Keep copy concise and natural; preserve English for code, model names, paths, and CLI output. Do not add locale-specific decorative motifs.
- **Usage scene:** Long-lived desktop sessions with frequent task switching, keyboard input, streaming output, and dense code-oriented information.
- **Register:** PRODUCT / developer tooling. It should feel dependable, calm, and fast rather than promotional.
- **Memorable signature:** A restrained azure “activity signal” appears in active navigation, streaming states, focus rings, and the composer send control; it is the only expressive accent that should repeat across the shell.
- **Restraint:** Windows window controls remain on the right in the familiar minimize/maximize/close order. Avoid macOS traffic-light controls, loud gradients, oversized hero copy, and gratuitous card decoration.
- **Anti-references:** Generic SaaS dashboards, neon cyberpunk IDEs, skeuomorphic glassmorphism, and three-color traffic-light chrome. Those references reduce trust and compete with code content.
- **Token ownership/runtime mapping:** `DESIGN.md` is the design-context source; runtime values are mapped in the canonical token block at the end of `src/index.css`. New visual values should be added there first and consumed through semantic custom properties. Drift is checked by the premium project audit and the verification commands recorded in `UX-CONTRACT.md`.

## Colors

The canvas (`#F4F6FA`) is a cool, low-contrast blue-gray that lets white work surfaces read as deliberate islands. The sidebar (`#EDF1F7`) is one tonal step darker, not a second theme. Primary action uses electric azure (`#0A84FF`) with a deeper pressed/hover value (`#0066D6`) and a pale tint (`#E8F3FF`) for selection. Text hierarchy is ink (`#172033`), muted ink (`#5F6B7A`), and subtle ink (`#8994A5`); separators use `#DCE3EC` rather than black. Semantic green, amber, red, and indigo are reserved for status meaning. The terminal is the only intentionally dark surface (`#141922`). Focus is a 3px azure ring; selection is an azure-tinted fill plus a 1px inner edge. Dark mode is not currently exposed, so do not add dark-only colors without a product decision.

## Typography

The sans stack uses the system UI face first so Windows text remains crisp while macOS-like metrics are available where present. Chinese falls back to PingFang SC / Microsoft YaHei UI. Body copy is 13px with 1.55 line-height; titles use 16–22px semibold with slight negative tracking; metadata is 11–12px and muted. Monospace is reserved for paths, commands, diffs, and model technical values. Never use all-caps for Chinese UI. Long labels wrap or ellipsize only when the full value remains available through focus, click, or an explicit preview.

## Layout

The shell is a three-zone workspace: a resizable 252px navigation rail, a 6px separator handle, and a flexible center; the optional right inspector is 300px minimum. The title bar is 38px. Use 8px as the base rhythm, with 12px control gaps, 16px surface padding, and 24px page breathing room. Keep the conversation column readable with a 960px soft max-width while allowing wide code/diff panels to use the available center. The app remains viewport-bounded at the shell level; individual panels own their scroll region. Reserve space for streaming indicators, attachment previews, and status cards to avoid layout jumps.

## Elevation & Depth

Hierarchy comes from tonal layering first, a 1px line second, and a restrained shadow third. Primary cards use `0 8px 24px rgba(23,32,51,.06)`; overlays use `0 20px 50px rgba(23,32,51,.16)`. Blur is limited to title bar, side rails, and overlays and is always paired with a solid fallback. Never use a shadow on every list row or on terminal/code surfaces; those areas should feel anchored.

## Shapes

Controls use 8–10px radii; cards and panels use 14–16px; the composer is the expressive exception at 18px. Pills are reserved for status chips and compact context labels. Dividers are 1px and low-contrast. Icon buttons are square with a 34px minimum hit area and visible focus. Avoid nested rounded rectangles unless the inner element is a distinct interactive control.

## Components

### Foundational visual states

Default controls are quiet white surfaces with a cool line. Hover lifts contrast with a subtle tint; focus-visible uses the azure ring; active/pressed removes the lift and deepens the tint; selected uses `primary-tint`; disabled lowers contrast without changing dimensions; busy keeps the same geometry and shows a compact indicator. Success, warning, and error always pair color with an icon or text. The default app-owned loader is a small azure orbit/pulse, not a full-screen spinner. Skeletons are not used unless a screen has enough predictable geometry to justify them.

### Buttons and actions

Primary actions are azure filled, 34–36px tall, semibold, and used once per local action group. Secondary actions are white with a line. Ghost actions are transparent and appear only in toolbars or navigation. Destructive actions use the danger token and an explicit verb; do not color routine close/cancel controls red. Icon-only buttons retain an accessible label and a 34px target. Busy state does not shrink or move the button.

### Navigation and data display

The sidebar is persistent on desktop, with a blue-tinted selected row and a small activity signal for unread/running sessions. Tabs are peer views with a 2px azure underline and no pill container. Lists use stable row height, clear hover, and no perpetual animation. Diff and terminal surfaces preserve monospace alignment. Right inspectors use a quiet tinted rail and a sticky header.

The marketplace is a browse-and-install catalog variant: a compact extension context strip leads into a source rail and a separate discover/install panel. Plugin cards use stable vertical geometry, source and capability metadata, and one clear footer action; loading, empty, and retry states reserve the same visual space as their content where practical.

### Forms and overlays

Inputs use 8px radii, 1px lines, 34–38px height, and a visible focus ring. Search fields own a clear action when non-empty. Dialogs are app-owned, mounted at `document.body` through `ModalPortal`, and bounded by the viewport so sidebars and blurred surfaces cannot clip them. They enter with a short opacity/scale ease-out; closing is opacity-only. Selected options use the same pale azure fill, edge signal, and check/radio affordance across login, settings, model, permission, and automation choices. Toasts remain compact and non-blocking. The settings overlay is a full work surface, not a floating marketing modal.

### Iconography

Use the existing inline SVG icon family with a consistent 1.7px stroke, round caps, and optical alignment to 16px labels. Filled status dots are allowed only for state. Text labels stay visible for primary actions and navigation items; icon-only controls require `aria-label`.

### Motion

Motion is calm and state-led. Use 160–220ms ease-out for hover/focus and 220–320ms for surface entrance. A first-load shell reveal may stagger direct children by 40–60ms once; list rows should not replay on every render. Active streaming uses a subtle azure pulse and a 1.2s orbit; send/stop transitions are immediate enough to feel responsive. Removing content fades before collapsing. Respect `prefers-reduced-motion: reduce`: remove transforms and stagger delays, keep only ≤100ms opacity feedback, and keep loading state visible without pulsing aggressively.

## Content and data visualization

Use concise Chinese action verbs: “新建任务”, “继续”, “停止”, “重试”, “查看变化”. Success copy describes the completed thing; errors explain recovery without exposing raw backend details. Paths and commands are monospace and copyable. Status colors are semantic and never the sole signal. When chart-like summaries appear, use azure, indigo, green, amber, and red in that order, with text labels or values alongside.

## Do's and Don'ts

- **Do:** Keep one clear azure signal for focus, selection, and active work.
- **Do:** Preserve Windows window chrome placement and stable panel geometry while refining the surfaces inside it.
- **Don't:** Add macOS traffic-light buttons, rainbow accents, or heavy blur to every element.
- **Don't:** Animate routine list rendering, move controls between idle/loading states, or rely on color alone for status.
