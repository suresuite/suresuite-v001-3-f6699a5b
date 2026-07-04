"""Canonical project → Scenario mapper: reducers, units, defaults, modes."""
from __future__ import annotations

import pytest

from scsim.entities.enums import DemandModel, EffectType, FulfillmentMode
from scsim.io.project_map import (
    BomArc,
    MaterialRow,
    OutboundArc,
    ProductRow,
    ProjectData,
    ScenarioSettings,
    SupplierRow,
    SupplyArc,
    from_project_data,
)


def _base(**scenario_kw) -> ProjectData:
    """One supplier → one material → one product → one customer."""
    return ProjectData(
        suppliers=[SupplierRow(id="s1")],
        materials=[MaterialRow(id="m1", cost=2.0)],
        products=[ProductRow(id="p1", sell_price=20.0, demand_mean=100.0,
                             production_capacity=200.0)],
        supply_arcs=[SupplyArc(supplier_id="s1", material_id="m1", unit_price=2.0,
                               lead_time=2, lead_time_unit="week")],
        bom=[BomArc(product_id="p1", material_id="m1", consumption_rate=1.0)],
        outbound=[OutboundArc(product_id="p1", customer_id="c1", unit_price=20.0,
                              volume=100.0, time_unit="week")],
        scenario=ScenarioSettings(**scenario_kw),
    )


def test_master_prices_win():
    res = from_project_data(_base())
    net = res.scenario.network
    assert net.materials[0].cost == 2.0
    assert net.products[0].unit_price == 20.0
    assert net.supplier_links[0].cost == 2.0


def test_product_price_is_demand_weighted_average_when_no_master():
    d = _base()
    d.products[0].sell_price = None  # force fallback
    d.outbound = [
        OutboundArc("p1", "big", unit_price=10.0, volume=300.0, time_unit="week"),
        OutboundArc("p1", "small", unit_price=20.0, volume=100.0, time_unit="week"),
    ]
    res = from_project_data(d)
    # weighted: (10*300 + 20*100) / 400 = 12.5  (NOT last-writer 20 or max 20)
    assert res.scenario.network.products[0].unit_price == pytest.approx(12.5)
    assert any(w.field == "unit_price" for w in res.warnings)


def test_material_cost_falls_back_to_cheapest_link_with_warning():
    d = _base()
    d.materials[0].cost = None
    d.supply_arcs = [
        SupplyArc("s1", "m1", unit_price=5.0, lead_time=2, lead_time_unit="week"),
        SupplyArc("s2", "m1", unit_price=3.0, lead_time=3, lead_time_unit="week"),
    ]
    res = from_project_data(d)
    assert res.scenario.network.materials[0].cost == 3.0  # cheapest
    assert any(w.entity == "material:m1" and w.field == "cost" for w in res.warnings)


def test_missing_price_defaults_to_one_and_warns():
    d = _base()
    d.products[0].sell_price = None
    d.outbound = [OutboundArc("p1", "c1", unit_price=None, volume=100.0, time_unit="week")]
    res = from_project_data(d)
    assert res.scenario.network.products[0].unit_price == 1.0
    assert any(w.level == "warn" and w.field == "unit_price" for w in res.warnings)


@pytest.mark.parametrize("unit,vol,expected", [
    ("week", 100.0, 100.0),
    ("day", 10.0, 70.0),       # per-day → ×7
    ("month", 434.8, pytest.approx(100.0, rel=1e-3)),  # ÷4.348
])
def test_demand_unit_normalization(unit, vol, expected):
    d = _base()
    d.products[0].demand_mean = None  # force outbound-derived demand
    d.outbound = [OutboundArc("p1", "c1", unit_price=20.0, volume=vol, time_unit=unit)]
    res = from_project_data(d)
    assert res.scenario.network.products[0].demand_mode == expected


def test_lead_time_days_normalized_to_weeks():
    d = _base()
    d.supply_arcs = [SupplyArc("s1", "m1", unit_price=2.0, lead_time=14, lead_time_unit="day")]
    res = from_project_data(d)
    assert res.scenario.network.supplier_links[0].lead_time_weeks == 2


def test_fulfillment_mode_from_project_model():
    d = _base()
    d.products[0].fulfillment_mode = None
    d.project_model = "Make-To-Stock"
    res = from_project_data(d)
    assert res.scenario.network.products[0].fulfillment_mode == FulfillmentMode.MTS


def test_scenario_demand_model_poisson_applied():
    d = _base(demand_model={"kind": "poisson"})
    res = from_project_data(d)
    assert res.scenario.network.products[0].demand_model == DemandModel.POISSON


def test_triangular_av_from_mean_and_cv():
    d = _base(demand_model={"kind": "triangular", "cv": 0.30})
    d.products[0].demand_mean = 100.0
    res = from_project_data(d)
    p = res.scenario.network.products[0]
    assert p.demand_model == DemandModel.TRIANGULAR
    assert (p.demand_min, p.demand_mode, p.demand_max) == (70.0, 100.0, 130.0)


def test_partial_cut_becomes_capacity_reduction_when_capacity_finite():
    d = _base()
    d.suppliers = [SupplierRow(id="s1", capacity_per_week=500.0)]
    d.scenario.disruption_schedule = [
        {"target": "supplier:s1", "magnitude_pct": 60, "start_week": 90, "duration_weeks": 6},
    ]
    res = from_project_data(d)
    ev = res.scenario.events[0]
    assert ev.effect_type == EffectType.CAPACITY_REDUCTION
    assert ev.capacity_factor == pytest.approx(0.40)  # 60% cut → 40% remains


def test_partial_cut_without_capacity_warns_and_uses_extension():
    d = _base()  # supplier capacity None (∞)
    d.scenario.disruption_schedule = [
        {"target": "s1", "magnitude_pct": 60, "start_week": 90, "duration_weeks": 6},
    ]
    res = from_project_data(d)
    assert res.scenario.events[0].effect_type == EffectType.LEAD_TIME_EXTENSION
    assert any("finite supplier capacity" in w.reason for w in res.warnings)


def test_plant_target_maps_to_node_plant_halt():
    from scsim.entities.enums import TargetType
    d = _base()
    d.scenario.disruption_schedule = [
        {"target": "plant:main", "magnitude_pct": 100, "start_week": 90, "duration_weeks": 6},
    ]
    res = from_project_data(d)
    ev = res.scenario.events[0]
    assert ev.target_type == TargetType.NODE_PLANT
    assert ev.effect_type == EffectType.LEAD_TIME_EXTENSION  # full cut = halt
    assert not any(w.field == "target" for w in res.warnings)


def test_plant_partial_cut_throttles_without_capacity_precondition():
    """Unlike suppliers, the plant needs no capacity_per_week: production_capacity
    is always finite, so a partial cut always becomes capacity_reduction."""
    from scsim.entities.enums import TargetType
    d = _base()
    d.scenario.disruption_schedule = [
        {"target": "node:plant", "magnitude_pct": 75, "start_week": 90, "duration_weeks": 6},
    ]
    res = from_project_data(d)
    ev = res.scenario.events[0]
    assert ev.target_type == TargetType.NODE_PLANT
    assert ev.effect_type == EffectType.CAPACITY_REDUCTION
    assert ev.capacity_factor == pytest.approx(0.25)  # 75% cut → 25% remains
    assert not any("finite supplier capacity" in w.reason for w in res.warnings)


def test_plant_event_runs_end_to_end():
    from scsim.core.engine import run_scenario
    d = _base(replications=2, horizon_days=560, warmup_mode="manual", warmup_days=70)
    d.scenario.disruption_schedule = [
        {"target": "plant:main", "magnitude_pct": 100, "start_week": 12, "duration_weeks": 8},
    ]
    out = run_scenario(from_project_data(d).scenario)
    assert out.aggregates["lost_sales_value"]["mean"] > 0.0


def test_material_target_still_skipped_with_warning():
    d = _base()
    d.scenario.disruption_schedule = [
        {"target": "material:m1", "magnitude_pct": 50, "start_week": 90, "duration_weeks": 6},
    ]
    res = from_project_data(d)
    assert res.scenario.events == []
    assert any(w.field == "target" and "skipped" in w.reason for w in res.warnings)


def test_supplier_literally_named_plant_stays_a_supplier():
    from scsim.entities.enums import TargetType
    d = _base()
    d.suppliers = [SupplierRow(id="plant")]
    d.supply_arcs = [SupplyArc(supplier_id="plant", material_id="m1", unit_price=2.0,
                               lead_time=2, lead_time_unit="week")]
    d.scenario.disruption_schedule = [
        {"target": "plant", "magnitude_pct": 100, "start_week": 90, "duration_weeks": 6},
    ]
    res = from_project_data(d)
    assert res.scenario.events[0].target_type == TargetType.NODE_SUPPLIER


def test_fulfillment_allocation_enables_customer_allocation():
    d = _base()
    d.outbound = [
        OutboundArc(product_id="p1", customer_id="c1", unit_price=20.0,
                    volume=60.0, time_unit="week"),
        OutboundArc(product_id="p1", customer_id="c2", unit_price=20.0,
                    volume=40.0, time_unit="week"),
    ]
    d.policies = {"default": {"fulfillment": {"allocation": "fair_share"}}}
    res = from_project_data(d)
    assert res.scenario.policies["customer_allocation"] == {"rule": "fair_share"}
    links = res.scenario.network.customer_links
    assert {(l.product_id, l.customer_id) for l in links} == {("p1", "c1"), ("p1", "c2")}
    shares = {l.customer_id: l.share for l in links}
    assert shares["c1"] == pytest.approx(60.0)


def test_single_customer_does_not_enable_customer_allocation():
    d = _base()  # one customer c1
    d.policies = {"default": {"fulfillment": {"allocation": "priority"}}}
    res = from_project_data(d)
    assert "customer_allocation" not in res.scenario.policies


def test_unsourced_material_raises():
    d = _base()
    d.supply_arcs = []  # m1 now has no supplier
    with pytest.raises(ValueError, match="no supplier link"):
        from_project_data(d)


def test_scenario_runs_end_to_end():
    from scsim.core.engine import run_scenario
    res = from_project_data(_base(replications=2, horizon_days=560, warmup_mode="manual", warmup_days=70))
    out = run_scenario(res.scenario)
    assert "fill_rate" in out.aggregates
