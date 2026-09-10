# Mobile skin — specification

The contract for every SuReSuite app surface at **≤ `md` (768px)**. It is a
**skin**, not a UX change: same routes, same flows, same data, same words, same
control inventory. It changes how a screen looks and nothing about what it
does. If a change would alter what a user can do, where a tap takes them, or
what a screen says, it is out of scope.

Desktop keeps the existing system unchanged. Everything here is additive at the
mobile breakpoint; nothing in it may re-tint or re-space a shared component
above `md`.

Source: the `Mobile UI Rules` / `SuReSuite Mobile` design handoff. Values below
are taken from the built prototype and are exact.

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

Every piece of content on a mobile screen is a **black-headed panel**.

```
1px #18181b border, 4px radius, overflow hidden
├─ head:  #18181b fill, 8px 12px padding
│         left:  mono 10px uppercase 0.14em #fff  (the label)
│         right: mono 10px #fff                   (one counter, optional)
└─ body:  #fff, rows divided by 1px #e4e4e4, 12–13px vertical padding
```

There is no second container style. Tables, lists, forms, stat groups, alerts
and agent output are all this panel at different row heights. A quieter
**secondary** variant swaps the border to `#d4d4d4` and the head to white with
`#525252` label text; it is for supporting panels only.

If a screen needs a container this cannot express, the answer is a different
arrangement of panels — not a new container.

Implementation: `MobilePanel` / `MobileRow` in `src/components/mobile/`.

## 2. Ink and ground

| Value | Use | Never |
|---|---|---|
| `#18181b` | Ink, panel frame, panel head, primary button, active segment | A page background |
| `#3f3f46` | Body copy and prose | A heading |
| `#525252` | Secondary text, micro-labels, chevrons, inactive tab | Anything below 10px |
| `#e4e4e4` | Row divider inside a panel | A panel outline |
| `#d4d4d4` | Secondary panel outline, stat-grid gap line, toggle-off track | Text |
| `#ffffff` | Panel interior, tab bar, thread canvas | The page canvas |
| `hsl(var(--m-canvas))` — 96% | The page canvas, every screen | Re-tinting per page |

`#8a8a8a` secondary text and `#f4f4f4` dividers are **retired** on mobile: they
are legible on a desk monitor and not in daylight. Every mobile occurrence
steps up to `#525252` and `#e4e4e4`.

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

| Size | Family / weight | Use |
|---|---|---|
| 10px | mono, uppercase, `0.14em` | Panel head label, stat label, agent badge |
| 10.5–11px | mono, `0.04em` | Row sub-line, ids, counters, timestamps |
| 13–13.5px | Inter 500/600 | Row label — the workhorse |
| 14.5px | Inter 400, `1.55` | Agent prose and chat only |
| 19px | Inter 600, `-0.019em` | The screen title, one per screen |
| 20–28px | Inter 600, `-0.022em`, tabular | Stat values only |

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

Spacing steps: 2 / 4 / 6 / 8 / 10 / 12 / 16. Row padding 12–13px vertical, 12px
horizontal. Stat-cell padding 11–12px.

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
5. No viewport units inside the app shell. No horizontal scroll except inside a
   deliberate full-table sheet or a code block.

## 10. Density

Rows are 12–13px vertical padding, ≈44px tall — both the touch minimum and the
reading rhythm. **Do not port the desktop 5–9px ledger rows to mobile.**

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
- A second container style — no bare cards, no borderless sections, no coloured
  panels.
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
3. The one thing that changed or needs attention — a black-headed panel.
4. The numbers — one stat grid.
5. The list — one or more black-headed panels, ordered by what the user acts
   on first.
6. Consequence or caveat — an amber-framed line, never more than two sentences.
7. The action bar.

A screen that needs more than four panels is two screens. Raise it rather than
cramming.

---

## Implementation

`src/components/mobile/` is the skin, and the only place its values live.
Import from `@/components/mobile`, never from the files beneath it.

| Export | Spec |
|---|---|
| `M`, `M_LABEL`, `M_MICRO`, `M_ROW`, `M_PROSE`, `M_TITLE`, `M_STAT` | §2, §5 |
| `MobilePanel`, `MobileRow`, `MobileNote`, `MobileChip`, `MobileDot` | §1, §3 |
| `MobileStatGrid` | §6, §9.2 |
| `MobileButton`, `MobileButtonRow`, `MobileActionBar` | §8, §9.3 |
| `MobileSegmented`, `MobileToggle`, `MobileStepper` | §8 |
| `MobileScreen` | §4 gutter, §13 order |

Nothing in that module may be rendered above `md`. A shared component reaching
for it gates the branch on `useIsMobile()` or resets at `md:`.

`<PageHeader skin>` wears the §4 header. The flag is a **migration seam**: it
exists so a converted screen's flat 16px gutter does not drag the unconverted
screens' fluid clamp with it. It comes out when the last surface converts.

### Order of work

1. Shared primitives — the panel, the row, the stat grid, the action bar, the
   segmented control, the toggle. Everything else composes from these.
2. One vertical slice end to end (Simulation Lab + run detail), reviewed
   against the prototype before going wide.
3. The remaining surfaces.
4. Getting Started last — it is the legacy generation and the largest delta.
5. A pass at 320px, 360px, 390px and 430px against the five §9 rules.

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
- **A stat label uppercased by CSS changes a Greek lowercase letter's glyph.**
  "Fill rate α" renders as "FILL RATE Α". The DOM text keeps its case, so
  assistive tech is unaffected, and the reference prototype does the same —
  recorded because it looks like a defect and is not one.

### Status

| Surface | State |
|---|---|
| Primitives (`src/components/mobile/`) | Done |
| Chrome — header, tab bar, credit footer, bottom reservation | Done |
| Simulation Lab + run detail | Done |
| Policies — page shell, setup bar, stage list, line sheet | Done |
| Policies — Run & validate stage (`RunValidateStage.tsx`) | Not started; no mobile branch today |
| Project Intelligence | Not started |
| Project Manager | Not started |
| Network (product / process / firm) — mobile composition | Done; `MLPrediction` inside it is a shared desktop component and unconverted |
| Developer API · Super Admin · About & help · Auth | Not started |
| Getting Started | Not started |
