# Overnight run — status

> Updated at the end of every work package. `docs/PLAN.md` §16 is the authority
> for what each package found; this file is the short version you read first.

**Branch:** `claude/busy-thompson-9p8zb9` · **Started from:** `e9b9644` (WP 4.2 merged) · **4 packages closed**

---

## Closed this run

### WP 4.3 — Migrate the analyzers (dual-write) · `20260917000007`

Three analyzers plus `combine-project` write **both** destinations, every derived
row carries the run that produced it, and the four deep-tier tables are described
for the first time. **Closed:** D72, D76, D77, D78, D79 + D54's largest group.
**Found:** D75.

The finding that changed the package: `current_graph_hash` hashes eleven tier-2
tables and the two centrality analyzers read `network_nodes`/`network_edges` —
neither of them. Keying their cache on that anchor serves the *previous* graph's
centralities as a hit.

### WP 4.4 — Staleness, invalidation, Trust Report · `20260917000008`

**Phase 4 is complete.** **Closed:** D12, D70, D80, D81.

- **D70 fixed by SPLITTING, not deleting.** A TTL is a record of something that
  happened and still persists; grounding drift became a computed column, so a
  project that drifts and drifts back leaves its proposals untouched.
  `rehearsal/140` §3 moves a real project twice — the half no source read can
  settle.
- **The rule needed a third state.** `unknown` is not `stale`: WP 4.3 shipped the
  provenance columns nullable, and reporting "we cannot tell" as "out of date"
  answers T1 with a guess. §11 is edited to say three.
- **D81** — one of the three ad-hoc mechanisms the brief told me to delete does
  not exist; the nearest identifier is a re-entry guard whose comment records the
  bug that made it one. Deleting it would have reintroduced that bug.
- **D80** — the trigger at the centre of D12 has never invoked an analysis. It ran
  an expensive check and `RAISE LOG`-ged the answer, and a whole performance
  migration (`20260712110000`) was spent optimising the inputs to that log line.
- **A3 shipped**: freshness badge + Project Data Trust Report, limits first,
  assembled by a pure module so WP 6.3 can emit the same report as PDF/JSON.

**Verified both packages:** `contract:check` ✓ · 336 tests ✓ · lint at baseline
(336 errors, unchanged) · build ✓ · `contract:rehearse` plain + `--fixtures` ✓,
14 behavioural files, both new rehearsals mutation-tested.

### WP 5.1 — Surfaces (lineage) block · no migration

`surfaces` is filled: **129 entries across 23 tables and 10 pages**, every one
carrying a `path:line` that `contract:check` **R12** re-opens on each run.
**Found:** D82, D83.

- **The section's own scope was too narrow.** It says to scan `src/pages/*.tsx`;
  seventeen pages contain eight direct table reads between them. The analyser is
  a module graph plus an RPC→table hop.
- **Three grades, never blurred** — `column` (an explicit `select` names it),
  `table` (the page reads the table by this path), `shell` (reached only through
  modules ≥80% of pages import — auth plumbing, not lineage).
- **D82** — the first run reported `NotFound.tsx` as a surface for user data.
  True about imports, false about the product. Fixing table grain alone left four
  pages still carrying *column* lineage, because `useAuth` names `organization`
  in an explicit select: strong evidence about a shell module is still shell.
- **D83** — a bare column-name scan produced 979 field-page pairs and **zero** for
  the table the policy grid plainly renders. Column grain is now only what a
  `.from(t).select(...)` names.
- **The gap check is R12's second half**: 17 of 17 pages either carry a non-shell
  entry or are declared in `coverage.yaml` with a reason.

**This push has no migration, so it carries the §15 probes the last two owed** —
`computed_from_hash IS NULL` per table, proposals expired for grounding drift
(D70's realised damage), `live_grounded_on_graph_hash` before WP 5.3's bump, and
whether D72's index reached production. `.github/verify-request` is touched.

**Verified:** `contract:check` ✓ · 336 tests ✓ · lint at baseline · build ✓ ·
R12 mutation-tested both ways.

---

### WP 5.3 — The anchor sees the graph; the drop is blocked · `20260917000009`

**The package could not do what its name says, and §15 is why.** "Pages read
`analysis_results`; drop entity columns" needs a non-empty store. The run measured
**8 577 of 8 577** derived rows carrying no input hash, against **0 runs and 0
results**. Switching readers shows nothing; dropping the columns destroys 8 577
values with no replacement. A backfill can't substitute — those rows have no hash,
and inventing one is fabricated provenance. **D88**, re-homed to WP 6.3 with the
unblocking condition stated as a §15 number rather than as prose. Not a design
defect: the dual-write is correct and shipped; the precondition is that somebody
*runs* an analysis.

**What it did ship is D75 closed.** The deep-tier topology is now in
`hash_network` — exactly the six columns the prominence RPCs return,
`schema_version` 2 → 3, against a measured blast radius of zero and as the first
bump after D70 made a hash change reversible. The fold is **by column** because
D88 closed the tier route, and the coverage rule moved from "these four tables are
excluded" to "no computed column is hashed" — what the invariant actually says.

Its gap check found `graphHashCoverage.test.ts` passing 24 assertions about a
migration the database no longer runs (it read one file by name). Live definition
now.

**Verified:** `contract:check` ✓ · 337 tests ✓ · eslint at baseline · build ✓ · 15
rehearsals green in both modes · mutation-tested.

## ⚠ READ FIRST — `main` IS RED, and this branch fixes it

PR #222 **merged** at `0ca07da` — two commits pushed to the branch after that
point were not in it, so `main`'s `contract:check` **exits 1** with six R12
failures (D86). The gate is right; the repair just missed the train.

**`claude/busy-thompson-9p8zb9` is green and carries the fix.** It needs to go
back into `main`. I did not open a PR for it — say the word and I will.

A second red on `main` is **not mine** (D87): `browser-wheels` fails because
PR #221 changed `scsim/io/project_map.py` without regenerating the committed
browser wheels. One command fixes it — `scripts/build_engine_wheels.sh` — but it
cannot be run from here: it imports `scsim` to stamp `engine_version`, that needs
`pydantic`, and the egress proxy denies PyPI. Regenerating without it writes
`"engine_version": "unknown"` into the manifest, which is a product regression
bought for a green check, so I reverted it rather than push that.

## CI on PR #222 (merged)

`contract`, `migrations run` and `audit` (bundle) are **green**. Two reds, both
diagnosed:

- **`audit` (ui-audit.yml) — NOT this PR's.** `npm run audit:ui` exits 1 on
  `origin/main` with identical findings; the only difference is two line numbers
  shifting because my edits added lines above them. Mobile-UI spec debt across six
  pages, none of which this branch authored. Commented once on the PR, not fixed —
  fixing six unrelated pages would widen the branch.
- **`verify` (verification-sql.yml) — was MINE, and is fixed** (`D84`). Both gate
  lines were probes asserting premises that had expired, not database defects. See
  below.

## Needs a decision when you wake up

1. **READ THE §15 REPORT FIRST — and note it came back RED for two bad gates, now
   fixed (D84).** Neither was a database defect: one probe counted `pg_proc` rows
   where it meant function names (WP 4.3's deploy-window overload took it 9 → 10),
   the other asserted "every stored version predates v2" and the one version that
   matched was the post-bump one — the anchor working, reported as a failure.
   The answers it was asked for are sound and sit on the `verification-results`
   branch. WP 5.1's push requested it (no migration, so the
   three-door rule allows it) and it answers three things nothing has measured:
   how many derived rows carry no input hash (the size of what WP 5.3 cannot
   migrate), how many proposals a page-load expired for grounding drift (**D70's
   realised damage — unrecoverable, so the number is all there is**), and what
   WP 5.3's hash bump would land on. It publishes to the `verification-results`
   branch. If it reports a WP 4.3/4.4 object missing, that is a deploy race, not
   a finding — re-run it.

2. **R8 caught an owner ten tables had been waiting on.** Marking WP 4.4 done
   turned the gate red in twelve places: the tier-5 run/result group and the
   `result-binding` invariant named WP 4.4 as owner and nothing in its brief had
   ever agreed to it. All twelve moved to WP 6.3 (the A5 Reproducibility Record
   *is* `result-binding`). Worth a look — that is a real re-scoping of WP 6.3.

3. **Three deprecated shims exist only for the migration/frontend deploy window**
   and WP 5.3 deletes them: `should_recalculate_network_metrics` + its caller, the
   two-argument `analysis_mark_critical_nodes`, the one-argument
   `refresh_node_list_for_project`.

4. **Two packages in a row had a wrong inherited "already verified" line**, in
   opposite directions (D72's count existed when WP 4.3 assumed it did not; WP
   4.4's third mechanism did not exist). `docs/PLAN-PROMPTS.md` is corrected for
   4.4; the preamble's first non-negotiable is earning its place.

---

## Still to do

| # | Package | State |
|---|---|---|
| 1 | **WP 6.1** — resolution chains, pinned | not started |
| 2 | WP 6.2 — fix the divergences | not started · budget shrank after D78 |
| 3 | WP 6.3 — vocabulary, value chain, reproducibility record | **re-scoped**: now owns `result-binding` + 11 table sidecars |
| — | WP 5.2b–g — the manual | 14 of 80 pages live |
| — | D57 — `reference.generated.ts` does not typecheck | unowned, one line, pick up anywhere |

## Blocked

Nothing. WP 6.1 can start immediately.
