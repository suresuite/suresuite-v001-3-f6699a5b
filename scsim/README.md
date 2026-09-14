# scsim — Resilience-Grade 3-Echelon Supply Chain Simulator

The SCSIM engine of the Master Development Plan v2.0: a phase-pipeline,
vectorized weekly DES that stress-tests supplier/material risk, evaluates
portfolios of resilience strategies, and measures synergy under common
random numbers. Operationalizes Nguyen & Ivanov, *"Synergistic Effects of
Combining Resilience Strategies in Supply Chains."*

**Full documentation: [`docs/`](docs/index.md)** (MkDocs;
`pip install mkdocs-material && mkdocs serve` here). The reference section
(policy catalog, variable dictionary, pipeline contract, KPI dictionary) is
**generated from the code registry** — `python scripts/gen_docs.py`;
`--check` is the CI gate.

## What's inside

```
scsim/
  entities/    Part III variable dictionary (Pydantic-canonical)
  core/        phase pipeline (PH-00..PH-99), SimContext, engine
  policies/    plugin registry — 22-policy catalog, 9 implemented ✅
  disruption/  generalized event injector (LT-extension ✅, capacity cuts)
  stats/       keyed SeedSequence tree, MSER-5 + Conway, bootstrap
  kpi/         Part V dictionary + Resilience Index
  synergy/     CRN portfolio decomposition + breadth ladder
  stress/      ST-1 ✅ / ST-2 batteries with warm-state snapshots
  io/          registry export, Parquet/CSV traces, snapshots,
               legacy sim-worker graph adapter
```

Implemented (✅) policies: P-P.1 `inventory_control`, P-C.1
`unmet_demand_handling`, P-S.1 `backup_supplier`, P-S.2
`proactive_multi_sourcing`, P-P.3 `safety_stock_materials`, P-P.4
`fg_safety_stock` (MTS), P-P.5 `short_term_capacity`, P-P.9
`material_allocation` (rolling HiGHS LP), P-T.2 `expedited_shipments`.
Both fulfillment modes of the CODP run on the same pipeline: MTO and MTS
(ADR 0001), mixable per product. The 13 planned (🧩) policies register
full parameter schemas and raise a milestone-pointing error if enabled —
never a silent no-op.

## Install & test

```bash
pip install -e ".[io,dev]"     # pyarrow optional (CSV fallback without it)
pytest                          # ~90 tests, < 30 s
pytest -m "not slow"            # skip the perf guard
python scripts/benchmark.py     # Part X targets (--large for the big instance)
```

## Quick example

See [docs/index.md](docs/index.md#quickstart). Highlights:

* `run_scenario(scenario)` — replication grid, warm-up detection, KPI
  aggregation with CIs.
* `run_st1(scenario)` — the manuscript supplier-outage sweep with
  per-cell Resilience Index and ρ_s overlay.
* `run_portfolio_study(...)` + `synergy.decompose(...)` — CRN-paired
  ΔR/ΔC vs S0 and bootstrap-starred synergy.
* `io.legacy_graph.from_legacy_graph(graph, policies, ...)` — run an
  existing SuReSuite sim-worker project on this engine (see
  `sim-worker/sim_worker/scsim_bridge.py`).

## Determinism contract

World streams (demand, lead time, hazards) are keyed structurally by
`(project_seed, model_rep, …)`; every policy draws only from its
`ctx.rng(policy_id)` child stream keyed by a digest of the policy id —
adding policy #22 cannot perturb policies #1–21 or the world (tested:
G-RNG). Golden traces #1–#5 freeze the engine semantics; the pipeline
schema snapshot (`scsim/pipeline_schema.json`) fails the build on
accidental contract drift.
