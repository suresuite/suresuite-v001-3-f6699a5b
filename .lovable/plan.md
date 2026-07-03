# UI Polish Plan — Sharper, Modern, Clean

Goal: keep the existing neutral palette and light/dark themes, but tighten every surface so the app reads like Linear / Vercel / Claude — precise spacing, crisper borders, quieter chrome, better typography rhythm. **No color scheme change, no logic change.**

---

## 1. Foundation refinements (`src/index.css`, `tailwind.config.ts`)

Keep the current HSL palette. Add precision on top of it.

- **Borders**: current `--border` is `0 0% 90%` (too heavy). Split into two tokens:
  - `--border` → `0 0% 92%` (subtle, default)
  - `--border-strong` → `0 0% 85%` (dividers, focused inputs)
  - Dark: `0 0% 16%` / `0 0% 22%`
- **Surfaces**: add `--surface-elevated` (`0 0% 99%` light / `0 0% 6%` dark) so cards can sit on `--background` with a real 1px separation instead of relying on shadows.
- **Shadows**: replace default Tailwind shadows with tight, low-alpha ones (Linear-style):
  - `--shadow-xs: 0 1px 2px hsl(0 0% 0% / 0.04)`
  - `--shadow-sm: 0 2px 4px -1px hsl(0 0% 0% / 0.06), 0 1px 2px hsl(0 0% 0% / 0.04)`
  - `--shadow-md: 0 8px 24px -8px hsl(0 0% 0% / 0.12)`
- **Radii**: standardize on 6 / 10 / 14 (current mix of `rounded-md`, `rounded-lg`, `rounded-2xl`, `rounded-full` is inconsistent). Composer → `rounded-xl` (14). Cards → `rounded-lg` (10). Buttons/inputs → `rounded-md` (6). Pills/avatars → `rounded-full` only.
- **Focus ring**: `2px solid hsl(var(--foreground) / 0.6)` with 2px offset — same everywhere.
- **Typography**:
  - Geist Sans is already set — good. Add `font-feature-settings: "cv11","ss01","ss03"` for the sharper Geist glyphs.
  - Tighten heading tracking to `-0.015em`; body stays at 0.
  - Introduce `text-[13px]` as the default UI size (currently jumps between 12/14) and reserve 14 for message body.
  - Tabular numbers (`font-variant-numeric: tabular-nums`) on all numeric cells, KPIs, timestamps.
- **Motion**: single `--ease` = `cubic-bezier(0.2, 0, 0, 1)`, standard durations 120/180/240ms.

## 2. App shell (`Navbar`, `PageLayout`, `Footer`)

- Reduce Navbar visual weight: remove any inner borders on nav items, use a single 2px left accent bar + subtle `bg-surface-elevated` for active state.
- Icon size lock: 16px in nav, 14px inline in body.
- Collapsed sidebar: exactly 56px wide, icons perfectly centered on 8px grid.
- Remove `<Footer>` on workspace routes (Intelligence, Simulation Lab, Policies, Data Manager) — it competes with the working canvas. Keep on marketing/help pages.
- Page padding: unify to `px-8 py-6` (currently `px-12 py-6` on Intelligence, other values elsewhere).

## 3. Page headers (`PageHeader`)

- Reduce vertical footprint: title 20px semibold, subtitle 13px muted on one line beneath, 16px bottom margin (currently oversized).
- Add a thin `border-b border-border` under headers on workspace pages for clear structural separation.

## 4. Project Intelligence surface (highest-impact area)

`ProjectIntelligence.tsx`, `ChatSidebar.tsx`, `ChatWorkspace.tsx`, `ChatComposer.tsx`

- **Outer frame**: drop the rounded card wrapping the whole workspace. Full-bleed with a single top border below the header — feels like a real app, not a widget.
- **Sidebar**:
  - Width 260px (from 280), single 1px right border, `bg-background` (not card).
  - "New chat" as a full-width ghost button with `+` icon + `⌘K` kbd hint on the right.
  - Search input: borderless, 32px tall, with left icon.
  - Group threads by **Today / Yesterday / Previous 7 days / Older** — small uppercase 11px muted labels.
  - Thread row: 32px tall, single line truncate, three-dot menu appears on hover only.
- **Empty state**:
  - Single centered column, max 640px.
  - Greeting: 24px medium, one line.
  - Agent tiles: 2×3 grid, each tile 14px padding, icon + name + one-line description, subtle hover lift.
  - Composer sits directly below — same rhythm as Claude.
- **Active agent**: move from centered chip to a small persistent strip above the message area (icon + name + × to change), always visible.
- **Composer polish**:
  - `rounded-xl`, `border-border-strong`, `shadow-xs`, `bg-surface-elevated`.
  - Focus state: border becomes `foreground/40` + `shadow-sm`.
  - Inner divider between textarea and control row uses `border-border` (subtle).
  - Send button 32×32, `rounded-lg` (not full circle) for a sharper look; disabled state uses `bg-muted` with no border.

## 5. Chat messages (`MessageBubble`, `ToolCallBadge`)

- Assistant messages: no background, no border, just text on canvas (per chat-ui-composition guidance).
- User messages: right-aligned bubble, `bg-foreground text-background`, `rounded-2xl rounded-tr-sm`, max-width 80%.
- Consistent 20px vertical gap between turns.
- Markdown: tighter prose (`prose-sm`), code blocks with `bg-surface-elevated`, 1px border, mono font, no default prose margins on first/last child.
- Tool call: collapsed accordion by default, status pill (running/done/error) with color-coded dot, chevron on the right, expands to show input/output in mono.
- Replace spinner with shimmer "Thinking…" text.

## 6. Shared components sweep

- **Buttons**: enforce three sizes (28 / 32 / 36) and three variants (primary, secondary, ghost). Consistent icon spacing (`gap-1.5`).
- **Cards**: one treatment — `bg-surface-elevated border border-border rounded-lg`. Remove nested borders where cards sit inside cards.
- **Inputs**: 32px default height, 6px radius, focus ring uses the shared token — audit all forms.
- **Tables**: sticky header with `bg-surface-elevated`, no zebra, 40px row height, hover tint, right-aligned numerics with tabular-nums, mono for IDs.
- **Empty states**: single reusable `<EmptyState icon title description action />` so every page speaks the same visual language.
- **Toasts** (sonner): bottom-right, single line, 13px, icon on left.

## 7. Consistency cleanup

- Delete unused `src/App.css` (Vite leftover).
- Grep for hardcoded colors (`text-white`, `bg-black`, `bg-[#...]`, hex literals) in `src/components/**` and replace with tokens.
- Standardize icon imports/sizes across pages.
- Standardize spacing scale usage — nothing outside Tailwind's 1/2/3/4/6/8/12/16 steps.

---

## Out of scope

- No palette/theme change (light + dark stay as-is).
- No logic, data, hook, edge-function, or route changes.
- No new dependencies.
- No feature additions or removals.

## Suggested execution order

1. Tokens + Tailwind extensions (foundation).
2. App shell + PageHeader (global lift).
3. Project Intelligence surface end-to-end (biggest perceived win).
4. Message + tool call rendering.
5. Shared components sweep (buttons, cards, inputs, tables, empty states).
6. Consistency cleanup pass (delete `App.css`, hardcoded-color audit).

Each step ships independently and is visually verifiable in the preview.
