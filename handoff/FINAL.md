# FINAL — the remaining delta, as complete files

**Read this file only.** It contains the finished contents of every file that
changes. Do not consult diffs elsewhere; replace each file wholesale with the
block given here.

Repo: `suresuite/suresuite-v001-3-f6699a5b`, branch `main`, verified at commit
`cd36c0e41644`.

---

## 0. Where the repo already is (verify, do not redo)

The mobile redesign is **already implemented and merged**. Confirm each, then stop
touching it:

| Landed | Proof |
|---|---|
| Fluid gutter + type tokens | `src/index.css` has `--fs-page-title/-section/-stat`; `shared/PageBody.tsx` exports `PAGE_GUTTER`, `PAGE_GUTTER_BLEED` |
| 44px floor + mobile back | `shared/PageHeader.tsx` — `min-h-11 md:min-h-0`, `h-11 w-11 … md:hidden` |
| Mobile shell | `components/MobileNav.tsx` (`MobileTabBar` + `MobileNavDrawer`), mounted in `shared/PageLayout.tsx`, sidebar wrapped `hidden md:block` |
| Missing routes | `pages/Profile.tsx`, `pages/Forbidden.tsx`, `pages/DeveloperApi.tsx` |
| Responsive tables | `shared/ResponsiveLedger.tsx`, `FROZEN_CELL` / `FROZEN_CELL_ON_TINT` |
| Adaptive text | `lib/ui/labels.ts`, `shared/AdaptiveText.tsx`, exported from `shared/index.ts` |
| Audit + CI | `scripts/audit-adaptive-ui.mjs`, `scripts/adaptive-ui-baseline.json`, `.github/workflows/ui-audit.yml`, `lint` runs `audit:ui` |

**The delta is exactly five things**, in this order: §1 the iOS safe-area defect
(4 files), §2 the 16 baselined violations, §2.5 the policy-grid interior — the
screen a planner uses most — §2.6 the remaining fixed-width rails and selects
across every other page, then §3 the model extraction. §2.6.5 is the page-by-page
coverage table; nothing outside it remains.

---

## 1. The iOS safe-area defect — do this first

`env(safe-area-inset-*)` resolves to **0** on iOS Safari unless the viewport
declares `viewport-fit=cover`. All three bottom-pinned elements compute clearance
from it, so all three are wrong on a physical iPhone and correct in every desktop
browser at every width. That is why review passed.

### 1.1 `index.html` — complete file

```html
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <!-- viewport-fit=cover is load-bearing: without it iOS Safari resolves every
       env(safe-area-inset-*) to 0, and the bottom tab bar, the credit footer and
       PageLayout's bottom reservation all silently lose their clearance. It
       reproduces on hardware only. -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="color-scheme" content="light" />
  <title>SuReSuite-v001</title>
  <link rel="icon" href="/favicon.ico" type="image/x-icon" />
  <meta name="description" content="SC Analytics Dashboard" />
  <meta property="og:image" content="/og-image.svg" />

</head>

<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>

</html>
```

### 1.2 `src/components/MobileNav.tsx` — add the height exports

Insert these two lines immediately after the import block (before `const TABS`).
Change nothing else in this file.

```ts
/** Bottom-chrome geometry, in px, published so PageLayout reserves space FROM
 *  these rather than from a hand-summed literal. Change a height here and the
 *  reservation follows; it cannot drift. */
export const MOBILE_TABBAR_H = 56;      // min-h-[56px] on each tab
export const MOBILE_TABBAR_BORDER = 1;  // border-t
```

### 1.3 `src/components/Footer.tsx` — complete file

Two changes: the exported height, and `+ 1px` for the tab bar's border, which the
current offset ignores — so the black bar sits flush on the tab bar with no gap.

```tsx
import React from "react";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { MOBILE_TABBAR_H, MOBILE_TABBAR_BORDER } from "@/components/MobileNav";

/** Single-line credit bar height, in px (px-3 py-2 text-xs). PageLayout reserves
 *  space from this. */
export const MOBILE_FOOTER_H = 32;

interface FooterProps {
  isCollapsed?: boolean;
  hasNavBar?: boolean;
}

const Footer: React.FC<FooterProps> = ({ isCollapsed = false, hasNavBar = true }) => {
  const isMobile = useIsMobile();
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return localStorage.getItem("ss.footerCredit") === "dismissed";
    } catch {
      return false;
    }
  });

  const dismiss = () => {
    try {
      localStorage.setItem("ss.footerCredit", "dismissed");
    } catch {
      /* ignore storage failures */
    }
    setDismissed(true);
  };

  return (
    <footer
      className={`fixed left-0 right-0 z-30 md:bottom-0 ${
        dismissed ? "hidden md:block" : ""
      }`}
      style={
        isMobile
          ? {
              // sits ABOVE the tab bar: its height, its border, then the inset.
              // The border term is what gives the visible gap.
              bottom:
                `calc(${MOBILE_TABBAR_H + MOBILE_TABBAR_BORDER}px` +
                ` + env(safe-area-inset-bottom, 0px))`,
            }
          : undefined
      }
    >
      <div
        className={`relative text-white pl-3 pr-10 py-2 text-xs text-center transition-all duration-500 md:pr-3
          bg-[linear-gradient(to_right,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.60)_10%,rgba(0,0,0,0.64)_22%,rgba(0,0,0,0.68)_34%,rgba(0,0,0,0.72)_44%,rgba(0,0,0,0.78)_50%,rgba(0,0,0,0.72)_56%,rgba(0,0,0,0.68)_66%,rgba(0,0,0,0.64)_78%,rgba(0,0,0,0.60)_90%,rgba(0,0,0,0.55)_100%)]
          md:bg-[linear-gradient(to_right,rgba(0,0,0,0.45)_0%,rgba(0,0,0,0.50)_10%,rgba(0,0,0,0.56)_22%,rgba(0,0,0,0.61)_34%,rgba(0,0,0,0.66)_44%,rgba(0,0,0,0.68)_50%,rgba(0,0,0,0.66)_56%,rgba(0,0,0,0.61)_66%,rgba(0,0,0,0.56)_78%,rgba(0,0,0,0.50)_90%,rgba(0,0,0,0.45)_100%)]
          ${hasNavBar ? (isCollapsed ? "ml-0 md:ml-14" : "ml-0 md:ml-48") : ""}`}
        style={{
          WebkitBackdropFilter: "blur(8px)",
          backdropFilter: "blur(8px)",
          textShadow: "0 1px 2px rgba(0,0,0,0.55)",
        }}
      >
        Developed by <span className="font-semibold">Phu Nguyen</span> &{" "}
        <span className="font-semibold">Prof. Dmitry Ivanov</span> (HWR Berlin) · WP4 - ACCURATE project, funded by the European Union
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss credit bar"
          className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center text-white md:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </footer>
  );
};

export default Footer;
```

### 1.4 `src/components/shared/PageLayout.tsx` — complete file

Replaces the hand-summed `8.5rem` with the measured sum.

```tsx
import React from 'react';
import Navbar from '@/components/Navbar';
import Footer, { MOBILE_FOOTER_H } from '@/components/Footer';
import PasswordExpiryBanner from '@/components/PasswordExpiryBanner';
import {
  MobileTabBar,
  MobileNavDrawer,
  MOBILE_TABBAR_H,
  MOBILE_TABBAR_BORDER,
} from '@/components/MobileNav';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: React.ReactNode;
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

// Bottom chrome on mobile, measured rather than guessed: tab bar + its border +
// the credit bar, then 16px of breathing room, then the device inset. Derived so
// a height change in either component cannot leave content underneath.
const MOBILE_CHROME_PX =
  MOBILE_TABBAR_H + MOBILE_TABBAR_BORDER + MOBILE_FOOTER_H + 16;

export function PageLayout({ children, isCollapsed, setIsCollapsed }: PageLayoutProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const isMobile = useIsMobile();

  return (
    <div className="min-h-screen bg-background">
      {/* sidebar is desktop-only now — the bottom tab bar + drawer replace it below md */}
      <div className="hidden md:block">
        <Navbar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      </div>
      <div
        className={cn(
          'min-h-screen overflow-x-hidden bg-[hsl(var(--surface-sunken))] md:pb-10 md:transition-all md:duration-300',
          'ml-0',
          isCollapsed ? 'md:ml-14' : 'md:ml-48'
        )}
        style={
          isMobile
            ? {
                paddingBottom:
                  `calc(${MOBILE_CHROME_PX}px + env(safe-area-inset-bottom, 0px))`,
              }
            : undefined
        }
      >
        <PasswordExpiryBanner />
        {children}
      </div>
      <Footer isCollapsed={isCollapsed} hasNavBar />
      <MobileTabBar onOpenDrawer={() => setDrawerOpen(true)} />
      <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
```

### 1.5 `scripts/audit-adaptive-ui.mjs` — add the regression guard

Append inside the rule-checking pass, before the tally. `push`, `files`, `ROOT`
and `join` already exist in the file.

```js
// §2.6 — a safe-area guard is inert on iOS unless the viewport opts in. The
// guards live in .tsx; the cause lives in index.html, which no other rule reads.
{
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  if (!/viewport-fit\s*=\s*cover/.test(html)) {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const i = src.indexOf('env(safe-area-inset-');
      if (i >= 0) {
        push(
          file,
          src.slice(0, i).split('\n').length,
          'safe-area-inert',
          '2.6',
          'env(safe-area-inset-*) resolves to 0 on iOS: index.html lacks viewport-fit=cover',
        );
      }
    }
  }
}
```

Three violations before §1.1, zero after. **Never baseline these** — a live device
defect is not backlog.

---

## 2. The 16 baselined violations

`scripts/adaptive-ui-baseline.json` records them. Run:

```bash
node scripts/audit-adaptive-ui.mjs --all
```

It prints file, line, rule and spec section for each. Fix in this order and
ratchet the baseline down after each file (`--update-baseline`):

| Priority | File | Count | Rule |
|---|---|---|---|
| **1** | `src/pages/InteractiveNetworkSpace.tsx` | 1 | **§3.3** numbers never adapt |
| **1** | `src/pages/ProcessLevelNetwork.tsx` | 1 | **§3.3** numbers never adapt |
| 2 | `src/pages/help/docBodies.tsx` | 1 | §2.7 tables |
| 3 | `src/pages/GettingStarted.tsx` | 9 + 1 | §6 anti-pattern, C6 |
| 3 | `src/pages/DeveloperApi.tsx` | 2 | §6 |
| 3 | `src/components/shared/YouTubeEmbed.tsx` | 1 | C6 |

The two **§3.3** items are first because a violation there means a figure is being
shortened, rounded or abbreviated to fit. Numbers are load-bearing in this
product; scroll the table instead (§2.7). Everything else is cosmetic drift.

`GettingStarted.tsx` is the legacy generation (design-system §3.10 — gradients,
`rounded-2xl`, six colours). Fix the §6 anti-patterns; **do not** modernise the
page to the current vocabulary unless asked.

Use the §3.1 ladder in order, descending only when the rung above genuinely fails
at 320px: wrap → `truncate`+`title` → `line-clamp-2`+disclosure → shorter label
variant in `lib/ui/labels.ts` → icon+`aria-label`+`title` → disclosure card.

---

## 2.5 Policy-grid interior — the real remaining gap

`src/components/policies/` holds the two largest UI files in the repo and has
**4** `md:` occurrences in the whole folder. The page shell is correct on mobile
(every page imports `PAGE_GUTTER`); the grid *inside* it is still desktop-only.
This is the screen a planner uses most, so do it before §3.

Observed at `cd36c0e`:

| File | Size | Mobile branches |
|---|---|---|
| `StagePolicyTable.tsx` | 67 kB | **none** |
| `RunValidateStage.tsx` | 124 kB | 3 × `md:grid-cols` only |
| `PolicySetupBar.tsx` | — | none |

### A. Fixed 192px label columns

Two identical occurrences — `PolicySetupBar.tsx:267` and
`RunValidateStage.tsx:1315`. At 320px this column consumes 60% of the width
before any data renders. It is a desktop rail; below `md` the label belongs
above its content.

Find (both files, identical string):

```
<div className="flex w-[192px] shrink-0 flex-col justify-center gap-[3px] pr-2.5">
```

Replace:

```
<div className="flex w-full min-w-0 flex-col justify-center gap-[3px] pb-2 md:w-[192px] md:shrink-0 md:pb-0 md:pr-2.5">
```

The parent row must then stack. Find the nearest enclosing `flex` wrapper in each
file and add `flex-col md:flex-row` — do not change `items-*`, which the desktop
row depends on.

### B. `shrink-0` on chip rows that can be long

`PolicySetupBar.tsx` lines 213, 225, 248 mark whole chip groups as
non-shrinkable, so they push the bar past the viewport (spec §2.5, rule 2 —
`shrink-0` belongs on icons and fixed chrome, never on a group that grows with
content).

| Line | Find | Replace |
|---|---|---|
| 213 | `<span className="flex shrink-0 items-center gap-2">` | `<span className="flex min-w-0 flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap">` |
| 225 | `<span className="inline-flex shrink-0 items-center gap-1.5">` | `<span className="inline-flex min-w-0 items-center gap-1.5 md:shrink-0">` |
| 248 | `<span className="flex shrink-0 items-center gap-2.5">` | `<span className="flex min-w-0 flex-wrap items-center gap-2.5 md:shrink-0 md:flex-nowrap">` |

Line 85's `inline-flex shrink-0 rounded-sm border bg-white p-[3px]` is a segmented
control of fixed width — **leave it**. Line 61's `h-[26px] shrink-0` chip is
fixed-height chrome, but 26px is below the 44px floor; see D.

### C. Freeze the identifying column

`StagePolicyTable.tsx` is a wide editable grid. Per §2.7 it keeps the table and
scrolls sideways — never reflow it to cards, because the column set *is* the
information. The helpers already exist in `shared/index.ts`:

```tsx
import { FROZEN_CELL, FROZEN_CELL_ON_TINT } from '@/components/shared';
```

Apply `FROZEN_CELL_ON_TINT` to the first `<th>` (it already sits on an opaque
`#fafafa` fill) and `FROZEN_CELL` to the first `<td>` of every row. Both release
at `md:static`, so the desktop table stays byte-identical and its hover tint
still paints across the row.

Add the affordance line directly under the scroll container:

```tsx
<p className="mt-2 px-0.5 font-mono text-[10.5px] text-muted-foreground md:hidden">
  swipe the table sideways for the remaining columns
</p>
```

### D. Sub-44px controls in the grid

Four controls sit at 15px or smaller and are the primary way to edit a policy row:

- `StagePolicyTable.tsx:1004` and `:1672` — `grid h-[15px] w-[15px] shrink-0 place-items-center font-mono text-[10px] …`
- `PolicySetupBar.tsx:61` — `flex h-[26px] shrink-0 items-center …`

Use the sanctioned pattern from spec §2.4 — pad the hit area, negate the layout
cost, so nothing moves visually:

```
h-[15px] w-[15px]
  →  h-[15px] w-[15px] -m-[14px] box-content p-[14px] md:m-0 md:p-0
```

`box-content` keeps the 15px glyph box intact while padding grows the target to
43px; the negative margin returns the space. For line 61: `min-h-11 md:min-h-0`
on the existing `h-[26px]`.

Line 1014 (`w-[15px] … text-[#c4c4c4]`) and 1106/1127 are static marks, not
buttons — leave them.

### E. Bulk edit as a sheet — scope is narrower than it looks

**Verified at `cd36c0e`, do not re-litigate:**

- `StagePolicyTable.tsx` has **no row-selection model.** Its only `Set` is
  `collapsedGroups` (line 363); there is no `Checkbox` import and no set of
  selected row keys. Adding one is a state-shape change, which §4 forbids in a
  UI-only PR.
- `BulkEditDialog.tsx` **does** exist and implements the sparse patch, with the
  copy *"Empty fields are skipped so the override stays sparse"* — but its only
  caller is `PolicyOverridesTable.tsx` (lines 7, 133), and that file's own
  comment says *"Edit reuses BulkEditDialog with a single target."*

So multi-row bulk edit **is not in this PR.** What is in scope:

**E1 — render the existing dialog as a sheet below `md`.** A centred dialog is
the wrong container on a phone. `BulkEditDialog` keeps its logic, its
`targetKeys` contract and its copy verbatim; only the shell changes, per spec
§4.4. Its heading already pluralises correctly
(`row{targetKeys.length === 1 ? "" : "s"}`) — leave that alone.

**E2 — the selection bar is dead code until a selection model exists.** Do not
add the markup. If you want it, that is a separate, non-UI-only PR: it needs
`selectedKeys` state in `StagePolicyTable`, a checkbox column, and
`targetKeys={[...selectedKeys]}` threaded to the existing dialog. Report it as
follow-up work; do not smuggle it in here.

This is the one place where the prototype is **ahead of** the product rather than
behind it. The mobile demo has row multi-select and a sheet-based bulk patch
because I built the selection model there; the real `StagePolicyTable` never had
one. Porting the visual treatment without the state is not possible, and
pretending otherwise is how a handoff produces a broken screen.

### F. Verify

At 320px on `/policies`, with the §5 probe:

- `overflow` false — the setup bar wraps rather than pushing the page wide.
- `small` empty — every grid control clears 44px.
- The first column stays put while the table scrolls sideways; at 1280 it does not.
- Desktop at 1280 pixel-identical to `main`.

---

## 2.6 Every remaining page — the full sweep

A repo-wide search for fixed widths and `shrink-0` rails found these. Each is a
literal string from `cd36c0e`; apply as given. Pattern in every case: the mobile
value is fluid, the desktop value is the **existing** literal moved behind `md:`,
so desktop stays pixel-identical.

### 2.6.1 Simulation Lab — a 256px rail that never collapses

`src/pages/SimulationLab.tsx` — at 320px this aside takes 80% of the width.
**Two edits, both required**; the aside alone does nothing while its parent is a
`flex-row`.

Parent (one occurrence in the file):

```
<div className="flex gap-4 items-start">
  →
<div className="flex flex-col gap-4 md:flex-row md:items-start">
```

The aside itself:

```
<aside className="w-64 shrink-0">
  →
<aside className="w-full min-w-0 md:w-64 md:shrink-0">
```

Its sibling `<div className="flex-1 min-w-0 flex flex-col gap-3">` already
carries `min-w-0` — leave it. Stacked, the scenario rail sits above the pane,
which is the right order: you pick a scenario, then work on it.

`src/components/sim/StageRail.tsx:58` — the label column constant:

```
export const RAIL_LABEL_COL = "w-[220px] shrink-0";
  →
export const RAIL_LABEL_COL = "w-full min-w-0 md:w-[220px] md:shrink-0";
```

### 2.6.2 Policy sheet wider than the phone

`src/components/policies/ParameterSheet.tsx:55` is **392px fixed** — wider than
320, 360 and 375. It clips on three of the six target widths:

```
<SheetContent className="w-[392px] overflow-y-auto sm:max-w-[392px]">
  →
<SheetContent className="w-full overflow-y-auto sm:w-[392px] sm:max-w-[392px]">
```

`src/components/policies/FocusedStage.tsx:188` — a 340px dropdown, 20px wider
than the 320 floor:

```
<DropdownMenuContent align="end" className="w-[340px]">
  →
<DropdownMenuContent align="end" className="w-[min(340px,calc(100vw-1.5rem))]">
```

`calc(100vw - 1.5rem)` leaves the 12px fluid gutter on each side.

### 2.6.3 Fixed-width selects — ten of them, all pages

Every one is a `SelectTrigger` with a hard pixel width and an `h-7`/`h-8`/`h-9`
height: it cannot shrink, and it is below the 44px floor.

**They split into two cases, and the wrong fix on the wrong case breaks the
header.** The test is deterministic — read the JSX and ask: *is this trigger
inside `PageHeader`'s `rightContent={…}` prop?*

**Case A — inside `rightContent`.** `PageHeader`'s right slot is `shrink-0` and
sits beside a `min-w-0 flex-1 truncate` title, so the row must stay horizontal.
`w-full` here would starve the title. Use a clamp instead, which keeps the
desktop value exactly (38vw exceeds the literal at every width ≥768, so it pins
to the literal) and yields ~122px at 320:

```
className="w-[200px] h-9"
  →
className="h-9 w-[clamp(120px,38vw,200px)]"
```

Do **not** add `min-h-11` to a Case A trigger: spec §0.3 makes the 44px floor a
mobile rule, and `PageHeader` already applies its own floor to the slot's
controls. Adding a second one double-pads the header.

**Case B — in page content.** Full width below `md`, literal above:

```
className="h-7 w-[160px] text-xs"
  →
className="h-7 min-h-11 w-full min-w-0 text-xs md:min-h-0 md:w-[160px]"
```

| File : line | Case | Literal to preserve |
|---|---|---|
| `SimulationLab.tsx:290` | **A** — `rightContent`, verified | `200px` |
| `ProjectPolicies.tsx:178` | **A** — `rightContent`, verified | `210px` |
| `FirmLevelNetwork.tsx:1146` | read it — apply the test | `180px` |
| `ProcessLevelNetwork.tsx:1124` | read it — apply the test | `160px` |
| `ProcessLevelNetwork.tsx:1204` | read it — apply the test | `180px` |
| `ProductLevelNetwork.tsx:915` | read it — apply the test | `180px` |
| `sim/ExperimentDesigner.tsx:279` | **B** | `160px` |
| `sim/ExperimentDesigner.tsx:337` | **B** | `260px` |
| `sim/PlaybookPicker.tsx:55` | **B** | `220px` |
| `sim/ReplicationSeedExplorer.tsx:80` | **B** (inside `cn()`) | `210px` |

For Case B, if the trigger sits in a `flex` row beside a label, that row also
needs `flex-col items-stretch md:flex-row md:items-center` — a full-width select
inside a `flex-row` squeezes its neighbour instead of stacking.

### 2.6.3a `ProjectPolicies` header carries four controls

Verified: its `rightContent` holds a `Segmented` with three options **plus** the
210px project select. At 320px that is more than the slot can hold, and spec §4.1
caps the mobile right slot at three controls.

Move the tab group into the page body below `md`, where it has full width, and
leave the desktop header untouched. In `src/pages/ProjectPolicies.tsx`, wrap the
`<Segmented …/>` in `rightContent` with `<span className="hidden md:contents">`,
then render a second copy as the first child of the content column inside
`<div className="md:hidden">`. `md:contents` is the right hiding mechanism here —
it removes the wrapper from layout entirely on desktop, so the slot's flex
geometry is unchanged.

Both copies drive the same `tab` state; this is presentation only.

| File : line | Find | Replace |
|---|---|---|
| `SimulationLab.tsx:290` | `className="w-[200px] h-9"` | `className="h-9 min-h-11 w-full min-w-0 md:min-h-0 md:w-[200px]"` |
| `ProjectPolicies.tsx:178` | `className="h-8 w-[210px] text-[12px]"` | `className="h-8 min-h-11 w-full min-w-0 text-[12px] md:min-h-0 md:w-[210px]"` |
| `FirmLevelNetwork.tsx:1146` | `className="w-[180px] h-9"` | `className="h-9 min-h-11 w-full min-w-0 md:min-h-0 md:w-[180px]"` |
| `ProcessLevelNetwork.tsx:1124` | `className="w-[160px] h-9"` | `className="h-9 min-h-11 w-full min-w-0 md:min-h-0 md:w-[160px]"` |
| `ProcessLevelNetwork.tsx:1204` | `className="w-[180px] h-9"` | `className="h-9 min-h-11 w-full min-w-0 md:min-h-0 md:w-[180px]"` |
| `ProductLevelNetwork.tsx:915` | `className="w-[180px] h-9"` | `className="h-9 min-h-11 w-full min-w-0 md:min-h-0 md:w-[180px]"` |
| `sim/ExperimentDesigner.tsx:279` | `className="h-7 w-[160px] text-xs"` | `className="h-7 min-h-11 w-full min-w-0 text-xs md:min-h-0 md:w-[160px]"` |
| `sim/ExperimentDesigner.tsx:337` | `className="h-7 w-[260px] text-xs"` | `className="h-7 min-h-11 w-full min-w-0 text-xs md:min-h-0 md:w-[260px]"` |
| `sim/PlaybookPicker.tsx:55` | `className="h-8 text-xs w-[220px]"` | `className="h-8 min-h-11 w-full min-w-0 text-xs md:min-h-0 md:w-[220px]"` |
| `sim/ReplicationSeedExplorer.tsx:80` | `cn("h-7 w-[210px] text-[11px]", className)` | `cn("h-7 min-h-11 w-full min-w-0 text-[11px] md:min-h-0 md:w-[210px]", className)` |

Where a select sits in a flex row beside a label, that row also needs
`flex-col items-stretch md:flex-row md:items-center` — a full-width select inside
a `flex-row` will otherwise squeeze its neighbour instead of stacking.

### 2.6.4 Already correct — do not touch

Verified as having proper mobile branches. Changing these would be regression:

| File | Why it is fine |
|---|---|
| `sim/StageRail.tsx:70,81,260` | `md:flex-nowrap`, `md:overflow-visible`, `md:w-auto md:flex-1 md:shrink md:basis-0` |
| `sim/DisruptionScheduleEditor.tsx:40–87` | all six controls carry `min-h-11 md:min-h-0` |
| `sim/ExperimentDesigner.tsx:195,244` | `md:grid-cols-3` collapses |
| `sim/ItemSeriesExplorer.tsx:187,188` | `md:grid-cols-[240px_minmax(0,1fr)]` + `md:border-r` |
| `AuthHeroStrip.tsx:102` | `hidden … md:flex` — never rendered on mobile |
| `MobileNav.tsx:100` | 300px drawer, inside the 320 floor |
| `Landing.tsx:146` | `sm:min-w-[180px]` — fluid below `sm` |
| `About.tsx:196` | fixed logo box, not content |
| admin `max-w-[…]` cells | `max-w` + `truncate`, which is the §3.1 rung-2 fix |
| `AdminUserAccess.tsx:247` | `w-full … sm:w-[210px]` |

### 2.6.5 Coverage, stated plainly

| Page | Shell | Interior |
|---|---|---|
| Getting Started | ✓ `PAGE_GUTTER` | legacy generation; §2 fixes its 10 violations |
| Project Manager | ✓ | ✓ `PAGE_GUTTER`, no fixed rails found |
| Product / Process / Firm level | ✓ | §2.6.3 selects; §2 fixes ProcessLevel's §3.3 |
| Interactive space | ✓ | §2 fixes its §3.3; 3D is desktop-only by decision |
| Policies | ✓ | **§2.5** A–D + E1 · §2.6.2 sheet · §2.6.3 select · §2.6.3a header |
| Simulation Lab | ✓ | **§2.6.1** rail + §2.6.3 selects |
| Project Intelligence | ✓ | ✓ ChatSidebar/Composer already carry `min-h-11 md:min-h-0` |
| Developer API | ✓ | §2 fixes its 2 violations |
| Profile · Forbidden | ✓ | ✓ built mobile-first |
| Super Admin (7) | ✓ | ✓ `useIsMobile` card branch on all seven |
| Landing · About · Auth · Help | ✓ | ✓ `clamp()` gutters, `sm:`/`md:` branches |

After §1, §2, §2.5 and §2.6 every row above is complete as a **UI-only** change.

One item is deliberately excluded and must be reported, not implemented:
multi-row bulk edit in `StagePolicyTable` (§2.5 E2) requires a selection model
the component does not have. §3 is structural only.

---

## 3. Model extraction — separate PR, zero visual change

```
src/lib/model/
  network.ts      netFor, netAnalyse, centrality
  simulation.ts   simModel, convergence
  index.ts
```

Move data and computation out of the page components; each screen then renders
both layouts from one source, so a change is physically unable to land on one
platform and miss the other. Verify by diffing rendered output before and after —
it must be identical.

---

## 4. The two constraints, on every commit

**UI-only.** Permitted: JSX structure, `className`, Tailwind utilities,
`aria-*`/`title`, presentational extraction, a label variant on a display
constant, a purely visual local `useState`. Forbidden: Supabase queries, RPC
names or arguments, Zod schemas, engine parameters, computation, validation,
routing, RoleGuard/capability resolution, any state shape another component
reads, and any number a user could act on. If a layout fix appears to need a
logic change, **stop and report it**.

**Both platforms, same commit.** One breakpoint: 768px (`useIsMobile`, Tailwind
`md:`). Never add a second. State both layouts in the PR body:

```md
## Desktop (≥768px)
<what changed, or "unchanged — mobile-only layout work">
## Mobile (<768px)
<what changed>
## UI-only
- [ ] No query/RPC/schema/engine/validation/routing change
- [ ] No user-visible number changed
## Verified at
320 · 360 · 375 · 390 · 414 · 768 · 1280 · landscape 874×402 · **a physical iPhone**
```

---

## 5. Verification

### Static

```bash
npm run lint          # eslint + audit:ui
node scripts/audit-adaptive-ui.mjs --all
```

### Widths — 320 / 360 / 375 / 390 / 414 / 768 / 1280

```js
const w = window.innerWidth;
const overflow = document.documentElement.scrollWidth > w;
const small = [...document.querySelectorAll('button,a,[role=button],input,select')]
  .filter(el => { const r = el.getBoundingClientRect();
    return r.width && (r.width < 44 || r.height < 44); })
  .map(el => el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24));
console.log(w, { overflow, small: w < 768 ? small : 'n/a ≥768' });
```

`overflow` must be false at every width. `small` must be empty below 768; above
it the audit's `h-8`/`h-9` is correct and the check does not apply.

Desktop at 1280 must be **pixel-identical** to `main`.

### On a physical iPhone — not the simulator, not a resized browser

This is the step that was skipped, and the only one that catches §1:

1. Tab labels clear the home indicator; "More" registers on the first tap.
2. A visible gap sits between the black credit bar and the tab bar.
3. Scrolled to the bottom of any page, the last row of content clears the credit bar.
4. Rotate to landscape: `viewport-fit=cover` also enables the left/right insets —
   check nothing hides behind the notch, and that sheets go full-height (§2.6).

### Numbers

Diff the rendered numeric text at 320 and at 1280. Every figure must match
exactly — no truncation, no rounding, no abbreviation.
