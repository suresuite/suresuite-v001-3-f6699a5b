"""Single-run inspection surface (G17/§9.5.1): per-item weekly matrices on
ScenarioResult — exposed ONLY for full_debug runs with exactly one
replication, and behavior-neutral for everything else."""
from __future__ import annotations

import numpy as np

from scsim.core.engine import run_scenario
from scsim.entities.enums import TraceVerbosity
from scsim.entities.scenario import Scenario
from scsim.io.project_map import ScenarioSettings, from_project_data

from .conftest import bom_blocked_network, make_settings, single_chain_network

MATERIAL_KEYS = ("material.on_hand", "material.in_transit", "material.orders")
PRODUCT_KEYS = (
    "product.demand", "product.production", "product.fulfillment",
    "product.backlog", "product.lost_units",
)


def _scenario(net, **settings_kw) -> Scenario:
    return Scenario(name="t", network=net, settings=make_settings(**settings_kw),
                    events=[], policies={})


def test_single_rep_full_debug_exposes_item_series():
    sc = _scenario(bom_blocked_network(), model_seeds=1,
                   trace_verbosity=TraceVerbosity.FULL_DEBUG)
    res = run_scenario(sc)
    assert res.item_series is not None and res.item_ids is not None
    assert res.item_ids["material"] == ["m1", "m2"]
    assert res.item_ids["product"] == ["p1"]
    T = sc.settings.horizon
    for key in MATERIAL_KEYS:
        assert res.item_series[key].shape == (2, T), key
        assert np.isfinite(res.item_series[key]).all(), key
    for key in PRODUCT_KEYS:
        assert res.item_series[key].shape == (1, T), key
        assert np.isfinite(res.item_series[key]).all(), key
    # Consistency with the network-aggregate weekly trace: per-material
    # on-hand valued at cost must reproduce on_hand_value week for week.
    costs = np.array([2.0, 4.0])
    on_hand_value = (res.item_series["material.on_hand"] * costs[:, None]).sum(axis=0)
    assert np.allclose(on_hand_value, res.extra_series["on_hand_value"][0])
    # Deterministic 100%-fill chain: weekly fulfillment equals weekly demand.
    assert np.allclose(res.item_series["product.fulfillment"],
                       res.item_series["product.demand"])


def test_multi_rep_full_debug_never_exposes_item_series():
    sc = _scenario(single_chain_network(), model_seeds=2,
                   trace_verbosity=TraceVerbosity.FULL_DEBUG)
    res = run_scenario(sc)
    assert res.item_series is None and res.item_ids is None


def test_weekly_verbosity_never_exposes_item_series():
    sc = _scenario(single_chain_network(), model_seeds=1)
    res = run_scenario(sc)
    assert res.item_series is None and res.item_ids is None


def test_item_series_is_behavior_neutral():
    """Raising the trace must not change a single KPI (Tier-2 guarantee)."""
    base = run_scenario(_scenario(single_chain_network(), model_seeds=1))
    insp = run_scenario(_scenario(single_chain_network(), model_seeds=1,
                                  trace_verbosity=TraceVerbosity.FULL_DEBUG))
    for key, agg in base.aggregates.items():
        # THE `capacity_utilization` SKIP IS GONE, AND THAT IS THE POINT (WP 9.3).
        # It read `trace.Q`, so it was NaN on the ordinary run and a number on
        # the inspection one — a KPI that was NOT behaviour-neutral, excused by
        # the test built to catch exactly that (§4 D165). It is computed from
        # the always-on weekly capacity series now, so the two runs agree.
        #
        # `supplier_capacity_utilization` is NaN on BOTH when no supplier
        # declares a finite capacity, which is a measurement that does not
        # exist rather than one that disagrees — so the comparison is
        # NaN-aware instead of skipped.
        mine, theirs = agg["mean"], insp.aggregates[key]["mean"]
        if np.isnan(mine) and np.isnan(theirs):
            continue
        assert mine == theirs, key
    assert np.array_equal(base.fr_series, insp.fr_series)


def _project_data_kwargs(inspection: bool, replications: int) -> dict:
    from scsim.io.project_map import (
        BomArc, MaterialRow, OutboundArc, ProductRow, ProjectData, SupplierRow,
        SupplyArc,
    )
    return dict(
        data=ProjectData(
            suppliers=[SupplierRow(id="s1")],
            materials=[MaterialRow(id="m1", cost=2.0)],
            products=[ProductRow(id="p1", sell_price=10.0, demand_mean=100.0,
                                 production_capacity=200.0)],
            supply_arcs=[SupplyArc(supplier_id="s1", material_id="m1",
                                   unit_price=2.0, lead_time=2)],
            bom=[BomArc(product_id="p1", material_id="m1")],
            outbound=[OutboundArc(product_id="p1", customer_id="c1",
                                  unit_price=10.0, volume=100.0, time_unit="week")],
            scenario=ScenarioSettings(replications=replications, seed=7,
                                      inspection=inspection),
            project_model="make_to_order",
        )
    )


def test_project_map_inspection_raises_trace_for_single_rep():
    mapping = from_project_data(**_project_data_kwargs(True, 1))
    assert mapping.scenario.settings.trace_verbosity == TraceVerbosity.FULL_DEBUG
    assert mapping.scenario.settings.model_seeds == 1
    assert not any(w.field == "inspection" for w in mapping.warnings)


def test_project_map_inspection_ignored_with_warning_for_multi_rep():
    mapping = from_project_data(**_project_data_kwargs(True, 30))
    assert mapping.scenario.settings.trace_verbosity == TraceVerbosity.WEEKLY
    warns = [w for w in mapping.warnings if w.field == "inspection"]
    assert len(warns) == 1 and warns[0].level == "warn"


def test_project_map_without_inspection_keeps_weekly_trace():
    mapping = from_project_data(**_project_data_kwargs(False, 1))
    assert mapping.scenario.settings.trace_verbosity == TraceVerbosity.WEEKLY
