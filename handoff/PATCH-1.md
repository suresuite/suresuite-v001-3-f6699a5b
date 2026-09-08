# PR 6 — the six replacements

The entire outstanding mobile delta, as exact find/replace pairs. No judgement
calls, no new components, no state changes. Verified present in `main` @
`a05c7508` on 2026-09-08.

Each `FIND` string is unique in its file. Each `REPLACE` keeps the desktop value
behind `md:`, so **desktop at 1280 must not move** — if it does, the edit was
applied wrong.

Two of the six need a second edit to their parent element. Those are marked
**PAIRED** — the child alone does nothing, because a `flex-row` parent overrides
it. This is the mistake to avoid.

---

## 1 · PolicySetupBar — label rail  **PAIRED**

`src/components/policies/PolicySetupBar.tsx:267`

FIND
```
flex w-[192px] shrink-0 flex-col justify-center gap-[3px] pr-2.5
```
REPLACE
```
flex w-full min-w-0 flex-col justify-center gap-[3px] pb-2 md:w-[192px] md:shrink-0 md:pb-0 md:pr-2.5
```

Then find the nearest enclosing flex wrapper (search upward from 267 for
`className="flex`) and add `flex-col md:flex-row`. Do **not** touch its
`items-*` — the desktop row depends on it.

---

## 2 · RunValidateStage — label rail  **PAIRED**

`src/components/policies/RunValidateStage.tsx:1315`

Identical string, identical replacement, identical parent requirement as #1.

FIND
```
flex w-[192px] shrink-0 flex-col justify-center gap-[3px] pr-2.5
```
REPLACE
```
flex w-full min-w-0 flex-col justify-center gap-[3px] pb-2 md:w-[192px] md:shrink-0 md:pb-0 md:pr-2.5
```

---

## 3 · SimulationLab — scenario rail  **PAIRED**

`src/pages/SimulationLab.tsx:317`

FIND
```
<aside className="w-64 shrink-0">
```
REPLACE
```
<aside className="w-full min-w-0 md:w-64 md:shrink-0">
```

Its parent must also change (the aside alone does nothing):

FIND
```
<div className="flex gap-4 items-start">
```
REPLACE
```
<div className="flex flex-col gap-4 md:flex-row md:items-start">
```

The aside's sibling already carries `min-w-0` — leave it.

---

## 4 · StageRail — rail label column

`src/components/sim/StageRail.tsx:58`

FIND
```
export const RAIL_LABEL_COL = "w-[220px] shrink-0";
```
REPLACE
```
export const RAIL_LABEL_COL = "w-full min-w-0 md:w-[220px] md:shrink-0";
```

Do **not** touch lines 70, 81, 260 — they already have correct branches.

---

## 5 · ParameterSheet — sheet wider than the phone

`src/components/policies/ParameterSheet.tsx:55`

392px is wider than a 320, 360 or 375px viewport, so the sheet is clipped.

FIND
```
className="w-[392px] overflow-y-auto sm:max-w-[392px]"
```
REPLACE
```
className="w-full overflow-y-auto sm:w-[392px] sm:max-w-[392px]"
```

---

## 6 · FocusedStage — dropdown wider than the phone

`src/components/policies/FocusedStage.tsx:188`

FIND
```
className="w-[340px]"
```
REPLACE
```
className="w-[min(340px,calc(100vw-1.5rem))]"
```

---

## Then

```bash
node handoff/verify-repo.mjs --book handoff   # gate A must read 6/6 landed
npm run lint && npm run build
```

Commit:

```
fix(mobile): unblock the six fixed-width rails below md

Six label rails and sheets carried fixed widths with no md: branch, so
Policies and the Simulation Lab overflowed on every phone width. Each
fix keeps the desktop value behind md:; desktop at 1280 is unchanged.

Closes the FINAL.md §2.5 / §2.6.1 / §2.6.2 delta.
```

## Do not include in this PR

- **`StagePolicyTable` row selection** — no selection model exists; that is a
  state-shape change and needs its own PR.
- **The Getting Started dialect decision** — a design call, not a layout fix.
- **The two `#F8D448` defects I reported** — they are prototype-only. Your repo
  is already clean. Changing anything yellow here would be a regression.

## Then verify for real

Gate A green means the code changed, not that the screens are right.
`handoff/VERIFY.md` layer 2 (320/360/390/414/landscape + desktop at 1280) and
layer 3 (a physical iPhone) still have to be walked for Policies and the
Simulation Lab.
