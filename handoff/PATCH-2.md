# PATCH 2 — two parent fixes my first patch missed

**This is a defect in `PATCH-1.md` item 4, not in the work that applied it.**

Item 4 changed a *shared constant*:

```
export const RAIL_LABEL_COL = "w-full min-w-0 md:w-[220px] md:shrink-0";
```

I checked that the three PAIRED spots got their parents stacked. I did not check
the constant's other consumers. It has three, and **all three are compact rows
that do not stack**:

| Consumer | Parent | Stacks below `md`? |
|---|---|---|
| `PolicySetupBar.tsx:209` — row A, model version | `ROW` = `flex items-center gap-2.5 px-3 py-1.5` | **no** |
| `PolicySetupBar.tsx:242` — row B, planning unit | same `ROW` | **no** |
| `StageRail.tsx:157` — `RailCollapsedRow` | `flex items-center px-3 py-1.5 border-b` | **no** |

Below `md` the label span now takes `w-full` inside a non-stacking row whose
siblings are all `shrink-0` — the version name, the Live/Snapshot chip, the
timestamp, **Save model version**, **History**, and the collapsed row's `▾`
button. The label eats the row and the controls are pushed off-screen.

So rows A and B, and every collapsed rail row, overflow horizontally on exactly
the widths the patch existed to fix. Note that the *stacking* consumer —
`PolicySetupBar.tsx:267`, the C row — does not use this constant at all; it
carries the literal class string. The constant change served no stacking
consumer, which is how the mistake slipped through.

`w-full` is still the right value. What is missing is the parent stack, in the
two places I failed to name.

---

## 1 · PolicySetupBar — rows A and B

`src/components/policies/PolicySetupBar.tsx:43`

FIND
```
const ROW = "flex items-center gap-2.5 px-3 py-1.5";
```
REPLACE
```
// Rows A and B put a w-full label column (RAIL_LABEL_COL) beside shrink-0
// controls, so below md they stack; md: restores the desktop row exactly.
const ROW = "flex flex-col items-start gap-2 px-3 py-1.5 md:flex-row md:items-center md:gap-2.5";
```

Both rows also carry a `<div className="flex-1" />` spacer that does nothing
once stacked, and pushes the buttons to their own line. Leave it — it is inert
in a column and correct again at `md`.

---

## 2 · StageRail — RailCollapsedRow

`src/components/sim/StageRail.tsx` — inside `RailCollapsedRow`

FIND
```
      className="flex items-center px-3 py-1.5 border-b"
```
REPLACE
```
      className="flex flex-col items-start gap-1.5 px-3 py-1.5 border-b md:flex-row md:items-center md:gap-0"
```

---

## Verify

```bash
npm run verify:mobile          # gates unchanged — this is a layout regression,
                               # not something gate A can see
npm run lint && npm run build
```

Then at **320px**, on `/policies`:

- Row A shows the version name, the chip, the stamp, **Save model version** and
  **History** — all reachable, nothing clipped.
- Row B shows the day/week/month segmented control and the horizon readout.
- `document.documentElement.scrollWidth > innerWidth` is `false`.
- At **1280px** rows A and B are visually identical to before this patch.

Commit:

```
fix(mobile): stack the two rail rows that consume RAIL_LABEL_COL

RAIL_LABEL_COL became w-full below md, but three of its consumers are
compact non-stacking rows — PolicySetupBar rows A and B, and
RailCollapsedRow. The label column took the full row and pushed the
shrink-0 controls off-screen. Stack those parents below md; desktop
unchanged.
```

---

## Why gate A could not catch this

Gate A asserts that six literal strings are gone. All six are. The regression is
a *second-order* effect of one of those replacements on a file the patch never
named — which is precisely the class of failure that layer 2 exists to catch, and
the reason `VERIFY.md` insists on 320px eyes-on-glass before a surface is called
done.

I should have traced the constant's consumers before writing item 4. Checking a
shared export's call sites is not optional, and I skipped it.
