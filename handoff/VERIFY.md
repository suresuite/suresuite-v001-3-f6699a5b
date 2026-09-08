# How to know your code matches the demo

Three layers. Each catches what the one before it cannot. Run them in order —
layer 1 is seconds, layer 3 needs a phone in your hand.

Nothing here asks you to trust my judgement. Layers 1 and 2 are mechanical;
layer 3 is you looking at a device.

---

## Layer 1 · the code contract (seconds, automated)

```
cd /path/to/suresuite-v001-3-f6699a5b
node /path/to/handoff/verify-repo.mjs --book /path/to/handoff
```

Exit code 0 = every gate passes. Seven gates:

| Gate | Proves |
|---|---|
| **A** | Every literal replacement from `FINAL.md` landed. Each check looks for a string that must *no longer exist*; a hit prints the exact find and replace. |
| **B** | `viewport-fit=cover` is on the viewport meta — the iPhone defect. |
| **C** | The adaptive-text baseline has not regressed past the agreed ceiling of 7, and flags any remaining `§3.3` (a figure being shortened to fit). |
| **D** | `#F8D448` appears only in the design system's four sanctioned locations, and specifically that the prototype's status-colour defect was not ported in. |
| **E** | No emoji. |
| **F** | No second structural breakpoint (review-only — the agreed `sm:` fixes are allowlisted). |
| **G** | **Per-surface acceptance — the gate that makes the book binding.** See below. |

### Making it binding — gate G

Gates A–F check code hygiene. They cannot tell you whether a screen we spent days
specifying actually says what we agreed. Gate G does, and it **fails the build**.

Every entry in `PAGES.md` now carries an `accept:` line under its `status:`:

| Value | Meaning |
|---|---|
| `accept: built <file,file…>` | Claimed done — **its copy deck is blocking.** Every agreed string must appear in those files or the build fails. |
| `accept: pending <why>` | No repo interior yet — reported every run, never blocking. |
| `accept: none <why>` | Deliberately not shipping (writes state, needs its own PR). |

Today: **13 surfaces in triage, 10 pending, 2 not shipping.**

**The workflow that makes the handoff stick.** When someone builds the Policies
interior, they flip one line:

```diff
-accept: pending   PR 6 fixes the rails; the interior is not built
+accept: built src/pages/ProjectPolicies.tsx,src/components/policies/StagePolicyTable.tsx
```

From that commit on, CI refuses the PR until every string we agreed that screen
says is in those files — the planning-unit mapping line, the gated-field reasons,
the `n / 4 ready` counter, the adequacy-table empty state. Nobody has to remember
to read the book. **The build reads it.**

That is the answer to "how do we ensure the agreed detail survives handoff": not a
document someone has to be diligent about — a failing test.

A surface can only leave enforcement by someone editing its `accept:` line, and
that shows up in review as a deliberate act rather than as something quietly
forgotten.

Wire it into CI next to the existing audit and gate A can never silently
regress:

```jsonc
// package.json
"scripts": {
  "verify:mobile": "node handoff/verify-repo.mjs --book handoff"
}
```

### Where you stand today — `main` @ `a05c7508`, checked 2026-09-08

| Gate | Status |
|---|---|
| **A** | **0 of 6 landed.** All six strings are still in the source: `PolicySetupBar.tsx:267`, `RunValidateStage.tsx:1315`, `SimulationLab.tsx:317`, `StageRail.tsx:58`, `ParameterSheet.tsx:55`, `FocusedStage.tsx:188`. |
| **B** | Pass — present, with a comment explaining why it is load-bearing. |
| **C** | Pass — 7 baselined, at the ceiling. Two are priority-1 `§3.3`: `InteractiveNetworkSpace.tsx`, `ProcessLevelNetwork.tsx`. |
| **D** | **Pass, and better than the prototype.** The repo's five yellow sites are exactly uses 1–4. `STEP_DOT.awaiting_approval` does *not* use the yellow in the repo, and neither does any CSV download — **both yellow defects I reported are prototype-only. Do not port them.** |
| **E** | Not yet run against a full checkout. |
| **F** | Not yet run against a full checkout. |
| **G** | Not yet run against a full checkout. |

So: the iPhone fix and the colour discipline are real in your code. The six
layout replacements are the whole outstanding delta — that is what "not 100%
yet" concretely means.

---

## Layer 2 · visual parity (minutes, semi-automated)

Gate A passing means the *code* changed. It does not mean the screen looks like
the demo. For each surface you touch:

1. Open the entry in `Mobile Page Book.dc.html`. Its screenshot is the target.
2. Run the app at **320, 360, 390, 414** and **874×402 landscape** (the agreed
   matrix — `docs/mobile-ui-spec.md` §5).
3. Compare against the entry's screenshot, then walk its **Check it** list.
4. Read the entry's **Copy on this screen** deck against the real screen. If a
   string is on your screen and not in the deck, tell me — the extractor missed
   something and the book is wrong, not your code.

Three failures that a screenshot catches and gate A cannot:

- **Horizontal page overflow.** In the console:
  `document.documentElement.scrollWidth > innerWidth` must be `false` at 320.
- **A control under 44×44 below `md`.**
  ```js
  [...document.querySelectorAll('button,a,input,select,[role="button"]')]
    .map(e => [e, e.getBoundingClientRect()])
    .filter(([, r]) => r.width && (r.width < 44 || r.height < 44))
    .map(([e, r]) => [e.textContent.trim().slice(0,30), Math.round(r.width) + '×' + Math.round(r.height)])
  ```
- **A number that changed between widths.** Numbers never adapt — tables scroll
  before figures truncate. Read the same KPI at 320 and at 1280; they must be
  byte-identical.

And one rule the standing instruction makes non-negotiable: **check desktop at
1280 after every mobile fix.** Each replacement in gate A is written so the
desktop branch is preserved behind `md:` — if desktop moved, the fix was applied
wrong, not the design.

---

## Layer 3 · the device (once per section, manual, unskippable)

The safe-area defect reproduced on hardware only and passed every static check
while broken. `viewport-fit=cover` being present in source is *not* evidence the
insets resolve — it is evidence the prerequisite is met.

On a real iPhone, not the simulator (`handoff/IPHONE-FIX.md`):

- Tab labels clear the home indicator.
- "More" registers on the **first** tap.
- A visible gap sits between the credit bar and the tab bar.
- The last row of content clears the credit bar — scroll to the very bottom.
- Landscape: nothing hides behind the notch; sheets go full height.

---

## What "100%" can and cannot mean

Layer 1 can be 100% and stay there — it is mechanical, and CI will hold it.

Layer 2 cannot honestly be called 100%, and I would not claim it for you. The
prototype and the repo are different codebases; parity is a judgement about
whether a screen reads the same, and the person who should make that call is the
one who knows the users. What the book gives you is the target and the specific
things to check, so the judgement is informed rather than vague.

Two open decisions that no script will settle, both waiting on you:

1. **The Getting Started visual dialect** (entry 04). The repo page is the legacy
   generation; the prototype rebuilt it in the current vocabulary. Design system
   §3.10 permits either, but demands the choice be explicit. Until you decide,
   desktop and mobile would speak different dialects on the same route.
2. **`StagePolicyTable` row selection** (entry 12). The prototype has a selection
   model the repo never had. Adding it is a state-shape change, not a UI fix — it
   needs its own PR, and I deliberately did not smuggle the markup in as dead
   code.

---

## If a gate fails and you think the gate is wrong

It might be. `verify-repo.mjs` encodes my reading of the design system and of
`FINAL.md`; the strings in gate A came from reading the files, but files move.
When a gate and the code disagree, check the code first — and if the gate is
stale, the fix is one line in `OUTSTANDING` or `YELLOW_ALLOW`, both of which are
plain arrays at the top of the script for exactly that reason.
