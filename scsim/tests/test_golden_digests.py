# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Frozen golden digests — the behaviour-neutral rule made checkable (PLAN.md §24).

Phase 14's rule is that a project which sets none of the new fields runs
byte-identically. Before WP 14.0 the golden traces were pinned by analytic
values and by run-to-run determinism (``test_golden1_trace_byte_identical_
across_runs``), which compares a run with ITSELF under the same code: it
cannot notice the code changing. This module freezes a digest of each
reference scenario's trace and per-item matrices into
``tests/data/golden_digests.json``, so a change of behaviour fails here.

Values are rounded to 9 decimals before hashing — the guard is against
behaviour, not against a different CPU's last ulp.

A DELIBERATE change (an ENGINE_VERSION bump recorded in ADR 0002 and §16)
regenerates the file and names the scenarios that moved::

    SCSIM_WRITE_GOLDEN=1 python -m pytest tests/test_golden_digests.py
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np
import pytest

from scsim import (
    BomLine,
    Customer,
    CustomerLink,
    DisruptionEvent,
    Material,
    Network,
    Product,
    Scenario,
    Supplier,
    SupplierLink,
)
from scsim.core.engine import compile_scenario, run_replication, run_scenario
from scsim.entities.enums import (
    DemandModel,
    EffectType,
    ForecastModel,
    FulfillmentMode,
    OverflowRule,
    TargetType,
    TraceVerbosity,
)
from scsim.io.traces import trace_frame

from .conftest import (
    bom_blocked_network,
    dual_source_network,
    make_settings,
    shared_material_network,
    single_chain_network,
)

DIGESTS = Path(__file__).parent / "data" / "golden_digests.json"
OUTAGE = DisruptionEvent(target_id="s1", start=20, duration=14)
THROTTLE = DisruptionEvent(target_type=TargetType.NODE_PLANT, target_id="plant",
                           effect_type=EffectType.CAPACITY_REDUCTION, capacity_factor=0.4,
                           start=20, duration=14)
THIN = {"coverage_weeks": {"nominal": 2, "alert": 2, "crisis": 2}}


def _two_customer() -> Network:
    base = single_chain_network(deterministic=False)
    return Network(
        suppliers=base.suppliers, materials=base.materials, products=base.products,
        bom=base.bom, supplier_links=base.supplier_links,
        customers=[Customer(id="key", segment="strategic", priority_weight=10.0),
                   Customer(id="spot", segment="spot", priority_weight=1.0)],
        customer_links=[CustomerLink(product_id="p1", customer_id="key", share=60.0),
                        CustomerLink(product_id="p1", customer_id="spot", share=40.0)],
    )


def _mts(forecast=ForecastModel.PERFECT, deterministic=False) -> Network:
    return Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=2.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=100.0,
                          demand_model=(DemandModel.DETERMINISTIC if deterministic
                                        else DemandModel.TRIANGULAR),
                          production_capacity=200.0, fulfillment_mode=FulfillmentMode.MTS,
                          forecast_model=forecast)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[SupplierLink(supplier_id="s1", material_id="m1", cost=2.0,
                                     lead_time_weeks=2)],
    )


def _poisson_two_products() -> Network:
    return Network(
        suppliers=[Supplier(id="s1", capacity_per_week=260.0), Supplier(id="s2")],
        materials=[Material(id="m1", cost=2.0), Material(id="m2", cost=3.0)],
        products=[
            Product(id="pa", unit_price=10.0, demand_mode=80.0,
                    demand_model=DemandModel.POISSON, production_capacity=120.0),
            Product(id="pb", unit_price=25.0, demand_mode=60.0, demand_min=30.0,
                    demand_max=90.0, demand_model=DemandModel.TRIANGULAR,
                    production_capacity=90.0, fulfillment_mode=FulfillmentMode.MTS),
        ],
        bom=[BomLine(product_id="pa", material_id="m1", rate=1.0),
             BomLine(product_id="pb", material_id="m1", rate=2.0),
             BomLine(product_id="pb", material_id="m2", rate=1.0)],
        supplier_links=[
            SupplierLink(supplier_id="s1", material_id="m1", cost=2.0, lead_time_weeks=2, moq=150),
            SupplierLink(supplier_id="s2", material_id="m1", cost=2.4, lead_time_weeks=3),
            SupplierLink(supplier_id="s2", material_id="m2", cost=3.0, lead_time_weeks=4),
        ],
    )


def _scenarios() -> dict[str, Scenario]:
    S = make_settings
    return {
        "g1_steady": Scenario(name="g1", network=single_chain_network(), settings=S()),
        "g1_outage_triangular": Scenario(
            name="g1o", network=single_chain_network(deterministic=False),
            settings=S(), events=[OUTAGE]),
        "g2_backup": Scenario(name="g2", network=dual_source_network(), settings=S(),
                              events=[OUTAGE], policies={"backup_supplier": {}}),
        "g3_bom_blocked": Scenario(
            name="g3", network=bom_blocked_network(), settings=S(),
            events=[DisruptionEvent(target_id="s2", start=20, duration=14)],
            policies={"backup_supplier": {"enabled_materials": "all_multi_sourced"}}),
        "g4_capacity_reject": Scenario(
            name="g4", network=single_chain_network(supplier_capacity=150.0), settings=S(),
            events=[DisruptionEvent(target_id="s1", effect_type=EffectType.CAPACITY_REDUCTION,
                                    capacity_factor=0.5, overflow_rule=OverflowRule.REJECT,
                                    start=20, duration=10)]),
        "p9_shared_material": Scenario(
            name="p9", network=shared_material_network(), settings=S(), events=[OUTAGE],
            policies={"material_allocation": {}, "safety_stock_materials": {}}),
        "mts_fg_ss": Scenario(name="mts", network=_mts(), settings=S(), events=[OUTAGE],
                              policies={"fg_safety_stock": {}}),
        "mts_ma_forecast": Scenario(name="mtsma", network=_mts(ForecastModel.MA), settings=S(),
                                    events=[OUTAGE]),
        "pc2_priority_backorder": Scenario(
            name="pc2", network=_two_customer(), settings=S(), events=[THROTTLE],
            policies={"customer_allocation": {"rule": "priority"}, "inventory_control": THIN,
                      "unmet_demand_handling": {"rule": "backorder", "backorder_horizon": 3,
                                                "backorder_penalty": 0.5}}),
        "pc2_sla_partial": Scenario(
            name="pc2s", network=_two_customer(), settings=S(), events=[THROTTLE],
            policies={"customer_allocation": {"rule": "sla_tier", "sla_tiers": {"spot": 80.0}},
                      "inventory_control": THIN,
                      "unmet_demand_handling": {"rule": "partial_backorder"}}),
        "mixed_poisson_mts_moq": Scenario(
            name="mix", network=_poisson_two_products(), settings=S(),
            events=[DisruptionEvent(target_id="s2", start=25, duration=8)],
            policies={"proactive_multi_sourcing": {}, "expedited_shipments": {}}),
        "forward_visibility": Scenario(name="fv", network=single_chain_network(deterministic=False),
                                       settings=S(), events=[OUTAGE],
                                       policies={"forward_visibility": {}}),
    }


def _r(x: np.ndarray) -> bytes:
    a = np.asarray(x)
    if a.dtype.kind == "f":
        a = np.round(a, 9) + 0.0  # +0.0 folds -0.0 into 0.0
    return a.tobytes()


def digest(sc: Scenario) -> str:
    h = hashlib.sha256()
    # One full-debug replication: the weekly trace plus every per-item matrix.
    dbg = sc.model_copy(update={"settings": sc.settings.model_copy(
        update={"trace_verbosity": TraceVerbosity.FULL_DEBUG})})
    ctx = run_replication(compile_scenario(dbg), 0, 0,
                          _resolved(dbg), debug=True)
    for k, v in trace_frame(ctx).items():
        h.update(k.encode()); h.update(_r(v))
    for k in ("D", "Q", "F", "B", "L", "I_mat", "I_transit", "O_mat"):
        h.update(k.encode()); h.update(_r(getattr(ctx.trace, k)))
    # And the scenario's KPI aggregates over the whole replication grid.
    res = run_scenario(sc, debug=True)
    for k in sorted(res.aggregates):
        h.update(k.encode()); h.update(_r(np.array([res.aggregates[k]["mean"]])))
    return h.hexdigest()


def _resolved(sc: Scenario):
    from scsim.core.engine import resolve_warmup
    from scsim.disruption.injector import resolve_events
    compiled = compile_scenario(sc)
    t_w = resolve_warmup(compiled).adopted_week
    return resolve_events(compiled.model, t_w, 0, {}) if sc.events else []


SCENARIOS = _scenarios()


def test_digest_file_lists_every_reference_scenario():
    if os.environ.get("SCSIM_WRITE_GOLDEN"):
        DIGESTS.parent.mkdir(parents=True, exist_ok=True)
        DIGESTS.write_text(json.dumps(
            {name: digest(sc) for name, sc in sorted(SCENARIOS.items())}, indent=2) + "\n")
    frozen = json.loads(DIGESTS.read_text())
    assert sorted(frozen) == sorted(SCENARIOS)


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_golden_digest_unchanged(name):
    frozen = json.loads(DIGESTS.read_text())
    assert digest(SCENARIOS[name]) == frozen[name], (
        f"{name}: the engine's behaviour moved. If deliberate, bump ENGINE_VERSION, "
        f"record it in ADR 0002 and PLAN.md §16, and regenerate with SCSIM_WRITE_GOLDEN=1."
    )
