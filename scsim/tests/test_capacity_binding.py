"""Capacity as a MEASURED OUTPUT, not a restated input (WP 9.3 / §4 D167).

`capacity_utilization` existed as a KPI from the day the KPI module was written
and was NaN on every run a user ever made: it read `trace.Q`, which exists only
under `trace_verbosity=full_debug`, and an ordinary Monte Carlo run allocates no
matrices. The /policies sanity panel printed "not recorded" for the quantity the
engine clips production against in every week of every replication.

These tests hold the four things that fixes:

  1. the weekly capacity series exist on an ORDINARY run;
  2. `capacity_utilization` is a number on an ordinary run, and it is the ratio
     of the summed parts rather than the mean of the weekly ratios;
  3. an unlimited supplier is in NEITHER side of the supplier ratio, so a
     project that declares no capacity reports "not measurable" rather than a
     percentage of infinity;
  4. binding is per entity and NAMES the entity — a utilization cannot.
"""
from __future__ import annotations

import numpy as np

from scsim import BomLine, Material, Network, Product, Scenario, Supplier, SupplierLink
from scsim.core.context import PUBLISHED_SERIES_KEYS
from scsim.core.engine import run_scenario
from scsim.entities.enums import DemandModel

from .conftest import make_settings, single_chain_network

CAPACITY_SERIES = (
    "plant_capacity_units", "plant_capacity_used_units",
    "supplier_capacity_units", "supplier_capacity_used_units",
)


def _scenario(net, **kw) -> Scenario:
    return Scenario(name="cap", network=net, settings=make_settings(**kw),
                    events=[], policies={})


def _starved_plant_network(capacity: float = 40.0) -> Network:
    """One product whose demand (100/wk) is far above its capacity."""
    return Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=2.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=100.0,
                          demand_model=DemandModel.DETERMINISTIC,
                          production_capacity=capacity)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[
            SupplierLink(supplier_id="s1", material_id="m1", cost=2.0, lead_time_weeks=1)
        ],
    )


# ── 1. the series exist on an ordinary run ───────────────────────────────────

def test_capacity_series_are_published_on_an_ordinary_run():
    for key in CAPACITY_SERIES:
        assert key in PUBLISHED_SERIES_KEYS, key
    res = run_scenario(_scenario(single_chain_network(), model_seeds=2))
    for key in CAPACITY_SERIES:
        assert key in res.extra_series, key
        assert res.extra_series[key].shape[1] == 70, key
    # The plant offers its declared capacity every week when nothing throttles it.
    assert np.allclose(res.extra_series["plant_capacity_units"], 200.0)


# ── 2. the KPI is measured, and it is Σ/Σ ────────────────────────────────────

def test_capacity_utilization_is_a_number_without_full_debug():
    res = run_scenario(_scenario(single_chain_network(), model_seeds=2))
    util = res.aggregates["capacity_utilization"]["mean"]
    assert np.isfinite(util), "the KPI this package exists for is still NaN"
    assert 0.0 < util < 1.0


def test_capacity_utilization_equals_summed_produced_over_summed_available():
    """The declared `ratio` aggregation, held against the series themselves.

    The old form was `(Q / cap).mean()` over products AND weeks, which gives a
    week that produced nothing the same weight as the week the plant ran flat
    out. Asserting the quotient-of-sums here is what stops a future edit from
    quietly going back to a mean of quotients.
    """
    settings = dict(model_seeds=1, warmup_end=10, analysis_window=50)
    res = run_scenario(_scenario(_starved_plant_network(), **settings))
    avail = res.extra_series["plant_capacity_units"][0][10:60].sum()
    used = res.extra_series["plant_capacity_used_units"][0][10:60].sum()
    assert res.kpis[0]["capacity_utilization"] == used / avail


# ── 3. unlimited suppliers are outside the ratio ─────────────────────────────

def test_an_unlimited_supplier_is_in_neither_side_of_the_supplier_ratio():
    # `single_chain_network` leaves capacity_per_week None → np.inf, which is
    # the DECLARED meaning of an empty column, not a missing value.
    res = run_scenario(_scenario(single_chain_network(), model_seeds=1))
    assert np.allclose(res.extra_series["supplier_capacity_units"], 0.0)
    assert np.allclose(res.extra_series["supplier_capacity_used_units"], 0.0)
    assert np.isnan(res.kpis[0]["supplier_capacity_utilization"]), (
        "no finite capacity exists, so there is nothing to divide by — 0% would "
        "say the suppliers were idle and 100% that they were the constraint"
    )
    assert res.capacity_binding["unlimited_suppliers"] == 1
    assert res.capacity_binding["suppliers"] == []


def test_a_finite_supplier_capacity_is_measured_and_binds():
    net = single_chain_network(supplier_capacity=30.0)  # demand is 100/wk
    res = run_scenario(_scenario(net, model_seeds=1))
    assert np.allclose(res.extra_series["supplier_capacity_units"], 30.0)
    util = res.kpis[0]["supplier_capacity_utilization"]
    assert np.isfinite(util) and util > 0.9
    assert res.capacity_binding["unlimited_suppliers"] == 0
    bound = res.capacity_binding["suppliers"]
    assert [r["id"] for r in bound] == ["s1"]
    assert bound[0]["capacity"] == 30.0
    assert bound[0]["bound_weeks"] > 0
    assert res.kpis[0]["suppliers_capacity_bound"] == 1.0


# ── 4. binding NAMES the entity ──────────────────────────────────────────────

def test_binding_is_measured_against_the_unclipped_want():
    """The plan is clipped in the same function that measures the clip.

    `ctx.production_plan` is already `min(want, cap)`, so a binding test written
    downstream of it compares a number against itself and answers "no" forever.
    A product whose demand is 2.5x its capacity must bind in every week of the
    window; if this test ever reports zero, that regression is what happened.
    """
    res = run_scenario(_scenario(_starved_plant_network(), model_seeds=1))
    binding = res.capacity_binding
    assert [r["id"] for r in binding["products"]] == ["p1"]
    assert binding["products"][0]["capacity"] == 40.0
    assert binding["products"][0]["bound_weeks"] == binding["window_weeks"]
    assert res.kpis[0]["products_capacity_bound"] == 1.0


def test_a_plant_with_slack_capacity_never_reports_binding():
    # single_chain: capacity 200/wk against demand 100/wk.
    res = run_scenario(_scenario(single_chain_network(), model_seeds=2))
    assert res.capacity_binding["products"] == []
    assert all(r["products_capacity_bound"] == 0.0 for r in res.kpis)
    # …and the utilization is still a number, which is the difference between
    # "capacity did not bind" and "capacity was not measured".
    assert np.isfinite(res.aggregates["capacity_utilization"]["mean"])


def test_capacity_binding_averages_over_every_replication():
    res = run_scenario(_scenario(_starved_plant_network(), model_seeds=3))
    assert res.capacity_binding["replications"] == res.stats.n_replications
    # Deterministic demand ⇒ every replication binds every week, so the mean
    # over replications is exactly the window length.
    assert res.capacity_binding["products"][0]["bound_weeks"] == float(
        res.capacity_binding["window_weeks"]
    )
