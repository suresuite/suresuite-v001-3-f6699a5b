"""A window with no demand has no fill rate (audit 2026-09-22, F-08).

`fulfilled / demand if demand > 0 else 1.0` reported 100% service for a
project with no demand at all — which is what a failed `outbound_logistics`
read produced before the worker stopped swallowing it. A week with no demand
keeps 1.0 (nothing was unmet that week; the weekly series and the recovery band
depend on it); the WINDOW's fill rate is not measured, and says so as NaN,
which the bridge maps to null and the KPI table shows as "not measured".
"""
from __future__ import annotations

import math

import numpy as np

from scsim.core.engine import run_scenario
from scsim.stats.bootstrap import aggregate_mean_ci
from scsim import Scenario

from .conftest import make_settings, single_chain_network


def _no_demand() -> Scenario:
    net = single_chain_network()
    net = net.model_copy(update={"products": [
        p.model_copy(update={"demand_mode": 0.0}) for p in net.products]})
    return Scenario(name="z", network=net, settings=make_settings())


def test_no_demand_is_not_a_perfect_fill_rate():
    res = run_scenario(_no_demand())
    for row in res.kpis:
        assert math.isnan(row["fill_rate"])
    assert math.isnan(res.aggregates["fill_rate"]["mean"])
    assert res.aggregates["fill_rate"]["n"] == 0


def test_weekly_fill_rate_keeps_the_no_demand_convention():
    res = run_scenario(_no_demand())
    assert np.all(res.fr_series == 1.0)


def test_aggregate_ignores_unmeasured_replications():
    agg = aggregate_mean_ci(np.array([0.9, float("nan"), 0.8]))
    assert agg["n"] == 2 and abs(agg["mean"] - 0.85) < 1e-12
    assert math.isnan(aggregate_mean_ci(np.array([float("nan")]))["mean"])
