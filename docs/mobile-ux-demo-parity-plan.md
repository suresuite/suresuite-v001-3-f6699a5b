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
| `SimulationLab.tsx:290` | `200px` |
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
(210px, inside `cn()`).

Where a Case B select sits in a flex row beside a label, that row also needs
`flex-col items-stretch md:flex-row md:items-center`.

### G4 — `BulkEditDialog` is a centred dialog on a phone

`BulkEditDialog.tsx:50` is `<DialogContent className="max-w-lg">`. A centred
dialog is the wrong container on mobile; the demo uses a bottom sheet.

**Shell only.** Its logic, its `targetKeys` contract and its copy ("Empty fields
are skipped so the override stays sparse") stay verbatim.

### G5 — `GettingStarted.tsx` never got the redesign · **largest visual gap**

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
| **5** | **Getting Started** — G5 | `GettingStarted.tsx` | **High, and gated on §5** |

Housekeeping (G7) rides with commit 1. G8 is out of scope.

Commits 1–3 are pure mechanical conformance and could land together if reviewers
prefer; 4 and 5 should stay alone because they change what a screen looks like
rather than how it reflows.

Traceability, per `CLAUDE.md` — reference the spec section each commit serves,
e.g. `fix(mobile): freeze the policy-grid identifying column (spec §2.5C/§2.7)`.

---

## 5. The one decision needed — Getting Started (G5)

Everything else is mechanical. This is not, so it is stated as a choice:

- **(a) Port the demo.** Replace the marketing stack with the resume card +
  quick-start rows. Matches the demo exactly, clears 5 of 7 audit violations,
  and makes Home useful to a returning user. Biggest change; the marketing copy
  moves to `/about` or is dropped.
- **(b) Conformance only.** Keep the page as-is, fix just the `lg:` breakpoints
  and the `bg-black` band. Clears the audit, leaves the demo divergence open.
  Low risk, low reward.
- **(c) Defer.** Ship commits 1–4, leave the audit baseline as-is, and take the
  page in its own redesign with the marketing copy resolved first.

**Recommendation: (c) now, (a) next.** Commits 1–4 are unambiguous wins that
need no product input and shouldn't be held hostage to a page-identity question.
(a) is the right end state, but "what does Home say to a returning user" is a
product call, not a UI cleanup — and `PAGES.md` already flags it as an open
question rather than a defect.

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
