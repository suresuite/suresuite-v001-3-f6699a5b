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


def test_duplicate_supplier_material_arcs_deduped_to_cheapest():
    d = _base()
    d.supply_arcs = [
        SupplyArc("s1", "m1", unit_price=5.0, lead_time=2, lead_time_unit="week"),
        SupplyArc("s1", "m1", unit_price=3.0, lead_time=4, lead_time_unit="week"),
        SupplyArc("s1", "m1", unit_price=3.0, lead_time=1, lead_time_unit="week"),
    ]
    res = from_project_data(d)
    links = res.scenario.network.supplier_links
    assert len(links) == 1
    assert links[0].cost == 3.0
    assert links[0].lead_time_weeks == 1  # tie broken by shortest lead time
    assert any(w.field == "duplicate_arc" for w in res.warnings)


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
    # Rate-word synonyms the upload templates actually use.
    ("yearly", 5218.0, pytest.approx(100.0, rel=1e-3)),   # ÷52.18
    ("annually", 5218.0, pytest.approx(100.0, rel=1e-3)),
    ("daily", 10.0, 70.0),
    ("weekly", 100.0, 100.0),
    ("monthly", 434.8, pytest.approx(100.0, rel=1e-3)),
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


def test_lead_time_is_weeks_and_ignores_rate_time_unit():
    """§3 contract: time_unit describes the volume period only; lead_time is
    weeks unless lead_time_unit explicitly overrides. A template row with
    time_unit="yearly" and lead_time=4 must map to 4 weeks, not 4 years."""
    d = _base()
    d.supply_arcs = [SupplyArc("s1", "m1", unit_price=2.0, lead_time=4,
                               time_unit="yearly")]
    res = from_project_data(d)
    assert res.scenario.network.supplier_links[0].lead_time_weeks == 4


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


def test_explicit_demand_bounds_override_triangular_av():
    """Master demand_min/demand_max carry an asymmetric empirical triangular
    (b = historical median, c = historical max) — the WSC/TRON form."""
    d = _base()
    d.products[0].demand_mean = 100.0
    d.products[0].demand_cv = 0.30
    d.products[0].demand_min = 70.0
    d.products[0].demand_max = 400.0  # right tail far beyond mean·1.3
    res = from_project_data(d)
    p = res.scenario.network.products[0]
    assert (p.demand_min, p.demand_mode, p.demand_max) == (70.0, 100.0, 400.0)
    assert not [w for w in res.warnings if w.field in ("demand_min", "demand_max")]


def test_partial_explicit_bound_keeps_av_for_the_other():
    d = _base()
    d.products[0].demand_mean = 100.0
    d.products[0].demand_cv = 0.30
    d.products[0].demand_max = 250.0
    res = from_project_data(d)
    p = res.scenario.network.products[0]
    assert (p.demand_min, p.demand_mode, p.demand_max) == (70.0, 100.0, 250.0)


def test_inconsistent_demand_bounds_clamped_with_warning():
    d = _base()
    d.products[0].demand_mean = 100.0
    d.products[0].demand_min = 120.0  # > mode
    d.products[0].demand_max = 80.0   # < mode
    res = from_project_data(d)
    p = res.scenario.network.products[0]
    assert (p.demand_min, p.demand_mode, p.demand_max) == (100.0, 100.0, 100.0)
    fields = {w.field for w in res.warnings if w.level == "warn"}
    assert {"demand_min", "demand_max"} <= fields


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


def test_extended_fulfillment_mode_collapses_to_mto_with_warning():
    """CTO/ETO are valid UI strategies the engine doesn't model — they must
    collapse to MTO loudly, not silently (audit finding G)."""
    d = _base()
    d.products[0].fulfillment_mode = "configure_to_order"
    res = from_project_data(d)
    assert res.scenario.network.products[0].fulfillment_mode == FulfillmentMode.MTO
    assert any(w.level == "warn" and w.field == "fulfillment_mode" for w in res.warnings)


def test_fg_safety_stock_gated_on_actual_product_mode():
    """FG safety stock is gated on the products' real engine mode, not the
    separate `fulfillment_strategy` string: an MTS product enables it even when
    fulfillment_strategy is unset."""
    d = _base()
    d.project_model = "make_to_stock"  # products resolve to MTS
    d.products[0].fulfillment_mode = None
    d.policies = {"default": {"inventory": {
        "fg_safety_stock": "service_level", "fg_service_level_target": 0.95}}}
    res = from_project_data(d)
    assert "fg_safety_stock" in res.scenario.policies


def test_fg_safety_stock_skipped_when_no_mts_product_despite_strategy():
    """The two fulfillment-mode fields disagree: fulfillment_strategy claims MTS
    but no product is actually MTS → FG stock skipped, disagreement warned."""
    d = _base()  # products default to MTO
    d.policies = {"default": {
        "fulfillment_strategy": "make_to_stock",
        "inventory": {"fg_safety_stock": "fixed_days"},
    }}
    res = from_project_data(d)
    assert "fg_safety_stock" not in res.scenario.policies
    assert any(w.level == "warn" and w.field == "fulfillment_strategy" for w in res.warnings)


def test_per_node_fulfillment_override_is_warned_not_dropped_silently():
    """Fulfillment is consumed at the project default scope only; a per-node
    backorder override must surface a warning (doc §4/§6)."""
    d = _base()
    d.policies = {
        "default": {"fulfillment": {"backorder_allowed": True}},
        "node:c1::p1": {"fulfillment": {"backorder_cost_per_day": 5.0}},
    }
    res = from_project_data(d)
    assert any(
        w.level == "warn" and w.entity == "policy:unmet_demand_handling"
        and w.field == "fulfillment"
        for w in res.warnings
    )


def test_per_node_routing_hint_does_not_trigger_fulfillment_warning():
    """primary_source / sourcing_firm are firm-routing hints, not fulfillment
    params — a node patch carrying only those must NOT warn."""
    d = _base()
    d.policies = {"node:c1::p1": {"fulfillment": {
        "sourcing_firm": "PlantA", "primary_source": True}}}
    res = from_project_data(d)
    assert not any(
        w.entity == "policy:unmet_demand_handling" and w.field == "fulfillment"
        for w in res.warnings
    )


def test_e1_fully_specified_project_has_no_silent_fallbacks():
    """Engine-retirement gate E1 (blueprint §3): a fully-specified project
    maps with ZERO warn-level MappingWarnings — every warn is a silent
    fallback the user did not ask for. The one info-level residue is the
    known Phase B leftover (absolute order_up_to → coverage-κ, G1)."""
    d = ProjectData(
        suppliers=[SupplierRow(id="s1", capacity_per_week=500.0)],
        materials=[MaterialRow(id="m1", cost=2.0)],
        products=[ProductRow(id="p1", sell_price=20.0, demand_mean=100.0,
                             production_capacity=200.0)],
        supply_arcs=[SupplyArc(supplier_id="s1", material_id="m1", unit_price=2.0,
                               lead_time=2, lead_time_unit="week")],
        bom=[BomArc(product_id="p1", material_id="m1", consumption_rate=1.0)],
        outbound=[OutboundArc(product_id="p1", customer_id="c1", unit_price=20.0,
                              volume=100.0, time_unit="week")],
        scenario=ScenarioSettings(horizon_days=364),
    )
    res = from_project_data(d)
    warns = [w for w in res.warnings if w.level == "warn"]
    assert warns == [], [w.as_dict() for w in warns]
    info_residue = {(w.entity, w.field) for w in res.warnings if w.level == "info"}
    assert info_residue <= {("policy:inventory_control", "order_up_to")}, info_residue


def test_scenario_runs_end_to_end():
    from scsim.core.engine import run_scenario
    res = from_project_data(_base(replications=2, horizon_days=560, warmup_mode="manual", warmup_days=70))
    out = run_scenario(res.scenario)
    assert "fill_rate" in out.aggregates


# ── Plant-stage production overrides (§4 D75) ────────────────────────────────
# The /policies plant grid keys every row "<focal plant>::<product>", so a
# lookup keyed by the product alone never reached it: line capacity was stored
# and never read. These pin both spellings and the master's precedence.

def _plant_capacity_case(policies: dict, master: float | None) -> tuple:
    d = _base()
    d.products = [ProductRow(id="p1", sell_price=20.0, demand_mean=100.0,
                             production_capacity=master)]
    d.policies = policies
    res = from_project_data(d)
    return res.scenario.network.products[0], res.warnings


def test_composite_plant_key_line_capacity_reaches_the_engine():
    """node:<plant>::<product> — the spelling the grid actually writes."""
    prod, warns = _plant_capacity_case(
        {"node:Focal plant::p1": {"production": {
            "capacity_units_per_day": 50.0, "utilization_cap_pct": 80.0}}},
        master=None,
    )
    assert prod.production_capacity == pytest.approx(50.0 * 7.0 * 0.80)  # 280/wk
    assert any(w.field == "production_capacity" and w.level == "info"
               and "derived from production policy" in w.reason for w in warns)
    assert not any("no capacity source" in w.reason for w in warns)


def test_bare_product_key_line_capacity_still_works():
    """node:<product> — no regression for any writer using the bare form."""
    prod, _ = _plant_capacity_case(
        {"node:p1": {"production": {
            "capacity_units_per_day": 50.0, "utilization_cap_pct": 80.0}}},
        master=None,
    )
    assert prod.production_capacity == pytest.approx(280.0)


def test_composite_key_beats_bare_key_and_project_default():
    """Most specific wins: default < node:<product> < node:<plant>::<product>."""
    prod, _ = _plant_capacity_case(
        {
            "default": {"production": {"capacity_units_per_day": 10.0,
                                       "utilization_cap_pct": 100.0}},
            "node:p1": {"production": {"capacity_units_per_day": 20.0}},
            "node:Focal plant::p1": {"production": {"capacity_units_per_day": 50.0}},
        },
        master=None,
    )
    assert prod.production_capacity == pytest.approx(50.0 * 7.0 * 1.0)  # 350/wk


def test_master_capacity_shadows_line_capacity_and_says_so():
    """products.production_capacity (units/wk) wins — but never silently."""
    prod, warns = _plant_capacity_case(
        {"node:Focal plant::p1": {"production": {"capacity_units_per_day": 50.0}}},
        master=200.0,
    )
    assert prod.production_capacity == pytest.approx(200.0)
    assert any(w.level == "info" and w.field == "production_capacity"
               and "shadows" in w.reason for w in warns)


def test_missing_utilization_cap_is_declared_not_silent():
    prod, warns = _plant_capacity_case(
        {"node:Focal plant::p1": {"production": {"capacity_units_per_day": 50.0}}},
        master=None,
    )
    assert prod.production_capacity == pytest.approx(50.0 * 7.0 * 0.85)  # 297.5/wk
    assert any(w.field == "utilization_cap_pct" and w.level == "info" for w in warns)


def test_override_naming_nothing_in_the_project_warns():
    """A key whose components name no entity joins nothing, in any family."""
    _, warns = _plant_capacity_case(
        {"node:Other plant::p_typo": {"production": {"capacity_units_per_day": 50.0}}},
        master=200.0,
    )
    assert any(w.level == "warn" and w.field == "target_key"
               and "p_typo" in w.reason for w in warns)


def test_known_target_keys_do_not_warn_as_orphans():
    """The four real spellings must not trip the orphan guard."""
    _, warns = _plant_capacity_case(
        {
            "node:Focal plant::p1": {"production": {"capacity_units_per_day": 50.0}},
            "node:s1::m1": {"sourcing": {"supply_share": 1.0}},
            "node:c1::p1": {"fulfillment": {"backorder_cost_per_day": 5.0}},
            "node:m1": {"inventory": {"holding_cost_pct": 0.25}},
        },
        master=200.0,
    )
    assert not any(w.field == "target_key" for w in warns)


def test_two_owners_on_one_product_warn_instead_of_silently_picking():
    """Two plants patching the same product (nganho124, PR #220).

    The merge is deterministic — sorted key order, last wins on a shared
    field — and it is ANNOUNCED. A silent choice between two values a user
    typed is the same defect D75 was.
    """
    prod, warns = _plant_capacity_case(
        {
            "node:Plant A::p1": {"production": {
                "capacity_units_per_day": 20.0, "utilization_cap_pct": 80.0}},
            "node:Plant B::p1": {"production": {"capacity_units_per_day": 30.0}},
        },
        master=None,
    )
    # B wins the field both set; A's utilization survives — B never sets it.
    assert prod.production_capacity == pytest.approx(30.0 * 7.0 * 0.80)
    amb = [w for w in warns if w.field == "target_key" and w.level == "warn"]
    assert len(amb) == 1, "exactly one ambiguity warning"
    assert "Plant A::p1" in amb[0].reason and "Plant B::p1" in amb[0].reason


def test_one_owner_per_product_does_not_warn():
    _, warns = _plant_capacity_case(
        {"node:Plant A::p1": {"production": {"capacity_units_per_day": 20.0}}},
        master=None,
    )
    assert not any(w.field == "target_key" and w.level == "warn" for w in warns)


def test_owner_name_containing_the_separator_still_resolves():
    """A plant literally named "A::B" — the second split candidate."""
    prod, _ = _plant_capacity_case(
        {"node:Plant A::B::p1": {"production": {
            "capacity_units_per_day": 20.0, "utilization_cap_pct": 80.0}}},
        master=None,
    )
    assert prod.production_capacity == pytest.approx(20.0 * 7.0 * 0.80)
