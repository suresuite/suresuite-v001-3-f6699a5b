"""Part X performance benchmarks.

Targets (§10.1):
  * single replication, manuscript scale (15 P × 556 M × 58 S × 156 wk) ≤ 0.5 s
  * synthetic large instance (200 P × 5,000 M × 300 S)                  ≤ 5 s/rep

Usage:  python scripts/benchmark.py [--large]
CI runs the manuscript-scale case via tests/test_performance.py (>10%
regressions fail the build, §10.4).
"""
from __future__ import annotations

import argparse
import time

import numpy as np

from scsim import (
    BomLine,
    DisruptionEvent,
    Material,
    Network,
    Product,
    Scenario,
    SimulationSettings,
    Supplier,
    SupplierLink,
)
from scsim.core.engine import compile_scenario, run_replication
from scsim.disruption.injector import resolve_events
from scsim.entities.enums import WarmupMethod


def synthetic_network(n_prods: int, n_mats: int, n_sups: int, seed: int = 0) -> Network:
    """Manuscript-shaped instance: every material feeds ≥1 product, ~15% of
    materials dual-sourced, BoM density ~ n_mats/n_prods materials each."""
    rng = np.random.default_rng(seed)
    suppliers = [Supplier(id=f"s{k}") for k in range(n_sups)]
    materials = [Material(id=f"m{i}", cost=float(rng.uniform(0.5, 20))) for i in range(n_mats)]
    products = [
        Product(id=f"p{j}", unit_price=float(rng.uniform(50, 500)),
                demand_mode=float(rng.uniform(40, 200)),
                production_capacity=float(rng.uniform(300, 600)))
        for j in range(n_prods)
    ]
    bom = []
    per_prod = max(1, n_mats // n_prods)
    for j in range(n_prods):
        lo = j * per_prod
        hi = n_mats if j == n_prods - 1 else (j + 1) * per_prod
        for i in range(lo, hi):
            bom.append(BomLine(product_id=f"p{j}", material_id=f"m{i}",
                               rate=float(rng.uniform(0.1, 3.0))))
    # ~10% shared materials across a second product (P-P.9 has work to do).
    for i in rng.choice(n_mats, size=max(1, n_mats // 10), replace=False):
        j = int(rng.integers(0, n_prods))
        if not any(b.material_id == f"m{i}" and b.product_id == f"p{j}" for b in bom[-50:]):
            try:
                bom.append(BomLine(product_id=f"p{j}", material_id=f"m{i}", rate=1.0))
            except Exception:
                pass
    links = []
    for i in range(n_mats):
        k = i % n_sups
        links.append(SupplierLink(supplier_id=f"s{k}", material_id=f"m{i}",
                                  cost=materials[i].cost, lead_time_weeks=int(rng.integers(1, 13))))
        if rng.random() < 0.15:  # dual-sourced share
            k2 = (k + 7) % n_sups
            links.append(SupplierLink(supplier_id=f"s{k2}", material_id=f"m{i}",
                                      cost=materials[i].cost * 1.2,
                                      lead_time_weeks=int(rng.integers(2, 16))))
    # Deduplicate (supplier, material) pairs that the sharing loop may duplicate.
    seen, unique_bom = set(), []
    for b in bom:
        if (b.product_id, b.material_id) not in seen:
            seen.add((b.product_id, b.material_id))
            unique_bom.append(b)
    return Network(suppliers=suppliers, materials=materials, products=products,
                   bom=unique_bom, supplier_links=links)


def bench(n_prods, n_mats, n_sups, horizon=156, label="", with_policies=True, reps=3):
    net = synthetic_network(n_prods, n_mats, n_sups)
    policies = {}
    if with_policies:
        policies = {
            "safety_stock_materials": {},
            "short_term_capacity": {},
            "material_allocation": {},
            "expedited_shipments": {},
            "backup_supplier": {},
        }
    sc = Scenario(
        name=f"bench_{label}", network=net,
        settings=SimulationSettings(project_seed=1, horizon=horizon, model_seeds=1,
                                    warmup_method=WarmupMethod.MANUAL, warmup_end=40,
                                    analysis_window=52),
        events=[DisruptionEvent(target_id="s0", start=60, duration=8)],
        policies=policies,
    )
    t0 = time.perf_counter()
    compiled = compile_scenario(sc)
    compile_s = time.perf_counter() - t0
    events = resolve_events(compiled.model, 40, 0)

    times = []
    for r in range(reps):
        t0 = time.perf_counter()
        run_replication(compiled, r, 0, events)
        times.append(time.perf_counter() - t0)
    best = min(times)
    print(f"{label:24s} {n_prods}P × {n_mats}M × {n_sups}S × {horizon}wk  "
          f"compile {compile_s*1000:6.0f} ms   rep {best*1000:7.0f} ms (best of {reps})")
    return best


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--large", action="store_true", help="also run 200×5000×300")
    args = ap.parse_args()

    t = bench(15, 556, 58, label="manuscript-scale")
    status = "PASS" if t <= 0.5 else "FAIL"
    print(f"  target ≤ 0.5 s/rep → {status}")
    if args.large:
        t = bench(200, 5000, 300, label="large-instance")
        status = "PASS" if t <= 5.0 else "FAIL"
        print(f"  target ≤ 5 s/rep → {status}")
