"""P-S.2 proactive_multi_sourcing: splitting, slice-wise exposure, premiums,
rebalancing — and the M5 exit criterion ({P-P.3, P-P.5} synergy positive)."""
from __future__ import annotations

import numpy as np
import pytest

from scsim import (
    BomLine,
    DisruptionEvent,
    Material,
    Network,
    Product,
    Scenario,
    Supplier,
    SupplierLink,
)
from scsim.core.engine import (
    CompileError,
    compile_scenario,
    run_portfolio_study,
    run_replication,
    run_scenario,
)
from scsim.disruption.injector import resolve_events
from scsim.entities.enums import DemandModel, EffectType

from .conftest import dual_source_network, make_settings, single_chain_network


def scenario(net, events=None, policies=None, **kw) -> Scenario:
    return Scenario(name="ps2", network=net, settings=make_settings(**kw),
                    events=events or [], policies=policies or {})


OUTAGE = [DisruptionEvent(target_id="s1", start=20, duration=14)]


def test_ps2_infeasible_when_all_single_sourced():
    sc = scenario(single_chain_network(), policies={"proactive_multi_sourcing": {}})
    with pytest.raises(CompileError, match="single-sourced"):
        compile_scenario(sc)


def test_ps2_weights_validation():
    sc = scenario(dual_source_network(), policies={
        "proactive_multi_sourcing": {"weights": {"m1": {"s1": 70.0, "s2": 20.0}}},
    })
    with pytest.raises(CompileError, match="sum to 90"):
        compile_scenario(sc)


def test_ps2_splits_orders_and_charges_premium():
    """Default equal split: both links carry flow every cycle; the non-primary
    slice pays (c_s2 − c_s1) + secondary_premium into C^res."""
    sc = scenario(dual_source_network(), policies={
        "proactive_multi_sourcing": {"secondary_premium": 0.1},
    })
    compiled = compile_scenario(sc)
    ctx = run_replication(compiled, 0, 0, [], debug=True)
    # Premium accrues on every ordering cycle's non-primary slice.
    costs = ctx.cost.total_by_component(0, sc.settings.horizon)
    assert costs["multi_sourcing_premium"] > 0
    assert costs["backup_premium"] == 0.0  # distinct component from P-S.1


def test_ps2_slice_wise_disruption_exposure():
    """50/50 split: an s1 outage hits only the s1 slice — losses sit strictly
    between single-sourcing-on-s1 (full exposure) and no disruption."""
    base = run_scenario(scenario(single_chain_network(), OUTAGE), debug=True)
    split = run_scenario(
        scenario(dual_source_network(), OUTAGE, {"proactive_multi_sourcing": {}}),
        debug=True,
    )
    assert split.aggregates["lost_sales_value"]["mean"] < \
        base.aggregates["lost_sales_value"]["mean"]


def test_ps2_rebalance_shifts_away_from_disrupted_source():
    no_reb = run_scenario(
        scenario(dual_source_network(), OUTAGE,
                 {"proactive_multi_sourcing": {"rebalance_trigger": "none"}}),
        debug=True,
    )
    reb = run_scenario(
        scenario(dual_source_network(), OUTAGE,
                 {"proactive_multi_sourcing": {"rebalance_trigger": "disruption"}}),
        debug=True,
    )
    assert reb.aggregates["lost_sales_value"]["mean"] <= \
        no_reb.aggregates["lost_sales_value"]["mean"]


def test_ps2_composes_with_ps1_distinct_premium_components():
    """P-S.2 (55) splits, P-S.1 (60) reroutes the disrupted slice — both write
    purchase_orders with declared resolutions, and each books its own premium."""
    res = run_scenario(
        scenario(dual_source_network(), OUTAGE,
                 {"proactive_multi_sourcing": {}, "backup_supplier": {}}),
        debug=True,
    )
    assert res.aggregates["cost_multi_sourcing_premium"]["mean"] > 0
    assert res.aggregates["fill_rate"]["mean"] > 0.9


# ----------------------------------------------- M5 exit: positive synergy case

def capacity_and_material_constrained() -> Network:
    """SS unlocks materials, overtime unlocks capacity — complementary
    constraints ⇒ positive {P-P.3, P-P.5} synergy (the C4 analogue)."""
    return Network(
        suppliers=[Supplier(id="s1"), Supplier(id="s2")],
        materials=[Material(id="m1", cost=2.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=100.0,
                          production_capacity=105.0)],   # capacity nearly binds
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[
            SupplierLink(supplier_id="s1", material_id="m1", cost=2.0, lead_time_weeks=2),
            SupplierLink(supplier_id="s2", material_id="m1", cost=2.6, lead_time_weeks=3),
        ],
    )


def test_m5_exit_pp3_pp5_synergy_positive():
    """Backorders pile up through a short outage; clearing them needs BOTH the
    material buffer (P-P.3) and the capacity headroom (P-P.5): together they
    recover more than the sum of parts."""
    sc = Scenario(
        name="c4", network=capacity_and_material_constrained(),
        settings=make_settings(model_seeds=4),
        events=[DisruptionEvent(target_id="s1", start=20, duration=6)],
        policies={"unmet_demand_handling": {"rule": "backorder", "backorder_horizon": 26}},
    )
    study = run_portfolio_study(sc, portfolios={
        "SS": {"safety_stock_materials": {"classification": "uniform",
                                          "uniform_service_level": 99.5}},
        "OT": {"short_term_capacity": {"max_overtime_factor": 2.0}},
        "SS+OT": {"safety_stock_materials": {"classification": "uniform",
                                             "uniform_service_level": 99.5},
                  "short_term_capacity": {"max_overtime_factor": 2.0}},
    }, debug=True)
    from scsim.synergy import decompose
    syn = decompose(study, "SS+OT", ["SS", "OT"])
    assert syn.synergy_revenue.point > 0, (
        f"expected complementary constraints to test positive, got "
        f"{syn.synergy_revenue.point:.4f}"
    )
