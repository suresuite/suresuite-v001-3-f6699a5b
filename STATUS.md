# Overnight run — status

> Updated at the end of every work package. `docs/PLAN.md` §16 is the authority
> for what each package found; this file is the short version you read first.

**Branch:** `claude/busy-thompson-9p8zb9` · **Started from:** `e9b9644` (WP 4.2 merged) · **5 packages closed + WP 6.2 slices 1–6** · PR [#223](https://github.com/suresuite/suresuite-v001-3-f6699a5b/pull/223) open

---

## Closed this run

### WP 6.2 (slice 6) — All three gates, every time · no migration

**D85 closed.** `npm run lint` was `eslint . && npm run audit:ui && npm run
check:docs`, and eslint exits 1 on this repo — so two of three gates were
**unreachable** from the command every contributor runs. Three work packages
reported "lint at baseline" on the strength of a command that stopped at step one.

**The recorded remedy was right to be refused.** D85 says flipping `&&` to `;`
"turns a red gate into a redder one" and defers the fix. It's worse than that:
`a; b; c` reports `c`'s exit code alone, so a red eslint would start **passing** —
a gate switched off in the name of repairing it, looking like progress.

`scripts/lint-all.mjs` runs all three, prints each one's output verbatim, exits
non-zero if any failed. Same verdict, more information, and **no dependency on
the eslint debt** — which is why it didn't have to wait for the package D85
deferred it to.

**The first run proved the point:** `audit:ui` is also failing. Two of three
gates red, where the command used to stop at one and report that as the whole
story.

No CI risk — checked, not assumed: CI has never called `npm run lint`;
`data-contract.yml` invokes each command directly for exactly this reason.

**Left open deliberately:** `lint` still doesn't cover `npm test` or
`contract:check`. Whether it should grow, or a `verify:local` should sit beside
it, is a convention call rather than a defect — flagged for you.

**Verified:** all three gates run and report · `contract:check` ✓ · 375 tests ✓ ·
build ✓ · eslint 336/116 and `audit:ui` 8, both unchanged.

### WP 6.2 (slice 5) — The customers table reaches the engine · no migration

**D69 closed — the first slice whose fix is in `scsim`, not `src/`.** A user
fills in a customer's priority or segment and nothing changes, on every project,
with no error.

The recorded half (`priority_weight`) was right. **The unrecorded half is worse**:
`sla_tiers` guarantees a fill floor *per segment*, every customer was in
`"default"`, so no tier ever matched and every floor was 0.0. The engine already
warned about it (`unknown_sla_segment`) — the warning named the symptom while
nothing named the cause, because the segments it compared against were a
constant.

The table was not merely unmapped, it was **never fetched** — so the fix spans
the worker's request, the DTO and the mapper.

✅ **VERIFIED — `8808612` is green on `scsim`, `sim-worker` and `grading`.** It took
three pushes: E1 caught a spurious warning residue, then this package's own GHOST
assertion caught an id-set widening that made it unfirable. Both were branching
bugs, neither findable by reading. The third push carried a stub harness that
runs `_build_customers` without `pydantic` — the transferable lesson.

⚠️ **Not verified locally when first pushed, and CI was the verifier.** `scsim` imports `pydantic`
and the egress proxy denies PyPI (D87's limit), so no Python here can be
executed. `sim-worker/tests/test_customer_attributes.py` has six assertions and
`scsim-tests.yml` runs it on this push. **Watch that check on PR #223.**
Ruff did catch one real bug pre-push (`F821` — the row block landed in the wrong
function).

**Needs a session that can run Python — D94.** The structural root is that
`P-C.2` reads two `Customer` attributes it never *declares*: its
`data_requirements` names one field. That silence is why D69 survived adoption —
the sidecar could say `consumed_by: null` unchallenged and every registry-derived
tool was blind. The sidecar also gave a **false reason** ("none of the `P-C.x`
policies is implemented"; `customer_allocation` is `status: implemented`).
I wrote the declaration and **reverted it**: `registry.generated.json` is
gated by `gen_frontend_registry.py --check`, regenerating needs pydantic, so
landing it would have shipped a knowingly-red gate.

**Needs a product decision.** No surface in this app writes `customers`. Two of
its columns now reach the engine and decide who is served when supply is short —
and they can only be set by hand in the database.

**Verified:** `contract:check` ✓ · `check:docs` ✓ · 375 tests ✓ · build ✓ ·
eslint 336/116 and `audit:ui` 8, both unchanged. Python: **CI only**.

### WP 6.2 (slice 4) — A saved sourcing choice survives a reload · no migration

**D23 + D24 closed.** The user picks a primary supplier, saves, reloads, and sees
the suggestion again. Both recorded mechanisms are real and each alone loses the
choice — but the root cause is one step further back than the defect row said.

A `markFromData` helper wrote the routing SUGGESTION into `__from_data` — the
marker that means "an upload carried this" — while the comment at **both** call
sites said these fields are *not* `__from_data`. The intent was on the record and
the code did the other thing. Three costs: the shadowing; a green "From project
data" dot on the most-clicked cell in the stage for a value no upload contained
(D16's shape); and `hasRealProjectData` counting an upload-free project as having
real data.

Four parts, none shippable alone — routing decisions carry `__decided` only; the
resolver ranks a saved override above a suggestion by reading the **raw patches**
(the merged bundle cannot tell "somebody saved `false`" from "the default is
`false`", and for a routing decision those are opposite answers); `saveAll` stops
dropping the un-check; and `prefillSourceFor` gains the `decision` source, which
is now the only thing keeping blueprint **G16** satisfied.

**Four of nine assertions fail against the pre-fix tree**, including the round
trip itself. Two assertions exist to pin what must *not* change: an uploaded field
still outranks the bundle (WP 4.4's staleness brief turns on it), and a row with
no `__decided` map behaves exactly as before.

Two transcriptions moved with the behaviour and neither is a test edited to pass:
`RESOLUTION_ORDER` gains two steps, and slice 3's own assertion that a `__decided`
marker alone does not persist is now deliberately false, with the reason written
above it.

**D24** closed alongside — same class, one stage over. Its latency was *confirmed*
(no column in the spec, and `runPrefill` iterates the spec not the row) rather
than inherited from the defect row.

**Verified:** `contract:check` ✓ · `check:docs` ✓ · 374 tests ✓ · build ✓ ·
eslint 336/116 and `audit:ui` 8, both unchanged.

### WP 6.2 (slice 3) — D26, and the test that belonged to the dead copy · no migration

**D26 predicted a risk. The risk had already happened.** D26 records two
implementations of the D1 prefill rule and warns that the next edit has "even odds
of landing on the dead one". Comparing them before deleting either — rather than
assuming the dead one was a copy — found they **already disagreed**, on a case
both were tested for: *the user types a value over an imputed average.* The live
rule refuses it (`__imputed` is tested before the draft); the dead one persisted
it as an edit.

`policyPrefill.test.ts` asserted the **dead** answer, in a test named "does NOT
persist an imputed average, but DOES persist an edit of one", and it passed for
its whole life against a function no screen ever called. That is worse than an
untested rule: a claim on the record that the product does something it does not
do — and here the claimed behaviour is the D1 defect's own shape.

The live answer is kept, on its merits: the prefill freezes what the *data* says,
an imputed average is an estimate to verify, and a manual save still writes the
user's value. The assertion is inverted **in place**, with the reasoning above it,
so it does not read as a test edited to pass.

A second difference was latent — the dead copy had a third source, `"decision"`,
reading `__decided`. Adding it would make a field with *no* value newly
persistable, which is the other half of D23. Left alone deliberately.

**Gated:** `oneResolver.test.ts` now also requires exactly one module to define
the predicate, and that it still tests `__imputed` before the draft — the order
that *is* the behaviour. Mutation-tested.

**Verified:** `contract:check` ✓ (R6 caught two citations left dangling by the
deletion) · `check:docs` ✓ · 362 tests ✓ · build ✓ · eslint 336/116 and
`audit:ui` 8, both unchanged.

### WP 6.2 (slice 2) — One resolver, and the sixty suppliers · no migration

**D17 could not be fixed once, so the duplication was paid first.** The fix lives
in `liveDefault`, and `liveDefault` existed *twice* — `resolveCell` and a verbatim
seventy-line copy inside `StagePolicyTable.tsx`, each with a comment telling the
reader to change both, since WP 0.1. Fixing D17 in two places would have deepened
the exact debt this package owns.

The desktop grid now calls `resolveCell`. `oneResolver.test.ts` is a **gate** —
both renderers must call it, neither may rebuild the ladder inline, and a third
assertion stops the first two passing by renaming. **Proven red on `HEAD~`.**
(A comment did not prevent this before: D26 is two prefill rules, both
unit-tested, one dead, the suite green while only one ran.)

**D17 needed a correction of its own.** Recorded as "renders `0`, no dot" at 60 of
60 suppliers. That is the **mobile** list — it renders `cellValue ?? liveDefault`.
The desktop grid showed `—`: not a claim of zero capacity, but nothing saying
blank means unlimited, and no dot either. Two failures, one `?? 0`. Six for six
now: a symptom recorded once is a symptom recorded on one surface.

Fixed as `declared-fallback` (I6) applied to the UI — `columnSpecs.ts` declares
`master.nullMeans: { token: "∞", title }` next to the pointer, the resolver
substitutes no number and returns a `contract` provenance that *has* a colour.
Mutation-tested three ways.

**A trap worth naming:** `kindOf` picks the widget from `typeof liveDefault ===
"number"`. Making `liveDefault` undefined would have silently turned the capacity
cell into a **text input** — a fix for a display lie introducing a worse editing
bug. Caught, fixed, and gated.

**WP 6.3 should know:** this spent the reserved `contract` provenance state, for
exactly its reserved meaning. `estimated` is untouched. The legend was updated in
the same commit.

**Verified:** `contract:check` ✓ · `check:docs` ✓ (it caught a §4 citation I had
removed while PLAN-PROMPTS still held it) · 359 tests ✓ · build ✓ · eslint 336/116
and `audit:ui` 8, both unchanged.

### WP 6.2 (slice 1) — The engine scan, corrected · no migration

WP 6.2 owns sixteen defects and is being landed in slices. This one is the
prerequisite: **the concrete list WP 6.2 was told to start from was wrong.**

WP 6.1 handed over nine broken chains and the rule "a fix is a name leaving
`KNOWN_BREAKS`". Checking the count before believing it — five for five now —
found its engine scan wrong in both directions:

- **too loose** — `order_up_to` passed because `project_map.py:865` names it in a
  warning whose text says the engine *replaces* it. The scan read the string that
  says the field is dropped as proof it is consumed.
- **too narrow** — the scan read `project_map.py` alone, so six breaks said "read
  by nothing" about fields the legacy engine or the product reads.

**Nine became eleven. No name left the list.** The growth is recorded in the test
as a correction rather than hidden by re-basing the ratchet. What changed is the
sentence: `classifyBreak` sorts the eleven into five shapes with `file:line`
evidence apiece, and each shape names a different remedy. The one worth reading
twice is `reorder_point` — declared in the legacy schema and consulted by
*neither* engine, because `engine.py:320` computes `RP` for itself. The grid
takes the user's number and drops it, and nothing had named that.

**Two lies fixed, not just recorded:**

- **D89 (display half).** `plant.initial_on_hand` claimed
  `master: products.initial_on_hand`; `products` has no such column, so the cell
  fell through to the bundle while the Parameter Sheet said *"reaches engine ·
  from item master"*. Pointer deleted; `masterPointersResolve.test.ts` is a
  **gate** (empty on arrival, mutation-tested both ways). The field is still read
  by nothing and stays on the ratchet — fixing a lie is not wiring a field.
- **D92 (new).** The sheet told users `reorder_point` *"activates with engine
  catalog — planned"*. Nothing is planned; that string was a hard-coded fallback
  every caller treated as a milestone. `FieldEngineStatus` gains `stored-only`,
  and the sheet now says *"stored only · no engine consumer, none planned"*.

**Needs a human — not blocked, but not mine to decide:**

- **`products.initial_on_hand`** was *not* added, and cost is not the reason:
  `scsim/scsim/core/context.py:150` builds on-hand from `net.materials` only, so
  there is no finished-goods initial inventory in the strategic engine for the
  column to feed. Schema change **and** engine capability.
- **Nine of the eleven need a product decision, not a fix** — remove the column,
  wire the field, or leave it badged. The badge now tells the truth, which makes
  deferring honest rather than silent.

**Verified:** `contract:check` ✓ (R6 caught an ambiguous `engine.py` citation —
qualified) · 352 tests ✓ · `check:docs` ✓ · build ✓ · eslint 336/116 and
`audit:ui` 8 findings, both unchanged from `HEAD`.

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

### WP 6.1 — Resolution chains, documented and pinned · no migration

**38 chains, derived rather than written.** ~120 hand-written chains are true on
the day they're typed (D21/D22); every hop already exists as data, so
`resolutionChains.ts` computes them and a test pins what rots. **9 break**, each
ratcheted so the number can only fall — that list is WP 6.2's actual work.

- **D89** — `plant.initial_on_hand` is master-backed by `products.initial_on_hand`
  and **`products` has no such column**. `materials` does, and the supplier stage
  uses it correctly fifty lines earlier. The cell silently falls through to the
  bundle under a header claiming item-master data.
- **D90** — three doors reach the engine and only two are declarations. For nine
  bundle keys, a quoted string in `project_map.py` is the only evidence they're
  read at all. §3 says the registry export is the single source for policy
  schemas — true of the ones that exist, silent about these.
- **Three over-claims caught inside the package** (28→11, 11→9, 7→0), each of
  which would have shipped a confidently wrong list of findings.
- **Its gap check found eleven tables** deferred to WP 6.1 behind an association
  rather than a plan. They now have a real owner: **WP 6.4**, a new package, kept
  off WP 6.3 because 22 tables under one package misrepresents its cost.

**Verified:** `contract:check` ✓ · 348 tests ✓ · eslint at baseline · build ✓ ·
mutation-tested.

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
| 1 | **WP 6.2** — fix the divergences | not started · budget shrank after D78 |
| 2 | WP 6.3 — vocabulary, value chain, reproducibility record | **re-scoped**: now owns `result-binding` + 11 table sidecars |
| 3 | **WP 6.4** — the decision plane described (NEW, created by 6.1's gap check: 11 tables) | not started |
| — | WP 5.2b–g — the manual | 14 of 80 pages live |
| — | D57 — `reference.generated.ts` does not typecheck | unowned, one line, pick up anywhere |

## Blocked

Nothing. WP 6.2 can start immediately — its list is now nine named broken chains plus D90's nine undeclared keys.
