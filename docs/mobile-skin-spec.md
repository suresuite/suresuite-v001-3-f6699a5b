# Mobile skin — specification

The contract for every SuReSuite app surface at **≤ `md` (768px)**. It is a
**skin**, not a UX change: same routes, same flows, same data, same words, same
control inventory. It changes how a screen looks and nothing about what it
does. If a change would alter what a user can do, where a tap takes them, or
what a screen says, it is out of scope.

Desktop keeps the existing system unchanged. Everything here is additive at the
mobile breakpoint; nothing in it may re-tint or re-space a shared component
above `md`.

Source: the `Mobile UI Rules` / `SuReSuite Mobile` design handoff, amended by
**handoff v2** (`SuReSuite Mobile v2`), which supersedes it on two things only:
how surfaces separate from each other (§1, §2) and how content sizes itself to
the device (§14). Everything else in v1 stands. Values below are exact.

**Relationship to `docs/mobile-ui-spec.md`.** That document is the earlier
mobile pass — the structural one: the tab bar, the sheet-instead-of-dialog
rule, the touch floor, the responsive mechanics, and the audit
(`scripts/audit-adaptive-ui.mjs`) that enforces them. It still holds. This
document supersedes it on **appearance only**: colour, type scale, container,
density and the chrome budget. Where the two disagree — the app gutter is the
clearest case, a fluid clamp there and a flat 16px here — this one wins on a
converted surface and the older one still describes every surface not yet
converted.

---

## 1. The one idea

Every piece of content on a mobile screen is **the panel**.

```
1px #d4d4d4 border, 4px radius, overflow hidden
├─ head:  #fafafa fill, 1px #d4d4d4 bottom rule, 8px 12px padding
│         left:  mono 10px uppercase 0.14em #525252  (the label)
│         right: mono 10px #525252                   (one counter, optional)
└─ body:  #fff, rows divided by 1px #e8e8ea, 11–14px vertical padding
```

That is `tone="secondary"`, the default and what nearly every panel on a screen
is. `tone="primary"` swaps the frame and head to `#18181b` with white on them,
and **a screen gets at most one** — the thing that changed or the thing that
blocks the user (§13.3).

That ration is the whole point of v2. A screen with four black bars has four
priorities, which is no priority at all; and when the frame was doing all the
separating, the panel did not read as an object with contents. v2 fixes the
mechanism: the canvas drops to 93% so a panel separates from the ground by
value, and the two rule weights split — `#d4d4d4` for anything touching the
canvas, `#e8e8ea` for anything inside a panel.

A panel that belongs to a layer or an agent takes `accent` — a 2px left rule in
that hex. It is the only accent a panel gets: never a fill, never a second edge.

A **group** names a band of panels with a 10px mono label on the canvas, 8px
above its own panel and a group gap from the next. It is the sanctioned
exception to §12's "no borderless sections" — a label, not a container, with no
rule and no fill — and it is what lets the ink head become rare, because a
screen that reached for `tone="primary"` to say "this band is about runs"
wanted the two words.

If a screen needs a container this cannot express, the answer is a different
arrangement of panels — not a new container.

Implementation: `MobilePanel` / `MobileRow` / `MobileGroup` in
`src/components/mobile/`.

## 2. Ink and ground

Three grounds, two rule weights, one loud panel.

| Layer | Value | Job |
|---|---|---|
| Canvas | `hsl(var(--m-canvas))` — **93%** | The page. Panels separate from it by value, not by a black frame. |
| Panel head | **`#fafafa`** | Holds the micro-label and any column labels. |
| Panel body | `#ffffff` | The only place data lives. |

| Rule | Value | Where |
|---|---|---|
| Outer | `#d4d4d4` | Panel outline, head bottom rule, action-bar top rule, stat-grid frame — anything touching the canvas. |
| Inner | **`#e8e8ea`** | Row dividers, stat-grid gap lines — inside a panel only. |
| Accent | 2px, layer or agent hex | Left edge of a panel. The only accent a panel gets. |

**The ink ladder** (contrast on white). Nothing lighter than `#6b6b6b` carries
text, ever.

| Value | Use | Contrast |
|---|---|---|
| `#171717` | Row labels, stat values, screen titles | 16.9:1 |
| `#3f3f46` | Body copy and prose. Never a heading. | 10.8:1 |
| `#525252` | Micro-labels at 11px and below. Never below 10px. | 7.4:1 |
| `#6b6b6b` | Chevrons and the inactive tab label. The floor. | 5.3:1 |

`#18181b` remains the ink FILL — the panel frame at `tone="primary"`, the
primary button, the active segment — and is not a text value.

**Retired:** `#8a8a8a` secondary text, `#f4f4f4` dividers and `#e4e4e4` as a
row divider. Every mobile occurrence steps to `#525252`, `#e8e8ea` and
`#e8e8ea` respectively. `#e4e4e4` survives only as `M.track`, the segmented
control's own ground, and in the `md:` half of a shared component.

`--m-canvas` is deliberately a separate token from `--surface-dense` (92%). The
skin is additive below `md`; the desktop canvas keeps its own value.

## 3. Colour is information

Colour appears as a **6px dot, a 2px rule, or a small chip**. Never a panel
fill, never a button fill, never a background wash.

| Value | Means |
|---|---|
| `#e0930b` | Firm level · derived or imputed · warning frame (`#e0930b1f` fill, `#6b4405` text) |
| `#7c3aed` | Product level |
| `#14b8c4` | Process level · running or healthy |
| `#bf2330` | Blocking · rejected · risk analyst · the `!` mark |
| `#F8D448` | "Begin here", and only that: template download, walkthrough, pending count, 2px emphasis rule |
| `#d4d4d4` | Queued · inactive · off |

## 4. Chrome budget

Fixed, and the same on every screen. Content gets everything else.

| Band | Height | Contents |
|---|---|---|
| Status bar | 40px | System |
| Page header | ≈46px | 19px title (or `‹` + title) and at most one right-hand element |
| Segmented row | 38px | Only where the screen has 2–3 peer views |
| Action bar | 64px | One primary, at most one secondary |
| Tab bar | 58px | Five tabs, icon + 10px label |

Removed at mobile: page subtitle, breadcrumb, toolbar row, card-level
descriptions, and the fixed black credit footer (`Footer.tsx`). The funding
credit appears once, in About & help.

Screen gutter **16px**; gap between panels **12px**.

## 5. Type — five sizes, nothing between

Five sizes, three of them fluid (v2 §5.3). The clamps live in `index.css` so
that CSS, not a resize listener, does the sizing; every floor is the value in
brackets, which is the size at 320px and the size the skin will never go below.

| Size | Token | Family / weight | Use |
|---|---|---|---|
| 10px | — | mono, uppercase, `0.14em` | Panel head label, stat label, agent badge |
| 10–11px [10] | `--fs-micro` | mono, `0.04em` | Row sub-line, ids, counters, timestamps |
| 13.5–15px [13.5] | `--fs-row` | Inter 500/600 | Row label — the workhorse |
| 14.5px | — | Inter 400, `1.55` | Agent prose and chat only |
| 17–21px [17] | `--fs-title` | Inter 600, `-0.019em` | The screen title, one per screen |
| 20–28px | — | Inter 600, `-0.022em`, tabular | Stat values only |

At 390px — the modal device — those resolve to 10.5px, 14.4px and 19.5px, which
is the v1 scale to within half a pixel. What changed is the ends: a 320px SE no
longer gets a 390px phone's type, and a 430px Pro Max no longer gets a 320px
phone's.

Agent prose is deliberately NOT fluid: it adapts by line count, not by size
(§14.3). Tailwind needs the length hint on a bare var —
`text-[length:var(--fs-row)]`, never `text-[var(--fs-row)]`, or it guesses
`color` and drops the rule silently.

Mobile lifts the desktop 12/12.5px row to 13.5px and the 15px `PageHeader`
title to 19px. Nothing else grows. Sentence case everywhere; the only uppercase
is the mono micro-label. The serif italic accent is permitted on the Auth
headline and nowhere else.

## 6. Numbers

Always `tabular-nums`, always right-aligned in a row, always the heavier weight
of the pair. A stat cell carries a 10px mono label and the figure — no delta
line, no confidence line, no unit spelled out twice. Precision that matters
(±0.03, n = 50) belongs on the detail screen, not the summary. A figure is
never rounded off to look tidier.

## 7. Geometry

| Radius | Applies to |
|---|---|
| `4px` | Every panel, every alert, every stat grid |
| `5px` | Segmented control and its thumb; stepper buttons |
| `6px` | Buttons, inputs |
| `3px` | Mono chips and version tags |
| `9999px` | Dots, avatars, toggles, the composer, pill buttons |
| `16px` | Sheet top corners and chat bubbles. Nothing else. |

Borders separate; **shadows never do**. The only shadow in the system sits
under a bottom sheet: `0 -8px 28px rgba(0,0,0,.14)`.

Spacing steps: 2 / 4 / 6 / 8 / 10 / 12 / 16. Three of them are fluid, for the
same reason the type is (v2 §5.3):

| Token | Range [floor] | Use |
|---|---|---|
| `--m-gutter` | 14–18px [14] | The screen gutter. 16px at 390. |
| `--m-gap` | 18–24px [18] | Between GROUPS. Panels inside a group sit 8px apart. |
| `--m-row-y` | 11–14px [11] | A row's vertical padding. |

A row is `min-h-11` at every value in that range — the 44px touch floor is a
floor, not an outcome of the padding, and it is checked rather than assumed.

## 8. Controls

- **Primary action** — one per screen, pinned in the bottom action bar above
  the tab bar. `#18181b` fill, white text, 46px, fills the remaining width, 6px
  radius, 13.5px/600.
- **Secondary** — at most one, to its left. White fill, 1px `#18181b` border,
  hugs its label, same height.
- **Segmented** — 5px radius, 2px padding on an `#e4e4e7` track; active item
  `#18181b`/white, inactive `#3f3f46`; items 11.5px/600, min-height 34px.
- **Toggle** — 34×18 pill, 14px white knob, `#18181b` on / `#d4d4d4` off.
- **Stepper** — 32px squares, 5px radius, `#d4d4d4` border; value mono
  15px/700 tabular, min-width 46px, centred.
- **Row** — 44px minimum, 13.5px/500 label, optional 10.5px mono sub-line,
  optional leading 6px dot, optional trailing chip, `›` chevron in `#525252`.
- **Icon-only** — 32–34px, always with `aria-label` and `title`.
- Touch targets never below 44px. Where a control is smaller by design (the
  toggle pill, a stepper square), it carries a transparent 44px hit area rather
  than growing.
- A control that is unavailable is **shown, disabled, and explained** in one
  12px line beneath it. Do not hide it.

Labels are verbs, two words maximum — Re-run · Upload CSV · Save version & run.
Icons stay `lucide-react` at the existing size tiers. Unicode functional marks
(`› ▾ ▸ ▲ ▼ ! ⚠ → ✕ ·`) are used as they are today.

## 9. Fluid width — 320px to 430px, no media queries

1. Every text-bearing flex child gets `min-width: 0`; the truncating one gets
   `text-overflow: ellipsis`. The **title** truncates; short fixed counters
   beside it get `white-space: nowrap` and never do.
2. Stat grids use `repeat(auto-fit, minmax(N, 1fr))` **only** when the cell
   count divides evenly at every reachable column count. Four cells use a fixed
   `repeat(2, minmax(0, 1fr))` — auto-fit orphans the fourth. `MobileStatGrid`
   derives fixed columns from the cell count and never uses auto-fit.
3. Button rows wrap: `flex-wrap` with `flex: 1 1 140px`. They stack rather than
   squeeze below the touch minimum.
4. Ids, keys and lane codes get `word-break: break-all`; prose gets
   `text-wrap: pretty`. No fixed heights on anything containing text.
5. No horizontal scroll except inside a deliberate full-table sheet or a code
   block.
6. **Viewport units.** `100vh` is banned — on a phone it is the height the
   window has once the URL bar has collapsed, so a `min-h-screen` shell is
   taller than the viewport on first paint and the canvas resizes mid-scroll.
   The app shell is `min-h-dvh` (a utility that falls back `vh` → `svh` →
   `dvh`). `dvh` is legal as a CAP on a chart or a media band (`max-h-[60dvh]`)
   and nowhere else; a fixed `dvh` height on a text container is still a fixed
   height, which rule 4 forbids.

## 10. Density

Rows are 11–14px vertical padding (`--m-row-y`), never under 44px tall — both
the touch minimum and the reading rhythm. **Do not port the desktop 5–9px
ledger rows to mobile.**

Dense tables summarise: a stat strip plus the ranked rows that matter, with the
full ledger deferred to a sheet. **Defer, never truncate** — all data stays
reachable, just not on the first screen. This is a presentation decision and
must not drop a column from the underlying view.

## 11. Motion

200ms for colour, 300ms for a sheet, nothing else. Press is a value step or a
1px nudge, never a colour flip. The only ambient animation is the pulsing 6px
dot on a running job. Respect `prefers-reduced-motion`.

## 12. Never

- A gradient, a glass blur, or a shadow used to separate two things.
- A second container style — no bare cards, no coloured panels. A borderless
  section is out too, with one sanctioned exception: a `MobileGroup`'s label,
  which carries no rule and no fill (§1).
- More than one `tone="primary"` panel on a screen. The ration is per SCREEN,
  counted across the whole composition, not per component.
- A colour fill larger than a chip, or a coloured button.
- A heading or button in uppercase; an emoji anywhere.
- A description line under a panel title, or helper text repeating the label.
- A radius above 6px on anything that is not a sheet, a bubble or a pill.
- A number without `tabular-nums`, or a figure rounded off to look tidier.

## 13. Assembling a screen

Top to bottom, in this order. Skip a band that has nothing to hold; never
reorder.

1. Title, and at most one counter or control beside it.
2. Segmented control, if the screen has peer views.
3. The one thing that changed or needs attention — the screen's ONE
   `tone="primary"` panel.
4. The numbers — one stat grid.
5. The list — one or more panels, grouped into named bands, ordered by what the
   user acts on first.
6. Consequence or caveat — `MobileNote`. The amber wash is for a **blocking**
   consequence; a caveat is the panel's geometry with a 2px amber left rule and
   body ink. One per screen either way, never more than two sentences.
7. The action bar.

A screen that needs more than four panels is two screens. Raise it rather than
cramming. Panels inside a band sit 8px apart; bands sit `--m-gap` apart.

## 14. Sizing to the device (v2 §5)

The skin used to adapt on width alone, and only through fixed pixels: a 320×568
SE and a 430×932 Pro Max got the same screen, so one clipped its last panel and
the other stranded 200px of canvas.

### 14.1 One viewport hook, two axes

`src/hooks/useViewport.tsx` publishes both bands from ONE listener, mounted
once in `App` as `<ViewportProvider>`:

| Band | Range | Devices |
|---|---|---|
| `compact` | 320–379 | SE, mini, small Android |
| `regular` | 380–519 | 12 / 13 / 14 / 15, Pixel, Galaxy |
| `wide` | ≥ 520 | Pro Max landscape, fold open, tablet portrait |
| `short` | < 700 | SE / 8 (667), any phone in landscape |
| `standard` | 700–849 | 13 / 14 / 15 (844–852) |
| `tall` | ≥ 850 | Pro Max (932), Ultra (915+) |

Three rules for using it:

1. It **never** changes what renders — only how much of it renders at once, and
   at what size. Same components, same data, same routes on every device.
2. Prefer CSS. `clamp()`, `dvh` and container queries size things without a
   listener and without a re-render. Reach for the hook only when the decision
   is a **count** — how many rows, how many stat cells — because CSS cannot
   count.
3. One listener per app, through the provider. Never a `resize` listener per
   component.

### 14.2 The shell

- `min-h-dvh`, never `100vh` (§9.6).
- The tab bar and the action bar add `env(safe-area-inset-bottom)` to their
  **padding**, never their height: §4's 58px and 64px are content bands and
  stay 58 and 64 above the inset.
- **Landscape**, i.e. `landscape && height === 'short'`: both bottom bands go to
  52px and the page-header title drops to the 15px desktop scale. A landscape
  phone has ~390px of height and the portrait bands would spend a third of it
  on chrome. Nothing is removed — same tabs, same actions, same destinations.
- **≥ 520 wide** keeps the skin but goes two-column at the GROUP level
  (`MobileGroupGrid`), groups filling in order. Above `md` the desktop system
  takes over as it does today.

### 14.3 The length of the content

A panel shows as many rows as the device can hold and **defers the rest** —
never truncates, never strands empty canvas.

| Helper | short / standard / tall | For |
|---|---|---|
| `useRowBudget()` | 3 / 5 / 7 | List panels |
| `useStatBudget()` | 3 / 4 / 6 | Stat-grid cells |
| `useProseLines()` | 4 / 6 / 8 | `MobileProse` line clamp |

- The **deferral row is not optional**. "Defer, never truncate" means the full
  list is one tap away in a `MobileSheet`, with every column the desktop view
  has, and the row says how many it is deferring.
- Prose clamps by LINES, never pixels: the same 120px is five lines at 13.5px
  and three at 15px, and it cuts a word in half. "Show more" expands in place,
  and appears only when the text actually overflows.
- A panel whose content is a chart or a map gets `aspect-ratio` plus a `dvh`
  cap, never a pixel height.
- Never fill space for its own sake. Three panels' worth of content on a tall
  device simply shows the canvas — that is the ground doing its job.

### 14.4 Container queries

Once the wide band goes two-column, a panel does not know its own width from
the viewport. `.m-cq` (in `index.css`) makes a panel body a container and
`.m-cq-stack` / `.m-cq-hide` respond below 320px of PANEL width. Written as
plain CSS rather than Tailwind variants: the repo pins Tailwind 3.4.17, whose
`@container` variant needs the container-queries plugin, and v2 §7 rules out a
new dependency.

---

## Implementation

`src/components/mobile/` is the skin, and the only place its values live.
Import from `@/components/mobile`, never from the files beneath it.

| Export | Spec |
|---|---|
| `M`, `M_LABEL`, `M_MICRO`, `M_ROW`, `M_PROSE`, `M_TITLE`, `M_STAT`, `M_CODE` | §2, §5 |
| `MobilePanel`, `MobileRow`, `MobileNote`, `MobileChip`, `MobileDot` | §1, §3 |
| `MobileProse` | §14.3 |
| `MobileStatGrid` | §6, §9.2 |
| `MobileButton`, `MobileButtonRow`, `MobileActionBar` | §8, §9.3 |
| `MobileSegmented`, `MobileToggle`, `MobileStepper` | §8 |
| `MobileScreen`, `MobileGroup`, `MobileGroupGrid` | §4 gutter, §13 order, §14.2 |

`src/hooks/useViewport.tsx` is the other half: `ViewportProvider`,
`useViewport`, `useCompactChrome`, `useRowBudget`, `useStatBudget`,
`useProseLines` (§14).

Nothing in that module may be rendered above `md`. A shared component reaching
for it gates the branch on `useIsMobile()` or resets at `md:`.

`<PageHeader skin>` wears the §4 header. The flag is a **migration seam**: it
exists so a converted screen's gutter does not drag the unconverted screens'
with it. Both are clamps now and they differ by two pixels at the floor, so the
seam is nearly closed — it comes out with `PAGE_GUTTER` itself.

### Order of work

1. Shared primitives — the panel, the row, the stat grid, the action bar, the
   segmented control, the toggle. Everything else composes from these.
2. One vertical slice end to end (Simulation Lab + run detail), reviewed
   against the prototype before going wide.
3. The remaining surfaces.
4. Getting Started last — it is the legacy generation and the largest delta.
5. A pass at 320×568, 375×667, 390×844, 430×932, 540×720, 768×1024 and
   844×390 against §9 and §14 — measured, not eyeballed.

### Recorded deviations

Each of these is a place the code does something the sections above do not
literally say. They are here so the next person finds them in the contract
rather than in a diff.

- **The Simulation Lab's segmented control carries five items, not two or
  three (§4).** The skin does not get to reduce a screen's inventory, and the
  Lab has five panes. At 320px the widest label ("Compare") ellipses by a
  hair; from 360px up it fits with room. Wrapping to two rows would cost a
  permanent 76px chrome band at every width to fix one label at one width, a
  smaller type size would add a sixth size to a five-size ladder, and
  scrolling the strip is what §9.5 forbids. A screen that grows a sixth pane
  is two screens (§13), not a tighter control.
- **A stat value steps down inside the 20-28px band when the figure is long.**
  §6 fixes the band, not a single size. An 8-digit seed at 28px overflowed a
  2-up cell at 320px, and a clipped figure is what §12 forbids outright — so
  the type moves and the number never does.
- **`rounded-md` is not the button radius.** `tailwind.config.ts` maps
  `rounded-sm|md|lg` all to `--radius` (4px), so the spec's 6px button is
  written `rounded-[6px]`. Anything reaching for a radius by name gets the
  panel's, silently.
- **The Simulation Lab's gate moved from the footer to the top of the
  content.** The action bar holds actions and nothing else (§8), and §13 puts
  what needs attention at band 3. Its warning acknowledgement is now the
  skin's toggle rather than a checkbox — the same binary control, in the only
  vocabulary the skin has for one.
- **The network lenses lost their "Network structure" section heading.** The
  figures under it are §13.4's numbers band, and a stat grid carries no head —
  the four stat labels name the figures. The kicker-and-hairline rule the three
  pages drew above each block was a borderless section (§12); every other block
  is a panel now, and its head is where the section name lives.
- **The lenses' five-column centrality table is a list of rows.** Same
  reasoning as the Simulation Lab's ledgers: §9.5 forbids the sideways scroll
  and §10 asks a dense table to summarise. The identity is the row label, the
  ranked figure is the value, and every remaining column — labelled — is on the
  mono sub-line. The desktop table's four prominence thresholds become the
  row's dot rather than coloured type.
- **The Project Intelligence composer is 22px, not a full pill.** §7 gives the
  composer the pill radius, and the reference's composer is one line. The
  product's holds a textarea over a control row, so a true `9999px` would bow
  the sides; 22px is a pill at the collapsed height and still reads as one
  expanded.
- **A bottom sheet keeps its one explanatory line.** §4 removes the page
  subtitle, but a sheet is a screen of its own with no tab bar or action bar
  competing for the band, and the line is what several sheets use to say what
  the rows below them do.
- **The landscape band is two 52px bands, not one merged band.** v2 §5.2 asks
  for the action bar and the tab bar to merge into a single 52px strip. They
  do not: the action bar is rendered by each screen, deep in its own tree,
  while the tab bar lives in `PageLayout`, so merging them needs the action to
  escape its screen through a portal — and in a merged strip the action's
  `note` has nowhere to go, which breaks §8's "shown, disabled and explained"
  in exactly the case that rule exists for. Both bands go to 52px instead, so
  landscape chrome falls from 122px to 104px of a ~390px viewport, and every
  control keeps its explanation. Raise it if the single band is worth the
  portal.
- **A documentation body is not line-clamped.** v2 §5.4 lists "doc bodies"
  among the prose that clamps at 4/6/8 lines behind a "Show more". `MobileProse`
  does that for agent output, where a long reply is one turn in a thread. A
  Help page's body is the thing the reader opened the page for; clamping it
  would cost them exactly what the page is for. About's copy is marketing scale
  under §14 rather than app content, and its blocks are short enough that the
  control would never appear.
- **The Help section's figures keep their documentation vocabulary.** The
  architecture diagram, the phase pipeline and the callouts are illustrations
  of a system, not app containers. Their shared primitives — the section head,
  the figures, the reference tables — wear the skin's rules below `md` (the 2px
  group rule instead of a wash, the 12px cell floor, the panel's radius), and
  the illustrations themselves are left alone.
- **`useViewport` is `.tsx`, not the `.ts` v2 §5.1 names.** It exports a
  provider, and the repo's other provider hooks (`useAuth`, `useCapabilities`,
  `useGlobalProject`) are `.tsx` for the same reason.
- **A stat label uppercased by CSS changes a Greek lowercase letter's glyph.**
  "Fill rate α" renders as "FILL RATE Α". The DOM text keeps its case, so
  assistive tech is unaffected, and the reference prototype does the same —
  recorded because it looks like a defect and is not one.

### Status

Converted means: every container on the surface is the panel, the type is the
five sizes, colour is a dot or a chip, the screen assembles in §13's order, and
it wears exactly one `tone="primary"` panel.

**Every surface is converted.** v2 completed the list.

| Surface | State |
|---|---|
| Primitives (`src/components/mobile/`) + `useViewport` | **Done** |
| Chrome — page header, tab bar, credit footer, bottom reservation, page canvas | **Done** — applies to every mobile screen |
| Bottom sheets (`MobileSheet`, `MobileSheetRow`) | **Done** — mobile-only by construction |
| Simulation Lab + run detail | **Done** |
| Policies — page shell, setup bar, stage list, line sheet | **Done** |
| Policies — Run & validate (`RunValidateStage.tsx`) | **Done** — v2. Step shell is the panel and loses its 340px floor; the four stage cards are the stage list; charts take `aspect-ratio`; every ledger button takes the touch floor. |
| Network — product / process / firm (`MobileLens`) | **Done** |
| Getting Started | **Done** |
| Project Intelligence — header, empty state, composer, thread canvas | **Done** |
| Auth | **Done** |
| Project Manager (`DataManager.tsx` + `ProjectCard`) | **Done** — v2. `ProjectCard` branches; the `…` dropdown becomes seven named rows in a sheet; the create and edit forms keep the real controls inside the panel. |
| Developer API (`DeveloperApi.tsx`) | **Done** — v2. Three peer views on the segmented control; every ledger summarises with its full record in a sheet. |
| Super Admin (`AdminLayout` + eight pages) | **Done** — v2. `AdminMobileList` / `AdminMobileRow` in `adminUi` carry all of them; the eight-section nav strip stops scrolling sideways. |
| About & help (About, `DocsLayout`, `docBodies`) | **Done** — v2, at the primitive level. See the deviation on documentation figures. |

Shared components that render inside a converted surface. Each is used by both
platforms, so each takes a class hook (the way `MessageStream` took
`userBubbleClassName`) rather than an edit — `skin` is false everywhere desktop
mounts them, so the desktop trees are byte-identical:

| Component | Hook | Where it shows |
|---|---|---|
| `ResultsDashboard` | `skin` | Simulation Lab — Results |
| `CompareScenariosPanel` | `skin` | Simulation Lab — Compare |
| `MessageStream` → `ProposalCard` → `ProposalCardView` | `skin` | Project Intelligence — the assistant turn |
| `MessageParts`, `piUi` | `md:`-split literals | Project Intelligence — the assistant turn |
| `MLPrediction` | `skin` | all three network lenses — Prediction |
| `PolicyVersionSheets` | its own `isMobile` branch | Policies — version history |

### Verification

There is no visual regression harness in the repo. What each conversion is
checked against:

- `npx tsc --noEmit -p tsconfig.app.json` — **seven** pre-existing errors, all
  in `useErpConnections.tsx`, and nothing else. (The count was recorded as two
  during v1; it is seven, measured against a clean tree.) The three network
  pages carry `@ts-nocheck` for a schema mismatch, so they are checked by
  lifting it temporarily — v2 did, and found no error outside that mismatch.
- `npx eslint` on the touched files, compared against the same files before the
  change — the counts must not move. They did not, on any file v2 touched.
- `node scripts/audit-adaptive-ui.mjs` — the mechanical guard for
  `docs/mobile-ui-spec.md`. Clean, with the seven baseline violations
  untouched.
- `npx vite build`.

**v2's measurement pass.** A headless Chromium at dpr 2–3 over
`/`, `/auth` and `/help` at **320×568, 375×667, 390×844, 430×932, 540×720,
768×1024 and 844×390**, plus the primitives rendered against the built CSS at
five widths. Measured, not eyeballed:

| What | 320 | 390 | 430+ | Spec |
|---|---|---|---|---|
| `documentElement.scrollWidth` vs `clientWidth` | equal | equal | equal | §9.5 — no horizontal scroll on any route at any width |
| `--fs-row` | 13.5px | 14.43px | 15px | §5 floor 13.5 |
| `--fs-title` | 17px | 19.5px | 21px | §5 — "19px @ 390" |
| `--fs-micro` | 10px | 10.53px | 11px | §5 floor 10 |
| `--m-gutter` | 14px | 15.98px | 17.6–18px | §7 — "16px @ 390" |
| `--m-gap` | 18px | 21.83px | 24px | §7 |
| `--m-row-y` | 11px | 12.87px | 14px | §7 |
| Row height (single line) | 44.0px | 44.0px | 46.8px | §8 — never below the 44px floor |
| Panel frame / radius | 1px `#d4d4d4` / 4px | — | — | §1, §7 |
| Head fill / rule | `#fafafa` / 1px `#d4d4d4` | — | — | §1, §2 |
| Row divider | 1px `#e8e8ea` | — | — | §2 inner weight |
| Stat-grid frame / gap fill | `#d4d4d4` / 1px `#e8e8ea` | — | — | §2 |
| `tone="primary"` frame and head | `#18181b` | — | — | §1 |
| `accent` | 2px `#e0930b` | — | — | §1 |
| Row label / sub / chevron ink | `#171717` / `#525252` / `#6b6b6b` | — | — | §2 ink ladder |
| Group label | 10px, 0.14em, uppercase, `#525252` | — | — | §1 |
| Stat value | 28px/600 `tabular-nums` | — | — | §6 |
| Button | 46px, 6px radius | — | — | §8 |
| Toggle | 34×18, off track `#d4d4d4` | — | — | §8 |
| Page canvas | `rgb(237,237,237)` = 93% | — | — | §2 |

Earlier passes found the 4px button radius, the frozen action-bar spacer and
the overflowing 8-digit stat. v2's found nothing outstanding.

**One thing still open, recorded rather than fixed.** The desktop Project
Intelligence tree carries `h-[calc(100vh-150px)]` on the chat grid
(`ProjectIntelligence.tsx`). Mobile returns before it, so no phone renders it,
and changing it is a desktop change this work does not make — but it is the
last `100vh` in the product and it is on a container that holds text.
