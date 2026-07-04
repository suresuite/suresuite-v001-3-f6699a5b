#!/usr/bin/env python3
"""E2 parity characterization: the preset library through both engines.

Engine-retirement gate E2 (blueprint §3) requires the preset library to be
run through the legacy worker engine and scsim, with differences documented
and accepted as corrections. This script does exactly that and regenerates
``docs/parity-characterization.md``:

- one representative dual-sourced network (the worker graph shape);
- the 8 system presets reduced to the family fields either engine consumes
  (the data-aware `why` fields the presets add are UI rationale, not engine
  input; per-node absolute points are exactly the G1 loss this table makes
  visible);
- two scenarios: steady state, and a 10-week full outage of the primary
  supplier;
- both engines run with the same seed/replication budget; every scsim
  mapping approximation (`scsim_notes`) is printed beside the numbers.

Run from the repo root (needs scsim installed and sim-worker deps):

    python scripts/parity_characterization.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sim-worker"))

import networkx as nx  # noqa: E402

from sim_worker.engine import compute_kpis  # noqa: E402
from sim_worker.scsim_bridge import compute_kpis_scsim  # noqa: E402

OUT = ROOT / "docs" / "parity-characterization.md"
SEED, N_REPS, N_WEEKS = 42, 20, 104
OUTAGE = [{"target": "s1", "target_type": "node",
           "start_day": 280, "duration_days": 70, "magnitude_pct": 100}]
# (legacy key, scsim key) pairs — the two engines name their KPI rows
# differently; only genuinely comparable quantities are tabled.
KPIS = (("fill_rate", "fill_rate"), ("revenue", "revenue"),
        ("lost_sales", "lost_sales_value"),
        ("cost_of_resilience", "cost_of_resilience"))


def representative_graph() -> nx.DiGraph:
    """Worker-shaped graph: dual-sourced m1; m2 is a single-sourced BoM peer
    of the SAME primary supplier — the manuscript's hard case, so the outage
    scenario genuinely bites regardless of sourcing strategy."""
    g = nx.DiGraph()
    g.add_node("s1", node_type="supplier", name="Primary")
    g.add_node("s2", node_type="supplier", name="Backup")
    g.add_node("m1", node_type="material")
    g.add_node("m2", node_type="material")
    g.add_node("p1", node_type="product", weekly_demand=100.0, unit_price=10.0,
               capacity_units_per_day=30.0)
    g.add_node("c1", node_type="customer")
    g.add_node("c2", node_type="customer")
    g.add_edge("s1", "m1", edge_type="supply", lead_time=2.0, unit_price=1.0)
    g.add_edge("s2", "m1", edge_type="supply", lead_time=3.0, unit_price=1.3)
    g.add_edge("s1", "m2", edge_type="supply", lead_time=2.0, unit_price=2.0)
    g.add_edge("m1", "p1", edge_type="bom", consumption_rate=1.0)
    g.add_edge("m2", "p1", edge_type="bom", consumption_rate=0.5)
    g.add_edge("p1", "c1", edge_type="outbound", volume=60.0)
    g.add_edge("p1", "c2", edge_type="outbound", volume=40.0)
    return g


def _fam(inventory: dict, fulfillment: dict, sourcing: dict, recovery: dict,
         production: dict | None = None) -> dict:
    fams = {"inventory": inventory, "fulfillment": fulfillment,
            "sourcing": sourcing, "recovery": recovery}
    if production:
        fams["production"] = production
    return {"default": fams}


# The 8 system presets (src/lib/policies/presets/), reduced to the family
# fields the engines consume. Derived values use the presets' own formulas at
# the reference context (demand 100/wk, supplier LT 3d, LT_cv 0.3, CV 0.3).
PRESETS: dict[str, dict] = {
    "lean_jit": _fam(
        {"type": "continuous_review", "safety_stock_method": "fixed_days",
         "safety_stock_days": 2, "review_period_days": 1, "holding_cost_pct": 0.25},
        {"backorder_allowed": False, "allocation": "priority", "service_level_alpha": 0.92},
        {"strategy": "single"},
        {"enabled": True, "response": ["mode_shift", "safety_stock_drawdown"],
         "recovery_target_days": 14},
    ),
    "resilient": _fam(
        {"type": "s_S", "safety_stock_method": "service_level",
         "service_level_target": 0.97, "safety_stock_days": 14,
         "review_period_days": 1, "holding_cost_pct": 0.18},
        {"backorder_allowed": True, "max_backorder_days": 21,
         "allocation": "sla_tier", "service_level_alpha": 0.97},
        {"strategy": "dual_sourcing", "ratios": {"primary": 0.7, "backup": 0.3}},
        {"enabled": True, "response": ["mode_shift", "dual_source_activate"],
         "recovery_target_days": 21},
        {"utilization_cap_pct": 75},
    ),
    "cost_optimized": _fam(
        {"type": "s_S", "safety_stock_method": "fixed_days", "safety_stock_days": 7},
        {"backorder_allowed": True, "max_backorder_days": 30, "allocation": "proportional"},
        {"strategy": "single"},
        {"enabled": True, "response": ["safety_stock_drawdown"]},
        {"utilization_cap_pct": 90},
    ),
    "service_first": _fam(
        {"type": "base_stock", "safety_stock_method": "service_level",
         "service_level_target": 0.99, "safety_stock_days": 21},
        {"backorder_allowed": False, "allocation": "fair_share",
         "service_level_alpha": 0.99},
        {"strategy": "dual_sourcing"},
        {"enabled": True,
         "response": ["safety_stock_drawdown", "mode_shift", "capacity_flex"]},
        {"utilization_cap_pct": 70},
    ),
    "sustainable": _fam(
        {"type": "s_S", "safety_stock_method": "fixed_days", "safety_stock_days": 14},
        {"backorder_allowed": True, "max_backorder_days": 45, "allocation": "proportional"},
        {"strategy": "single"},
        {"enabled": True, "response": ["safety_stock_drawdown", "demand_shaping"]},
        {"utilization_cap_pct": 88},
    ),
    "agile_high_mix": _fam(
        {"type": "s_S", "safety_stock_method": "demand_variability",
         "safety_stock_days": 10, "review_period_days": 1},
        {"backorder_allowed": True, "max_backorder_days": 7, "allocation": "priority"},
        {"strategy": "multi"},
        {"enabled": True, "response": ["safety_stock_drawdown", "dual_source_activate"]},
        {"utilization_cap_pct": 75},
    ),
    "make_to_order": _fam(
        {"type": "base_stock", "safety_stock_method": "fixed_days", "safety_stock_days": 0},
        {"backorder_allowed": True, "max_backorder_days": 60, "allocation": "priority"},
        {"strategy": "primary_backup"},
        {"enabled": True, "response": ["capacity_flex", "dual_source_activate"]},
        {"utilization_cap_pct": 80},
    ),
    "make_to_stock": _fam(
        {"type": "s_S", "safety_stock_method": "service_level",
         "service_level_target": 0.95, "safety_stock_days": 14},
        {"backorder_allowed": True, "max_backorder_days": 14, "allocation": "fair_share"},
        {"strategy": "single"},
        {"enabled": True, "response": ["safety_stock_drawdown"]},
        {"utilization_cap_pct": 85},
    ),
}


def run_pair(policies: dict, schedule: list[dict]) -> tuple[dict, dict]:
    g = representative_graph()
    legacy = compute_kpis(g, dirty=set(), policies=policies, n_weeks=N_WEEKS,
                          seed=SEED, n_reps=N_REPS, disruption_schedule=schedule)
    g = representative_graph()
    scsim = compute_kpis_scsim(g, policies=policies, n_weeks=N_WEEKS,
                               seed=SEED, n_reps=N_REPS, disruption_schedule=schedule)
    return legacy, scsim


def fmt(v) -> str:
    if v is None:
        return "—"
    return f"{v:,.3f}" if abs(v) < 10 else f"{v:,.0f}"


def main() -> None:
    lines: list[str] = []
    add = lines.append
    add("# Parity characterization — legacy engine vs scsim (gate E2)")
    add("")
    add("<!-- GENERATED by scripts/parity_characterization.py — edit the script, "
        "then rerun it; do not edit the numbers by hand. -->")
    add("")
    add("Engine-retirement gate **E2** (blueprint §3) requires the preset library "
        "to be characterized through both engines with differences documented and "
        "accepted as corrections. Method: the 8 system presets "
        "(`src/lib/policies/presets/`), reduced to the family fields either engine "
        "consumes, on one representative dual-sourced network "
        f"(2 suppliers, 2 materials, 1 product, 2 customers; m2 single-sourced "
        f"from the primary — the BoM-peer bottleneck), seed {SEED}, "
        f"{N_REPS} replications, {N_WEEKS} weeks; steady state and a 10-week full "
        "outage of the primary supplier.")
    add("")
    add("Reading the numbers: the two engines are *different models of the same "
        "system*, not two builds of one model — no delta here is a bug per se. "
        "The recurring, explainable sources of difference are:")
    add("")
    add("1. **Inventory sizing.** scsim maps every control rule onto coverage-κ "
        "order-up-to levels and ignores absolute `reorder_point`/`order_up_to` "
        "(G1 — the info-level mapping note); the legacy engine consumes "
        "`safety_stock_days` directly. scsim generally carries more stock and "
        "holds service higher through the outage.")
    add("2. **Fulfillment semantics.** The legacy engine treats service as "
        "units shipped vs demand with a simple backlog; scsim distinguishes "
        "backorder aging, lost sales, and value-weighted fill (PH-60 contract).")
    add("3. **Statistics.** scsim uses the keyed seed tree, warm-up detection, "
        "and CI machinery; the legacy engine reseeds per replication. The same "
        "`seed` does not mean common random numbers *across engines*.")
    add("4. **`cost_of_resilience` is definitionally different.** The legacy "
        "engine folds total holding and backlog cost into it; scsim's C^res "
        "ledger counts only resilience-attributable components (premiums, "
        "expediting, overtime, lost sales, monitoring). Compare its trend, "
        "never its magnitude.")
    add("")
    add("These are exactly the corrections E2 anticipates: scsim's behavior is "
        "the intended one. The table exists so the flip of the default engine "
        "(gate E3) changes numbers *knowingly*, not silently.")
    add("")

    for label, schedule in (("Steady state", []), ("Primary-supplier outage (10w)", OUTAGE)):
        add(f"## {label}")
        add("")
        add("| Preset | KPI | legacy | scsim | Δ (scsim − legacy) |")
        add("|---|---|---:|---:|---:|")
        notes_by_preset: dict[str, list[str]] = {}
        for preset, policies in PRESETS.items():
            legacy, scsim = run_pair(policies, schedule)
            notes_by_preset[preset] = list(scsim.get("scsim_notes", []))
            for lkey, skey in KPIS:
                lv, sv = legacy.get(f"mean_{lkey}"), scsim.get(f"mean_{skey}")
                delta = None if (lv is None or sv is None) else sv - lv
                add(f"| {preset} | {skey} | {fmt(lv)} | {fmt(sv)} | {fmt(delta)} |")
        add("")
        add("<details><summary>scsim mapping notes per preset (the approximations "
            "behind the deltas)</summary>")
        add("")
        for preset, notes in notes_by_preset.items():
            add(f"**{preset}**")
            for n in sorted(set(notes)):
                add(f"- {n}")
            add("")
        add("</details>")
        add("")

    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
