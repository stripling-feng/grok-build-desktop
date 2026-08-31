# UX Contract

## Product context

- Audience: Developers and technical teams using Grok CLI from a Windows desktop workbench.
- Primary jobs: Manage projects and sessions, chat with Grok, approve/execute plans, inspect diffs, use the terminal, and manage extensions/settings.
- Target market(s): Windows 10/11 desktop.
- Active locales: Simplified Chinese UI; technical values preserve their source language.
- Language/content register and native-review policy: Concise, direct Chinese product copy; code/CLI output is not translated.
- Timezone/calendar policy: Follow the local Windows timezone for displayed automation times; no custom calendar UI in this surface.
- Accessibility target: WCAG 2.2 AA baseline for owned controls.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Product scope | `README.md` | Product documentation | 2026-08-31 |
| Session/plan behavior | `src/lib/plan-flow.ts` | Domain implementation | 2026-08-31 |
| Electron capability boundary | `electron/shared.ts`, `electron/preload.ts` | API/runtime contract | 2026-08-31 |
| Permission modes | `electron/shared.ts`, `src/components/Composer.tsx` | Product/runtime contract | 2026-08-31 |
| Deletion/retention | No separate policy in repository | Unresolved; do not infer | 2026-08-31 |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`
- Token ownership model: `DESIGN.md` documents the system; `src/index.css` is the runtime canonical adapter.
- Runtime design-system/token source: `src/index.css` canonical token block.
- Mapping/export/adapters: CSS custom properties consumed by shared components and page classes.
- Token drift gate: `python C:/Users/feng/.codex/plugins/cache/openai-curated-remote/frontend-design-premium/1.4.0/skills/frontend-design-premium/scripts/audit_project.py . --mode strict`, plus typecheck/build/tests.
- Supported themes: Light Windows desktop surface with macOS-inspired layering; no user-selectable dark theme currently exposed.
- Design-context owner/review policy: Update `DESIGN.md` and the canonical CSS token block in the same change when system decisions change.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Scrollbar | Global stylesheet | `DESIGN.md` + `src/index.css` | compact geometry only | computed style / visual inspection |
| Select/Listbox | Native `<select>` controls | Windows/Electron platform behavior | native | keyboard + platform popup |
| Date | Native time input | Windows/Electron platform behavior | native | keyboard + platform picker |
| Form | Existing shared `.field` and component styles | `DESIGN.md` + sibling screens | create / edit | typecheck + flow tests |
| Toast/status | Existing app status surfaces | `src/App.tsx`, `src/components/StatusCard.tsx` | status / error | flow tests + visual inspection |
| Plan flow | `src/lib/plan-flow.ts` + `PlanPanel` | plan-flow domain contract | clarify / approve / execute | `npm test` |
| Window controls | `TitleBar` + Electron window API | Windows platform contract | minimize / maximize / close | Electron smoke check |

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Button | quiet white or azure primary | tint + slight lift | 3px azure ring | deeper tint | same geometry, muted | compact indicator | danger text/icon |
| Icon button | transparent 34px target | tinted square | visible ring | pressed tint | muted | stable target | danger only when action is destructive |
| Input | white field + line | line contrast | azure ring | n/a | muted fill | preserve value | inline message + `aria-invalid` where applicable |
| Search | debounced app-owned search | clear affordance | azure ring | n/a | muted | preserve query | explicit retry/error surface |
| Textarea | stable min-height, `resize: none` | line contrast | azure ring | n/a | muted | preserve draft | inline recovery |
| Table/list | stable rows | row tint | keyboard-visible | selected tint | muted | reserved loader region | empty/no-results/error states |

## Dataset navigation

- Admin tables: Not applicable; dense lists and inspectors are the primary data surfaces.
- Exploratory lists: Sidebar projects/threads, marketplace and automation cards.
- URL state: Electron navigation is in-memory; preserve local panel state where existing code already does so.
- Page size: Not applicable to the current shell.
- Empty/no-results/error/loading treatment: Keep the footprint stable, name the state, and provide the nearest recovery action.
- Back/scroll restoration: Preserve active session and panel state when switching pages; each panel owns its scroll container.
- Selection scope: Project/thread selection is single-item and keyboard/pointer accessible.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create task | New-task action / composer send | Running indicator, stable composer | Active session | Session appears/selects | Keep draft, show retry/error | Composer remains usable | `src/App.tsx` |
| Approve plan | Plan action | Plan progress state | Execution in same session | Plan status updates | Preserve revision and explain | Plan action remains reachable | `src/lib/plan-flow.ts` |
| Search | Sidebar input | Debounced local/app search | Filtered list | Results update in place | Keep query and show no-results/error | Return focus to search | `src/components/Sidebar.tsx` |
| Browse/install plugin | Marketplace tab, source rail, install action | Source/catalog busy state; stable card geometry | Installed plugin remains in catalog | Status badge and updated count | Inline error state with retry; preserve source filter | Return focus to the triggering tab/action | `src/components/Settings.tsx`, `src/components/WorkspacePages.tsx` |
| Cancel/back | Close/stop action | Immediate local state | Previous surface | No success toast required | Preserve safe draft/state | Restore triggering control | `src/App.tsx` |

## Navigation and responsive behavior

- Route document title policy: `Grok 桌面端` shell title; navigable settings/workspace surfaces should keep titles honest if route-level titles are added later.
- Route error / 403 page behavior: Keep app chrome navigable and use an app-owned explanatory state; do not redirect authenticated users to login for missing permission.
- Breadcrumb/tab/route-state policy: Tabs are peer views; active tab is visually and semantically distinct.
- Sidebar/drawer/bottom-sheet transformation: Persistent desktop sidebar; preserve project/thread access when the window narrows.
- Responsive table strategy: Prefer horizontal scroll or inspector detail for code/diff data; never hide important paths silently.
- Truncation/full-value access: Copy/preview actions remain available for paths and identifiers.
- Focus restoration and sticky-obstruction policy: Escape closes the topmost layer and returns focus to its trigger; sticky headers do not cover focused content.

## Overlays and feedback

- Dialog primitive: Existing app-owned modal components.
- Portal policy: Every app-owned dialog and the full-page settings surface is mounted through `ModalPortal` at `document.body`, so clipping, blur, and overflow on the sidebar or workspace cannot contain it. Anchored menus, tooltips, and context menus intentionally remain beside their trigger.
- Marketplace variant: The plugin catalog uses a compact source rail, a dedicated discover/install panel, stable non-square cards, explicit capability/status metadata, and app-owned loading, empty, and retry states. It remains a browse surface rather than inheriting the visual hierarchy of the settings form.
- Destructive confirmation levels: Keep routine close/cancel non-destructive; explicit destructive copy for irreversible actions.
- Toast placement/duration/deduplication: Existing app status surfaces; do not flood or expose secrets.
- Alert/banner scope and persistence: Inline for field/action errors, panel-level for stream/plan failures.
- Tooltip delay/dismissal: Existing title/tooltip affordances remain supplemental, never the only instruction.
- Unsaved-changes behavior: Preserve composer and settings drafts where existing code supports it.
- Layer/z-index contract: Dialog/overlay > drawer/inspector > popover/menu > toast/status. The titlebar remains above the page overlay so Windows window controls stay reachable.

## Async and resilience

- Mutation default: Pessimistic for permission, plan execution, and destructive operations; preserve pending geometry.
- Idempotency and duplicate-submit policy: Disable duplicate activation while a request is pending; keep control dimensions stable.
- Auto-save/draft recovery: Composer drafts persist per session/project through existing local storage behavior.
- Offline/read-stale/write behavior: Preserve readable local state and provide retry when IPC/API work fails; do not claim success without confirmation.
- Retry/backoff/timeout behavior: Follow existing Electron service behavior; UI must retain input and offer explicit recovery.
- Version conflict and multi-tab behavior: Single Electron window is canonical; refresh/reconcile before replacing newer data.
- Session expiry/re-authentication: Preserve safe drafts through the existing login flow.
- Long-running progress and return path: Show plan/stream progress in context; users may switch sessions without losing state.
- Stale-request cancellation/invalidation and pending-state ownership: Existing `activeViewVersionRef`/stream guards remain authoritative.
- Dialog/form preservation and retry after mutation failure: Preserve values and reopen the failed action in place.

## Validation

- Schema/validation layer: Existing component-level validation and Electron service responses.
- Trigger timing: On submit or explicit field interaction; do not interrupt IME composition.
- Error summary/inline policy: Inline where correction is needed; panel status for stream/service failures.
- Server error mapping: Use concise actionable copy, keep raw diagnostics in logs/console only.
- Sensitive-value handling: Do not place API keys, tokens, or raw backend errors in visual status or logs shown to other users.
- `noValidate`, first-invalid focus, duplicate-submit prevention, unsaved changes, and submit recovery: Preserve existing behavior; any new form must follow the shared field contract.

## Permission and clipboard

- Permission UI strategy: Explain disabled actions with their reason; use app-owned denied states when the boundary matters.
- Clipboard copy policy: Keep copy buttons adjacent to paths/logs; do not put secret values in toast copy.
- Disabled-state explanation: Use visible helper text or a supplemental tooltip, never color alone.

## Migration status

- Migration ledger location: This contract plus the changed CSS/component history.
- Canonical primitives and owners: Shared component class families in `src/index.css` and existing React components.
- Current risk-prioritized slices: Shell/titlebar, sidebar navigation, composer, message stream, inspectors, settings/marketplace cards.
- Legacy import/token enforcement: New styles use semantic CSS variables; legacy selectors remain as compatibility adapters until their consumers are removed.
- Rollout/rollback and removal gates: CSS-only visual changes are reversible; retain existing behavior tests and build checks before removing legacy selectors.

## Verification

- Required static commands: `npm run typecheck`, `npm test`, `npm run build`, premium strict audit.
- Browser/device/locale/theme matrix: Electron desktop at 1320×860 and a narrow window; Simplified Chinese; reduced motion; Windows controls right-aligned.
- Accessibility checks: Keyboard focus-visible, icon labels, stable busy/disabled geometry, contrast, reduced motion.
- Native-language/domain review and target-user evidence: Chinese developer copy reviewed against README and existing UI terminology; no separate reviewer available in repository.
- Component-state/visual regression coverage: Local Electron smoke capture plus source-state inspection; no Storybook harness in repository.
- Canonical sibling flow used for comparison: Chat/composer + plan sidebar and Settings overlay.
- Project audit command/result: Run before handoff and record result in final response.
- CRUD full-flow evidence: Not applicable to this visual pass; plan/session flows covered by existing tests.
- Failure-path evidence: Existing test suite plus build/typecheck; visual pass preserves existing error surfaces.
