# Phone check — hold this in your hand

Six checks, in order, on the real device. Stop at the first failure and send me
the number — each one has a different cause, so knowing *which* one broke tells
me where to look without guessing.

**Before you start:** `PATCH-2.md` and `PATCH-3.md` must be applied and deployed.
Without PATCH-3 check 1 will fail, and nothing after it is worth running.

```bash
npm run verify:mobile     # gate H must read "shelled" for every app page
npm run lint && npm run build
```

Gate H is new and exists because of exactly the bug you found: it fails if any
app page renders the desktop sidebar itself or skips `PageLayout`. Run it before
you deploy — if it fails, the phone will fail too, and you save the round trip.

---

## The six checks

**1 · Sign in. Look at the home screen.**
- No sidebar anywhere.
- A bottom bar with five items: **Home · Policies · Lab · AI · More**.
- The bar sits above the black credit strip, not under it.

*Fails →* PATCH-3 not applied, or not deployed. Everything else is meaningless
until this passes.

**2 · Tap all five tabs.**
- Each loads its page. The tab bar stays put and the active tab is marked.
- **More** opens a drawer with the full nav list, your name and role, and Log out.

*Fails on one tab →* that page is missing the shell. Tell me which.

**3 · Scroll to the very bottom of the home screen.**
- The last row of content is fully readable — not under the credit bar.
- The credit bar is fully visible — not under the tab bar.
- Tab labels clear the home indicator (iPhone) / gesture bar (Samsung).

*Fails →* the safe-area reservation. This is the defect that reproduces on
hardware only, so this check cannot be replaced by a simulator.

**4 · Open Policies.**
- Rows **A** (model version) and **B** (planning unit) stack: the label sits
  above its controls.
- **Save model version** and **History** are both fully on screen and tappable.
- The day / week / month control is reachable.

*Fails →* PATCH-2 not applied. This is the regression my first patch caused.

**5 · Open the Simulation Lab.**
- The scenario rail is full width, **above** the panes — not a narrow column
  beside them.
- The five stage cards scroll sideways; the active one is centred.

*Fails →* one of the PATCH-1 PAIRED parents. Tell me which screen.

**6 · Nothing scrolls sideways.**
On each of the five tabs, drag left and right on an empty part of the page.
Nothing should move horizontally. Tables *inside* a card are allowed to scroll —
the **page** is not.

*Fails →* a fixed width somewhere. Name the screen and I'll find it.

---

## What "the right direction" looks like after this

If 1–6 pass, the shell and the six rails are correct, and the app is genuinely
on the path. What will still be missing, by design and not by accident:

- **Policies interior** — the four configuration steps, the gated-field reasons,
  the warm-up / n\* adequacy table. Book entry 11.
- **Simulation Lab panes** — events, comparison, the run gate detail. Entry 14.
- **Lab results** — convergence, heatmap, recovery impact. Entry 15.
- **Network lens findings** — the structural-risk prose and centrality tables.
  Entry 08.

Those eight surfaces have no repo code yet; they are `pending` in `PAGES.md`.
So expect the phone to look *structurally* right and *thin* on content. That is
the correct state after PATCH-1 through 3 — a working shell over screens that
are still mostly desktop-shaped inside.

If instead you see the shell working **and** a screen whose content is wrong
rather than absent, that is new information and worth sending me: it means a
surface I marked as landed isn't.

---

## Send me back

Just this, and nothing else:

```
1 pass/fail
2 pass/fail   (which tab, if fail)
3 pass/fail
4 pass/fail
5 pass/fail
6 pass/fail   (which screen, if fail)
device: iPhone <model> / Samsung <model>
```

A screenshot of any failure helps more than a description.
