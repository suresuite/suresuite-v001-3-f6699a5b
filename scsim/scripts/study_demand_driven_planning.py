# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Validation study: MRP versus reorder point — PLAN.md §24 WP 14.6 (G20 close).

REGENERATES ``docs/research/mrp-vs-reorder-point.md``. Every number on that page
comes from this script, and ``--check`` fails when the committed page differs
from what the script produces now — so the page cannot drift from the engine
(transparency commitment T5).

Method (blueprint A7):

* **CRN-paired.** Every policy is run on the SAME replications — the same world
  seed tree, so the same demand draws and the same disruption — and compared
  replication by replication. Confidence intervals are on the PAIRED
  difference (MRP − reorder point), Student's t, 95 %.
* **Equal average stock.** On the reference chain min-max runs at κ = 2 weeks
  (the design doc's probe) with 7 days of safety stock, and MRP's safety-stock
  days are tuned on the stationary case so its average material stock matches
  min-max's; a second MRP variant is tuned to min-max's fill rate. Both are then
  held fixed in every case. Project TRON is reported at its default settings,
  not matched.
* **The plan reads the forecast.** Phase 14's MRP plans from the customer
  table's forecast; a step or surge is IN the forecast. The forecast-bias case is
  the one where the world differs from the plan: realized demand is 20 % above
  the forecast every week (design doc §9, point 15).

Run from the repository root or ``scsim/``::

    python scsim/scripts/study_demand_driven_planning.py          # rewrite the page
    python scsim/scripts/study_demand_driven_planning.py --check  # CI gate
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from scipy import stats

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "sim-worker"))

import scsim.core.engine as engine  # noqa: E402
from scsim import (  # noqa: E402
    ENGINE_VERSION,
    BomLine,
    Customer,
    CustomerLink,
    DisruptionEvent,
    Material,
    Network,
    Product,
    Scenario,
    SimulationSettings,
    Supplier,
    SupplierLink,
)
from scsim.core.engine import compile_scenario, run_replication  # noqa: E402
from scsim.disruption.injector import resolve_events  # noqa: E402
from scsim.entities.enums import TraceVerbosity, WarmupMethod  # noqa: E402
from scsim.kpi.compute import compute_replication_kpis  # noqa: E402

PAGE = ROOT / "docs" / "research" / "mrp-vs-reorder-point.md"
HORIZON, WARMUP, WINDOW = 104, 20, 80
REPS_REFERENCE, REPS_TRON = 20, 6
OUTAGE_START, OUTAGE_WEEKS = 50, 8
KAPPA = 2.0
SS_DAYS = 7.0
MRP_SS_GRID = (0.0, 3.5, 7.0, 10.5, 14.0, 17.5, 21.0, 28.0, 35.0, 42.0)


def _settings() -> SimulationSettings:
    return SimulationSettings(project_seed=2026, horizon=HORIZON, model_seeds=1,
                              warmup_method=WarmupMethod.MANUAL, warmup_end=WARMUP,
                              analysis_window=WINDOW, trace_verbosity=TraceVerbosity.FULL_DEBUG)


# ── the reference chain ────────────────────────────────────────────────────

def _forecast(case: str) -> list[float]:
    base = [100.0] * (HORIZON + 80)
    if case == "step":
        base = [100.0] * 40 + [150.0] * (HORIZON + 40)
    elif case == "surge":
        base = [100.0] * 50 + [180.0] * 6 + [100.0] * (HORIZON + 24)
    return base


def reference_network(case: str) -> Network:
    """One plant, one MTO product, two materials (lead times 2 and 4 weeks, the
    second with an MOQ), one supplier; demand is a normal row with CV 0.2 around
    the customer table's forecast, lost sales."""
    return Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=2.0), Material(id="m2", cost=5.0)],
        products=[Product(id="p1", unit_price=20.0, demand_mode=100.0,
                          production_capacity=220.0)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0),
             BomLine(product_id="p1", material_id="m2", rate=2.0)],
        supplier_links=[
            SupplierLink(supplier_id="s1", material_id="m1", cost=2.0, lead_time_weeks=2),
            SupplierLink(supplier_id="s1", material_id="m2", cost=5.0, lead_time_weeks=4, moq=200),
        ],
        customers=[Customer(id="c1")],
        customer_links=[CustomerLink(product_id="p1", customer_id="c1", share=1.0,
                                     demand_model="normal", demand_variation=0.2,
                                     forecast=_forecast(case))],
    )


def _policies(kind: str, ss_days: float = SS_DAYS) -> dict:
    inv: dict = {"policy_type": "mrp"} if kind == "mrp" else {
        "policy_type": "min_max",
        "coverage_weeks": {"nominal": KAPPA, "alert": KAPPA, "crisis": KAPPA}}
    return {"inventory_control": inv,
            "safety_stock_materials": {"classification": "fixed_days", "fixed_days_cover": ss_days},
            "unmet_demand_handling": {"rule": "lost_sales"}}


# ── one replication's measures ─────────────────────────────────────────────

@dataclass
class Rep:
    fill: float
    lost: float
    stock: float
    order_cv: float
    ttr: Optional[float]


def _measure(ctx, events) -> Rep:
    k = compute_replication_kpis(ctx, WARMUP, WARMUP + WINDOW, events)
    o = ctx.trace.O_mat[:, WARMUP:WARMUP + WINDOW]
    cvs = [float(r.std() / r.mean()) for r in o if r.mean() > 0]
    return Rep(fill=float(k["fill_rate"]), lost=float(k["lost_units"]),
               stock=float(k["avg_on_hand_units"]), order_cv=float(np.mean(cvs)) if cvs else 0.0,
               ttr=k.get("ttr_weeks"))


def run_case(scenario: Scenario, reps: int, scale: float = 1.0) -> list[Rep]:
    """``reps`` CRN replications (model_rep r, event_rep 0). ``scale`` ≠ 1 is the
    forecast-bias case: the WORLD's drawn demand is scaled after it is drawn, so
    the plan (which reads the forecast) and the world disagree."""
    compiled = compile_scenario(scenario)
    events = resolve_events(compiled.model, WARMUP, 0, {}) if scenario.events else []
    real_init: Callable = engine._initialize_state

    def init(c, ctx):
        real_init(c, ctx)
        if scale != 1.0:
            ctx.demand_schedule *= scale
            if ctx.demand_schedule_rows is not None:
                ctx.demand_schedule_rows *= scale

    engine._initialize_state = init
    try:
        return [_measure(run_replication(compiled, r, 0, events), events) for r in range(reps)]
    finally:
        engine._initialize_state = real_init


# ── statistics ─────────────────────────────────────────────────────────────

def _mean_ci(x: np.ndarray) -> tuple[float, float]:
    n = len(x)
    if n < 2:
        return float(x.mean()), 0.0
    half = float(stats.t.ppf(0.975, n - 1) * x.std(ddof=1) / np.sqrt(n))
    return float(x.mean()), half


def _fmt(m: float, h: float, d: int) -> str:
    # Rounded first, so a mean of −0.00004 prints 0.000, not −0.000.
    return f"{round(m, d) + 0.0:.{d}f} ± {round(h, d) + 0.0:.{d}f}"


def _ttr(reps: list[Rep]) -> str:
    xs = [r.ttr for r in reps if r.ttr is not None]
    if not xs:
        return "—"
    m, h = _mean_ci(np.array(xs))
    return f"{_fmt(m, h, 1)} ({len(xs)}/{len(reps)})"


def _row(label: str, reps: list[Rep]) -> str:
    a = {f: np.array([getattr(r, f) for r in reps]) for f in ("fill", "lost", "stock", "order_cv")}
    return (f"| {label} | {_fmt(*_mean_ci(a['fill']), 3)} | {_fmt(*_mean_ci(a['lost']), 0)} | "
            f"{_fmt(*_mean_ci(a['stock']), 0)} | {_fmt(*_mean_ci(a['order_cv']), 2)} | {_ttr(reps)} |")


def _diff(mrp: list[Rep], other: list[Rep]) -> str:
    df = np.array([a.fill - b.fill for a, b in zip(mrp, other)])
    dl = np.array([a.lost - b.lost for a, b in zip(mrp, other)])
    ds = np.array([a.stock - b.stock for a, b in zip(mrp, other)])
    return (f"Δ fill {_fmt(*_mean_ci(df), 3)} · Δ lost {_fmt(*_mean_ci(dl), 0)} · "
            f"Δ stock {_fmt(*_mean_ci(ds), 0)}")


HEADER = ("| Policy | Fill rate | Lost units | Avg material stock (units) | Order CV | "
          "Weeks to recover (measured/reps) |\n|---|---|---|---|---|---|")


# ── the study ──────────────────────────────────────────────────────────────

def _reference_scenario(case: str, policies: dict) -> Scenario:
    events = ([DisruptionEvent(target_id="s1", start=OUTAGE_START, duration=OUTAGE_WEEKS)]
              if case == "outage" else [])
    return Scenario(name=f"ref-{case}", network=reference_network(
        "stationary" if case in ("outage", "bias") else case),
        settings=_settings(), policies=policies, events=events)


def _tune(mm_stationary: list[Rep]) -> tuple[float, float, float, float]:
    """MRP's safety-stock days at min-max's average stock, and the fewest days
    reaching min-max's fill rate — both on the stationary case, then held fixed.
    Returns the two day values and the stocks they reach (the page states them,
    so "equal" is a measured statement, not a label)."""
    target_stock = float(np.mean([r.stock for r in mm_stationary]))
    target_fill = float(np.mean([r.fill for r in mm_stationary]))
    results = {d: run_case(_reference_scenario("stationary", _policies("mrp", d)), REPS_REFERENCE)
               for d in MRP_SS_GRID}
    stock = {d: float(np.mean([r.stock for r in results[d]])) for d in MRP_SS_GRID}
    d_stock = min(MRP_SS_GRID, key=lambda d: (abs(stock[d] - target_stock), d))
    reach = [d for d in MRP_SS_GRID if np.mean([r.fill for r in results[d]]) >= target_fill - 1e-12]
    d_fill = min(reach) if reach else max(MRP_SS_GRID)
    return d_stock, d_fill, stock[d_stock], target_stock


CASES = (
    ("stationary", "Stationary demand, forecast = mean (100/wk)", 1.0),
    ("step", "Demand step 100 → 150/wk at week 40, in the forecast", 1.0),
    ("surge", "Demand surge to 180/wk for weeks 50–55, in the forecast", 1.0),
    ("outage", f"ST-1 supplier outage: s1's lead time blocked weeks {OUTAGE_START}–"
               f"{OUTAGE_START + OUTAGE_WEEKS - 1}", 1.0),
    ("bias", "Forecast bias: the world's demand is 20 % ABOVE the forecast the plan reads", 1.2),
)


def tron_section() -> list[str]:
    from scsim.io.project_map import from_project_data
    from sim_worker.local import project_data_from_snapshots

    ds = json.loads((ROOT / "scripts" / "tron_ver2" / "dataset.json").read_text())
    tables = {k: ds[k] for k in ("suppliers", "materials", "products", "bom", "inbound", "outbound")}
    out = ["## Project TRON (committed dataset)", "",
           f"`scripts/tron_ver2/dataset.json`, {REPS_TRON} CRN replications per cell, default "
           f"settings with {SS_DAYS:g} days of safety stock. **Not stock-matched**: the average stock "
           "is reported beside each result so the comparison can be read for what it is.", ""]
    for case, title in (("stationary", "As uploaded"),
                        ("outage", f"Supplier 965 blocked weeks {OUTAGE_START}–"
                                   f"{OUTAGE_START + OUTAGE_WEEKS - 1}")):
        out += [f"### {title}", "", HEADER]
        runs = {}
        for kind in ("min_max", "mrp"):
            pol = {"schema_version": 2, "overrides": [], "defaults": {"inventory": {
                "type": kind, "safety_stock_method": "fixed_days", "safety_stock_days": SS_DAYS}}}
            data = project_data_from_snapshots({"inputs": tables}, pol,
                                               {"horizon_days": HORIZON * 7, "replications": 1,
                                                "seed": 2026, "crn": True}, None)
            sc = from_project_data(data).scenario
            events = ([DisruptionEvent(target_id="965", start=OUTAGE_START, duration=OUTAGE_WEEKS)]
                      if case == "outage" else [])
            sc = sc.model_copy(update={"settings": _settings(), "events": events})
            runs[kind] = run_case(sc, REPS_TRON)
            out.append(_row("min-max (default κ)" if kind == "min_max" else "MRP", runs[kind]))
        out += ["", f"Paired, MRP − min-max: {_diff(runs['mrp'], runs['min_max'])}.", ""]
    return out


def build_page() -> str:
    mm = {c: run_case(_reference_scenario(c, _policies("min_max")), REPS_REFERENCE, s)
          for c, _t, s in CASES}
    d_stock, d_fill, s_mrp, s_mm = _tune(mm["stationary"])
    lines = [
        "<!-- GENERATED by scsim/scripts/study_demand_driven_planning.py — do not edit; "
        "rerun the script (CI runs it with --check). -->",
        "",
        "# MRP versus reorder point — the Phase 14 validation study",
        "",
        f"**Status:** GENERATED · engine {ENGINE_VERSION} · PLAN.md §24 WP 14.6 · blueprint G20.",
        "",
        "What planning materials from the plan (MRP: BOM × planned production over the lead "
        "time, net of stock and the pipeline) changes against planning them from consumption "
        "(min-max reorder point). Every cell is a mean over CRN-paired replications with a 95 % "
        "confidence half-width; the paired lines compare the SAME replications, so the demand "
        "and the disruption are identical across the two policies.",
        "",
        "## The reference chain",
        "",
        "One MTO product (capacity 220/wk) from two materials — m1 (lead time 2 weeks) and m2 "
        "(lead time 4 weeks, MOQ 200, two per product) — at one supplier. Demand is a normal "
        "row, CV 0.2, around the customer table's forecast; unmet demand is lost. Both policies "
        f"start from {SS_DAYS:g} days of safety stock. Horizon {HORIZON} weeks, measured over weeks "
        f"{WARMUP}–{WARMUP + WINDOW - 1}, {REPS_REFERENCE} replications.",
        "",
        f"**Tuning (stationary case, then held fixed):** min-max runs at κ = {KAPPA:g} weeks "
        f"with {SS_DAYS:g} days of safety stock (average stock {s_mm:.0f} units). MRP with "
        f"{d_stock:g} days of safety stock is the grid value closest to that stock "
        f"({s_mrp:.0f} units); {d_fill:g} days is the fewest reaching min-max's fill rate "
        f"(grid {', '.join(f'{d:g}' for d in MRP_SS_GRID)} days).",
        "",
    ]
    for case, title, scale in CASES:
        mrp_s = run_case(_reference_scenario(case, _policies("mrp", d_stock)), REPS_REFERENCE, scale)
        mrp_f = run_case(_reference_scenario(case, _policies("mrp", d_fill)), REPS_REFERENCE, scale)
        lines += [f"### {title}", "", HEADER,
                  _row(f"min-max (κ = {KAPPA:g}, SS {SS_DAYS:g} d)", mm[case]),
                  _row(f"MRP, equal stock (SS {d_stock:g} d)", mrp_s),
                  _row(f"MRP, equal fill (SS {d_fill:g} d)", mrp_f),
                  "",
                  f"Paired, MRP at equal stock − min-max: {_diff(mrp_s, mm[case])}.",
                  ""]
    lines += tron_section()
    lines += [
        "## What this does and does not show",
        "",
        "- **It shows** the order rule's effect with the demand and the disruption held equal: "
        "every difference above is between two runs that saw the same world.",
        "- **The plan reads the forecast.** In the step and surge cases the change is in the "
        "customer table's forecast, which is how Phase 14 expects a known change to be entered. "
        "A change nobody forecast is the forecast-bias case: MRP plans for the wrong demand and "
        "is protected only by its safety stock and what is on hand — the table shows how far "
        "that went on this chain, at equal stock.",
        "- **It does not show** a general ranking. One reference chain, one dataset, fixed "
        "parameters; the safety stock is tuned on a grid, not optimized; lot-sizing beyond MOQ, time fences "
        "and capacity planning are out of scope (design doc §8).",
        "- Weeks to recover are measured only in disrupted cases and only for replications whose "
        "fill rate left its pre-disruption band and returned (the engine's TTR); the count of "
        "measured replications is shown beside each mean.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="fail if the committed page differs from what the script produces")
    args = ap.parse_args()
    page = build_page()
    if args.check:
        current = PAGE.read_text() if PAGE.exists() else ""
        if current != page:
            print(f"STUDY DRIFT: {PAGE.relative_to(ROOT)} does not match the engine — rerun "
                  "scsim/scripts/study_demand_driven_planning.py and commit the page")
            return 1
        print("study page matches the engine")
        return 0
    PAGE.parent.mkdir(parents=True, exist_ok=True)
    PAGE.write_text(page)
    print(f"wrote {PAGE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
