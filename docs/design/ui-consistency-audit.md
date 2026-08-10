# UI Consistency Audit — Super Admin & Developer API

**Scope**: bring `src/pages/admin/*` + `src/components/admin/AdminLayout.tsx` and
`src/pages/DeveloperApi.tsx` in line with the design language set by the mature pages
(Landing `/`, Policies, Simulation Lab, Project Manager, Project Intelligence).

**Status**: batches **B0–B4 executed** (one commit per batch) and verified by the §3-B6
Playwright pass. B5 (lint guardrail) remains open. Execution deviations are recorded in §5.

> Path note: the task brief lists `src/pages/admin/AdminLayout.tsx`; the file actually lives at
> **`src/components/admin/AdminLayout.tsx`**. All admin pages import it from there.

---

## 1. Design Contract (the reference language, as actually built)

Extracted from `src/index.css`, `tailwind.config.ts`, `src/components/shared/PageLayout.tsx`,
`PageHeader.tsx`, `Navbar.tsx`, `NavItem.tsx`, `Footer.tsx`, `src/pages/Landing.tsx`,
`ProjectPolicies.tsx`, `SimulationLab.tsx` (cross-checked against `DataManager.tsx`,
`ProjectIntelligence.tsx`, and the policies/sim component families).

### C1 — Containers
- **Landing / public**: `mx-auto max-w-6xl px-6`; top bar `h-14` (`Landing.tsx:121`).
- **App pages**: full-width inside the sidebar offset — wrapper is exactly **`px-12 py-6`**
  (`ProjectPolicies.tsx:76`, `SimulationLab.tsx:253`, `DataManager.tsx:710`,
  `ProjectIntelligence.tsx:123`). **No `max-w-*`, no `mx-auto`** on app pages. The
  `px-12`/`py-6` values are load-bearing: `PageHeader` bleeds out with `-mx-12 -mt-6`
  (`PageHeader.tsx:21`), so any other padding breaks the sticky header.
- App content sits on `bg-[hsl(var(--surface-sunken))]` supplied by `PageLayout.tsx:18` —
  pages never re-tint the canvas.

### C2 — Section rhythm
- **Landing**: `py-24` per section, sections separated by `border-t border-border/60`
  (`Landing.tsx:199,329,507,530`); hero `pt-20 pb-24`.
- **App**: `py-6` page padding; vertical stacks are `flex flex-col gap-6` / `space-y-6`
  (`ProjectPolicies.tsx:104,120`), with `gap-3`/`gap-4` inside a section. Spacing steps used:
  1.5 / 2 / 3 / 4 / 6 / 8 (i.e. 6–32 px); nothing off-scale.

### C3 — Page header
- Every app page renders **`PageHeader`**: sticky `top-0 z-40`, `-mx-12 -mt-6 mb-5`,
  `bg-header-background/95 backdrop-blur-md border-b border-header-border`, inner
  `px-8 py-3.5` (`PageHeader.tsx:21-22`).
- Title: `text-[15px] font-semibold leading-tight truncate` (`PageHeader.tsx:24`).
  Subtitle: `text-[12px] text-muted-foreground mt-0.5` (`PageHeader.tsx:28`).
- Right side: controls at `h-8` (buttons, `PageHeader.tsx:41`) / `h-9` (project selects,
  `ProjectPolicies.tsx:85`, `SimulationLab.tsx:263`).

### C4 — Cards & surfaces
- Base card: shadcn `Card` = `rounded-sm border border-border bg-card` (`ui/card.tsx:12`) —
  4px per C9, and **no hover lift**: with one radius product-wide the shadow change was the
  only thing left implying depth, and this system separates by value, not depth.
  Static content cards flatten the shadow to **`shadow-xs`** (`StatCard.tsx:20`,
  `AdminUserAccess.tsx:461` — the one admin file already on-language).
- Flat toolbar/strip variant: `rounded-md border bg-card px-3 py-2.5`
  (`SimulationLab.tsx:395`, `PolicyVersionBar.tsx:102`).
- KPI tiles: **`StatCard`** only — label `text-[11px] font-medium uppercase tracking-wide
  text-muted-foreground`, value `text-[26px] font-semibold tabular-nums`, `p-4`
  (`StatCard.tsx:24-40`).
- **No gradients, no glassmorphism** (backdrop-blur exists only on the two sticky headers).
  Corner radius is a single 4px value everywhere (C9) — there is no `rounded-xl+` and no
  `rounded-sm`-as-exception, because `rounded-sm|md|lg` now all resolve to the same 4px.

### C5 — Typography
- App page title = the 15 px PageHeader title; in-content section headings are
  `text-sm font-semibold` (`AdminUserAccess.tsx:463`, `GuidePanel.tsx:120`).
- Micro-labels: `text-[10px]`/`text-[11px]` `uppercase tracking-wide text-muted-foreground`
  (`StatCard.tsx:25`, `ParameterSheet.tsx:29`, `PolicyDefaultsCard.tsx:191`); the landing
  kicker adds `font-mono tracking-[0.2em]` (`Landing.tsx:20`) — landing only.
- Meta text: `text-[11px]`/`text-xs text-muted-foreground` (`SimulationLab.tsx:369,411`).
- **Mono** (`font-mono`, JetBrains) for IDs, hashes, key prefixes, scope names, model/action
  codes, code snippets (`DeveloperApi.tsx:154,545`, `AdminAudit.tsx:106`,
  `AdminUserAccess.tsx:356`). Timestamps stay proportional `text-xs text-muted-foreground`.
- Numeric columns and KPI values: `tabular-nums` (`StatCard.tsx:30`, `AdminDashboard.tsx:242`).

### C6 — Color
- **Semantic tokens only**: `border-border`, `bg-card`, `text-muted-foreground`,
  `text-destructive`, `bg-muted`, `bg-accent`, `surface-elevated/sunken/dense`, `header-*`.
- **Canvas and rule values** (`index.css` `:root`) — the canvas carries the separation, so
  cards stay `#fff` and are never tinted:

  | Token | Value | Used for |
  |---|---|---|
  | `--surface-sunken` / `--surface-dense` | `0 0% 92%` | the page canvas (`PageLayout`) |
  | `--card` | `0 0% 100%` | every card; never tinted |
  | `--border` / `--input` | `0 0% 88%` | control and in-card borders |
  | `--zinc-border` | `#e0e0e3` | 1px rules **inside** a white card, and small controls |
  | `--hair-rule` / `--hair-border` / `--hair-divider` / `--sim-divider` | `#d4d4d4` | any 1px rule that touches the canvas, plus card outer borders and row dividers |
  | `--header-border` | `0 0% 83%` | the sticky page-header's bottom border — a rule on the canvas, so it tracks `--hair-rule` |
  | `--muted-foreground` | `0 0% 42%` | quiet text |
  | `--zinc-quiet` / `--hair-quiet` / `--ledger-quiet` | `#6b6b6b` | one quiet ink, replacing the three greys the ledger / hair / sim dialects each carried |
  | `--brand-ink` | `#171717` | the L2 table column row |

- **A 1px rule directly on the canvas must use `--hair-rule`, never `--zinc-border` or
  `hsl(var(--border))`** — at a 92% canvas an `#e0e0e3` rule is a 4% step and vanishes.
  Rules inside a white card keep `--zinc-border`.
- Text that was `text-muted-foreground` on a **dark or tinted** fill keeps its old value:
  `#6b6b6b` is darker than before and can fall under contrast there.
- Status tints use the canonical recipe
  `bg-{emerald|amber}-500/10 text-{…}-700 dark:text-{…}-300 border-{…}-500/30`
  (`ProvenanceBadge.tsx:15-16`, `DataMapGrid.tsx:20-27`).
- `bg-black` / `text-white` / hex values are confined to: the always-dark landing viewports
  and the two "KEPT VERBATIM" landing bands (`Landing.tsx:84,250,559`), and the funding
  `Footer` (`Footer.tsx:11`). Never in app pages.

### C7 — Iconography
- lucide-react only. Sidebar nav: size 14 (`Navbar.tsx:149`). Standard buttons/menu items:
  `h-4 w-4`. Compact `h-8` buttons, tab triggers, dense contexts: `h-3.5 w-3.5`
  (`SimulationLab.tsx:358`, `ProjectPolicies.tsx:110`). Inline-in-badge/table: `h-3 w-3`.

### C8 — Empty states, badges, buttons, tables
- Table empty state: shared **`TableEmpty`** (`shared/TableEmpty.tsx`) — icon +
  `text-sm text-muted-foreground` + optional action.
- Badges: shadcn variants only (`secondary` for neutral/active, `outline` for meta,
  `destructive` for bad) at `text-[10px]`/`text-[11px]`; **no filled `default` badges** in
  the mature pages. Scope/code badges add `font-mono`.
- Buttons: shadcn variants/sizes only; `size="sm"` = `h-8` (`ui/button.tsx:24`); icon-only
  actions use `size="icon"`.
- Tables: shadcn `Table`; **dense data tables carry uppercase micro-headers**
  (`text-[10px]/[11px] uppercase tracking-wide text-muted-foreground` —
  `PolicyDefaultsCard.tsx:191`, `PolicyOverridesTable.tsx:85`); the shadcn `TableHead`
  default (`h-12 text-sm font-medium`) is the *un-styled* fallback, not the language.
- Table shells: card treatment per C4 — target `rounded-lg border border-border bg-card
  shadow-xs overflow-hidden`.

### C9 — Radii
- **One radius, 4px, product-wide.** `--radius: 4px` in `index.css`, and
  `tailwind.config.ts` maps `rounded-sm`, `rounded-md` and `rounded-lg` all to it — so
  corner size never implies hierarchy or depth. No `rounded-xl+`, no arbitrary
  `rounded-[3px]`/`[5px]`.
- **`rounded-full` for true circles only**: status dots, avatars, spinners, the numbered
  Quick Start step circles, the 2px emphasis rule, and the toggle/switch track and knob.
  Every pill-shaped chip, badge and button is 4px.
- The one deliberate exception is the concentric inner radius on segmented controls
  (`rounded-[1px]`/`rounded-[2px]` on a button nested inside a 4px track with 2–3px
  padding), where matching the outer radius would read as a defect.

---

## 2. Audit — deviations per file

Severity: **P0** breaks the language · **P1** visible drift · **P2** polish.

### 2.1 `src/components/admin/AdminLayout.tsx` (shell for all 9 admin pages)

| Ref | Location | Current | Expected (contract) | Sev |
|---|---|---|---|---|
| A1 | `AdminLayout.tsx:46` | `mx-auto max-w-[1400px] px-6 py-6` | `px-12 py-6`, full-width, no `mx-auto`/`max-w` (C1) | **P0** |
| A2 | `AdminLayout.tsx:47-55` | Hand-rolled non-sticky header block instead of `PageHeader` | `PageHeader` (sticky, header-background, border-b) with `title`/`subtitle`/`rightContent` (C3) | **P0** |
| A3 | `AdminLayout.tsx:49` | Title `text-2xl font-semibold tracking-tight` | PageHeader title `text-[15px] font-semibold leading-tight` (C3) | **P0** (falls out of A2) |
| A4 | `AdminLayout.tsx:51` | Description `text-sm text-muted-foreground` | PageHeader subtitle `text-[12px] text-muted-foreground` (C3) | P1 (falls out of A2) |
| A5 | `AdminLayout.tsx:66-77` | Sub-nav items `text-sm`, icons `h-4 w-4`, active `bg-accent text-accent-foreground` | Match main sidebar weight: `text-xs font-medium`, icons `h-3.5 w-3.5` (size 14), active `bg-muted/80 text-foreground` + `before:` left bar, hover `hover:bg-muted/50` (`NavItem.tsx:23-27`) | P1 |
| A6 | `AdminLayout.tsx:47` | `mb-6` below header | `PageHeader` supplies `mb-5`; remove local margin (C3) | P2 (falls out of A2) |
| A7 | `AdminLayout.tsx:57` | Sub-nav column has no visual separation from content | Optional: `border-r border-border/60 pr-4` or keep bare — decide once, apply once | P2 |

### 2.2 `src/pages/admin/AdminDashboard.tsx`

| Ref | Location | Current | Expected | Sev |
|---|---|---|---|---|
| D1 | `AdminDashboard.tsx:228-233` | `TableHead` at shadcn default (`h-12 text-sm font-medium`) | Dense header: `text-[11px] uppercase tracking-wide text-muted-foreground h-9` (C8) | P1 |
| D2 | `AdminDashboard.tsx:168` | `space-y-8` | `space-y-6` rhythm (C2) | P2 |
| D3 | `AdminDashboard.tsx:219` | `Card className="shadow-xs"` but base Card keeps `hover:shadow-md` | Static cards: suppress hover lift (part of the shared `SectionCard`, §3 B0) | P2 |

Otherwise on-language: uses `StatCard`, `TableEmpty`, `tabular-nums`, `text-[11px] uppercase`
section labels (`AdminDashboard.tsx:201`).

### 2.3 `src/pages/admin/AdminUsers.tsx`

| Ref | Location | Current | Expected | Sev |
|---|---|---|---|---|
| U1 | `AdminUsers.tsx:136-141` | Search `Input` default height (`h-10`) `w-64` | `h-9 w-64` to match header-row controls (C3) | P1 |
| U2 | `AdminUsers.tsx:149` | Table shell `rounded-md border border-border bg-card` | `rounded-lg … shadow-xs overflow-hidden` (C4/C8) | P2 |
| U3 | `AdminUsers.tsx:152-162` | Default `TableHead` styling | Dense uppercase header (C8) | P1 |
| U4 | `AdminUsers.tsx:166-170` | Hand-rolled loading row (`py-8` + spinner) | Shared `TableLoading` row (§3 B0) | P2 |
| U5 | `AdminUsers.tsx:222-227` | Numeric cells (Req/Cost MTD) lack `tabular-nums` | `text-right tabular-nums` (C5) | P2 |
| U6 | `AdminUsers.tsx:249-263` | Actions cell mixes `outline` + `ghost` text buttons | One actions pattern: ≤2 actions inline `ghost`; 3+ → `DropdownMenu` (as `AdminProjects.tsx:241`) | P1 |
| U7 | `AdminUsers.tsx:255` | Icon `h-3 w-3` inside an `h-8` button | `h-3.5 w-3.5` (C7) | P2 |

### 2.4 `src/pages/admin/AdminUserAccess.tsx` — closest to on-language; local `Section` (461) is the pattern to extract

| Ref | Location | Current | Expected | Sev |
|---|---|---|---|---|
| UA1 | `AdminUserAccess.tsx:529` | `bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400` | Canonical status recipe `bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30` (C6) | P2 |
| UA2 | `AdminUserAccess.tsx:574` | `text-emerald-600 dark:text-emerald-400` | Same recipe family: `text-emerald-700 dark:text-emerald-300` (C6) | P2 |
| UA3 | `AdminUserAccess.tsx:310` | Ad-hoc error box (`border-destructive/40 bg-destructive/10 …`), duplicated in AdminRoles | Shared `ErrorBanner` or `Alert variant="destructive"` (§3 B0) | P2 |
| UA4 | `AdminUserAccess.tsx:522-524` | `ToggleGroupItem h-7` | `h-8` — only height on the control scale (C8) | P2 |
| UA5 | `AdminUserAccess.tsx:547` | `UsageStat` tile on `bg-background` | `bg-card` mini-stat, label `font-medium` — extract as `StatMini` or a `StatCard` compact variant (C4) | P2 |
| UA6 | `AdminUserAccess.tsx:459-473` | `Section` defined locally | Promote to shared `SectionCard` — it *is* the contract card (`rounded-lg border border-border bg-card p-4 shadow-xs`) | P2 |

### 2.5 `src/pages/admin/AdminRoles.tsx`

| Ref | Location | Current | Expected | Sev |
|---|---|---|---|---|
| R1 | `AdminRoles.tsx:93` | Table shell `rounded-md …` | `rounded-lg … shadow-xs` (C4) | P2 |
| R2 | `AdminRoles.tsx:96-103` | Default `TableHead` | Dense uppercase header (C8) | P1 |
| R3 | `AdminRoles.tsx:91` | Section spacing `mb-8` | `space-y-6` on the parent (C2) | P2 |
| R4 | `AdminRoles.tsx:150-152` | Hand-rolled loading block | Shared `TableLoading`/spinner pattern | P2 |
| R5 | `AdminRoles.tsx:155-157` | Duplicated ad-hoc error box (= UA3) | Shared `ErrorBanner` | P2 |

### 2.6 `src/pages/admin/AdminOrganizations.tsx`

| Ref | Location | Current | Expected | Sev |
|---|---|---|---|---|
| O1 | `AdminOrganizations.tsx:122-158` | **No empty state at all** — an empty result renders a bare table | `TableEmpty` row (C8) | **P1** |
| O2 | `AdminOrganizations.tsx:110-120` | Default `TableHead` | Dense uppercase header | P1 |
| O3 | `AdminOrganizations.tsx:108` | Shell `rounded-md …` | `rounded-lg … shadow-xs` | P2 |
| O4 | `AdminOrganizations.tsx:145-155` | Three inline ghost text-buttons per row | 3+ actions → `DropdownMenu` (match `AdminProjects.tsx:241-268`) | P1 |
| O5 | `AdminOrganizations.tsx:147,150` | Icons `h-3 w-3` in `h-8` buttons | `h-3.5 w-3.5` (moot if O4 lands — menu items use `h-4 w-4`) | P2 |
| O6 | `AdminOrganizations.tsx:136` | Cost cell lacks `tabular-nums` | `text-right tabular-nums` | P2 |
| O7 | `AdminOrganizations.tsx:123-128` | Hand-rolled loading row | `TableLoading` | P2 |

### 2.7 `src/pages/admin/AdminProjects.tsx`

| Ref | Location | Current | Expected | Sev |
|---|---|---|---|---|
| P1a | `AdminProjects.tsx:200-205` | Hand-rolled empty row (`No projects match.`) | `TableEmpty` with clear-search action (as `AdminUsers.tsx:172-182`) | P1 |
| P2a | `AdminProjects.tsx:180-191` | Default `TableHead` | Dense uppercase header | P1 |
| P3a | `AdminProjects.tsx:178` | Shell `rounded-md …` | `rounded-lg … shadow-xs` | P2 |
| P4a | `AdminProjects.tsx:166-171` | Search `Input` default `h-10` | `h-9` (= U1) | P1 |
| P5a | `AdminProjects.tsx:243` | Icon-only trigger uses `size="sm"` (has `px-3`) | `size="icon"` (C8) | P2 |
| P6a | `AdminProjects.tsx:194-199` | Hand-rolled loading row | `TableLoading` | P2 |

### 2.8 `src/pages/admin/AdminModels.tsx`

| Ref | Location | Current | Expected | Sev |
|---|---|---|---|---|
| M1 | `AdminModels.tsx:224-249` | No empty state (empty catalog → bare table) | `TableEmpty` | P1 |
| M2 | `AdminModels.tsx:213-222` | Default `TableHead` | Dense uppercase header | P1 |
| M3 | `AdminModels.tsx:211` | Shell `rounded-md …` | `rounded-lg … shadow-xs` | P2 |
| M4 | `AdminModels.tsx:235` | Model code cell plain `text-muted-foreground` | `font-mono text-xs text-muted-foreground` (C5 — codes are mono) | P2 |
| M5 | `AdminModels.tsx:236-238` | Price/context cells lack `tabular-nums` | `text-right tabular-nums` | P2 |
| M6 | `AdminModels.tsx:132,150,158,166,178,190` | Dialog `Label` without `text-xs` (every other admin dialog uses `Label className="text-xs"`) | `text-xs` labels | P2 |
| M7 | `AdminModels.tsx:226-230` | Hand-rolled loading row | `TableLoading` | P2 |

### 2.9 `src/pages/admin/AdminUsage.tsx`

| Ref | Location | Current | Expected | Sev |
|---|---|---|---|---|
| G1 | `AdminUsage.tsx:193-198` | Hand-rolled empty row | `TableEmpty` | P1 |
| G2 | `AdminUsage.tsx:173-185, 242-250, 285-294` | Default `TableHead` ×3 tables | Dense uppercase headers | P1 |
| G3 | `AdminUsage.tsx:171,240,284` | Shells `rounded-md …` ×3 | `rounded-lg … shadow-xs` | P2 |
| G4 | `AdminUsage.tsx:206,254` | `model_code` plain `text-xs` | `font-mono text-xs` (C5) | P2 |
| G5 | `AdminUsage.tsx:207-211,299-307` | Token/cost/latency/bytes columns lack `tabular-nums` | `text-right tabular-nums` | P2 |
| G6 | `AdminUsage.tsx:232-239, 277-283` | Secondary sections are bare heading + paragraph + table with only `mt-6` | Wrap in `SectionCard` (heading inside card, per AdminUserAccess) or add `border-t border-border/60 pt-6` section separation (C2/C4) | P2 |
| G7 | `AdminUsage.tsx:187-191` | Hand-rolled loading row | `TableLoading` | P2 |

### 2.10 `src/pages/admin/AdminAudit.tsx`

| Ref | Location | Current | Expected | Sev |
|---|---|---|---|---|
| L1 | `AdminAudit.tsx:93-98` | Hand-rolled empty row | `TableEmpty` | P1 |
| L2 | `AdminAudit.tsx:77-85` | Default `TableHead` | Dense uppercase header | P1 |
| L3 | `AdminAudit.tsx:75` | Shell `rounded-md …` | `rounded-lg … shadow-xs` | P2 |
| L4 | `AdminAudit.tsx:107-110` | Target type/id plain text | id fragment `font-mono` (C5) | P2 |
| L5 | `AdminAudit.tsx:111-117` | before/after JSON payloads in proportional `text-xs` | `font-mono text-[11px]` (C5 — it's code) | P2 |
| L6 | `AdminAudit.tsx:87-91` | Hand-rolled loading row | `TableLoading` | P2 |

### 2.11 `src/pages/DeveloperApi.tsx` — uses `PageLayout`+`PageHeader` correctly; drift is in the content

| Ref | Location | Current | Expected | Sev |
|---|---|---|---|---|
| V1 | `DeveloperApi.tsx:468` | Wrapper `px-12 pt-6` (no bottom padding) | `px-12 py-6` — the app-standard wrapper (C1) | P2 |
| V2 | `DeveloperApi.tsx:540` | Env badge `variant="default"` for `live` (filled primary) | No filled badges in the language: `live` → `outline` (mono text), `test` → `secondary` (C8) | P1 |
| V3 | `DeveloperApi.tsx:555` + `keyStatus` at 416-422 | `active` status badge `variant="default"` (filled) | `active` → `secondary` (matches `AdminUsers.tsx:219`), `expired` → `outline`, `revoked` → `destructive` (C8) | P1 |
| V4 | `DeveloperApi.tsx:503-514, 647-652, 784-792, 820-827, 854-860` | Default `TableHead` across all 5 tables | Dense uppercase headers (C8) | P1 |
| V5 | `DeveloperApi.tsx:517-528, 751-752` | Hand-rolled loading + empty rows | `TableLoading` / `TableEmpty` | P1 |
| V6 | `DeveloperApi.tsx:490, 615, 638, 682, 723` | Bare `Card` (inherits `shadow-sm hover:shadow-md` lift on static content) | `shadow-xs`, no hover lift — i.e. `SectionCard` (C4) | P2 |
| V7 | `DeveloperApi.tsx:169-181` + inline `<code>` chips at 628, 759, 766, 988 | Local `Snippet` + repeated `rounded-md border border-border bg-muted/50 …` code chips | Extract shared `ApiCodeBlock` (titled, copy button) + `InlineCode` chip — pattern repeats 3+ times (§3 B0) | P2 |
| V8 | `DeveloperApi.tsx:713` | `🔑` emoji in Alert body copy | No emoji anywhere else in the product; drop it | P2 |

**Not violations** (already on-language, keep): `IdCell` mono copy-buttons (148-167), scope
badges `font-mono text-[10px]` (545), `h-3.5 w-3.5` icons in `h-8` buttons, show-once/rotate
dialog structure, `TableEmpty`-style microcopy.

---

## 3. Remediation plan — ordered mechanical batches

Order: shared primitives → AdminLayout shell → admin pages top-to-bottom → DeveloperApi →
visual QA. Each batch is independently committable; run the QA pass (B6) after B1 and again
at the end.

### B0 — Shared primitives (new files; no page behavior changes)
**Files**: `src/components/shared/` (+ re-exports in `shared/index.ts`)

1. **`SectionCard.tsx`** — lift `Section` from `AdminUserAccess.tsx:459-473` verbatim:
   `<section className="rounded-lg border border-border bg-card p-4 shadow-xs">` with
   `title` (`text-sm font-semibold`), optional `badge`, optional `description`
   (`text-xs text-muted-foreground`). Consumers: AdminUserAccess (swap local), AdminUsage
   (G6), DeveloperApi (V6 — allow `padding="lg"`/`p-6` prop or `className` passthrough to
   preserve CardHeader/CardContent spacing).
2. **`TableShell.tsx`** (or just an exported const) —
   `className="rounded-lg border border-border bg-card shadow-xs overflow-hidden"`.
   Replaces every `rounded-md border border-border bg-card` table wrapper.
3. **`TableLoading.tsx`** — sibling of `TableEmpty`: `<TableRow><TableCell colSpan …
   className="py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin
   text-muted-foreground" /></TableCell></TableRow>`.
4. **Dense table-header class** — export from `shared/index.ts`:
   `export const TH_DENSE = 'h-9 text-[11px] uppercase tracking-wide text-muted-foreground';`
   Applied as `<TableHead className={TH_DENSE}>` (append `text-right` etc. as-is). Do **not**
   change `ui/table.tsx` defaults — other surfaces depend on them.
5. **`ErrorBanner.tsx`** — the destructive box from `AdminUserAccess.tsx:310-312`
   (also `AdminRoles.tsx:155-157`), one implementation.
6. **`ApiCodeBlock.tsx` + `InlineCode.tsx`** — lift `Snippet` from `DeveloperApi.tsx:169-181`
   and the `code` chip (`rounded-md border border-border bg-muted/50 px-3 py-1.5 font-mono
   text-[11px]`).

**Risk**: none (additive).

### B1 — AdminLayout shell (fixes A1–A7 for all 9 admin pages at once)
**File**: `src/components/admin/AdminLayout.tsx`

| Before | After |
|---|---|
| `mx-auto max-w-[1400px] px-6 py-6` (L46) | `px-12 py-6` |
| L47-55 header block | `<PageHeader title={title} subtitle={description} rightContent={actions} />` |
| `mb-6 flex items-start justify-between gap-4` | *(delete — PageHeader owns spacing)* |
| nav item `text-sm` (L68) | `text-xs font-medium` |
| `isActive ? 'bg-accent text-accent-foreground font-medium'` (L70) | `bg-muted/80 text-foreground before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-full before:bg-primary` (+ `relative` on the link base, per `NavItem.tsx:24-26`) |
| `hover:bg-accent/50` (L71) | `hover:bg-muted/50` |
| `<Icon className="h-4 w-4" />` (L75) | `<Icon className="h-3.5 w-3.5" />` |
| `grid-cols-[180px_1fr]` (L57) | keep (works at px-12); optionally `160px` |

Notes: `PageHeader`'s `-mx-12 -mt-6` requires the `px-12 py-6` wrapper — these two swaps ship
together. `description` in AdminUserAccess passes a ReactNode with badges; `PageHeader.subtitle`
accepts ReactNode but wraps in a `truncate` div — verify badge rendering (drop `truncate`
conflict by keeping the badge row compact; it already is `inline-flex`).

**Risk**: **layout-shifting** (title moves into a sticky bar; content column widens on large
screens). This is the intended language change. Every admin page inherits it with zero edits.

### B2 — Admin tables sweep (mechanical, all admin pages)
**Files**: AdminDashboard, AdminUsers, AdminRoles, AdminOrganizations, AdminProjects,
AdminModels, AdminUsage, AdminAudit.

Per file, same four swaps:
1. Shell: `rounded-md border border-border bg-card` → `TableShell` / `rounded-lg border
   border-border bg-card shadow-xs overflow-hidden` (U2, R1, O3, P3a, M3, G3, L3).
2. Headers: every `TableHead` gains `TH_DENSE` (D1, U3, R2, O2, P2a, M2, G2, L2).
3. Loading rows → `TableLoading` (U4, R4, O7, P6a, M7, G7, L6).
4. Empty rows → `TableEmpty` — **add** where missing: AdminOrganizations (O1), AdminModels
   (M1); **swap** hand-rolled: AdminProjects (P1a), AdminUsage (G1), AdminAudit (L1).
5. Numerics: add `tabular-nums` to right-aligned numeric cells (U5, O6, M5, G5).
6. Mono: `font-mono text-xs` on `AdminModels.tsx:235`, `AdminUsage.tsx:206,254`;
   `font-mono` on `AdminAudit.tsx:109` id slice; `font-mono text-[11px]` on
   `AdminAudit.tsx:111-117` JSON diff (L4, L5, M4, G4).

**Risk**: visual-only.

### B3 — Admin per-page one-offs
- **AdminUsers**: `Input` → `h-9` (U1, `AdminUsers.tsx:140`); actions cell → keep the
  `outline` Access button + move Suspend/Enable into it or convert both to a consistent pair
  of `ghost` buttons with `h-3.5 w-3.5` icons (U6, U7). *(Smallest mechanical fix: make both
  `ghost`, fix icon size; dropdown conversion optional.)*
- **AdminProjects**: `Input` → `h-9` (P4a); `size="sm"` → `size="icon"` on the `…` trigger
  (P5a).
- **AdminOrganizations**: replace the 3 inline row buttons with the `DropdownMenu` pattern
  copied from `AdminProjects.tsx:241-268` (O4/O5).
- **AdminUserAccess**: emerald badge → canonical recipe (UA1/UA2:
  `bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400` →
  `bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30`;
  `text-emerald-600 dark:text-emerald-400` → `text-emerald-700 dark:text-emerald-300`);
  local `Section` → shared `SectionCard` (UA6); error box → `ErrorBanner` (UA3);
  `UsageStat` → `bg-card` + `font-medium` label (UA5); `ToggleGroupItem h-7` → `h-8` (UA4).
- **AdminRoles**: `mb-8` → parent `space-y-6` (R3); error box → `ErrorBanner` (R5).
- **AdminModels**: dialog `Label` → `Label className="text-xs"` ×6 (M6).
- **AdminUsage**: wrap the matrix + file-usage sections in `SectionCard` with their headings
  and descriptions inside (G6).
- **AdminDashboard**: `space-y-8` → `space-y-6` (D2).

**Risk**: visual-only, except the Organizations dropdown (interaction change, same actions).

### B4 — DeveloperApi
**File**: `src/pages/DeveloperApi.tsx`
1. `px-12 pt-6` → `px-12 py-6` (V1).
2. Badge variants (V2/V3): in `keyStatus` (L416-422) `active` → `variant: 'secondary'`;
   env badge (L540) `live` → `outline` + `font-mono text-[10px]`, `test` → `secondary`.
3. Tables: same B2 sweep — `TH_DENSE` on all 5 tables, `TableLoading`/`TableEmpty` for
   L517-528 (V4, V5).
4. Cards: add `shadow-xs` (twMerge drops the base `shadow-sm`) to the five `Card`s, or
   migrate the two simple ones to `SectionCard` (V6).
5. Replace local `Snippet` with shared `ApiCodeBlock`; swap the four inline code chips to
   `InlineCode` (V7).
6. Remove the `🔑` emoji at L713 (V8).

**Risk**: visual-only.

### B5 — Guardrail (optional, cheap)
Add a lint/grep CI check for app pages (`src/pages`, `src/components` minus `Landing.tsx`,
`Footer.tsx`): forbid `max-w-[`, `bg-black`, `text-white`, `bg-[#`, `text-[#`. Keeps the
contract from regressing.

### B6 — Visual QA pass
Playwright at **1280×800**, screenshot each route: `/admin`, `/admin/users`,
`/admin/users/:id`, `/admin/roles`, `/admin/organizations`, `/admin/projects`,
`/admin/models`, `/admin/usage`, `/admin/audit`, `/developer` — plus `/policies` and
`/simulation-lab` as controls. Checklist per shot:
- sticky header identical to Policies/SimLab (height, blur, border);
- content starts at the same left edge (`px-12`) as the control pages;
- table headers uppercase-micro, shells `rounded-lg` + `shadow-xs`;
- no filled-primary badges; no `h-10` inputs in header rows;
- empty states render `TableEmpty` (force with a filtered search that matches nothing).

---

## 4. Summary of counts

| File | P0 | P1 | P2 |
|---|---|---|---|
| AdminLayout | 3 (A1–A3) | 2 | 2 |
| AdminDashboard | – | 1 | 2 |
| AdminUsers | – | 3 | 4 |
| AdminUserAccess | – | – | 6 |
| AdminRoles | – | 1 | 4 |
| AdminOrganizations | – | 3 | 4 |
| AdminProjects | – | 3 | 3 |
| AdminModels | – | 2 | 5 |
| AdminUsage | – | 2 | 5 |
| AdminAudit | – | 2 | 4 |
| DeveloperApi | – | 4 | 4 |

The three P0s all live in `AdminLayout.tsx` and are fixed by batch **B1** alone, which
re-skins all nine admin pages in one edit. Everything else is the B0 primitives plus
mechanical class swaps.

---

## 5. Execution notes (build turn)

Where the mechanical plan met reality, the following adjustments were made:

- **UA1 emerald recipe**: applied as `<Badge variant="outline" className="bg-emerald-500/10
  text-emerald-700 dark:text-emerald-300 border-emerald-500/30">` rather than leaving the
  badge on the `default` variant with the recipe classes — the `default` variant's
  `hover:bg-primary/80` survives twMerge and would flash primary on hover. This matches how
  the recipe's source (`ProvenanceBadge.tsx:26`) applies it.
- **R4 (AdminRoles loading)** skipped: the loading state is a page-level block rendered
  *before* both tables exist, not a table row — `TableLoading` (a `TableRow`) does not apply.
  The existing block is byte-identical to the AdminUserAccess spinner pattern, which §2.4
  treats as on-language. Same reasoning for the DeveloperApi notebook-panel spinner
  (the non-table half of V5); the keys-table loading/empty rows were swapped as planned.
- **AdminRoles role-column headers**: the `capitalize` on role names was dropped when
  `TH_DENSE` landed — `uppercase` and `capitalize` are conflicting `text-transform` values
  and the dense-header language is uppercase (C8).
- **D3 (dashboard card hover lift)**: applied as `shadow-xs hover:shadow-xs` on the
  `TopTable` card; converting it to `SectionCard` would have discarded its
  CardHeader/CardContent(p-0) layout for no visual gain.
- **B0 re-exports**: `TableEmpty` (pre-existing) was added to `shared/index.ts` alongside the
  new primitives so table pages import from one barrel.

### 5.1 Follow-up consistency pass (same branch)

A second sweep tightened the table contract without changing the design language:

- **`TableLoading` upgraded** from a single spinner row to **`Skeleton` rows** (default 3,
  `h-4` bar per row at real row height) so tables don't jump when data lands. Same API
  (`colSpan`, optional `rows`); every consumer picked it up unchanged.
- **Primary name columns** truncate at `max-w-[280px]` (Users, Organizations, Projects,
  Models, Dashboard top tables, DeveloperApi key name).
- **Actions columns** normalized to `w-[1%]` heads + `whitespace-nowrap` cells instead of
  magic pixel widths (`w-[120px]`/`w-[60px]`/`w-[80px]`).
- **Numeric formatting**: token counts in AI Usage now `toLocaleString()`; `tabular-nums`
  extended to the remaining numeric cells (org members/projects, user budget, capability
  matrix passing, DeveloperApi requests-30d — now right-aligned).
- **Kept as-is, deliberately**: `TH_DENSE` uppercase micro-headers (C8 — the language of the
  mature pages; a sentence-case/default-`TableHead` scheme was considered and rejected as a
  revert of C8), `h-9` header-row search inputs (C3), `TableShell` for single-table pages
  (a `CardHeader` title would duplicate the sticky `PageHeader` title), and the compact
  `UsageStat` minis on the user-access page (C4 density).
