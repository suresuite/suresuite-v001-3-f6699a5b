# SuReSuite mobile — everything agreed, for a fresh session

Paste this file at the start of a new chat. It replaces the whole conversation.
Read it with `docs/mobile-ui-spec.md` (the contract) and `handoff/FINAL.md`
(the remaining code changes).

---

## 1. What this project is

Mobile UI/UX redesign of **SuReSuite** — a supply-chain resilience simulation
platform from the Digital SC Lab, HWR Berlin (Phu Nguyen, Prof. Dmitry Ivanov),
WP4 of the EU-funded ACCURATE project.

- **Repo:** `suresuite/suresuite-v001-3-f6699a5b`, branch `main`, verified at
  commit `cd36c0e41644`. React + Vite + Tailwind + shadcn + Supabase.
- **Prototype:** `SuReSuite Live Demo.dc.html` in this project — the full mobile
  flow, tappable end to end, inside a phone frame with a device-width switcher.
  It is the **behavioural reference**: read it for copy, flow and interaction
  order. It is NOT source to port — the repo is React, the demo is a Design
  Component.
- **Also here:** `Project Intelligence Mobile.dc.html` (the PI screen standalone,
  with a nine-state jump rail), `docs/mobile-ui-spec.md` (12-section contract),
  `handoff/FINAL.md` (remaining changes, every string literal),
  `handoff/IPHONE-FIX.md`, `github.md` (sync point + screen map).

## 2. The standing rules — these govern everything

1. **UI-only.** No Supabase query, RPC, Zod schema, engine parameter,
   computation, validation, routing or capability-resolution change. No
   user-visible number changes. If a layout fix seems to need a logic change,
   **stop and report it**. Permitted: JSX structure, `className`, Tailwind,
   `aria-*`/`title`, presentational extraction, a label variant on a display
   constant, a purely visual local `useState`.
2. **Every change ships desktop AND mobile in the same commit.** One breakpoint:
   **768px** (`useIsMobile`, Tailwind `md:`). Never add a second. The PR body
   states both layouts; "unchanged" is valid but must be said.
3. **Desktop is the primary surface** and must stay pixel-identical at 1280
   unless the task says otherwise. Express every rule as
   `mobile / md:desktop` so the desktop literal is untouched in the diff.
4. **Adaptive text, six-rung ladder** (spec §3.1), applied in order, descending
   only when the rung above fails at 320px: wrap → `truncate`+`title` →
   `line-clamp-2`+disclosure → shorter label variant → icon+`aria-label` →
   disclosure card. **Never truncate** a number, unit, status word, error, or the
   reason a control is disabled.
5. **Numbers never adapt.** No truncating, rounding or abbreviating to fit. The
   table scrolls instead.
6. **Test matrix:** 320 · 360 · 375 · 390 · 414 · 768 · 1280 · landscape
   874×402 · **and a physical iPhone**. 414 is the default dev target (highest
   real share); 402 is the design baseline but unranked; 320 is the stress floor.

## 3. Decisions taken (do not re-ask)

| Question | Decision |
|---|---|
| Desktop counterparts | **Mobile only for now** — desktop untouched |
| 3D interactive space on mobile | **No 3D.** Findings-only; name the spatial view as a desktop surface |
| Network lenses depth | **Table + metrics, no 3D** |
| Nexus Node Prediction | **Ships** — built |
| OrbitMRP / ERP integration | **In scope** — built |
| Project data viewer | **Built** |
| Next phase | Polish pass, then the model extraction |

## 4. Design language (from the bound design system)

- **Three dialects.** Semantic (`border-border`, `rounded-lg`) · Sharp
  (`#ebebeb` hairlines, `rounded-sm`, black pill active) · Sharp/zinc
  (`#e0e0e3`, `#71717a` — Simulation Lab only). Never mix two in one panel.
- **Light-locked.** `#BF2330` is the only brand colour, never a button fill.
  `#F8D448` marks "begin here" and has exactly four sanctioned uses.
- **Ledger tables:** `TH` is `font-mono text-[11px] uppercase tracking-[0.04em]`
  — **0.04em, not the 0.2em of a kicker**. Row height by page density:
  Developer `py-[11px]` · Admin `py-[9px]` · Sim + PI `py-1.5` · parameter
  cards `py-[5px]`. Divider `#f4f4f4`, except the two sim tables at `#ececee`.
- **Sentence case everywhere. No emoji.** Functional Unicode marks only
  (`▲▼ › ≈ ⚠ → ·`). Icons are lucide 0.451, sizes strictly tiered (14/16/12px).
- **A disabled control is shown, disabled, and explained** — never hidden.
- Hierarchy is value + 1px borders. No gradients, no shadow for depth.
- Every app page has the fixed black credit footer; a mock without it reads fake.

## 5. Mobile patterns established

- **Fluid gutter:** `px-[clamp(0.75rem,4vw,1.125rem)] py-4 md:px-12 md:py-6`
  (`PAGE_GUTTER` in `shared/PageBody.tsx`). `PageHeader` bleeds out with the
  mirrored negative margins — change one, change both.
- **44px touch floor** below `md`. Where 44px would break a text line's rhythm:
  `py-[11px] -my-[11px]` (or `box-content p-[14px] -m-[14px]`) — hit area grows,
  nothing moves visually.
- **`min-w-0` on every flex child containing text; never `shrink-0` on text.**
  These two rules prevent every horizontal-scroll bug seen in this project.
- **`minmax(0,1fr)`, never bare `1fr`** in a grid.
- **Tables keep the table** — scroll sideways with a frozen identifying column
  (`FROZEN_CELL` / `FROZEN_CELL_ON_TINT`, both release at `md:static`), plus the
  line "swipe the table sideways for the remaining columns". Card lists only
  where the product itself already switches (`AdminAudit.tsx`).
- **Sheets** replace side panels: `max-h-[76%]`, **full-height in landscape**,
  header is the drag handle, drag past 90px dismisses, and closing clears any
  sheet the parent screen owns.
- **Bottom tab bar:** Home · Policies · Lab · AI · More. Same lucide icons as the
  sidebar for the same destination. `More` opens a drawer showing the logo.
- **Safe-area inset on anything bottom-pinned** — and `viewport-fit=cover` in
  `index.html`, or iOS resolves every inset to 0.

## 6. State of the repo

**Merged and working:** fluid gutter + type tokens · `PageHeader` with 44px floor
and mobile back · `MobileNav` (tab bar + drawer) mounted in `PageLayout`, sidebar
`hidden md:block` · `Profile`, `Forbidden`, `DeveloperApi` · `ResponsiveLedger` ·
`lib/ui/labels.ts` + `shared/AdaptiveText.tsx` · `scripts/audit-adaptive-ui.mjs`
with a ratcheting baseline, wired into `lint` and `.github/workflows/ui-audit.yml`.
All ten pages import `PAGE_GUTTER`.

**Remaining — all in `handoff/FINAL.md`, in order:**

1. **§1 iOS safe-area defect.** `index.html` lacks `viewport-fit=cover`, so
   `env(safe-area-inset-*)` is 0 on iPhone and all three bottom-pinned elements
   lose their clearance. Reproduces on hardware only. 4 files + an audit rule.
2. **§2** 16 baselined violations, 7 files. The two `§3.3` ones
   (`InteractiveNetworkSpace`, `ProcessLevelNetwork`) go first — a violation
   there means a figure is being shortened to fit.
3. **§2.5** policy-grid interior: 192px label columns, `shrink-0` chip rows,
   frozen column, sub-44px grid controls, bulk-edit dialog → sheet.
4. **§2.6** every other page: the 256px Simulation Lab rail (needs its parent
   stacked too), `ParameterSheet` at 392px (wider than the phone), a 340px
   dropdown, and ten fixed-width selects split into two cases.
5. **§3** extract `src/lib/model/` — no visual change.

**Explicitly excluded:** multi-row bulk edit in `StagePolicyTable` (FINAL §2.5
E2). The component has no selection model — only `collapsedGroups` — so it is
not a UI-only change. The prototype is ahead of the product here because the demo
has a selection model the repo never had. Report it; do not smuggle it in.

## 7. What went wrong in this session — avoid repeating it

- **I signed off on mobile work without ever testing on a device.** The user
  found the iPhone defect. Every audit rule I wrote checks source patterns, and
  the safe-area guards were all correct *in source* — the cause was in
  `index.html`, the one file the audit never reads. A static check cannot see a
  device-conditional value. **The device pass is not optional.**
- **I asserted alignment before checking.** Twice I claimed a page was covered
  and a later read found a fixed-width rail with no mobile branch. Read the file.
- **I wrote post-edit assertions against the wrong string** — checking a data
  flag instead of the handler I had patched — so a silent `replaceText` no-op
  reported success. Assert on the thing you changed.
- **Recurring defect classes to watch:** a `style="{{ hole }}"` inside a loop
  resolves once and freezes · hardcoded plurals ("1 rows") · a literal copied
  from another project's seed · state keys colliding after a merge · timers as
  the only exit from a loading state.
- **The user's priority order:** working on a real phone > feature parity with
  desktop > polish. Honesty about what is unverified matters more than a
  confident summary.
