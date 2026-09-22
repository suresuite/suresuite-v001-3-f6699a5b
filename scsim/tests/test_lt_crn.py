"""Stochastic lead times are common random numbers across policies (audit F-24).

`_sample_lt` drew from the world lead-time stream only when an order SHIPPED,
so the number of draws depended on the policy: two scenarios with the same seed
consumed the stream differently after their first differing shipment, and every
later lead time differed for reasons unrelated to the policy under test — while
the Compare panel asserted CRN pairing. The variates are now pre-drawn per
(link, week) from the world stream at replication start, so link k shipping in
week t gets the same variate under every policy.
"""
from __future__ import annotations

import numpy as np

from scsim import Scenario
from scsim.core.engine import compile_scenario, run_replication
from scsim.core.context import SimContext

from .conftest import make_settings, single_chain_network
from scsim.entities.enums import LeadTimeDist


def _net():
    net = single_chain_network(deterministic=False)
    return net.model_copy(update={"supplier_links": [
        l.model_copy(update={"lead_time_dist": LeadTimeDist.LOGNORMAL, "lead_time_cv": 0.5,
                             "lead_time_weeks": 4})
        for l in net.supplier_links]})


def test_the_variate_for_a_link_and_week_does_not_depend_on_the_policy():
    base = Scenario(name="a", network=_net(), settings=make_settings())
    loaded = base.with_policies({"safety_stock_materials": {}})
    c0, c1 = compile_scenario(base), compile_scenario(loaded)
    r0 = run_replication(c0, 0, 0, [])
    r1 = run_replication(c1, 0, 0, [])
    assert np.array_equal(r0.lt_variates, r1.lt_variates)


def test_different_worlds_get_different_variates():
    c = compile_scenario(Scenario(name="a", network=_net(), settings=make_settings()))
    assert not np.array_equal(run_replication(c, 0, 0, []).lt_variates,
                              run_replication(c, 1, 0, []).lt_variates)


def test_the_sampled_lead_time_keeps_its_mean():
    """The re-parameterisation must not move the distribution: the mean of the
    transformed variates over many weeks stays at the link's lead time."""
    from scsim.core.engine import _lt_from_variate
    z = np.random.default_rng(0).standard_normal(200_000)
    xs = np.array([_lt_from_variate(LeadTimeDist.LOGNORMAL, 8.0, 0.5, v, rounded=False) for v in z[:20000]])
    assert abs(xs.mean() - 8.0) < 0.1
    g = np.random.default_rng(1).gamma(1 / 0.25, 1.0, 20000)
    ys = np.array([_lt_from_variate(LeadTimeDist.GAMMA, 8.0, 0.5, v, rounded=False) for v in g])
    assert abs(ys.mean() - 8.0) < 0.1


def test_no_policy_moves_the_lead_time_stream_during_the_run():
    """The property itself: after the run, the world lead-time stream is in the
    SAME state under both policies — which is only true if nothing consumed it
    at ship time, when the two policies ship different orders."""
    # Periodic review ships on different weeks from the default continuous
    # review — the case where ship-time draws consumed the stream differently.
    base = Scenario(name="a", network=_net(), settings=make_settings())
    periodic = base.with_policies({"inventory_control": {"policy_type": "periodic"}})
    r0 = run_replication(compile_scenario(base), 0, 0, [])
    r1 = run_replication(compile_scenario(periodic), 0, 0, [])
    assert r0.trace.demand_value.tobytes() == r1.trace.demand_value.tobytes()
    assert r0.streams.leadtime.bit_generator.state == r1.streams.leadtime.bit_generator.state
