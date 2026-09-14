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

Companion docs: `docs/data-simulation-mapping.md` (field-mapping contract),
`docs/simulation-data-lifecycle.md` (state tiers), `scsim/docs/` (engine reference,
generated — edit via `scsim/scripts/gen_docs.py`, not by hand).
