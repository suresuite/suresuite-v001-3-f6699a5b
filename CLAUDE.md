# SuReSuite — session guidance

## Governing document — read before platform work

Any work touching the simulation platform — policies UI, data model, engine, worker,
experimentation, AI/surrogates — must first consult the design blueprint:

**`docs/design/next-gen-platform-design.md`**

Where to look inside it:

- **§2.3 Gap catalog (G1–G12)** — the numbered problems the plan closes; check which gap your task serves.
- **§13 Roadmap (Phases A–E)** — where the task sits in the sequence and its exit criteria.
- **§5 + Appendix A — policy catalog** — before adding or changing any policy, find its row (or add one).
- **§2.2 Preserved assets (A1–A15)** — design decisions that must not be broken.

## The plan — the authority for the data layer

`docs/design/next-gen-platform-design.md` says what the platform becomes.
**`docs/PLAN.md` is the single plan for getting the data layer there** — architecture,
confirmed defects, the transparency standard, the documentation manual, the work
packages, the verification SQL and the drift log. There is no second plan; the two
documents it replaced (`TRANSPARENCY.md`, `USER-DOCS-PLAN.md`) were folded in because
duplicating facts is the defect the plan exists to end.

- **§4 is the only authority for data-layer `file:line` evidence.** Anything about the
  CSV parse, ingestion, the ETL, the policy grid, the engine mapping or the migrations
  cites §4 by D-number or §4.1 row — it does not restate the line numbers. A citation
  that lives only in another document is a fact with no owner, and it goes stale within
  a quarter (D21 and D22 are what that looks like).
- **`npm run check:docs` enforces it** (`scripts/check-docs-single-source.mjs`): a
  markdown file outside the allow-list may not carry data-layer evidence at all, and an
  allow-listed *derived* file (today only `docs/PLAN-PROMPTS.md`) may not hold a fact
  the plan lacks. It runs as part of `npm run lint`.
- **Every work package ends with a gap check and a §16 drift-log entry** — what the
  previous package promised versus what this one found. If a finding changes a later
  package, edit the plan in the SAME commit.
- Commit convention: `Phase N / WP N.M / <blueprint ref>: <title>`.

## The invariants (PLAN.md §2.1) — by gate name

**Every invariant has a NAME, and you cite the name.** The plan's `§2.1` table
numbers four of them `G1`–`G4`, and the blueprint numbers eighteen *gaps* `G1`–`G18`;
on one page "G4" means both "every tier transition writes an audit row" and "no
data-entry surface for the economics". Names do not collide. `PLAN.md §2.1` remains
the authority for the statements; this table adds what the plan cannot — **where
each one is enforced today, and where it is still only a promise.**

Each is meant to be a CI gate, not an aspiration — anything unenforced drifts within
two months, which is the lesson of the two orphan tables (D3, D4, both closed in
WP 1.4). Gates land with their work packages; the rule holds from now.

| Gate name | §2.1 | Invariant | Enforced today by |
|---|---|---|---|
| `single-source` | I1 | Every data fact is authored exactly once; docs/validators/RLS generate from it | `check:docs` · `contract:check` R3 (page drift) |
| `no-tier-skip` | I2 | No tier skipping — external data never lands below T1; pages never write T3 | **not yet** — WP 3.2 |
| `normalize-at-promotion` | I3 | Units normalize at promotion into T2; nothing downstream converts | `contract:units -- --check` (one `UNIT_DAYS`); promotion itself WP 3.3 |
| `natural-key` | I4 | Every canonical table has a natural-key unique constraint; ingestion upserts | `contract:check` R5 — **WARN only**; WP 3.3 lands the keys, WP 2.4 flips it to a failure |
| `input-hash` | I5 | Every derived row carries the input hash it came from | **not yet** — WP 4.1 |
| `declared-fallback` | I6 | A fallback absent from the contract may not exist in code | `contract:validate` (`engine.missing_default`) · `contract:generate` fails when the engine registry names a required field the contract has no column for |
| `ingestion-contract` | I7 | A new source implements the ingestion contract; it never touches T2 schemas | **not yet** — WP 3.1 |
| `result-binding` | I8 | Every result binds dataset + policy + scenario + engine version | **not yet** — WP 4.4 |
| `uuid-identity` | G1 | Orgs/projects/users referenced by uuid; a displayable name is never a join key | **not yet** — WP 2.1 |
| `declared-capability` | G2 | Every table declares read/write capability and minimum project role | `contract:validate` (`governance` is a required sidecar block) |
| `subtractive-delegation` | G3 | Delegation is subtractive and expiring | **not yet** — WP 2.2 |
| `audit-actor` | G4 | Every tier transition writes an audit row naming the actor | **not yet** — WP 2.3; `audited: false` on every sidecar is the honest record |
| `table-covered` | — | Every table is described by a sidecar or deferred to a named work package | `contract:check` R1 (WP 1.4) |
| `no-orphan-table` | — | No table the code reads is created by no migration; none is ALTERed without being created | `contract:check` R4 · `contract:verify` (WP 1.4) |

## The transparency commitments (PLAN.md §5.3)

Also named, for the same reason. These are what the invariants are *for*.

| Commitment | Rule |
|---|---|
| **T1 · No number without a source** | Every displayed value resolves to data, a named substitution rule, or an explicit default. There is no fourth option. |
| **T2 · Substitution is always visible** | At the point of display, not in a log. A fallback absent from the contract may not exist in code (`declared-fallback`). |
| **T3 · We publish our own blind spots** | Every report and export states the known limits of its own computation. |
| **T4 · Reproducible or not published** | Any figure leaving the system carries the dataset, policy, scenario and engine versions that produced it. |
| **T5 · Transparency survives handover** | Generated and CI-gated, so it stays true when the people who built it have moved on. |

## The data-contract commands

One command reproduces everything CI asserts about the data layer:

```
npm run contract:check
```

It runs `contract:introspect -- --check`, `contract:validate`, `contract:units -- --check`,
`contract:verify` and `contract:generate -- --check`, then its own rules (R1 coverage,
R4 orphans, R5 natural keys, R6 §4 citation resolution). `.github/workflows/data-contract.yml`
runs the same set, plus `check:docs` and `npm test`, on every pull request.

- **Added a table?** Author `supabase/contract/<table>.contract.yaml`, or defer it in
  `scripts/data-contract/coverage.yaml` under the work package that will. A table in
  neither fails `table-covered`.
- **Changed a migration or a sidecar?** Run `npm run contract:generate` and commit
  `build/data-contract.generated.json` and `docs/data/tables/*.md` with it. They are
  committed on purpose: a gate that compares against an uncommitted artifact can never
  fail.
- **Never edit `docs/data/tables/*.md`.** They are generated. Edit the sidecar.

## Traceability convention

- Commits and PRs that advance the plan reference the blueprint section, gap, and phase they
  serve — e.g. `Phase A / G4 / §8.3: item-master editing forms`.
- If implementation must deviate from the blueprint, **update the blueprint in the same PR**.
  The document and the code move together; the blueprint is never allowed to go stale.

## Standing architectural laws (from the blueprint)

- **scsim is the strategic engine.** The legacy engine `sim-worker/sim_worker/engine.py` is
  frozen — never add capability to it (§3).
- **The registry export is the single source of truth for policy schemas**
  (`scsim/scsim/io/registry_export.py`). Never hand-write parallel policy schemas; generate
  from the registry (§6.2).
- **Extend existing artifacts, don't replace them** — proposals build on the phase pipeline,
  plugin registry, and version/hash patterns that already exist (§0).
- **Policy catalog IDs**: `P-S.x` supplier, `P-P.x` plant, `P-T.x` transport, `P-C.x` customer,
  `P-F.x` forecasting, `P-X.x` cross-cutting; `P-W.x` reserved for the warehouse echelon (§4.2).

## Repo orientation

| Tier | Path | Entry points |
|---|---|---|
| Frontend (React/Vite) | `src/` | `src/pages/ProjectPolicies.tsx` (/policies), `src/pages/DataManager.tsx` (/project-manager), `src/pages/SimulationLab.tsx` (/simulation-lab) |
| Data & control plane (Supabase) | `supabase/` | `supabase/functions/sim-command/index.ts`, `supabase/migrations/` |
| Execution (Fly.io worker) | `sim-worker/` | `sim_worker/worker.py`, `sim_worker/datamap.py`, `sim_worker/scsim_bridge.py` |
| Engine (Python) | `scsim/` | `scsim/scsim/core/phases.py`, `scsim/scsim/policies/registry.py`, `scsim/scsim/io/project_map.py` |

Companion docs, all under `docs/data/` and each opening with a status banner
(GENERATED / AUTHORED / DEPRECATED) so you know whether to edit it or its generator:
`docs/data/field-mapping.md` (AUTHORED — the field-mapping contract),
`docs/data/lifecycle.md` (AUTHORED — state tiers), `docs/data/tables/*.md`
(GENERATED by the data contract, lands in WP 1.4). The old top-level paths
`docs/data-simulation-mapping.md` and `docs/simulation-data-lifecycle.md` are
tombstones — many code comments still cite them; follow the stub, and do not add
content there.

`scsim/docs/` is the engine reference — generated, edit via
`scsim/scripts/gen_docs.py`, not by hand.
