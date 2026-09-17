# Overnight run — status

> Updated at the end of every work package. `docs/PLAN.md` §16 is the authority
> for what each package found; this file is the short version you read first.

**Branch:** `claude/busy-thompson-9p8zb9` · **Started from:** `e9b9644` (WP 4.2 merged)

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

---

## Needs a decision when you wake up

1. **Two §15 runs are owed and were deliberately not taken.** Both pushes carry
   migrations, and the three-door rule forbids touching `.github/verify-request`,
   `verification-sql.yml` or `verification-sql.mjs` alongside one. Once
   `Deploy Supabase Migrations` is green, a second push should add probes for:
   `computed_from_hash IS NULL` per derived table (the size of what WP 5.3 cannot
   migrate); proposals already expired for `grounding_drift` (**D70's realised,
   unrecoverable damage** — the prior status is not in the row); and
   `live_grounded_on_graph_hash` before WP 5.3 takes the D75 bump.

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
| 1 | **WP 5.1** — surfaces (lineage) block | next |
| 2 | WP 5.3 — pages read `analysis_results`; drop entity columns | unblocked · also owns D75's real fix |
| 3 | WP 6.1 — resolution chains, pinned | not started |
| 4 | WP 6.2 — fix the divergences | not started · budget shrank after D78 |
| 5 | WP 6.3 — vocabulary, value chain, reproducibility record | **re-scoped**: now owns `result-binding` + 11 table sidecars |
| — | WP 5.2b–g — the manual | 14 of 80 pages live |
| — | D57 — `reference.generated.ts` does not typecheck | unowned, one line, pick up anywhere |

## Blocked

Nothing. WP 5.1 can start immediately.
