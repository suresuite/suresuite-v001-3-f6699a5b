
## Scope

Focused pass on the four pages you called out. No visual redesign — same tokens, same fonts. Goal is fewer words, clearer hierarchy, consistent chrome (`PageHeader` + `PageLayout`), and navigation that never goes missing.

## 1. Homepage — split public landing from authed app

Today `/` renders `GettingStarted` behind `ProtectedRoute` with the sidebar. It becomes a real marketing landing.

- New `src/pages/Landing.tsx` — public, no sidebar, no `Navbar`. Sections:
  - Top bar: wordmark left, **Log in** / **Sign up** right.
  - Hero: one headline, one subline, primary CTA "Get started", secondary "Sign in".
  - 3 value tiles (data → simulate → decide) using existing card + icon tokens.
  - Footer with product links + `/help`.
  - No stats, no long paragraphs. Scannable in under 5 seconds.
- `App.tsx` routing changes:
  - `/` → `Landing` (public). If session exists, redirect to `/app`.
  - Move current `GettingStarted` to `/app` (protected, keeps sidebar). This is the authed "home".
  - Update `Navbar` "home" link and any hardcoded `/` navigations to `/app`.
- Reuse existing color tokens and typography — no new palette.

## 2. Platform Overview (`/admin`) — scannable metrics, less text

`AdminDashboard.tsx` + `AdminLayout` chrome.

- Header: title only. Remove the descriptive subtitle (title already says it).
- KPI grid: keep 8 cards, but group into two rows with a subtle divider:
  - Row A — Reach: Orgs · Projects · Users · Active (7d).
  - Row B — AI spend: Requests · Cost today · Cost MTD · Avg $/request.
- Card refinements (no new tokens):
  - Larger, tabular-nums value (`text-2xl` → `text-[26px] font-semibold tabular-nums`).
  - Tiny label above (`text-[11px] uppercase tracking-wide`).
  - Add a small trend caret / delta slot when data is trivially derivable (today vs. yesterday from existing query); otherwise omit — no fake data.
  - Highlight the two "money" cards with a soft ring for emphasis.
- Top tables:
  - Rename to "Top users" and "Top orgs" — drop the "by AI cost (MTD)" tail; add "MTD" as a badge in the header row instead.
  - Right-align numeric columns, `tabular-nums`, zebra rows off, tighter row height.
  - Empty state: single line + subdued icon (not the current colspan paragraph).
- Skeleton loader instead of centered spinner (matches other admin pages).

## 3. Subusers — `AdminUsers` list + `AdminUserAccess` detail

You landed on the detail page (`/admin/users/:id`), so both get the pass.

**AdminUsers (list)**
- Compact toolbar row: search left, role/status filters middle, "Invite user" right. Remove any duplicate helper text under the title.
- Table: name + email in one cell (name bold, email muted below), role as a subtle badge, last active as relative time, actions collapsed into a `…` menu (Open access, Reset password, Disable).
- Empty state: icon + "No users match these filters" + a clear-filters button.

**AdminUserAccess (detail)**
- Header: user name + email inline; remove "role: X" from subtitle and show it as a badge next to the name. Keep Back + Preview buttons.
- Remove every `Section` subtitle that just paraphrases the title:
  - "Pages" — drop "Which pages this user can open…". The tri-toggle column headers already say it.
  - "Features" — drop "Cross-page abilities…".
  - "AI models" — drop the two explanatory paragraphs; keep a single inline hint only when `all_allowed` is true, as a muted chip on the section header.
  - "Budgets & limits" — drop "Spend caps and rate limits…"; usage stats above already communicate this.
- Convert the four "Section" blocks to shared `Card` + `CardHeader/CardContent`, matching the rest of the admin surface. One consistent card style, one radius, one shadow.
- Group budget inputs into 2 rows (Money / Rate) with a subtle label, replacing the 5-across grid that currently wraps awkwardly at this viewport.
- Super-admin banner: keep, but move to a single `Badge` next to the name instead of the full-width strip.

## 4. Help — wrap in the app shell

- `App.tsx`: wrap the `/help` route tree in `PageLayout` (same `Navbar` + collapse state as everything else). The route becomes:
  ```
  <Route path="/help" element={<PageLayout><DocsLayout /></PageLayout>}>
  ```
- `DocsLayout.tsx`:
  - Remove its own `min-h-screen` outer wrapper and the "App" return button in the top bar (redundant once the sidebar is present).
  - Drop the sticky docs top bar's left panel-toggle on desktop (sidebar already handles nav); keep search, theme, font-size.
  - Shrink docs top bar height to align with `PageHeader` height so the two chromes read as one product.
  - Keep the docs three-pane inside the sidebar-offset content area — no layout math changes needed since `PageLayout` already offsets `ml-14/48`.
- Result: the app sidebar is always visible, active state on Help lights up, docs internal nav still works.

## 5. Consistency touch-ups (only where the four pages touch shared code)

- `PageHeader`: allow omitting `subtitle` cleanly (already supported) — audit each of the touched pages and remove subtitles that only repeat the title.
- Shared empty-state pattern for the admin tables in scope: centered icon (16px muted), one-line message, optional action. Extract as `<TableEmpty />` in `src/components/shared/`.
- Shared `<StatCard />` in `src/components/shared/` used by Platform Overview and the budget usage strip on User Access — one source of truth for KPI styling.

## Out of scope (per your answer)

- Other pages (Data Manager, Simulation Lab, Networks, Policies, Profile, other admin pages) — not touched this pass.
- Palette / typography changes.
- Functional/business-logic changes.

## Technical notes

- Files created: `src/pages/Landing.tsx`, `src/components/shared/StatCard.tsx`, `src/components/shared/TableEmpty.tsx`.
- Files modified: `src/App.tsx` (routes for `/`, `/app`, `/help` wrapping), `src/components/Navbar.tsx` (home link → `/app`), `src/pages/admin/AdminDashboard.tsx`, `src/pages/admin/AdminUsers.tsx`, `src/pages/admin/AdminUserAccess.tsx`, `src/components/docs/DocsLayout.tsx`.
- No DB, no edge function, no schema changes.
- Verify after build: `/` public renders without auth; authed user hitting `/` redirects to `/app`; `/help` shows the app sidebar with Help highlighted; admin pages render without regressions on 1042px width (your current viewport).

Approve and I'll implement in that order: routes/landing → Help wrapping → Platform Overview → Subusers.
