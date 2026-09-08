# Handoff to Claude Code

Everything agreed in the design session, in the form Claude Code needs. Follow the four
steps in order. Total setup time: about two minutes.

---

## Step 1 — Put the spec in the repo

`docs/mobile-ui-spec.md` in **this** project is the contract. Copy it into the repo so
the agent reads it from the codebase it is editing, not from a chat attachment:

```
suresuite-v001-3-f6699a5b/
  docs/
    mobile-ui-spec.md        ← copy it here
    design/
      ui-consistency-audit.md   (already there — the spec defers to it)
```

Commit it on its own: `docs: add adaptive mobile UI specification`.

---

## Step 2 — Paste this prompt

Verbatim. It is written so the agent cannot start coding before it has read the two
documents that govern the work.

```
Read docs/mobile-ui-spec.md in full, then docs/design/ui-consistency-audit.md §1
(the C1–C9 contract). The spec defers to the audit wherever they disagree, except
on the two amendments the spec lists in §0.3.

Then implement PR 1 only — "Foundations" in §11. Do not start PR 2.

Two constraints govern every change you make, now and later:

1. UI-only. No query, RPC, schema, engine-parameter, validation or routing change.
   No user-visible number changes. §0.1 has the permitted/forbidden list. If a
   layout fix appears to require a logic change, stop and report it instead of
   making it.

2. Every change ships for desktop AND mobile in the same commit. The product has
   one breakpoint: 768px. Do not add a second. State what happens to both layouts
   in the PR body using the §8 template — "unchanged" is a valid answer for
   desktop but must be written down.

PR 1's exit criterion is non-negotiable: a 1280px screenshot diff against main must
be empty. Desktop must not move by one pixel. If it does, the fluid gutter or the
PageHeader bleed is wrong — fix it before opening the PR, because every later PR
inherits the error.

Verify at 320 / 360 / 375 / 390 / 414 / 768 / 1280 and landscape 874×402 using the
probe in §7. Report the results in the PR body.

Before you write any code, tell me:
  - which of the three dialects (§0.2) each file you are about to touch belongs to
  - the list of files PR 1 will change
  - anything in the spec that contradicts what you find in the codebase
```

When PR 1 is merged and the desktop diff is confirmed empty, continue with:

```
PR 1 is merged and the 1280px diff was empty. Implement PR 2 from §11 of
docs/mobile-ui-spec.md. Same two constraints, same verification, same PR template.
```

Repeat for PRs 3–6. **One PR per prompt** — the sequence in §11 exists because each
step makes the next one reviewable.

---

## Step 3 — Attach the behavioural reference

Claude Code cannot run the prototype, but it can read it, and it is the only place some
agreed behaviour is written down.

| File | Why the agent needs it |
|---|---|
| `SuReSuite Live Demo.dc.html` | Every mobile screen we built, with the real copy. Read it for **wording and flow**, never for implementation — it is a single-file DC, not React. |
| `Project Intelligence Mobile.dc.html` | The full PI feature set, all nine message-part kinds. |
| `github.md` | Screen map: which repo file each screen was built from. Saves the agent guessing. |

Say this when you attach them:

```
These three files are a behavioural reference, not code to port. Read them for copy,
flow and state transitions. §12 of the spec lists which of their behaviours are demo
devices that must NOT ship, and which are product contracts that must survive.
```

That last sentence matters. The prototype fakes a backend in six places — token expiry
triggered by "the sync after one has been applied", fixed sync counts, `setTimeout`
progress, seeded KPI draws, a hardcoded company list, nexus counts scaled at ~9.2%. All
six are listed in §12 as **do not ship**. Six other behaviours in the same file are real
contracts and are listed as **must survive**, the ERP two-stage gate among them.

---

## Step 4 — Check what comes back

Reject the PR unless all six hold:

- [ ] **1280px diff against `main` is empty** (PR 1 only, but check it every time desktop
      is claimed unchanged)
- [ ] PR body uses the §8 template and states **both** layouts
- [ ] The UI-only checkboxes are ticked, and the diff contains no query, schema or
      engine change
- [ ] No number differs between 320px and 1280px
- [ ] Nothing scrolls horizontally at 320px except an intentionally scrollable table
- [ ] Every interactive element is ≥44×44 below 768px

One-line probe for the last two, in the browser console at each width:

```js
[320,360,375,390,414,768,1280].forEach(w => console.log(w, {
  overflow: document.documentElement.scrollWidth > w,
  small: [...document.querySelectorAll('button,a,[role=button],input,select')]
    .filter(el => { const r = el.getBoundingClientRect();
      return r.width && (r.width < 44 || r.height < 44); }).length,
}));
```

At ≥768 the 44px count is expected to be non-zero — the audit's `h-8`/`h-9` is correct
there.

---

## What is in the spec, and where

So you can check the agent against it without re-reading 28,000 characters.

| Thing we agreed | Section |
|---|---|
| UI-only, no logic changes | §0.1 A — with the permitted/forbidden list |
| Both platforms, one 768px breakpoint | §0.1 B, and every rule is given as a `mobile / md:desktop` pair |
| Which dialect a screen belongs to | §0.2 |
| The two mobile amendments to C1–C9 | §0.3 |
| Test widths, in real share order | §1 — 414 first, 320 as the stress floor |
| Fluid gutter, type, grids, 44px targets, sheets, tables | §2 |
| **Adaptive text — the six-rung ladder** | §3.1 |
| What may never be truncated | §3.1 — numbers, units, status words, errors, disabled reasons |
| Label variants in display constants, swapped by CSS | §3.2 |
| Disclosure card for long explanation | §3.4 |
| PageHeader, tab bar, Ledger table, sheet shell, StatCard | §4 |
| The 8 screens, with a mandatory desktop column | §5 |
| Anti-patterns to reject | §6 |
| Verification probe | §7 |
| PR template | §8 |
| Shared-model extraction | §9, and PR 6 in §11 |
| The six-PR sequence | §11 |
| Demo devices vs product contracts | §12 |

Two open items from the session are **not** in the spec, deliberately — they are work on
the prototype, not on the repo:

- a polish pass over the existing mobile screens
- extracting `suresuite-model.js` in the prototype (the repo equivalent is PR 6)

---

## If the agent pushes back

Three objections are likely. All three have answers already in the spec.

**"The fluid gutter changes desktop."** It must not. `px-[clamp(...)] md:px-12` leaves the
`md:` value literally identical to today's. If the diff moves, the `PageHeader` bleed was
not updated to match (§2.1) — that is the bug, not the approach.

**"This label doesn't fit, I'll abbreviate the number."** Never. §3.3. The table scrolls;
the number does not change.

**"I'll use `useIsMobile` for this."** Only for structural branches — a different component
tree. Purely visual differences use `md:` (§6). Adding a hook call for a label swap is
rejected by §3.2, which uses CSS so the label responds to its container.
