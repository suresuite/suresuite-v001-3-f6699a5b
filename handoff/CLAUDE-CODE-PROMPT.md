# Paste this into Claude Code

Open the repo (`suresuite/suresuite-v001-3-f6699a5b`, branch `main`) with the
`handoff/` folder present, then paste the block below verbatim.

It is written to be safe: it names what to change, what not to touch, and how to
prove it worked. It will not let the agent redesign anything.

---

```
Read handoff/README.md first, then handoff/PATCH-1.md. Do these in order and
stop after step 3 to report.

STEP 1 — apply the six replacements in handoff/PATCH-1.md exactly.
- Each FIND string is unique in its file. Do not reformat surrounding code.
- Three of the six are marked PAIRED: PolicySetupBar.tsx, RunValidateStage.tsx
  and SimulationLab.tsx each need a SECOND edit to their parent element. A
  flex-row parent overrides the child's w-full, so the child edit alone does
  nothing. Apply both halves.
- Every replacement keeps the desktop value behind md:. Desktop at 1280 must be
  unchanged. If a change would alter desktop, stop and tell me instead.
- Do not touch StageRail.tsx lines 70, 81, 260, DisruptionScheduleEditor.tsx
  40-87, or ExperimentDesigner.tsx 195, 244 — they already have correct branches.

STEP 2 — wire up the checker.
- Add to package.json scripts:
    "verify:mobile": "node handoff/verify-repo.mjs --book handoff"
- Run: npm run verify:mobile
- Gate A must read "6/6 landed". If it does not, a PAIRED parent was missed.
- Gates B-F should already pass. If gate D flags anything about #F8D448, STOP
  and tell me — the repo's yellow usage is correct and must not be changed.
- Then run: npm run lint && npm run build

STEP 3 — report, do not fix.
- Run: npm run verify:mobile -- --all
- Gate G prints a "triage" list per surface: agreed copy strings that are not in
  the code. Do NOT implement them and do NOT edit handoff/PAGES.md.
- Instead, give me the list grouped by surface, and for each string say which it
  looks like:
    (a) copy genuinely missing from our code, or
    (b) a string that cannot match a literal search anyway — a runtime-composed
        label, text split across JSX nodes, or a per-project value.
- That classification is all I need from step 3.

CONSTRAINTS for this whole task:
- Edit ONLY files under the repo's own src/ and package.json. Never edit anything
  under handoff/ — it is the spec, not source. If a path you are about to change
  starts with handoff/, stop.
- This is a layout-only PR. Do not add state, do not add row selection to
  StagePolicyTable, do not build any new screen.
- Single breakpoint: 768px (md). Do not introduce sm:, lg: or xl: for anything
  structural.
- Do not restyle src/pages/GettingStarted.tsx. Its visual dialect is an open
  product decision (handoff/PAGES.md entry 04).
- No emoji. Sentence case. lucide icons only.

COMMIT with exactly this message:

  fix(mobile): unblock the six fixed-width rails below md

  Six label rails and sheets carried fixed widths with no md: branch, so
  Policies and the Simulation Lab overflowed on every phone width. Each
  fix keeps the desktop value behind md:; desktop at 1280 is unchanged.

  Closes the FINAL.md §2.5 / §2.6.1 / §2.6.2 delta.
```

---

## After it reports back

**Step 4 is yours, not the agent's.** Gate A green means the code changed; it
does not mean the screens are right.

- Run the app at 320 / 360 / 390 / 414 and 874×402 landscape. Compare Policies
  and the Simulation Lab against their screenshots in the page book
  (entries 11 and 14).
- Check desktop at 1280 — nothing should have moved.
- Then a physical iPhone, per `handoff/IPHONE-FIX.md`. That defect passed every
  static check while it was broken.

## Then, one surface at a time

Bring me (or the agent) the step-3 triage list. For each surface:

- strings in category (a) → a small follow-up PR that adds the missing copy
- strings in category (b) → I fix the deck line in `PAGES.md`

When a surface's list is empty, flip its line in `PAGES.md`:

```diff
-accept: verify src/pages/Profile.tsx
+accept: built  src/pages/Profile.tsx
```

From that commit, CI fails if that screen ever loses the agreed detail. That is
what stops the handoff decaying — do it per surface as each one comes clean,
never in bulk.

## For the eight unbuilt surfaces

Policies interior, Simulation Lab panes, network lens findings, Lab results —
these have no repo code yet, so they are not in the triage list. When you build
one, give the agent that surface's entry in `handoff/PAGES.md` as the spec: it
carries the layout decisions, the reasoning, the copy deck, and a Check it list.
Then flip `pending` → `verify` → `built`.
