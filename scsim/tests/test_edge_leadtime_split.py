"""Edge lead-time split (M7 / Phase A).

``Lane.lead_time_weeks`` composes into the effective link lead time at
compile, so planning coverage, shipping physics, and ring sizing all see
the same total. The decomposition is exact: transit quoted on the lane is
byte-identical to transit folded into the supplier link.
"""
from __future__ import annotations

import numpy as np

from scsim import DisruptionEvent, Lane, Network, Scenario
from scsim.core.engine import compile_scenario, run_replication, run_scenario
from scsim.entities.enums import TargetType, TransportMode
from scsim.io.traces import trace_frame

from .conftest import make_settings, single_chain_network


def with_lane(net: Network, lt: int, **lane_kw) -> Network:
    return Network(
        suppliers=net.suppliers, materials=net.materials, products=net.products,
        bom=net.bom, supplier_links=net.supplier_links, customers=net.customers,
        lanes=[Lane(id="l1", supplier_id="s1", lead_time_weeks=lt, **lane_kw)],
    )


def scenario(net: Network, events=None, **kw) -> Scenario:
    return Scenario(name="t", network=net, settings=make_settings(**kw),
                    events=events or [], policies={})


def _trace(sc: Scenario) -> dict[str, np.ndarray]:
    return trace_frame(run_replication(compile_scenario(sc), 0, 0, []))


def test_lane_transit_composes_into_link_lead_time():
    net = with_lane(single_chain_network(), lt=3)
    model = compile_scenario(scenario(net)).model
    assert model.link_lt[0] == 2 + 3  # supplier link 2w + lane transit 3w


def test_zero_lane_is_behavior_neutral():
    base = _trace(scenario(single_chain_network()))
    laned = _trace(scenario(with_lane(single_chain_network(), lt=0)))
    for key in base:
        np.testing.assert_array_equal(base[key], laned[key], err_msg=key)


def test_lane_quote_equivalent_to_folded_quote():
    """link 2w + lane 2w must be byte-identical to link 4w + lane 0w."""
    folded = single_chain_network()
    folded.supplier_links[0].lead_time_weeks = 4
    split = with_lane(single_chain_network(), lt=2)  # 2 + 2
    a = _trace(scenario(folded))
    b = _trace(scenario(split))
    for key in a:
        np.testing.assert_array_equal(a[key], b[key], err_msg=key)


def test_lane_transit_deepens_outage_impact():
    """Longer pipe = slower recovery: the same outage loses at least as much
    with 6 weeks of lane transit, and planning still covers steady state."""
    ev = [DisruptionEvent(target_id="s1", start=20, duration=14)]
    short = run_scenario(scenario(single_chain_network(), events=ev), debug=True)
    long = run_scenario(scenario(with_lane(single_chain_network(), lt=6), events=ev),
                        debug=True)
    assert long.aggregates["lost_sales_value"]["mean"] >= \
        short.aggregates["lost_sales_value"]["mean"]
    quiet = run_scenario(scenario(with_lane(single_chain_network(), lt=6)), debug=True)
    assert quiet.aggregates["fill_rate"]["mean"] == 1.0  # coverage sees the total


def test_edge_lane_event_stays_supplier_equivalent():
    """edge:lane targets resolve through the lane's supplier (the documented
    behavior-neutral mode) — identical results to targeting the supplier."""
    net = with_lane(single_chain_network(), lt=2, mode=TransportMode.SEA)
    via_lane = run_scenario(scenario(
        net, events=[DisruptionEvent(target_type=TargetType.EDGE_LANE, target_id="l1",
                                     start=20, duration=14)]), debug=True)
    via_supplier = run_scenario(scenario(
        net, events=[DisruptionEvent(target_id="s1", start=20, duration=14)]), debug=True)
    assert via_lane.aggregates["lost_sales_value"]["mean"] == \
        via_supplier.aggregates["lost_sales_value"]["mean"]


def test_default_mode_lane_wins_when_multiple():
    net = single_chain_network()
    net = Network(
        suppliers=net.suppliers, materials=net.materials, products=net.products,
        bom=net.bom, supplier_links=net.supplier_links,
        lanes=[
            Lane(id="air", supplier_id="s1", mode=TransportMode.AIR, lead_time_weeks=1),
            Lane(id="sea", supplier_id="s1", mode=TransportMode.DEFAULT, lead_time_weeks=5),
        ],
    )
    model = compile_scenario(scenario(net)).model
    assert model.link_lt[0] == 2 + 5  # the default-mode lane binds in v1
