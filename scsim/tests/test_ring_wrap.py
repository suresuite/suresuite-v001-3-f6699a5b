"""A lead-time draw beyond the in-transit ring must not land early (audit F-36).

`ring_width = max(link_lt) + 64`, and `_mech_ship_queue` writes `arrival % W`.
A lognormal/gamma draw longer than the ring wrapped and landed the shipment
EARLY — a wrong number with no symptom. The draw is now bounded to `W − 2`
weeks and every bounded draw is counted, per link, onto the result, where the
bridge turns it into a `mapping_warnings` entry the run panel renders.
"""
from __future__ import annotations

from scsim.core.engine import run_scenario
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


def _heavy_tail(cv: float) -> ProjectData:
    # A 40-week lane → ring 104 wk. At cv 1 a lognormal draw exceeds 102 weeks
    # about 6% of the time: a real long-haul lane, not a contrived one.
    return ProjectData(
        suppliers=[SupplierRow(id="s1")],
        materials=[MaterialRow(id="m1", cost=2.0, lead_time_dist="lognormal", lead_time_cv=cv)],
        products=[ProductRow(id="p1", sell_price=20.0, demand_mean=100.0,
                             production_capacity=200.0)],
        supply_arcs=[SupplyArc(supplier_id="s1", material_id="m1", unit_price=2.0,
                               lead_time=40, lead_time_unit="week")],
        bom=[BomArc(product_id="p1", material_id="m1", consumption_rate=1.0)],
        outbound=[OutboundArc(product_id="p1", customer_id="c1", unit_price=20.0,
                              volume=100.0, time_unit="week")],
        scenario=ScenarioSettings(replications=20, horizon_days=1092,
                                  warmup_mode="manual", warmup_days=70, seed=7),
    )


def test_draws_beyond_the_ring_are_bounded_and_counted():
    res = run_scenario(from_project_data(_heavy_tail(cv=1.0)).scenario)
    trunc = res.lead_time_truncations
    assert trunc, "a cv=1 lognormal on a 40-week lane exceeds a 104-week ring"
    [row] = trunc
    assert row["supplier_id"] == "s1" and row["material_id"] == "m1"
    assert row["draws"] > 0 and row["bounded_to_weeks"] == 40 + 64 - 2


def test_a_tame_distribution_reports_nothing():
    res = run_scenario(from_project_data(_heavy_tail(cv=0.1)).scenario)
    assert not res.lead_time_truncations
