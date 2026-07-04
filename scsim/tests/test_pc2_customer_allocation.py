"""P-C.2 customer_allocation (M7 / Phase A).

Distribution of the week's product-level fulfillment across customers.
Product-level physics are untouched (the policy is a read-only PH-60
resident); its output is the per-segment service view.
"""
from __future__ import annotations

import pytest

from scsim import Customer, CustomerLink, DisruptionEvent, Network, Scenario
from scsim.core.engine import run_scenario
from scsim.entities.enums import EffectType, TargetType
from scsim.policies.registry import check_portfolio, get_entry, instantiate

from .conftest import make_settings, single_chain_network

# A partial plant throttle (φ=0.4 → capacity 80 < demand 100) produces
# genuine weekly scarcity — a supplier outage is all-or-nothing on this
# chain, which no allocation rule can differentiate.
THROTTLE = [DisruptionEvent(
    target_type=TargetType.NODE_PLANT, target_id="plant",
    effect_type=EffectType.CAPACITY_REDUCTION, capacity_factor=0.4,
    start=20, duration=14,
)]
THIN_BUFFER = {"coverage_weeks": {"nominal": 2, "alert": 2, "crisis": 2}}


def two_customer_network(shares=(60.0, 40.0)) -> Network:
    """Golden #1 chain with two customers splitting p1's demand."""
    base = single_chain_network()
    return Network(
        suppliers=base.suppliers, materials=base.materials, products=base.products,
        bom=base.bom, supplier_links=base.supplier_links,
        customers=[
            Customer(id="key_account", segment="strategic", priority_weight=10.0),
            Customer(id="spot_buyer", segment="spot", priority_weight=1.0),
        ],
        customer_links=[
            CustomerLink(product_id="p1", customer_id="key_account", share=shares[0]),
            CustomerLink(product_id="p1", customer_id="spot_buyer", share=shares[1]),
        ],
    )


def scenario(net=None, policies=None, events=None, **kw) -> Scenario:
    return Scenario(
        name="t", network=net or two_customer_network(),
        settings=make_settings(**kw), events=events or [],
        policies=policies or {},
    )


def test_registered_as_implemented():
    entry = get_entry("customer_allocation")
    assert entry.plugin_cls is not None
    assert entry.catalog_ref == "P-C.2"
    instantiate("customer_allocation", {"rule": "priority"})


def test_proportional_split_gives_equal_segment_fill():
    res = run_scenario(scenario(
        policies={"customer_allocation": {"rule": "proportional"},
                  "inventory_control": THIN_BUFFER},
        events=THROTTLE,
    ), debug=True)
    agg = res.aggregates
    assert agg["fill_rate_segment_strategic"]["mean"] == \
        pytest.approx(agg["fill_rate_segment_spot"]["mean"])
    # Scarcity actually occurred, so the shared fill rate is < 1.
    assert agg["min_segment_fill_rate"]["mean"] < 1.0


def test_priority_protects_the_key_account():
    res = run_scenario(scenario(
        policies={"customer_allocation": {"rule": "priority"},
                  "inventory_control": THIN_BUFFER},
        events=THROTTLE,
    ), debug=True)
    agg = res.aggregates
    assert agg["fill_rate_segment_strategic"]["mean"] > \
        agg["fill_rate_segment_spot"]["mean"]


def test_sla_floor_lifts_the_spot_segment():
    """Pure priority starves the spot buyer; an SLA floor guarantees it a
    baseline while the strategic account keeps its edge."""
    starved = run_scenario(scenario(
        policies={"customer_allocation": {"rule": "priority"},
                  "inventory_control": THIN_BUFFER},
        events=THROTTLE,
    ), debug=True)
    floored = run_scenario(scenario(
        policies={"customer_allocation": {"rule": "sla_tier",
                                          "sla_tiers": {"spot": 80.0}},
                  "inventory_control": THIN_BUFFER},
        events=THROTTLE,
    ), debug=True)
    assert floored.aggregates["fill_rate_segment_spot"]["mean"] > \
        starved.aggregates["fill_rate_segment_spot"]["mean"]
    assert floored.aggregates["fill_rate_segment_strategic"]["mean"] >= \
        floored.aggregates["fill_rate_segment_spot"]["mean"]


def test_distribution_conserves_product_physics():
    """Enabling the policy must not change any engine KPI — it only adds
    the per-segment view (CRN pairing makes this an exact comparison)."""
    without = run_scenario(scenario(
        policies={"inventory_control": THIN_BUFFER}, events=THROTTLE), debug=True)
    with_alloc = run_scenario(scenario(
        policies={"customer_allocation": {"rule": "priority"},
                  "inventory_control": THIN_BUFFER},
        events=THROTTLE,
    ), debug=True)
    for key in ("fill_rate", "lost_sales_value", "revenue", "max_backlog"):
        assert with_alloc.aggregates[key]["mean"] == \
            pytest.approx(without.aggregates[key]["mean"])


def test_segment_fills_are_consistent_with_product_fill():
    """Value-weighted segment fills recombine to the product fill rate."""
    res = run_scenario(scenario(
        policies={"customer_allocation": {"rule": "priority"},
                  "inventory_control": THIN_BUFFER},
        events=THROTTLE,
    ), debug=True)
    agg = res.aggregates
    # 60/40 demand shares: strategic fill · 0.6 + spot fill · 0.4 ≈ fill_rate.
    combined = 0.6 * agg["fill_rate_segment_strategic"]["mean"] \
        + 0.4 * agg["fill_rate_segment_spot"]["mean"]
    assert combined == pytest.approx(agg["fill_rate"]["mean"], abs=0.02)


def test_single_customer_network_is_inert_with_warning():
    net = single_chain_network()
    sc = scenario(net=net, policies={"customer_allocation": {}})
    codes = {i.code for i in check_portfolio(sc)}
    assert "single_customer" in codes
    res = run_scenario(sc, debug=True)
    assert not any(k.startswith("fill_rate_segment") for k in res.aggregates)


def test_feasibility_flags_unknown_names_and_bad_floors():
    sc = scenario(policies={"customer_allocation": {
        "priority_weights": {"ghost": 5.0}, "sla_tiers": {"nonseg": 20.0}}})
    codes = {i.code for i in check_portfolio(sc)}
    assert {"unknown_customer_weight", "unknown_sla_segment"} <= codes
    from scsim.core.engine import CompileError, compile_scenario
    with pytest.raises(CompileError, match="sla_floor_out_of_range"):
        compile_scenario(scenario(policies={"customer_allocation": {
            "rule": "sla_tier", "sla_tiers": {"spot": 250.0}}}))
