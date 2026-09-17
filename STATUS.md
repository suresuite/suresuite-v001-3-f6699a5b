# Overnight run — status

> Updated at the end of every work package. `docs/PLAN.md` §16 is the authority
> for what each package found; this file is the short version you read first.

**Branch:** `claude/busy-thompson-9p8zb9` · **Started from:** `e9b9644` (WP 4.2 merged)

---

## Closed this run

### WP 4.3 — Migrate the analyzers (dual-write) · `20260917000007`

Three analyzers plus `combine-project` now write **both** destinations, every
derived row carries the run that produced it, and the four deep-tier tables are
described for the first time.

**Defects closed:** D72, D76, D77, D78, D79 — plus D54's largest deferral group.
**Defect found:** D75 (mitigated here, real fix is WP 4.4's).

**The finding that changed the package.** `analysis_runs.input_hash` is
`current_graph_hash`, which hashes eleven tier-2 tables — and the two centrality
analyzers read `network_nodes`/`network_edges`, neither of them. Re-upload a
network and the anchor does not move, so WP 4.2's store would report a cache hit
and serve the *previous* graph's centralities. Mitigated by a declared
`topology_digest` in `analysis_runs.params`; the real fix is folding it into
`hash_network`, which is a `schema_version` bump and therefore blocked on D70.

**Also found by reading the invocation path nothing had named:**
- the prominence auto-invoker was `FOR EACH ROW` — one upload of the 2 129-edge
  project fired 2 129 full recomputations of the same graph (D76);
- its `pg_net` fallback caught the wrong SQLSTATE, so a failed notification
  **aborted the write it was notifying about** (D77);
- D71's "26 writers, two attribute" was a text scan's reading — ten attribute
  through `set_current_user_context` and have since 2025-08-20 (D78).

**Verified:** `contract:check` ✓ · `npm test` 326/326 ✓ · lint at baseline
(336 errors, unchanged) · `contract:rehearse` plain ✓ and `--fixtures` ✓, 13
behavioural files including the new `supabase/rehearsal/130` (11 sections,
mutation-tested — one mutation survived the first draft and the assertion was
fixed).

---

## Needs a decision when you wake up

1. **A §15 run is owed and was deliberately not taken.** This push carries a
   migration, and the three-door rule forbids touching `.github/verify-request`,
   `verification-sql.yml` or `verification-sql.mjs` in the same push. Once
   `Deploy Supabase Migrations` is green, a second push should add two probes:
   `computed_from_hash IS NULL` per derived table (that number is the size of
   what WP 5.3 cannot migrate) and a re-run of the `network_nodes` duplicate
   sweep against the new unique index.

2. **D75's real fix needs a `schema_version` bump, which needs D70 first.** WP 4.4
   owns both, and the order is now load-bearing rather than a preference. D70 was
   a finding with no consumer; it is now what blocks two other things.

3. **Edge functions deploy on a different workflow from migrations, with no
   ordering between them.** Two deprecated shims exist only to cover that window
   — the two-argument `analysis_mark_critical_nodes` and the one-argument
   `refresh_node_list_for_project`. WP 5.3 deletes them once no deployed caller
   uses them.

4. **The three `src/` call sites now pass `uploaded_by`.** A tier-3 write without
   an actor is refused with a 400 rather than writing `actor_known: false`. If any
   other caller invokes those functions, it will start failing — worth a check
   against the deployed frontend.

---

## Still to do

| # | Package | State |
|---|---|---|
| 1 | **WP 4.4** — staleness, invalidation, Trust Report | next · D70 first, then D75's fold into `hash_network` |
| 2 | WP 5.1 — surfaces (lineage) block | not started |
| 3 | WP 5.3 — pages read `analysis_results`; drop entity columns | not started · unblocked by WP 4.3 |
| 4 | WP 6.1 — resolution chains, pinned | not started |
| 5 | WP 6.2 — fix the divergences | not started · re-budget smaller after D78 |
| 6 | WP 6.3 — vocabulary, value chain, reproducibility record | not started |
| — | WP 5.2b–g — the manual | 14 of 80 pages live |
| — | D57 — `reference.generated.ts` does not typecheck | unowned, one line, pick up anywhere |

## Blocked

Nothing. WP 4.4 can start immediately.
