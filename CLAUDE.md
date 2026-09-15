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

## The invariants (PLAN.md §2.1)

Each is meant to be a CI gate, not an aspiration — anything unenforced drifts within
two months, which is the lesson of the two orphan tables (D3, D4). Gates land with
their work packages; the rule holds from now.

| # | Invariant |
|---|---|
| I1 | Every data fact is authored exactly once; docs/validators/RLS generate from it |
| I2 | No tier skipping — external data never lands below T1; pages never write T3 |
| I3 | Units normalize at promotion into T2; nothing downstream converts |
| I4 | Every canonical table has a natural-key unique constraint; ingestion upserts |
| I5 | Every derived row carries the input hash it came from |
| I6 | A fallback absent from the contract may not exist in code |
| I7 | A new source implements the ingestion contract; it never touches T2 schemas |
| I8 | Every result binds dataset + policy + scenario + engine version |
| G1 | Orgs/projects/users referenced by uuid; a displayable name is never a join key |
| G2 | Every table declares read/write capability and minimum project role |
| G3 | Delegation is subtractive and expiring |
| G4 | Every tier transition writes an audit row naming the actor |
| T1–T5 | The transparency commitments — PLAN.md §5.3 |

`G1`–`G4` here are the plan's **governance** invariants and are unrelated to the
blueprint's `G1`–`G18` gap numbers; the plan cites blueprint gaps as "blueprint G4".

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
