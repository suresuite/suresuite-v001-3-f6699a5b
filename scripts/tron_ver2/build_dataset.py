#!/usr/bin/env python3
"""Build the committed Project TRON - ver2 dataset (dataset.json) from the
source workbook `SC_data__MOR.xlsx` (WSC 2026 supplementary material).

Phase B0 / test-fixture → real-project onboarding / §8. The output JSON is the
single input `scripts/seed_project_tron_ver2.mjs` seeds through the app's own
RPC lifecycle. The workbook itself is NOT committed (real-company data file);
this script records every derivation rule so the JSON is reproducible:

  python3 scripts/tron_ver2/build_dataset.py <SC_data__MOR.xlsx> [seed0.npz]

Derivation rules (all cross-checked against the reference snapshot seed0.npz —
17 products × 560 materials — when it is supplied):

  R1  Products: the 17 products of the reference model. The workbook's two
      extra articles are excluded: '597-1557LC001-TEST' (a test article) and
      'XPF0003892' (excluded from the reference snapshot; its demand history
      is extremely lumpy/irregular).
  R2  Demand (WSC PDF §2, Table 1): weekly demand ~ Triangular(a, b, c) with
      b = median of the product's non-zero historical weekly demand (demandDT),
      c = historical max, a = max{0, (1−ν)·b}, ν = 0.30. Stored as
      demand_mean = b, demand_cv = 0.30, demand_min = a, demand_max = c
      (the explicit bounds carry the asymmetric right tail c ≫ b·1.3).
  R3  Sourcing: single sourcing per material (the workbook's "MOR" model):
      the arc flagged `MOR Source` wins; materials with no flagged arc use the
      lowest ordering cost (tie: shortest lead time) — the PDF's supplier-
      selection rule and the engine's primary-source rule.
  R4  Sentinel lead times: arcs with LT_wk >= 100 (the workbook's 143-week
      placeholder) are dropped; materials left with no arc are removed from
      the model (BOM rows too) — matching the reference snapshot exactly
      (six materials). Remaining lead times are clamped to the engine max of
      51 weeks (one arc: DA008634487, 63 → 51; the visibility horizon is 52).
  R5  Zero / missing ordering costs are floored at 0.0001 (the engine rejects
      non-positive arc costs and would silently default them to 1.0).
  R6  BOM rows with consumption_rate = 0 are dropped (the engine requires
      rate > 0); their materials stay in the item master so the modeled
      material set matches the reference snapshot (560 materials).
  R7  materials.cost = the selected arc's unit cost; holding_cost_pct = 0.20
      (PDF Table 2: annual holding cost 20 % of material cost);
      moq = the selected arc's MOQ (missing → 0); initial_on_hand = NULL so
      the engine warm-starts at S_m; deterministic lead times (PDF).
  R8  production_capacity = demand_max: capacity never binds below the
      historical demand peak (the PDF's fill-rate losses come from material
      availability, not the plant), yet stays a real, finite number.
  R9  Outbound: one aggregate customer per product (CUST-TRON) at volume = b
      units/week, unit_price = the product's UnitPrice (ProductDT) — the
      engine reads economics from the masters first; the arcs make the
      /policies lanes and the §8.1 gate complete.
  R10 Suppliers: every supplier referenced by a selected arc; names from
      supplierDT; capacity_per_week = NULL (unlimited — the PDF models
      supplier disruptions as lead-time delays, not capacity); reliability 1.
"""
from __future__ import annotations

import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl

OUT = Path(__file__).with_name("dataset.json")

EXCLUDED_PRODUCTS = {"597-1557LC001-TEST", "XPF0003892"}  # R1
SENTINEL_LT = 100          # R4
ENGINE_MAX_LT = 51         # R4
COST_FLOOR = 0.0001        # R5
NU = 0.30                  # R2 (PDF: ν = 0.30)
CUSTOMER_ID = "CUST-TRON"  # R9


def sheet_rows(wb, name: str) -> list[tuple]:
    it = wb[name].iter_rows(values_only=True)
    next(it)  # header
    return [r for r in it if any(v is not None for v in r)]


def build(xlsx: Path) -> dict:
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    audit: list[str] = []

    # ── Products + demand (R1, R2) ──────────────────────────────────────────
    product_rows = {str(r[1]): r for r in sheet_rows(wb, "ProductDT")}
    products = sorted(set(product_rows) - EXCLUDED_PRODUCTS)
    audit.append(f"R1 products: {len(products)} kept, excluded {sorted(EXCLUDED_PRODUCTS)}")

    hist = defaultdict(list)
    for p, _wk, q in sheet_rows(wb, "demandDT"):
        hist[str(p)].append(float(q))

    # ── Sourcing selection (R3, R4, R5) ─────────────────────────────────────
    arcs_by_mat: dict[str, list[dict]] = defaultdict(list)
    for r in sheet_rows(wb, "sourcingDT"):
        m = r[0]
        if m is None:
            continue
        arcs_by_mat[str(m)].append({
            "supplier_id": str(r[2]),
            "supplier_name": r[3],
            "mor": bool(r[4]),
            "moq": float(r[5]) if r[5] is not None else None,
            "lt": float(r[6]) if r[6] is not None else None,
            "cost": float(r[7]) if r[7] is not None else None,
        })

    selected: dict[str, dict] = {}
    dropped_sentinel_mats: list[str] = []
    for m, arcs in arcs_by_mat.items():
        usable = [a for a in arcs if a["lt"] is not None and a["lt"] < SENTINEL_LT]
        if not usable:
            dropped_sentinel_mats.append(m)
            continue
        flagged = [a for a in usable if a["mor"]]
        pool = flagged or usable
        selected[m] = min(pool, key=lambda a: (a["cost"] if a["cost"] and a["cost"] > 0 else float("inf"),
                                               a["lt"]))
    audit.append(f"R4 sentinel-LT materials dropped: {sorted(dropped_sentinel_mats)}")

    # ── BOM (R6) restricted to kept products + sourced materials ───────────
    bom_rows: list[dict] = []
    model_mats: set[str] = set()
    zero_rate_dropped = 0
    for p, m, rate in sheet_rows(wb, "BOMDT"):
        p, m = str(p), str(m)
        if p not in set(products) or m not in selected:
            continue
        model_mats.add(m)  # rate-0 materials stay in the master set (R6)
        if not rate or float(rate) <= 0:
            zero_rate_dropped += 1
            continue
        bom_rows.append({"product_id": p, "material_id": m, "consumption_rate": float(rate)})
    audit.append(f"R6 BOM arcs kept: {len(bom_rows)}, zero-rate dropped: {zero_rate_dropped}")
    audit.append(f"model materials: {len(model_mats)}")

    # ── Materials master (R7) ───────────────────────────────────────────────
    category = {str(r[0]): str(r[1]) for r in sheet_rows(wb, "MaterialDT") if r[0] is not None}
    materials, cost_floored, lt_clamped = [], [], []
    inbound = []
    weekly_req = defaultdict(float)  # Eq. 1 at mean demand, for the arc volume column
    demand_mode = {p: statistics.median(hist[p]) for p in products}
    for b in bom_rows:
        weekly_req[b["material_id"]] += b["consumption_rate"] * demand_mode[b["product_id"]]

    for m in sorted(model_mats):
        arc = selected[m]
        cost = arc["cost"] if arc["cost"] and arc["cost"] > 0 else COST_FLOOR
        if cost == COST_FLOOR:
            cost_floored.append(m)
        lt = min(arc["lt"], ENGINE_MAX_LT)
        if lt != arc["lt"]:
            lt_clamped.append(f"{m}: {arc['lt']:.0f}→{ENGINE_MAX_LT}")
        materials.append({
            "material_id": m,
            "name": f"{m} — {category.get(m, 'uncategorized')}",
            "cost": round(cost, 6),
            "holding_cost_pct": 0.20,
            "moq": arc["moq"] if arc["moq"] is not None else 0,
            "lead_time_dist": "deterministic",
            "lead_time_cv": 0,
        })
        inbound.append({
            "supplier_id": arc["supplier_id"],
            "material_id": m,
            "volume": round(weekly_req[m], 2),
            "time_unit": "week",
            "lead_time": lt,
            "unit_price": round(cost, 6),
        })
    audit.append(f"R5 cost floored at {COST_FLOOR}: {cost_floored}")
    audit.append(f"R4 lead time clamped: {lt_clamped}")

    # ── Suppliers master (R10) ──────────────────────────────────────────────
    sup_names: dict[str, str] = {}
    for r in sheet_rows(wb, "supplierDT"):
        sid = str(r[5]) if r[5] is not None else None
        if sid and sid not in sup_names:
            country = f" ({r[4]})" if r[4] else ""
            sup_names[sid] = f"{r[1]}{country}"
    used_sups = sorted({a["supplier_id"] for a in inbound})
    suppliers = [{
        "supplier_id": s,
        "name": sup_names.get(s) or next((a["supplier_name"] for m, a in selected.items()
                                          if a["supplier_id"] == s and a["supplier_name"]), s),
        "reliability_score": 1.0,
    } for s in used_sups]
    audit.append(f"R10 suppliers: {len(suppliers)}")

    # ── Products master + outbound (R2, R8, R9) ─────────────────────────────
    product_masters, outbound = [], []
    for p in products:
        b = demand_mode[p]
        c = max(hist[p])
        a = max(0.0, (1 - NU) * b)
        price = float(product_rows[p][5])
        product_masters.append({
            "product_id": p,
            "name": p,
            "sell_price": round(price, 4),
            "production_capacity": c,          # R8 — never binds below the peak
            "fulfillment_mode": "mto",
            "demand_distribution": "triangular",
            "demand_mean": b,
            "demand_cv": NU,
            "demand_min": round(a, 4),
            "demand_max": c,
        })
        outbound.append({
            "customer_id": CUSTOMER_ID,
            "product_id": p,
            "volume": b,
            "time_unit": "week",
            "expected_lead_time": 1,
            "unit_price": round(price, 4),
        })

    return {
        "_provenance": {
            "source": "SC_data__MOR.xlsx (WSC 2026 supplementary material, MOR model)",
            "generator": "scripts/tron_ver2/build_dataset.py",
            "rules": "R1–R10 — see the generator docstring",
            "audit": audit,
        },
        "project": {
            "name": "Project TRON - ver2",
            "plant_name": "TRON Focal Plant",
            "supply_chain_model": "Make-To-Order",
            "bom_level": "single",
        },
        "suppliers": suppliers,
        "materials": materials,
        "products": product_masters,
        "bom": bom_rows,
        "inbound": inbound,
        "outbound": outbound,
        "policies": {
            # PDF §1: min-max control (Eqs. 2–4, κ = 8 wks is the engine's
            # coverage default), no safety stock beyond lead-time cover,
            # lost sales (Fig. 3 reports lost sales), single sourcing,
            # no resilience strategies in the baseline.
            "fulfillment_strategy": "make_to_order",
            "inventory": {"type": "min_max", "safety_stock_method": "fixed_days",
                          "safety_stock_days": 0, "holding_cost_pct": 0.20},
            "fulfillment": {"backorder_allowed": False, "allocation": "priority"},
            "sourcing": {"strategy": "single"},
            "recovery": {"enabled": False, "response": []},
        },
        "scenarios": [
            {
                "name": "TRON baseline (WSC 2026)",
                "description": "156-week baseline, 30 replications, auto warm-up "
                               "(MSER-5 + Conway, most conservative) — PDF §1.",
                "horizon_days": 1092, "replications": 30, "seed": 42, "crn": True,
                "warmup_mode": "auto",
                "demand_model": {"kind": "triangular"},
                "disruption_schedule": [],
                "stopping_rule": {"kind": "fixed_horizon"},
                "primary_kpi": "fill_rate",
            },
            {
                "name": "TRON supplier 965 disruption",
                "description": "Deep supplier disruption stress test (PDF §1: "
                               "an 8-week inbound delay — the mean of U{5..10} — "
                               "at the top-impact supplier, starting 1–3 weeks "
                               "after steady-state onset). The engine warm-starts "
                               "inventories at S_m, so its steady state begins "
                               "≈ week 10 (vs week 85 in the paper's cold-start "
                               "implementation); the PDF's t* = 86 (t_w + 1) is "
                               "therefore expressed as week 12 here, inside the "
                               "52-week KPI analysis window.",
                "horizon_days": 1092, "replications": 30, "seed": 42, "crn": True,
                "warmup_mode": "auto",
                "demand_model": {"kind": "triangular"},
                "disruption_schedule": [
                    {"target": "node:965", "start_week": 12, "duration_weeks": 8,
                     "magnitude_pct": 100}
                ],
                "stopping_rule": {"kind": "fixed_horizon"},
                "primary_kpi": "fill_rate",
            },
        ],
    }


def crosscheck(data: dict, npz_path: Path) -> None:
    import numpy as np
    d = np.load(npz_path, allow_pickle=True)
    ref_products = sorted(str(p) for p in d["products"])
    ref_materials = sorted(str(m) for m in d["materials"])
    got_products = sorted(p["product_id"] for p in data["products"])
    got_materials = sorted(m["material_id"] for m in data["materials"])
    assert got_products == ref_products, (
        f"product set mismatch: +{set(got_products) - set(ref_products)} "
        f"-{set(ref_products) - set(got_products)}")
    assert got_materials == ref_materials, (
        f"material set mismatch: +{set(got_materials) - set(ref_materials)} "
        f"-{set(ref_materials) - set(got_materials)}")
    # Demand parameterization: triangular mean (a+b+c)/3 vs the snapshot's
    # sampled mean per product (1200 weeks — tolerance covers sampling noise).
    D = d["D_sampled"]
    by_id = {p["product_id"]: p for p in data["products"]}
    for i, pid in enumerate(str(p) for p in d["products"]):
        row = by_id[pid]
        tri_mean = (row["demand_min"] + row["demand_mean"] + row["demand_max"]) / 3.0
        samp = float(D[i].mean())
        assert abs(tri_mean - samp) <= max(1.0, 0.05 * samp), \
            f"{pid}: triangular mean {tri_mean:.1f} vs snapshot {samp:.1f}"
    print(f"✓ cross-check vs {npz_path.name}: {len(ref_products)} products, "
          f"{len(ref_materials)} materials, demand means match the snapshot")


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(f"usage: {sys.argv[0]} <SC_data__MOR.xlsx> [seed0.npz]")
    data = build(Path(sys.argv[1]))
    if len(sys.argv) > 2:
        crosscheck(data, Path(sys.argv[2]))
    OUT.write_text(json.dumps(data, indent=1, sort_keys=False) + "\n")
    p = data["_provenance"]["audit"]
    print(f"wrote {OUT} — {len(data['suppliers'])} suppliers, "
          f"{len(data['materials'])} materials, {len(data['products'])} products, "
          f"{len(data['bom'])} bom, {len(data['inbound'])} inbound, "
          f"{len(data['outbound'])} outbound arcs")
    for line in p:
        print(f"  audit: {line}")


if __name__ == "__main__":
    main()
