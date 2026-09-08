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

### G7 — `npm run verify:mobile` is broken

`package.json` points at `handoff/verify-repo.mjs`, deleted in `e0bb85c`. It
fails for everyone. Either drop the script or repoint it at
`scripts/audit-adaptive-ui.mjs`.

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
