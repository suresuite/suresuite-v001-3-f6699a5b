# Conference paper — the SureSuite AI harness

Working title: **"The Harness Is the Guarantee: Deterministic Gates for LLM Agents
over a Validated Simulation Platform"**

This directory holds the paper, its bibliography, and the script that keeps every
number in the draft traceable to the tree.

| File | What it is |
|---|---|
| `ai-harness.tex` | The full draft (IEEE two-column, venue-neutral). |
| `refs.bib` | Bibliography. |
| `scripts/paper_metrics.mjs` | Extracts repo-derived numbers; `--tex` regenerates the macros. |
| `generated/metrics.tex` | Generated macros (`\TestCount`, `\FixtureCount`, …). Do not hand-edit. |

```sh
node docs/paper/scripts/paper_metrics.mjs            # inspect
node docs/paper/scripts/paper_metrics.mjs --tex > docs/paper/generated/metrics.tex
cd docs/paper && latexmk -pdf ai-harness.tex
```

---

## 1. The decision I took, and why

You asked what to do. Three framing choices drive everything else; I took the
defaults below because they match the evidence that actually exists in this repo.
Each is cheap to reverse — say the word and I will retarget.

### Venue → AI-engineering track (CAIN / ICSE-SEIP), IEEE two-column

Your evidence is *systems-shaped*: 279 deterministic tests, 120 golden fixtures,
a real production incident with a recomputed root-cause audit, CI gates, and a
published per-model capability matrix. That is a software-engineering
contribution about building on a nondeterministic component, not an ML result.

- **IEEE/ACM CAIN** (Conference on AI Engineering) — best fit. Its whole remit is
  engineering practice around AI components. The "deterministic floor" thesis is
  squarely in scope, and reviewers there will value the CI gates as results
  rather than as implementation detail.
- **ICSE-SEIP** (Software Engineering in Practice) — equally plausible, stronger
  prestige, more demanding on the "what generalizes beyond your system" question.
  §7 (Discussion) is written to answer exactly that.
- **Winter Simulation Conference** — the alternative I would pick if you want the
  domain audience. It needs a different §2 and §5.6 emphasis (the closed decision
  loop and cache-first run reuse become the contribution; the verifier becomes
  supporting material). The draft is structured so this swap is a section
  reorder, not a rewrite.

The draft uses `IEEEtran` in `conference` mode, which CAIN, SEIP, and most IEEE
venues accept unmodified.

### Thesis → the model-agnostic safety floor

> Trustworthiness properties of an LLM agent in an operational setting should be
> enforced by deterministic platform gates, not by prompt quality or model choice.
> The harness — not the model — is what carries the guarantee.

This is the strongest claim your artifacts actually support, and it is falsifiable:
the per-model capability matrix (§23 of the design doc) is precisely the apparatus
that would expose it as false if the floor turned out to be model-dependent.

Rejected alternatives, and why:

- *"Harness as an architectural pattern"* — narrower, and it discards your best
  asset (the incident + audit).
- *"Closed decision loop for simulation"* — better for WSC, weaker for an
  SE venue; folded in as §5.6 instead.
- *"Incident-driven engineering"* — reads as an experience report. The incident is
  kept as the motivating narrative (§3) but the contribution is the mechanism.

### Scope → evidence map plus a complete draft

Both, in this pass, so you can edit prose rather than start from a blank page.

---

## 2. Evidence map — every claim to its source

The draft cites nothing that is not in this tree. Section numbers below are the
paper's; `§n` in the right column refers to `docs/design/ai-agents.md`.

| Paper section | Claim | Evidence in repo |
|---|---|---|
| §3 Incident | Supplier 10 = TTI INC; 187 materials, all sole-sourced, #1 by spend | `scripts/audit/report_Project_TRON_ver2.md` §1 |
| §3 | Five fabricated IDs all belong to supplier 41679 (MICROTEC) | same, §1 table |
| §3 | None of the five appears in the first page `list_project_entities` returns | same — "ungrounded by construction" |
| §3 | Root cause = capability gap + faithfulness gap, not a tool bug | design §19.0 |
| §4 | Platform law (proposal-gated, never LLM-computed results) | blueprint §12; design §0 |
| §5.1 | Proposal lifecycle + terminal states + inverse-proposal rollback | design §4.2; `supabase/migrations/*proposal*` |
| §5.2 | Intent taxonomy I1–I15; coverage law | design §19.1–19.2 |
| §5.2 | Four new relation/detail tools close I2–I6 | design §19.3; `tools.ts`, `personaTools.ts` |
| §5.3 | Two-layer pre-send verifier; pass / retry-once / replace | design §22.3; `verifier.ts` (550 LOC) |
| §5.3 | ID lexicon learned per request, never a hardcoded regex | `verifier.ts` header comment |
| §5.4 | Plan tool schema, append-only steps, one active step | design §21.1; `planTools.ts` (777 LOC) |
| §5.4 | Integrity law: no step left `active` at request end | design §21.3; `plan_integrity_test.ts` (22 cases) |
| §5.5 | Budget defaults 4 / 15 / 48,000 / 60,000 / 5 hops | `budgets.ts` lines 19–28; design §21.5 |
| §5.6 | Cache-first reuse keyed on three grounding hashes | design §20.2; `dispatch.ts` G17 predicate |
| §5.7 | Capability vocabulary; fail-open on stale/absent rows | design §23.2, §23.4; `matrix.ts` |
| §6 | Two-tier eval design | design §7.4; `eval/README.md` |
| §7 Results | 279 tests / 35 files; 120 fixtures / 14 suites; 225 golden utterances | `paper_metrics.mjs` |
| §7 | Coverage audit: 12/12 grounded, 0 GAP, 0 PARTIAL post-H1 | `scripts/audit/report_Project_TRON_ver2.md` §2 |
| §7 | Tool outputs match recomputed truth on all four H1 tools | same, §4 |
| §8 Related work | adopt/adapt/reject verdicts | design §12.2 |

### Numbers the draft currently marks `\TODO`

**This is the honest gap and it is the one thing I cannot close for you.** The
deterministic tier is fully evidenced; the *model-scored* tier requires live API
keys and a nightly run that has not been captured into the repo.

| Missing | How to produce it |
|---|---|
| Per-model fabrication rate (target 0) | `run_model_eval.ts --models=…` with real keys |
| Per-model verifier intervention rate | same run; count `verifier.blocked_reply` events |
| Judged-faithful rate (≥ 0.95) | same run; nightly LLM-as-judge slice |
| Router precision/recall per class | `--models=…` over `routing.golden.jsonl` |
| The capability matrix table (Table VI) | `run_model_eval.ts --matrix` (refused on `--mock`) |
| Deterministic-tier pass/runtime | `deno test` — Deno is not installed in this container |

Table VI is the paper's money table: **the same floor holding on
`gemini-2.5-flash` and on `gpt-5`** is the empirical proof of the thesis. Without
it the paper is a well-argued design paper; with it, it is an evidenced one.

Run this before submission:

```sh
cd supabase/functions/project-ai-chat/eval
deno test --allow-env --allow-read --allow-write --allow-run .          # tier 1
deno run --allow-env --allow-read --allow-write --allow-net \
  run_model_eval.ts --models=gemini-2.5-flash,gpt-5,gpt-5-mini,deepseek-chat \
  --matrix --out=../../../../docs/paper/generated/model_eval.json        # tier 2
```

Then paste the numbers into the tables marked `% FILL` in `ai-harness.tex`.

---

## 3. What I still need from you

1. **Author block** — names, affiliations, emails. Placeholders are in the draft.
2. **Venue lock** — confirm CAIN/SEIP or switch to WSC (I will restructure).
3. **Ethics/consent** — the TRON ver2 dataset is a real customer network. Confirm
   you may publish the aggregate shape (60 suppliers / 560 materials) and the
   anonymised incident. I used supplier IDs as they appear in your own audit
   report; if the supplier *names* (TTI INC, MICROTEC) are sensitive, say so and
   I will anonymise to S1/S2 throughout.
4. **The live eval run** — the table above.

---

## 4. Suggested schedule

| Step | Owner | Notes |
|---|---|---|
| Lock venue + author block | you | unblocks formatting |
| Live model-scored run | you (needs keys) | fills Tables IV–VI |
| Anonymisation pass | me | if you want S1/S2 |
| Related-work expansion | me | §8 is currently one page; SEIP wants ~1.5 |
| Figures 1–3 to TikZ | me | currently described, not drawn |
| Internal review draft | — | after the eval run |
