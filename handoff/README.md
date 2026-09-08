# START HERE

Everything needed to get the mobile UI/UX into the app as agreed. Four steps,
in order. Nothing else in this folder is required reading until a step sends
you there.

---

## Step 1 · Apply the six edits  → `PATCH-1.md`

The entire outstanding layout delta. Exact find/replace pairs, verified present
in `main` @ `a05c7508`.

Either hand `PATCH-1.md` to Claude Code in the repo, or apply by hand in ~10
minutes.

**The one trap:** three of the six are marked **PAIRED** — `PolicySetupBar`,
`RunValidateStage`, `SimulationLab`. Each needs a second edit to its *parent*
element, because a `flex-row` parent overrides the child's `w-full`. The child
edit alone changes nothing and looks like the fix failed.

---

## Step 2 · Turn on the checker  → `verify-repo.mjs`

```jsonc
// package.json
"scripts": {
  "verify:mobile": "node handoff/verify-repo.mjs --book handoff"
}
```

```bash
npm run verify:mobile
```

Add it to CI. Exit code 0 = all gates pass.

After step 1, **gate A must read 6/6 landed**. If it doesn't, the patch is not
fully applied — most likely a missed PAIRED parent.

Gates B–F should already pass: your repo has the iPhone meta tag and its yellow
usage is clean. (Two `#F8D448` defects I reported earlier were in my prototype,
not your code. Don't "fix" them.)

---

## Step 3 · Work the triage list  → gate G output

This is the step that makes the handoff stick, and it is the only one that takes
real time.

Gate G reads `PAGES.md` and, for each of the 15 surfaces mapped to real repo
files, prints the agreed strings **not present in your code**:

```bash
npm run verify:mobile -- --all
```

Each `triage —` line is a worklist for one screen. Every entry on it is one of
two things, and you decide which:

1. **Your code is genuinely missing agreed copy** → implement it. This is the
   detail that would otherwise be lost in handoff.
2. **The deck string is prototype-only** — a composed label, text split across
   JSX, or something the prototype invented → the book is wrong. Tell me, or fix
   the deck line in `PAGES.md`.

When a surface's list is empty, flip its line:

```diff
-accept: verify src/pages/Profile.tsx
+accept: built  src/pages/Profile.tsx
```

**From that commit on, CI fails if any agreed string on that screen disappears.**
That is the enforcement: not a document someone must be diligent about, a failing
test. A surface can only leave enforcement by someone editing its `accept:` line,
which shows up in review as a deliberate act.

Current state: **13 in triage · 10 pending (no repo interior, or no enforceable
deck) · 2 not shipping.**

The pending surfaces are the unbuilt ones — Policies interior, Simulation Lab
panes, lens findings, Lab results — plus two (10 Nexus, 20 User access) whose
decks came out empty or too thin to prove anything. Their spec is their book
entry. Whoever builds them flips `pending` → `verify` → `built` the same way.

---

## Step 4 · Verify what no script can  → `VERIFY.md` layers 2 and 3

Gates prove the code contains what we agreed. They cannot prove a screen *looks*
right or that safe-area insets resolve on a device.

- **Layer 2** — per surface: the book entry's screenshot is the target; test at
  320/360/390/414 and 874×402 landscape; run the three console probes (page
  overflow, sub-44px controls, a number that changed between widths); then check
  desktop at 1280 to confirm nothing moved.
- **Layer 3** — a physical iPhone, not the simulator. The safe-area defect passed
  every static check while broken. `handoff/IPHONE-FIX.md` has the five checks.

---

## Two decisions that are yours, not mine

Neither is a bug; both block a surface from being called done.

1. **Getting Started's visual dialect** (entry 04). Your repo page is the legacy
   generation — gradients, `rounded-2xl`. The prototype rebuilt it in the current
   vocabulary. Design system §3.10 permits either but requires the choice to be
   explicit. Until you decide, desktop and mobile would speak different dialects
   on the same route. Left `pending` deliberately.
2. **`StagePolicyTable` row selection** (entry 12). The prototype has a selection
   model your repo never had. Adding it is a state-shape change, not a UI fix —
   its own PR. Marked `none`.

---

## The rest of this folder

| File | When you need it |
|---|---|
| `PATCH-1.md` | Step 1. The six edits. |
| `CLAUDE-CODE-PROMPT.md` | Step 1–3, if you are handing this to Claude Code. The prompt to paste. |
| `verify-repo.mjs` | Step 2. The seven gates. |
| `VERIFY.md` | Step 4, and the full description of all three layers. |
| `PAGES.md` | The spec — 25 surfaces, why each mobile decision was made, and the copy decks gate G enforces. Read the entry for whatever you are building. |
| `Mobile Page Book.dc.html` | The same content with the demo screenshots, for reading and review. Open it directly in a browser. |
| `shots/` | 39 phone screenshots of the demo — the layer-2 visual targets. |
| `SuReSuite Live Demo (standalone).html` | The working prototype, bundled into one offline file (2.6 MB — fonts, icons and images inlined). Double-click it. Reference only — never ship from it. |
| `AUDIT.md` | Proof the spec matches the demo: 43 quoted claims checked, 0 failures. Re-run after editing `PAGES.md`. |
| `IPHONE-FIX.md` | Step 4, layer 3. The device defect and its five checks. |
| `FINAL.md` | Superseded by `PATCH-1.md` for the layout delta; still the reference for the §3 model extraction. |
| `CONTEXT.md` | Full context for starting a fresh session. |
| `support.js`, `ds-tokens.css` | Runtime files the page book needs. Don't edit. |

**This folder is self-contained.** Zip `handoff/` and everything works anywhere:
the page book and the standalone demo both open straight in a browser, the
screenshots resolve, and the book finds `PAGES.md` whether it runs from here or
from the project root. Nothing outside `handoff/` is needed.
