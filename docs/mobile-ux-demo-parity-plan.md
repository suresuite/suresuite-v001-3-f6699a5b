# Mobile UX — demo parity plan

**Goal.** Bring the shipped mobile UI up to the prototype ("the demo") it was
specified from, without changing desktop and without changing behaviour.

**Constraints, restated as gates.** Every item below is checked against these; an
item that cannot satisfy all four is not in this plan.

1. **UI only.** No query, RPC, Zod schema, engine parameter, validation rule,
   routing logic or state shape. Only JSX structure, `className`, CSS, `aria-*`,
   `title`, and purely visual local state.
2. **Desktop is frozen.** Every change is expressed as *mobile value + `md:`
   restores the existing literal*. A 1280px screenshot diff against `main` must
   be empty.
3. **Fluid, not fixed.** Sized with `clamp()` / `minmax(0,1fr)` / `min-w-0` so
   the layout holds across the whole device matrix, not just one width.
4. **One breakpoint: 768px.** `md:`. The only sanctioned exceptions are in
   `docs/mobile-ui-spec.md` §6.1.

Rulebook: `docs/mobile-ui-spec.md`. This file is the *work list*; the spec is the
*law*. Where they disagree, the spec wins.

---

## 1. What "the demo" is, and where it lives

The demo is the mobile prototype the current spec was reverse-engineered from. It
was committed under `handoff/` and removed in `e0bb85c` ("Delete handoff
directory"). Nothing is lost — it is fully recoverable:

```bash
git show e0bb85c^:"handoff/SuReSuite Live Demo (standalone).html" > demo.html
git show e0bb85c^:handoff/PAGES.md                                > PAGES.md
git show e0bb85c^:handoff/FINAL.md                                > FINAL.md
git show e0bb85c^ --stat -- handoff/shots   # 39 reference screenshots
```

| Artifact | What it is |
|---|---|
| `SuReSuite Live Demo (standalone).html` | Self-extracting bundle; a ~698 KB single-page Design Canvas of every mobile surface |
| `Mobile Page Book.dc.html` | Renderer for `PAGES.md`, one screen per page |
| `PAGES.md` (1669 lines) | **The design record** — 25 entries, each with intent, phone layout, repo mapping, and a per-screen `status:` |
| `FINAL.md` (715 lines) | The remaining delta as literal find/replace strings |
| `shots/01…39*.png` | Reference screenshots, one per surface |

`docs/mobile-ui-spec.md` in the repo (691 lines) is the maintained successor to
`handoff/mobile-ui-spec.md` (663 lines) and supersedes it.

**These files are reference material, not product.** This plan deliberately does
not re-add `handoff/` to the tree. If the team wants them back, that is a
separate call.

---

## 2. What already matches — verified, do not redo

Re-derived against the working tree, not taken on trust. The mobile foundations
landed; this is a finishing job, not a rebuild.

| Area | Evidence |
|---|---|
| iOS safe-area chain | `index.html` carries `viewport-fit=cover`; `Footer` offsets by the tab bar's border; `PageLayout` **measures** the credit bar with a `ResizeObserver` instead of hard-coding it |
| Fluid gutter + type tokens | `PAGE_GUTTER` / `PAGE_GUTTER_BLEED` in `shared/PageBody.tsx`; `--fs-*` clamps in `index.css` |
| `PageHeader` | Mobile back slot, 44px touch floor below `md`, `md:` releases to the audit's `h-8`/`h-9` |
| Bottom tab bar | `MobileNav.tsx` — the demo's five roots (Home · Policies · Lab · AI · More), heights exported so `PageLayout` reserves *from* them |
| The three missing routes | `/profile`, `/developer`, `/forbidden` all exist in `App.tsx` |
| Lab rail collapse | `SimulationLab.tsx:317` and `StageRail.tsx:58` (`RAIL_LABEL_COL`) already stack below `md` |
| Policy sheet widths | `ParameterSheet.tsx:55` is `w-full sm:w-[392px]`; `FocusedStage.tsx:188` is `w-[min(340px,calc(100vw-1.5rem))]` |
| Policies header overflow | `ProjectPolicies.tsx` uses the `md:contents` split so the mobile right slot stays within its three-control cap |
| Fixed 192px label rails | `PolicySetupBar.tsx:269`, `RunValidateStage.tsx:1315` — both stack below `md` |
| Mechanical guard | `scripts/audit-adaptive-ui.mjs` + baseline, wired into CI |

**Audit status today:** `node scripts/audit-adaptive-ui.mjs --all` →
**7 violations across 284 files**, and 5 of the 7 are in one legacy page.

---

## 3. The gap list — verified against the working tree

Ordered by user impact. Line numbers are current, not `FINAL.md`'s (they drifted).

### G1 — `StagePolicyTable.tsx` is desktop-only · **highest impact**

76 KB, the largest UI file in the repo, and **zero `md:` branches**. It is the
grid a planner spends most of their time in.

The table already scrolls (`:1480` is `max-h-[614px] overflow-auto`), so the
column set is preserved correctly — §2.7 is satisfied in spirit. What is missing
is everything that makes that scroll *usable* on a phone:

| # | Gap | Where | Fix |
|---|---|---|---|
| G1.1 | No frozen identifying column — scroll sideways and you lose which row you are editing | first `<th>` / first `<td>` of each row | `FROZEN_CELL_ON_TINT` on the `<th>`, `FROZEN_CELL` on the `<td>`. Both already exist in `shared/index.ts:38-40` and both release at `md:static`, so desktop is byte-identical |
| G1.2 | No scroll affordance | under the container at `:1480` | The spec's line: `swipe the table sideways for the remaining columns`, `md:hidden` |
| G1.3 | 15px touch targets on the primary row controls | `:1004`, `:1672` | Spec §2.4 pattern — `-m-[14px] box-content p-[14px] md:m-0 md:p-0`. Grows the target to 43px; the negative margin returns the space, so **nothing moves visually** |

`FROZEN_CELL` is already used in 10 other files — this is applying an established
repo pattern to the one surface that never got it, not inventing anything.

*Note:* `max-h-[614px]` exceeds a landscape phone's ~402px viewport. Worth a
`max-h-[min(614px,70vh)]`; flagged, low priority.

### G2 — `PolicySetupBar.tsx` chip rows push the page sideways

Three chip groups marked `shrink-0`, so they force the bar past the viewport —
the exact defect spec §2.5 rule 2 exists to prevent.

| Line | Current | Fix |
|---|---|---|
| 215 | `flex shrink-0 items-center gap-2` | `flex min-w-0 flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap` |
| 227 | `inline-flex shrink-0 items-center gap-1.5` | `inline-flex min-w-0 items-center gap-1.5 md:shrink-0` |
| 250 | `flex shrink-0 items-center gap-2.5` | `flex min-w-0 flex-wrap items-center gap-2.5 md:shrink-0 md:flex-nowrap` |

Line 87's segmented control (`inline-flex shrink-0 … p-[3px]`) is fixed-width
chrome — **leave it**. Line 63's `h-[26px]` chip needs `min-h-11 md:min-h-0`
(touch floor), not a shrink change.

### G3 — Nine fixed-width selects that cannot shrink

Each is a `SelectTrigger` with a hard pixel width and an `h-7`/`h-8`/`h-9`
height. **I resolved the Case A/B question `FINAL.md` left open** by reading each
one: all six page-level selects sit inside `PageHeader`'s `rightContent`.

**Case A — inside `rightContent` (6).** The right slot is `shrink-0` beside a
`min-w-0 flex-1 truncate` title, so `w-full` would starve the title. Use a
clamp; `md:` is unnecessary because the `vw` term exceeds the literal at every
width ≥768, pinning it to the desktop value automatically.

The repo already has the landed precedent —
`ProjectPolicies.tsx:183` is `w-[clamp(130px,42vw,210px)]`. Match it.

| File : line | Literal to preserve |
|---|---|
| `SimulationLab.tsx:290` | `200px` · ✅ done (G10) |
| `ProcessLevelNetwork.tsx:1153` | `160px` |
| `ProcessLevelNetwork.tsx:1233` | `180px` |
| `FirmLevelNetwork.tsx:1193` | `180px` |
| `ProductLevelNetwork.tsx:940` | `180px` |
| `ProjectPolicies.tsx:183` | ✅ already done — the reference |

Do **not** add `min-h-11` to a Case A trigger: `PageHeader` already applies a
floor to its slot, and a second one double-pads the header.

**Case B — page content (4).** Full width below `md`, literal above:
`h-7 min-h-11 w-full min-w-0 text-xs md:min-h-0 md:w-[160px]`.

`sim/ExperimentDesigner.tsx:279` (160px) · `:337` (260px) ·
`sim/PlaybookPicker.tsx:55` (220px) · `sim/ReplicationSeedExplorer.tsx:80`
(210px, inside `cn()`). **Both ✅ done (G10);** `ExperimentDesigner.tsx` is
imported by nothing and was left alone.

Where a Case B select sits in a flex row beside a label, that row also needs
`flex-col items-stretch md:flex-row md:items-center`.

### G4 — `BulkEditDialog` is a centred dialog on a phone

`BulkEditDialog.tsx:50` is `<DialogContent className="max-w-lg">`. A centred
dialog is the wrong container on mobile; the demo uses a bottom sheet.

**Shell only.** Its logic, its `targetKeys` contract and its copy ("Empty fields
are skipped so the override stays sparse") stay verbatim.

### G5 — `GettingStarted.tsx` never got the redesign · ✅ **done, mobile only**

This is the app's **Home tab**, and it is the one page still in the old
marketing dialect: gradients, `hover:shadow-xl hover:-translate-y-1`, centred
`text-3xl font-bold`, colour-tiled feature cards, `bg-black` sections.

It owns **5 of the 7** remaining audit violations:

```
GettingStarted.tsx:78   bg-black/text-white outside landing, /auth and Footer
GettingStarted.tsx:254  lg:grid-cols-3
GettingStarted.tsx:412  lg:grid-cols-3
GettingStarted.tsx:414  lg:col-span-1
GettingStarted.tsx:445  lg:col-span-2   (+ bg-gradient-to-br)
```

The demo (`shots/03-home.png`) replaces the whole marketing stack with two
compact blocks:

1. **"Where you left off"** — a resume card: project name, `1 284 nodes · 3
   echelons · MTO`, a three-line readiness checklist (data imported / policies
   configured / validated run) with right-aligned status, and one full-width
   black primary action.
2. **"Quick start"** — three numbered rows (amber discs, the sanctioned
   `#F8D448` use), each a title + mono sub-line + `›`.

`PAGES.md` entry 04 records this as *"shell landed · remaining · **one open
question (the visual-dialect divergence)**"* — the prototype and the shipped
page disagree about what this page *is*, not merely how it is laid out.

> **This is the one item that needs a product decision before code.** Everything
> else in this plan is a mechanical UI fix. Replacing the marketing page with the
> resume card changes what a returning user sees first. Options in §5.

### G6 — The "More" panel is a drawer, not the demo's sheet

| | Demo (`shots/26-more.png`) | Shipped (`MobileNav.tsx`) |
|---|---|---|
| Shape | Full-width panel | 300px drawer sliding from the left |
| Tab bar | Stays visible, **More shown active** | Covered (`z-[60]` over the bar's `z-50`) |
| Brand | Full `SuReSuite` logo lockup | `logo-mark.png` only |
| Rows | Full-bleed, hairline-divided groups | Inset `rounded-md` rows |
| Foot | Account row + the EU/ACCURATE credit band | Account row only |

Covering the tab bar is the substantive part: the user loses the "you are in
More" signal and the one-tap route back. The rest is cosmetic alignment.

### G7 — `npm run verify:mobile` is broken · ✅ **done**

`package.json` pointed at `handoff/verify-repo.mjs`, deleted in `e0bb85c`, so it
failed for everyone. It now runs `scripts/audit-adaptive-ui.mjs` (with G13).

### G8 — Two rounded display numbers (pre-existing)

`InteractiveNetworkSpace.tsx:623` and `ProcessLevelNetwork.tsx:477` both do
`Math.round(weightedValue)` in a display label — spec §3.3 forbids a number that
silently differs from its source.

**Not UI-only.** Changing a rendered number is exactly what gate 1 forbids, and
these are equally wrong on desktop. Track separately; do not fold into this work.

### G9 — Project Intelligence never got the demo's phone composition · ✅ **done, mobile only**

`PAGES.md` entry 16 records this screen as *landed*. It was not: what shipped below
`md` was the desktop workspace in one column with the sidebar as a left drawer —
the page title, the agent strip, the memory strip, the suggestion chips and the
composer's four separate controls all still on screen. The demo's whole point on
this surface is the opposite: **on a phone the conversation is the product**, and
~150px of chrome folds away to make room for it.

| | Demo (`shots/24-ai.png`, `25-ai-agents.png`) | Shipped before this change |
|---|---|---|
| Header | Chats · chat title + agent chip · ⋯ | `PageHeader` "Project Intelligence" + a panel toggle |
| Agent | Two-letter badge in the header, opens a sheet | Full-width strip under the header |
| Memory | Rows in the ⋯ menu | Purple strip above the stream |
| Suggestions | Composer lightbulb → sheet | Chip row above the composer |
| Composer | One chip — `Tronico EMS · GPT-5 · Review` — plus lightbulb, expand, send | Project select + expand + Ask/Review/Auto + model select |
| Chats / files / memory | Bottom sheets | Left drawer (chats), disclosures (files, memory) |

**What shipped.** A separate phone tree, `components/intelligence/MobileIntelligence.tsx`,
mounted from `ProjectIntelligence.tsx` behind `useIsMobile()` — the same
`use-is-mobile.ts` case §5 established for `GettingStarted`: a different
composition, not a reflow. Desktop renders exactly what it rendered before.

- **One data flow.** The phone tree takes the page's existing props and hooks; it
  adds no query, no RPC and no state shape. Files, memory and suggestions are the
  ones the page already loads.
- **One message stream.** The turn list moved out of `ChatWorkspace` into
  `MessageStream`, which both platforms render — all nine part kinds stay identical
  on both, and the desktop wrapper passes the classes it used inline.
- **One sheet shell.** `components/shared/MobileSheet.tsx` implements §4.4 (drag the
  header down past 90px to dismiss, 76% portrait / full-height landscape) and backs
  all eleven sheets — agents, this chat → project / model / mode, chats, suggested
  actions, ⋯ → summary / how memory works / project memory / my files / rename. It
  stops **above** the tab bar, per G6's rule.
- **One thread list.** The Chats sheet mounts the real `ChatSidebar` with the page's
  own prop set, so search, folders and per-row actions cannot drift from desktop.
- **One panel body.** `MyFilesPanel` / `ProjectMemoryPanel` gained a
  `variant="sheet"` — same copy, same handlers, no disclosure, 44px actions.
  `variant` defaults to `"panel"`, so the sidebar is untouched.

Copy is the demo's, verbatim: "needs project", "Grounds every answer in that
project's data.", the Auto lock, the memory-consent line.

**Two defects found while doing it**, both pre-existing:

1. `MessageParts.TablePart` put `FROZEN_CELL` on the ledger `<th>`. Its
   `bg-background` repaints the ink header white — on a phone the first column
   header was **white text on white**. Fixed with `FROZEN_CELL_ON_TINT`, which is
   what §2.7 says to use on a cell that already carries an opaque fill.
   `FROZEN_CELL` also carries `md:bg-transparent`, so **above** `md` that cell has
   always rendered transparent beside its ink neighbours. That is a desktop defect;
   it is deliberately **not** fixed here (this work is mobile-only) and the class is
   kept explicitly so desktop is byte-identical. Worth its own one-line PR.
2. `ChatSidebar` was only partly at the §2.4 touch floor — section headers, the
   thread row, the per-row ⋯, the folder `+`, Select, the row-menu items, both
   selects and the select-mode checkbox were all under 44px. All now carry the
   mobile value with `md:` restoring the literal. `EvidencePart` and `ActivityGroup`
   had the same gap, and the KPI strip's three fixed columns do not fit a 320px
   phone — it is the §2.3 auto-fit 2-up below `md`, desktop count restored from
   `--kpi-cols` at `md`.

`PageLayout` now publishes `--pi-chrome` (its measured bottom reservation plus the
gutter) so the chat column ends exactly on the credit bar however that bar wraps,
and follows it when the bar is dismissed. Nothing else reads the variable.

**Verified** at 320 / 390 / 767 / 1280 and landscape: no horizontal overflow and no
sub-44px control on any of the mobile surfaces, no console or page errors, `tsc`
clean, `audit-adaptive-ui --all` unchanged at 7.

#### G9.1 — second pass: measured against the demo, not remembered

The first pass got the composition right (header, sheets, composer chip) but was
built from reading the demo's markup. It was then **rendered**: the standalone
bundle unpacks and runs, so the demo's own AI screen was driven in a browser and
its computed styles diffed against the shipped page element by element. Two
things that reading had missed:

1. **The surface was inset in the page gutter.** `PAGE_GUTTER` plus a card
   border put ~31px of padding and a rounded frame around a conversation that
   the demo runs edge to edge. It also cost the in-reply cards ~17px of line
   length, which is what made KPI labels wrap that fit in the demo. The mobile
   branch now renders `MobileIntelligence` with no gutter, and `--pi-chrome`
   dropped its `+2rem` allowance to match.
2. **The in-message table was the page ledger.** `TablePart` used piUi's `TH`/`TD`
   — the ink header with sans cells. The demo's in-reply table is a different
   object: `#fafafa` header, `#8a8a8a` mono labels, `#ebebeb` / `#f4f4f4`
   hairlines, and **every cell in mono** so figures line up column to column.
   That is now `TH_MESSAGE` / `TD_MESSAGE` in `piUi.tsx`, mobile value with
   `md:` restoring the ledger literal.

Also brought to the demo's numbers: card hairline `#ebebeb`, KPI label 9.5px
`#8a8a8a` with tabular-nums values on an `#f4f4f4` grid rule, source note, the
evidence chip and its citation rows, the activity disclosure, the composer's
inner `#f4f4f4` rule, and the composer's two-row resting height (the demo's
collapsed textarea is ~61px, not one line — `height:auto` lets `rows` set the
floor so auto-grow still measures from there).

**Two demo behaviours deliberately not ported:**

- The demo colours any table cell whose **text** matches `/source|unset/` brand
  red. That is a prototype shortcut, not a semantic: it would paint a supplier
  legitimately named "Source Ltd" as a risk. Cell emphasis needs a real field on
  the server's table part before it can ship.
- The demo's header reads "New thread" on an empty chat. `PAGES.md` 16 is
  explicit that "chat" is the user-visible word and "thread" is the data term,
  so the shipped header says **New chat** — the demo contradicts its own spec
  here.

**Flag-dependent, worth knowing before a demo:** the composer's mode segment and
the suggestions lightbulb only appear when `VITE_CHAT_MODES_ENABLED` and
`VITE_SUGGESTED_ACTIONS_ENABLED` are on; the memory and files rows in the ⋯ menu
need the `project_memory` / `reports` capabilities and an attached project. With
those off the screen is correct but thinner than the demo's screenshots.

---

### G10 — Simulation Lab was never taken past its rail · ✅ **done, mobile only**

`PAGES.md` entry 14 records this screen as *"shell landed · rail remaining"*,
and the rail did land — `StageRail` scrolls its five stage cards below `md` and
centres the active one. Everything **behind** those five cards did not. Measured
in Chromium against the real components, at 320px:

| # | Defect | Measured |
|---|---|---|
| G10.1 | Tables clipped, not scrolled — `TableShell` and `ParameterCard` are `overflow-hidden` | KPI summary 576px in 292px · comparison 595px in 292px · recovery impact 360px in 292px · Run window 409px in a **131px** card · Precision 472px in **152px** · Objective 517px in 294px |
| G10.2 | `RunProgressPanel`'s header pushed the document sideways | `scrollWidth` 471 at 320, 474 at 414, **778 at 768** |
| G10.3 | `ScenarioLibraryPanel` is a fixed 420px sheet | renders at `left:-93` — 93px permanently off-screen |
| G10.4 | `DisruptionScheduleEditor`'s six fields share 12 columns | 31px per input |
| G10.5 | `GateBar` truncates the blocked-run reason | §3.1 never-truncate list |
| G10.6 | 60+ controls under the 44px floor across all five panes | now 0 |

**What shipped.** Reflows only — no recomposition, no new component tree. Every
change is a mobile value with `md:` restoring the existing literal. The clipped
tables scroll with the identifying column frozen (`FROZEN_CELL_ON_TINT`) and
carry the swipe affordance; the two parameter cards stack; the run header and
the gate bar wrap; the library sheet clamps to the viewport; the playbook save
dialog uses `DIALOG_AS_SHEET`; the schedule editor is two columns below `md`.
G3's three Lab selects (`SimulationLab.tsx:290`, `PlaybookPicker.tsx:55`,
`ReplicationSeedExplorer.tsx:80`) closed with it.

**Two desktop regressions were introduced and caught only by measuring at 1280**,
both worth knowing:

1. A scroll wrapper around a table that held `flex-1` **takes** that `flex-1`,
   so the card's surplus height stopped being shared across its rows.
   `md:contents` removes the wrapper from desktop layout entirely.
2. `FROZEN_CELL` carries `md:bg-transparent`, which stripped the parameter
   grid's provenance rows of their `#fffdf7` tint above `md` — the same class
   of defect G9 recorded on the ledger `TH`. A cell that already carries an
   opaque fill wants `FROZEN_CELL_ON_TINT`.

**Verified.** 320 / 360 / 375 / 390 / 414 / 768 / 1280 plus landscape 874x402,
across five panes and the empty, loading, no-project, no-scenario, no-run,
queued, running, failed, blocked-gate, warn-only, clear-gate, dirty-policy and
long-text states, and behind every control: the library sheet, the stress-test
drawer, the save dialog, the mapping report and all five Select popovers. No
horizontal overflow and no sub-44px control anywhere below `md`. **Desktop
proved rather than asserted: 21 full-page screenshots at 1280 are byte-identical
by SHA-256 to `main`.** `audit-adaptive-ui` clean with the baseline unchanged at
7; `tsc` unchanged at 7 pre-existing errors; `eslint` on the changed file set
identical to `main`; every rendered number identical at 320 and 1280.

**Not done, and why.** The `Dialog`/`Sheet` primitive's close button is 16x16 —
a global control on ~40 surfaces, so raising it is a cross-page change that
cannot be verified inside one page. The scenario row is a `div` with an
`onClick` and so is not keyboard reachable; making it a real control is a
behaviour change. `CredibilityBadge` and the per-replication cells explain
themselves only through hover (`title` / tooltip), which is inert on touch —
also behaviour. The demo's Lab copy ("No disruption schedule yet — this project
has no network to disrupt", "swipe →", "Ask the AI about this run") was **not**
ported: changing product strings is not a reflow, and §6 forbids copy that
differs between platforms, so it needs one decision covering both.
**G13 took that decision** — see below.

---

### G11 — Super Admin was desktop-only below the card lists · ✅ **done, mobile only**

`PAGES.md` entry 19 records this surface as *landed*. The eight `useIsMobile`
card branches had landed; nothing behind them had. Re-derived against the tree
and measured in Chromium, the gaps were:

| Gap | Where | Fix |
|---|---|---|
| KPI ledger is `grid-cols-4` — 80px cells with 27px figures at 320 | `AdminDashboard.tsx` | 2-up over a 1px divider grid below md; `md:grid-cols-4` and the index-driven `border-r` restore the literal. Figures use `--fs-stat`, `md:text-[27px]` |
| Two Top ledgers side by side (~150px each at 320) | `AdminDashboard.tsx` | `grid-cols-1 md:grid-cols-[repeat(2,minmax(0,1fr))]` |
| `Toggle` is 34×18 · `Segmented` 55×25 · `SortTH` 28px · `Checkbox` 16×16 · `Switch` 44×24 · close ✕ 16×16 · every `SelectItem`/`DropdownMenuItem` 32px | `adminUi.tsx`, `ui/dialog.tsx`, `ui/sheet.tsx`, 6 pages | Spec §2.4. Pad-and-negate where the control carries its own visual (the pill and the checkbox box are redrawn as `::before` so nothing moves), `min-h-11 md:min-h-0` everywhere else |
| Eight centred dialogs on a phone | Users, Orgs ×2, Projects ×4, Models | `DIALOG_AS_SHEET` + `md:max-w-lg md:rounded-sm`; inner 2-ups stack below md |
| Role matrix and the two AI-Usage sub-tables scroll with no frozen column or affordance | `AdminRoles.tsx`, `AdminUsage.tsx` | `FROZEN_CELL`/`FROZEN_CELL_ON_TINT` + the §2.7 affordance line, `md:hidden` |
| Three `sm:` layout grids — a second breakpoint (§6) | `AdminUserAccess.tsx` | Moved to `md:`; changes only 640–767px, which is mobile territory |

**Two defects found by measuring, both pre-existing.** The model-allowlist row's
44px `<label>` is inert — it wraps a Radix *button*, not an input, so tapping the
row text toggled nothing; the control is now the 44px target itself. And
`place-items-center` on a `<button>` is **not** inert: it feeds the button's
anonymous inner box and silently widened the Radix check indicator from 14px to
16px. Both were caught only by a computed-geometry diff against `main`.

**Not built: the demo's phone hub.** `shots/27-admin-hub.png` replaces the
eight-tab strip with search → "Needs attention" → today 2×2 → People → Recent
changes → Reference. Every block needs data this route does not fetch —
cross-entity search, per-user budget-vs-spend, and the audit tail all live on
*other* routes' queries. Mounting them is a behaviour change, so it is outside
gate 1 and deliberately left out.

**Verified.** 320 · 360 · 375 · 390 · 414 · 768 · 1280 and landscape 874×402
across all nine routes, plus every dialog, sheet, menu and select popover, and
the empty / loading / error states: no horizontal overflow, no sub-44px control
below md. Desktop proved by computed-geometry diff against `main` served from a
separate worktree — **every element rect identical** on all nine routes and all
eight open dialogs; the only computed deltas are inert (`min-height`/`min-width`
`auto`→`0`, grid `gap: normal`→`0px`, `z-index` on `position: static` cells).
Screenshot hashes were tried first and abandoned: they are not deterministic
here (`main` differs from itself). `audit-adaptive-ui --all` unchanged at 7,
`tsc` unchanged at 7, eslint unchanged.

### G12 — The network lens pages · ✅ **done, mobile only**

`ProductLevelNetwork.tsx`, `ProcessLevelNetwork.tsx`, `FirmLevelNetwork.tsx`.
`PAGES.md` entry 08 records the lens interiors as *landed*. Re-derived against
the working tree, three things were wrong and two were fatal.

**1. The mobile header was unusable on all three.** `PageHeader`'s right slot
is `shrink-0` beside a `min-w-0 flex-1` title, and each lens put five or six
controls in it. Measured in Chromium at 390px: the page title rendered at
**zero width** and the project select ran to x=506 on a 390px viewport — off
the screen, unreachable. Fixed with the `md:contents` split `ProjectPolicies`
already uses (§2 above): below `md` the header holds refresh + the project
select, which is two of the three §4.1 allows; at `md` every control is handed
straight back to the same flex row.

The container had to move from `space-x-2` to `gap-2` at the same time —
`space-x-*` puts its margin on the *DOM* children, so it lands on the
`md:contents` wrapper instead of the controls inside it and collapses the
desktop spacing. `gap` is inherited correctly through `display:contents`, and
for a single-line row the two are geometrically identical. This was caught by
a 1280px screenshot diff, not by reading the classes.

**Where the displaced controls went.** Search, the map/network toggle, the
labels toggle, the level-1 filter, "clear filter", the analytics toggle and
"add disruption" all drive the network graph or the analytics panels, and both
of those are `hidden md:` on these pages — on a phone they change nothing that
is on screen. They are now desktop-only, and the page says so in words rather
than leaving dead chrome. The two that *do* change what a phone shows moved
next to the thing they change: product's metric calculation and firm's
prominence recalculation are now action buttons in the centrality card.

**2. `FirmLevelNetwork` did not render at all — on either platform.**
`import { Map } from 'lucide-react'` shadows the global `Map`, and commit
`b8f7c09` (the previous pass at this page) added `new Map<string, Set<string>>()`
inside `mobileFirmMetrics`. Every render threw `TypeError: Map is not a
constructor` and the route was a blank screen at every width. Reached through
`globalThis.Map`, which is the workaround `ProductLevelNetwork.tsx` already
uses for the same shadowing. **This is the one change in this commit that is
not UI-only** — it is a one-token expression fix with no intended behaviour
change, made because nothing on the page could be seen, let alone verified,
without it.

**3. `ProcessLevelNetwork`'s identifying column was blank on every row.**
The graph blanks `node.data.label` to `''` while the Labels toggle is off
(`:683`), which is its default and — now — a desktop-only control. The mobile
table read `node?.data?.label ?? n.id`, and `??` does not catch an empty
string, so the frozen first column rendered empty. Now `||`.

**What else changed on mobile.** The composition itself is the demo's, and the
three copies of it are now one presentational module,
`components/network/MobileLens.tsx`, imported only by the `md:hidden` subtree:

- **"How to read this"** is the shared §3.4 `Disclosure` — a card with a 44px
  header — instead of a bare `<details>` whose `<summary>` measured 20px. Its
  body carries the demo's three groups: **Scope**, **Findings**, **Columns**.
  The column definitions for Degree, Betweenness and Prominence are lifted
  verbatim from the repo's own legend (`NetworkMetricsTable.tsx:293-298`);
  the rest are plain descriptions of columns that legend does not cover.
- **The centrality table** freezes its identifying column (§2.7) — measured
  under a full horizontal scroll, the name cell stays pinned at the container
  edge — carries the spec's affordance sentence, and truncates the name in a
  block span with `title`, because `truncate` on a `<td>`/`<th>` is ignored by
  the table layout algorithm and clips without an ellipsis. Empty and loading
  rows drop the `min-width` so their message wraps instead of running off.
- **Empty / loading / disabled** are all real states: "—" throughout with no
  project, a disabled action that carries its reason in `title` (§6 — shown,
  disabled, explained), and a loading row.
- Structure tiles are `repeat(2,minmax(0,1fr))` with `min-w-0` (§2.3), values
  use `--fs-stat`, risk figures are `whitespace-nowrap tabular-nums` (§3.3).
- `MLPrediction`'s docs link — shared with desktop — gained `aria-label`,
  `title` and a 44px hit area below `md` via the §2.4 negative-margin pattern,
  with `md:` restoring the bare 16px icon.

**Verified.** 320 / 360 / 375 / 390 / 414 / 768 / 1280 plus landscape 874×402,
in Chromium against the real components: no horizontal page overflow at any
width, and **zero** controls under 44×44 below 768 on any of the three (main
had two per page). Desktop proof is a SHA-256 comparison, not an assertion:
full-page at 1280 is byte-identical to `main` on all three pages, and the
header region is byte-identical at 768 / 1024 / 1280 / 1440. (Full-page 768 is
not a usable signal — React Flow's `fitView` makes it non-deterministic across
runs on `main` itself.) `tsc` 7 errors, unchanged; `eslint` 49 problems on the
touched files, unchanged; `audit-adaptive-ui --all` 7, unchanged.

**What was deliberately not built.** The demo's node inspector (`PAGES.md` 09)
is not here — it writes a scenario, which is a feature PR. The demo's
lens-specific *prose* findings are not here either: they are statements about
the prototype's own data, and the equivalent on these pages is the SPOF alert,
which is already computed from the real graph. "Critical path" and "utilisation
headroom" stay `—` on every lens, exactly as on `main`; no page computes them,
and inventing a number is what §3.3 exists to prevent.

### G13 — the Lab's demo composition, ported · ✅ **done, mobile only**

G10 made every existing Lab surface usable below `md`. It deliberately did not
recompose the page, and said so. This is the recomposition.

**The demo does not reflow the Lab, it replaces it.** Read against the
prototype's source (`handoff/SuReSuite Live Demo (standalone).html`, recoverable
from `e0bb85c^`; the Lab block starts at offset ~124483 and runs ~40 KB), the
phone screen is: a header carrying the title, a status dot + scenario name and a
44px project button; a five-chip pane strip — **the demo has no lettered stage
rail**; one pane at a time in a scrolling `main`; and a sticky footer holding the
gate and the Run button. So this ships as a separate phone tree,
`components/sim/MobileSimulationLab.tsx`, mounted from `SimulationLab.tsx`
behind `useIsMobile()` — the precedent §5 set for `MobileGettingStarted` and G9
for `MobileIntelligence`. The branch sits **below every hook**, so hook order is
identical on both platforms. Desktop renders exactly what it rendered before.

**The one thing that would have ruined it.** The demo is a prototype with less
functionality than the product: its Setup pane is READ-ONLY fact rows, and it
has no playbook picker, no strategy toggles, no seed explorer, no item-series
explorer and no inline supplier fix. Spec §6 is explicit — the product shows a
control, disables it and explains why; it never hides one. So the resolution is
the demo's own idiom: **where the demo shows a read-only value row, that row
opens a bottom sheet holding the REAL existing editor.**

| Demo row / affordance | Sheet, and what is actually inside it |
|---|---|
| header scenario line | `ExperimentLibraryBox` + `StressTestDrawer` + the real `ScenarioList` (select · Library · new · duplicate · delete) |
| header project button | the project list, replacing the `Select` below `md` |
| Scenario | `ScenarioSetupForm section="identity"` — name, description, `TimeUnitBar` |
| Horizon · Warm-up | `ScenarioSetupForm section="runWindow"` — horizon, steady-state start, warm-up detection, time step |
| Replications · Random seed | `ScenarioSetupForm section="precision"` — replications, CRN, seed, stopping rule |
| Primary KPI | `ScenarioSetupForm section="objective"` |
| "Add disruption" / a schedule row | the real `DisruptionScheduleEditor` |
| "Response strategies" | `DisruptionRecoveryPane sections="playbook"` — the picker, save/reset/delete, the enable switch, all six strategy toggles and their parameter inputs |
| "Engine mapping report" | the real `MappingWarningsCard` |
| blocked-gate button / "view" | the real `PreRunValidationPanel`, with its per-finding routes and the inline supplier fix |

`section` / `sections` are new **presentational** props on `ScenarioSetupForm`
and `DisruptionRecoveryPane`, defaulting to the whole form, so desktop mounts
what it always mounted. There is one editor per control, rendered in two
chromes — a control cannot drift between platforms because there is only one of
it. `shared/MobileSheet.tsx` backs all ten sheets; it already implements §4.4
and already stops above the tab bar (G6). No second sheet shell was written.

**Two rows the demo does not have** are added, as rows of the same kind rather
than hidden: **Scenario** (the product has a name and a description; the demo
puts the name in the header and has no description) and **Primary KPI** (the
product has an objective; the demo does not). **Policy version** stays a
read-only value row, because this page holds no editor for it.

**One card the demo does not have.** The demo's Events pane is the schedule and
nothing else, but the product's pane also carries the playbook — 23 controls.
Dropping them is forbidden by §6, so they keep the demo's card vocabulary
("Recovery playbook" is the demo's own string, from its Results pane) and their
rows open the real editors. This is the one place the composition is *extended*
rather than reproduced, and it is recorded here rather than discovered in review.

**Copy is the demo's, verbatim** — "No disruption schedule yet — this project has
no network to disrupt.", "swipe →", "Add disruption", "Setup", "Go to Run",
"Spec", "warm-up & n* not adopted — set them in Policies", "view", "Experiment
design", "Disruption schedule", "edit in Events", "Recovery playbook",
"Per replication". This **closes the open question G10 left**: the phone chip for
the `recovery` pane reads **"Events"** while the desktop rail reads **"Recovery
playbook"**, and the phone's Setup rows are read-only where desktop's are
editable. That is copy that differs between platforms, which §6's table lists as
an anti-pattern, so it is a **knowing exception**, taken for the same reason §5's
dialect divergence was: the brief was to port the demo's composition, and the
demo's composition *is* its vocabulary. The pane behind the "Events" chip names
its second card "Recovery playbook", so neither name is lost.

### What was deliberately NOT built, and why

Three demo elements need data this page does not hold. None was faked and no
query was added — the gate-1 rule G5's record established:

1. **"Fill rate · 52 weeks"** (the demo's inline SVG: playbook-on vs
   playbook-off, event bands, a dashed baseline, a TTR rule). The page holds no
   weekly fill-rate path with the playbook counterfactual — the demo computes it
   from a prototype model. The real weekly evidence is
   `ReplicationSeedExplorer`, which renders the persisted per-seed traces, and
   it occupies that slot.
2. **The KPI tiles' delta line.** A delta needs a baseline to diff against; the
   run holds its own means and CI half-widths and nothing to compare them to.
   The tiles carry `± 95% CI` instead — a number the run recorded.
3. **"Ask the AI about this run".** The demo's hand-off seeds a Project
   Intelligence question with the run's context. That is chat state this page
   does not own, so the button is not built rather than built as a dead link.
4. **"Open Nordic retail DC"** on the empty-results card. The demo hard-codes a
   second project's name; spec §12 lists exactly that class of fixed value as a
   demo device, not product behaviour. The card keeps "Go to Run".

**Two places the demo's copy is deliberately not used**, because the product's
table is a different table, not the same table renamed:

- **Compare.** The demo's five columns are `Scenario | Service | Fill | Cost |
  TTR` — one row per scenario. The product's Compare is a **paired** experiment:
  `KPI | A mean | ± CI | B mean | ± CI | B − A | CI overlap`, and §9.3 refuses to
  show a number at all unless the two runs are CRN-paired and differ in exactly
  one RunKey component. Porting the demo's columns would mean rendering a
  per-scenario summary the product deliberately withholds. The real
  `CompareScenariosPanel` is mounted unchanged, with its own copy and its own
  refusal reasons.
- **Utilization.** The demo says "Utilization · node × week". The engine emits
  per-tick series whose unit is the scenario's time step, so the product says
  "node × time". Relabelling it "week" would assert a unit the data need not
  have — §3.3 territory.

**One behavioural consequence worth knowing.** On the phone the playbook editor
lives behind a sheet, so `DisruptionRecoveryPane` — and therefore
`useRecoveryPlaybooks` — mounts only when that sheet is opened, where desktop
mounts it whenever the pane is shown. That **defers** a request; it does not add
one, so it stays inside gate 1. Everything else on the screen is built from
state the page had already loaded.

`ResultsDashboard` is mounted unchanged below the tiles, so every chart and every
table on the phone is the same component, the same maths and the same numbers as
desktop. Its `credibility` badge is omitted on the phone only because the demo's
credibility chip above it is already that readout, and the badge explains itself
only through a hover tooltip, which is inert on touch.

### Two pre-existing defects found by measuring, both in Compare

Neither was in G10's inventory; both surfaced only under the `long-text` and
`no-run` fixtures:

1. **`CompareScenariosPanel`'s A/B selects collapse to 38 × 44** when no
   scenario has results — under the touch floor on precisely the state where the
   user needs to reach them. Fixed with `min-w-11 md:min-w-0`.
2. **A long scenario name pushes the document sideways at 768** —
   `scrollWidth` 1274 against a 768 viewport — because a native `<select>`'s
   intrinsic width is set by its longest `<option>` and nothing in `TableName`'s
   action slot carries `min-w-0`. This is a **desktop** defect (768 is at the
   breakpoint, so the desktop tree renders), gate 2 freezes desktop, and it is
   identical on `main`. **Left unfixed and recorded here**; it wants its own
   one-line PR against `shared/TableShell.tsx`. Below `md` it is gone, because
   the phone tree's `main` is its own scroll container.

### Merging `main`: `--pi-chrome` changed meaning

`main` took G11 and G12 while this branch was in flight, and the merge had one
substantive conflict. Project Intelligence now runs **edge to edge with no page
gutter**, so `main` dropped the `+ 2rem` term from `--pi-chrome`. This page sits
inside `PAGE_GUTTER` and had added that term for its own column. Taking either
side alone puts the other surface out by 32px — PI would leave a gap above the
credit bar, or the Lab's gate footer would sit below the fold.

Resolved so neither loses behaviour: `--pi-chrome` is **the bottom reservation
and nothing else**, and a reader that sits inside the gutter subtracts it
itself — `h-[calc(100svh-var(--pi-chrome,170px)-2rem)]`. The probe now asserts
this directly rather than by eye: at every mobile width it checks the column's
bottom edge against the viewport, so a footer pushed below the fold fails the
run. 0 of 400 mobile measurements do.

`main` also dropped the **G10 section** while appending G11 and G12, leaving
sequence row 7's "see G10" pointing at nothing. It is restored verbatim.

### Housekeeping

`npm run verify:mobile` (G7) pointed at `handoff/verify-repo.mjs`, deleted in
`e0bb85c`, and failed for everyone. It now runs `scripts/audit-adaptive-ui.mjs`.

`PageLayout`'s `--pi-chrome` now has a second reader: the Lab column is
`100svh - var(--pi-chrome)` so the gate footer stays on screen. An honest gate
you have to scroll to find is not one.

### Verified — measured, not asserted

Two Vite servers, not `git stash` (HMR silently serves stale modules and
produces a false "identical"): the branch on :5199 and a `git worktree` of the
base on :5302. Measured twice — first against the branch's own base commit
`aa3fba9`, then re-measured in full against **`origin/main`** after merging it
in, because that merge changed a value this page's layout depends on (see
below). Both passes give the same result.

- **80 fixture states** — 5 panes × 16 modes (no-project · no-scenario ·
  loading · no-run · no-reps · queued · running · done · failed · blocking-gate ·
  warn-only · clear-gate · dirty-policy · no-events · long-text · empty-library)
  at 320 / 360 / 375 / 390 / 414 / 768 / 1280 = **560 measurements**.
- **Desktop proved, not asserted:** full-page 1280 screenshots of all 80 states
  compared against the base worktree. **71 are byte-identical by SHA-256.** The
  other 9 are the `results` pane, and SHA is the wrong instrument there: the
  **same code screenshotted twice from the same server** does not reproduce
  byte-for-byte, because recharts redraws its plots slightly differently. So
  those 9 were measured both ways — branch↔base *and* base↔base. Three
  (`dirty-policy`, `long-text`, `warn-only`) came back byte-identical on
  re-capture, taking it to 74. The remaining six sit inside the renderer's own
  measured noise: `no-events` differs by 566 px / 102-row band in **both**
  directions, `running` by 426 vs 432 px, `empty-library` by 7 vs 7, and on
  `done` the **same-code** difference (304 px) is the larger of the two. The
  102-row band is the chart's own height; a layout change would shift everything
  below it and show a band running to the foot of the page. None does.
  `setup/long-text` also failed the first SHA pass by 14 pixels of text
  antialiasing across 3 bands, and re-measured byte-identical.
- Every overlay opened and measured at 320 / 390 / 414 and landscape: all ten
  sheets, the scenario library (populated and empty), the stress drawer, the
  playbook save dialog, the mapping report and the Select popovers. Clean
  everywhere. The `Dialog`/`Sheet` primitive's 16 × 16 close button — the one
  finding G10 had to scope out as a ~40-surface cross-page change — was raised
  to 44px on `main` in the G11 pass, so merging `main` in closes it.
- **Landscape is 740 × 380, not 874 × 402.** 874 ≥ 768, so at that width the Lab
  correctly renders its *desktop* tree and the sheet rules are not exercised at
  all; a landscape phone under the breakpoint is what tests them. Both were
  measured. The §2.6 check is that the 76% cap does not **clip** — a short sheet
  staying short is correct — so it asserts that a sheet whose body overflows is
  using the room it has. None is clipped.
- `node scripts/audit-adaptive-ui.mjs` clean, baseline unchanged at **7**;
  `tsc` unchanged at **7** pre-existing errors in `src/hooks/useErpConnections.tsx`;
  `eslint` on `src/components/sim/**` + `SimulationLab.tsx` unchanged at
  **1 error / 13 warnings**, the error pre-existing in `ExperimentDesigner.tsx`
  (a file nothing imports). `MobileSimulationLab.tsx` contributes zero.
- §3.3: numeric text is identical across every width **within** each platform.
  Across the 768 boundary the Lab now renders two different compositions, so
  cross-platform numeric equality is no longer the applicable test and is not
  claimed. Recharts' x-axis tick labels re-thin by width — on the base commit
  too — and are excluded from the comparison rather than "fixed".
---

## 4. Sequence

Five commits, each independently shippable and revertable, ordered so the
riskiest visual change lands last and alone.

| # | Scope | Files | Risk |
|---|---|---|---|
| **1** | **Policy grid** — G1.1–G1.3, G2 | `StagePolicyTable.tsx`, `PolicySetupBar.tsx` | Low. Additive classes, all `md:`-released |
| **2** | **Selects** — G3 (all 10) | 5 pages + 4 sim components | Low. One-line each |
| **3** | **Bulk edit sheet** — G4 | `BulkEditDialog.tsx` | Low. Shell swap, logic untouched |
| **4** | **More panel** — G6 | `MobileNav.tsx` | Medium. Re-layout; keep the tab bar visible |
| **5** | **Getting Started** — G5 | `GettingStarted.tsx`, `home/MobileGettingStarted.tsx` | ✅ **done** — see §5 |
| **7** | **Simulation Lab** — G10 | `resultTables.tsx`, `ParameterCard.tsx`, `ScenarioSetupForm.tsx`, `RunGate.tsx`, `RunProgressPanel.tsx`, `PreRunValidationPanel.tsx`, `DisruptionScheduleEditor.tsx`, `DisruptionRecoveryPane.tsx`, `PlaybookPicker.tsx`, `PlaybookSaveDialog.tsx`, `ScenarioLibraryPanel.tsx`, `ScenarioRail.tsx`, `CompareScenariosPanel.tsx`, `ReplicationSeedExplorer.tsx`, `ItemSeriesExplorer.tsx`, `ResultsDashboard.tsx`, `UtilizationHeatmap.tsx`, `SimulationLab.tsx` | ✅ **done** — see G10. Low: reflow only, all `md:`-released |
| **6** | **Project Intelligence** — G9 | `intelligence/MobileIntelligence.tsx`, `shared/MobileSheet.tsx`, `intelligence/MessageStream.tsx`, `ProjectIntelligence.tsx`, `ChatSidebar.tsx`, `SidebarPanels.tsx`, `MessageParts.tsx`, `PageLayout.tsx` | ✅ **done** — see G9. Medium: a new phone tree, but desktop is a separate branch |
| **8** | **Super Admin** — G11 | `adminUi.tsx`, `ui/dialog.tsx`, `ui/sheet.tsx`, `OrgAccessDrawer.tsx`, 8 admin pages | ✅ **done** — see G11 |
| **9** | **Network lenses** — G12 | `ProductLevelNetwork.tsx`, `ProcessLevelNetwork.tsx`, `FirmLevelNetwork.tsx`, `network/MobileLens.tsx`, `MLPrediction.tsx` | ✅ **done** — see G12. Medium: a header recomposition plus one crash fix |
| **10** | **Simulation Lab composition** — G13 | `sim/MobileSimulationLab.tsx`, `SimulationLab.tsx`, `ScenarioSetupForm.tsx`, `DisruptionRecoveryPane.tsx`, `CompareScenariosPanel.tsx`, `PageLayout.tsx`, `package.json` | ✅ **done** — see G13. Medium: a new phone tree, but desktop is a separate branch |

Housekeeping (G7) rides with commit 1. G8 is out of scope.

Commits 1–3 are pure mechanical conformance and could land together if reviewers
prefer; 4 and 5 should stay alone because they change what a screen looks like
rather than how it reflows.

Traceability, per `CLAUDE.md` — reference the spec section each commit serves,
e.g. `fix(mobile): freeze the policy-grid identifying column (spec §2.5C/§2.7)`.

---

## 5. Getting Started (G5) — decided, and the divergence recorded

**Decision (owner's call, taken): port the demo composition, mobile only.**

`PAGES.md` entry 04 required this to be settled explicitly — *"either the repo
page is modernised too, or this divergence is accepted deliberately and written
down. It is not a thing to discover in review."* This section is that record.

**What now ships on this route:**

| | Below 768px | 768px and up |
|---|---|---|
| Tree | `components/home/MobileGettingStarted.tsx` | The existing legacy page, untouched |
| Dialect | Current/sharp — 4px radius, 1px `--hair-border`, mono kickers, no gradients | Legacy — gradients, icon tiles, `rounded-2xl` |
| 3D | Not mounted | `NetworkVisualization3D` as before |

**The divergence is accepted deliberately.** Desktop and mobile speak different
visual dialects on this one route. That is a knowing exception to "every change
ships desktop and mobile", taken because the desktop page is *documented legacy*
(design system §3.10 names it as the one surface that "predates [the system] and
looks nothing like it") and because the brief for this work was explicitly
mobile-only. Modernising desktop remains open, and would close the divergence.

**Why a `useIsMobile` branch and not `md:` classes.** This is a different
component tree, which is exactly what `use-is-mobile.ts` reserves the hook for.
Rendering both trees behind `hidden md:block` would mount the 3D canvas on
phones, against the standing no-3D-on-mobile decision. The branch sits below
every hook in the component, so hook order is identical on both platforms.

### What was deliberately not built, and why

The demo's resume card also carries a relative timestamp ("12 min ago"), node
and echelon counts, and a three-row readiness checklist (data imported /
policies configured / validated run). **None of it shipped**, because every one
of those values needs a query this route does not make — `useDataMap`,
`usePolicies`, `useScenarioRuns`. Mounting them would fire three new requests on
every home load: a behaviour change, not a UI change, and so outside gate 1.

What shipped instead is built strictly from `useGlobalProject()` — app-wide
context that is already mounted and costs no request. Nothing is invented: a
field the context does not hold is not rendered at all, and the meta line drops
empty entries rather than showing a hole.

**Consequence worth knowing:** a cold load restores the project *id* from
`localStorage` but not the project row, so the card's "No project open" state is
common rather than exceptional. It is built as a real destination
("Choose a project" → Project Manager), not an apology.

**Follow-up, if the full demo card is wanted:** add the three readiness rows and
the timestamp. That is a small, well-scoped change — but it is a *data* change,
so it needs its own non-UI-only PR and its own review.

### What this did not clear

The 4 `lg:` violations and the `bg-black` band are all in the **desktop** tree,
which this work does not touch. The audit therefore still reports 7 — unchanged,
not worsened. They clear only if desktop is modernised too.

---

## 6. Verification — the same gate for every commit

Static, before anything else:

```bash
node scripts/audit-adaptive-ui.mjs --all   # must not rise above baseline
npm run lint
```

Widths — **320 · 360 · 375 · 390 · 414 · 768 · 1280**, plus landscape 874×402:

```js
[320,360,375,390,414,768,1280].forEach(w => {
  const overflow = document.documentElement.scrollWidth > w;
  const small = [...document.querySelectorAll('button,a,[role=button],input,select')]
    .filter(el => { const r = el.getBoundingClientRect();
      return r.width && (r.width < 44 || r.height < 44); })
    .map(el => el.getAttribute('aria-label') || el.textContent.trim().slice(0,24));
  console.log(w, { overflow, small });
});
```

- `overflow` false at every width (an intentionally scrollable table container
  is the only exception).
- `small` empty below 768. At ≥768 the check does not apply — `h-8`/`h-9` is
  correct there.
- **1280 pixel-identical to `main`.** If it is not, an `md:` is missing.
- Every rendered number identical at 320 and 1280 — diff the numeric text.

Landscape: sheets full-height, bottom chrome not covering content.

PR body uses the §8 template in `docs/mobile-ui-spec.md` — it requires stating
what happened to *both* platforms, which is what stops one-sided changes.

---

## 7. Explicitly out of scope

| Item | Why |
|---|---|
| Row multi-select + bulk patch on the policy grid | `StagePolicyTable` has no selection model (its only `Set` is `collapsedGroups`). Adding one is a state-shape change — gate 1. The demo is *ahead of* the product here; porting the visuals without the state is not possible |
| Node inspector / scenario-from-node | `PAGES.md` 09 — prototype ahead of product, needs a product decision |
| `Math.round` display numbers (G8) | Changes a rendered number; wrong on both platforms |
| Any desktop change | Gate 2 |
| Re-adding `handoff/` | Deliberately deleted; recoverable from `e0bb85c^` |
