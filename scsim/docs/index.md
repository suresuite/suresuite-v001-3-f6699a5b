# SCSIM — Resilience-Grade 3-Echelon Supply Chain Simulator

SCSIM is a discrete-time simulation platform that **stress-tests supplier and
material risk in a three-echelon network** (suppliers → plant → customers),
evaluates **portfolios of resilience strategies**, measures **synergy**
between them under common random numbers, and grounds recommendations in
disruption duration, supplier sourcing structure, and fulfillment mode.

It operationalizes the methodology of *"Synergistic Effects of Combining
Resilience Strategies in Supply Chains"* (Nguyen & Ivanov). Manuscript
constructs are the validated core (✅); everything else is a governed
extension (🧩) that ships through the change-governance tiers in
[Extending the engine](extending.md).

## Quickstart

```python
from scsim import (
    BomLine, DisruptionEvent, Material, Network, Product,
    Scenario, SimulationSettings, Supplier, SupplierLink,
)
from scsim.core.engine import run_scenario

network = Network(
    suppliers=[Supplier(id="acme"), Supplier(id="backup_co")],
    materials=[Material(id="resin", cost=2.0)],
    products=[Product(id="widget", unit_price=20.0, demand_mode=100.0,
                      production_capacity=200.0)],
    bom=[BomLine(product_id="widget", material_id="resin", rate=1.0)],
    supplier_links=[
        SupplierLink(supplier_id="acme", material_id="resin",
                     cost=2.0, lead_time_weeks=2),
        SupplierLink(supplier_id="backup_co", material_id="resin",
                     cost=2.6, lead_time_weeks=3),
    ],
)

scenario = Scenario(
    name="acme outage",
    network=network,
    settings=SimulationSettings(project_seed=42),
    events=[DisruptionEvent(target_id="acme")],   # start/duration drawn per rep
    policies={"backup_supplier": {}, "expedited_shipments": {}},
)

result = run_scenario(scenario)
print(result.aggregates["fill_rate"], result.aggregates["cost_of_resilience"])
```

Three higher-level entry points sit on top of `run_scenario`:

| Entry point | Question it answers | Docs |
|---|---|---|
| `scsim.stress.run_st1` / `run_st2` | *Which supplier hurts most, under delay vs volume loss?* | [Stress tests](stress-tests.md) |
| `scsim.core.engine.run_portfolio_study` | *What does each strategy buy me vs doing nothing (ΔR, ΔC, SLA)?* | [Synergy](synergy.md) |
| `scsim.synergy.decompose` | *Do these strategies reinforce or cannibalize each other?* | [Synergy](synergy.md) |

## How it fits the SureSuite stack

```
Frontend (/simulation-lab, /policies)
   renders forms from the /scsim/registry payload ONLY
        │
Supabase (scenarios, policy bundles, runs)
        │
sim-worker (Fly.io)  ──  scsim.io.legacy_graph.from_legacy_graph(...)
        │                       converts the existing project graph + policy
        ▼                       dict into a Scenario (notes list every
scsim engine                    structural approximation)
```

`scsim.io.registry_export.build_registry()` produces the single JSON payload
behind the frontend forms, the Zod/Supabase validator codegen, and the
[generated reference pages](reference/policies.md) — Pydantic is canonical,
so an undocumented parameter fails the docs CI gate.

## Map of the documentation

* [Architecture](architecture.md) — the phase pipeline, engine semantics, determinism.
* [Statistics](statistics.md) — seed tree, CRN, warm-up, bootstrap (Part VIII hard requirements).
* [KPIs](kpis.md) — definitions and the Resilience Index normalizations.
* [Stress tests](stress-tests.md) — the ST-1..7 battery.
* [Synergy](synergy.md) — portfolio decomposition under CRN.
* [Extending](extending.md) — how to add policies/variables/phases without rewrites.
* [Performance](performance.md) — targets and the engineering that meets them.
* [Roadmap](roadmap.md) — milestone status (M1..M8).
* Reference (generated): [policies](reference/policies.md) ·
  [variables](reference/variables.md) · [pipeline](reference/pipeline.md) ·
  [KPIs](reference/kpis.md).
