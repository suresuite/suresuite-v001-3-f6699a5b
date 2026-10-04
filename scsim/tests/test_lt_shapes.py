# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Supplier lead-time shapes chosen like demand — PLAN.md §26 WP 16.1 (P-S.6).

normal (mean + CV, raised to 1 week and counted), triangular (min, mode, max)
and uniform (min, max) join deterministic / lognormal / gamma. Their variates
are standard uniforms pre-drawn per (lane, week) from a NEW world stream keyed
per lane, so (a) the lognormal/gamma draws stay bit-identical, (b) two policy
sets on one seed see the same draws, and (c) a lane's draws do not depend on
which supplier a policy made primary.
"""
from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from scsim import Scenario
from scsim.core.engine import compile_scenario, run_replication, run_scenario
from scsim.core.leadtime import from_variate
from scsim.entities.enums import LeadTimeDist
from scsim.entities.network import (
    SupplierLink,
    lead_time_bounds_cv,
    lead_time_bounds_mean,
)

from .conftest import dual_source_network, make_settings, single_chain_network


def _with_link(net, **upd):
    return net.model_copy(update={"supplier_links": [
        l.model_copy(update=upd) for l in net.supplier_links]})


def _trace_bytes(ctx) -> bytes:
    tr = ctx.trace
    return b"".join(v.tobytes() for k, v in sorted(vars(tr).items())
                    if isinstance(v, np.ndarray))


# ── the inverse CDFs ─────────────────────────────────────────────────────────

U = np.random.default_rng(123).random(200_000)


@pytest.mark.parametrize("cv", [0.1, 0.3])
def test_normal_has_its_mean_and_cv(cv):
    xs = np.array([from_variate(LeadTimeDist.NORMAL, 8.0, cv, u, rounded=False) for u in U[:40_000]])
    assert abs(xs.mean() - 8.0) < 0.05
    assert abs(xs.std() / xs.mean() - cv) < 0.01


def test_triangular_has_its_moments():
    lo, mo, hi = 2.0, 4.0, 9.0
    xs = np.array([from_variate(LeadTimeDist.TRIANGULAR, 5, 0.0, u, lo=lo, mode=mo, hi=hi,
                                nominal=5, rounded=False) for u in U[:40_000]])
    mean = lead_time_bounds_mean(LeadTimeDist.TRIANGULAR, lo, mo, hi)
    var = (lo**2 + mo**2 + hi**2 - lo * mo - lo * hi - mo * hi) / 18.0
    assert abs(xs.mean() - mean) < 0.03
    assert abs(xs.var() - var) / var < 0.03
    assert xs.min() >= lo and xs.max() <= hi
    assert abs(lead_time_bounds_cv(LeadTimeDist.TRIANGULAR, lo, mo, hi) - np.sqrt(var) / mean) < 1e-12


def test_uniform_has_its_moments():
    xs = np.array([from_variate(LeadTimeDist.UNIFORM, 6, 0.0, u, lo=3.0, hi=9.0, nominal=6,
                                rounded=False) for u in U[:40_000]])
    assert abs(xs.mean() - 6.0) < 0.03
    assert abs(xs.var() - 36.0 / 12.0) / 3.0 < 0.03


def test_an_expedited_shipment_scales_a_bounded_draw_by_its_own_mean():
    # A policy that halves this shipment's lead time halves the draw.
    full = from_variate(LeadTimeDist.TRIANGULAR, 6, 0.0, 0.7, lo=3, mode=6, hi=9, nominal=6,
                        rounded=False)
    half = from_variate(LeadTimeDist.TRIANGULAR, 3, 0.0, 0.7, lo=3, mode=6, hi=9, nominal=6,
                        rounded=False)
    assert half == pytest.approx(full / 2)


# ── validation ───────────────────────────────────────────────────────────────

def _link(**kw):
    base = dict(supplier_id="s", material_id="m", cost=1.0, lead_time_weeks=4)
    base.update(kw)
    return SupplierLink(**base)


def test_bounded_shapes_validate_their_bounds():
    _link(lead_time_dist="triangular", lead_time_min_weeks=2, lead_time_mode_weeks=4,
          lead_time_max_weeks=6)
    _link(lead_time_dist="uniform", lead_time_min_weeks=2, lead_time_max_weeks=6)
    with pytest.raises(ValidationError, match="min ≤ mode ≤ max"):
        _link(lead_time_dist="triangular", lead_time_min_weeks=5, lead_time_mode_weeks=4,
              lead_time_max_weeks=6)
    with pytest.raises(ValidationError, match="needs min, mode and max"):
        _link(lead_time_dist="triangular", lead_time_min_weeks=2, lead_time_max_weeks=6)
    with pytest.raises(ValidationError, match="min ≤ max"):
        _link(lead_time_dist="uniform", lead_time_min_weeks=7, lead_time_max_weeks=6)
    with pytest.raises(ValidationError, match="triangular and uniform only"):
        _link(lead_time_dist="normal", lead_time_cv=0.2, lead_time_min_weeks=2)
    with pytest.raises(ValidationError, match="outside the lead-time bounds"):
        _link(lead_time_weeks=12, lead_time_dist="uniform", lead_time_min_weeks=2,
              lead_time_max_weeks=6)


def test_empirical_still_hard_errors_at_compile():
    from scsim.core.engine import CompileError
    net = _with_link(single_chain_network(), lead_time_dist=LeadTimeDist.EMPIRICAL, lead_time_cv=0.2)
    with pytest.raises(CompileError, match="empirical"):
        compile_scenario(Scenario(name="e", network=net, settings=make_settings()))


# ── behaviour in a run ───────────────────────────────────────────────────────

def test_triangular_with_min_eq_max_equals_deterministic():
    det = single_chain_network(deterministic=False)
    tri = _with_link(det, lead_time_dist=LeadTimeDist.TRIANGULAR, lead_time_min_weeks=2,
                     lead_time_mode_weeks=2, lead_time_max_weeks=2)
    for rep in (0, 1):
        a = run_replication(compile_scenario(Scenario(name="d", network=det, settings=make_settings())), rep, 0, [])
        b = run_replication(compile_scenario(Scenario(name="t", network=tri, settings=make_settings())), rep, 0, [])
        assert _trace_bytes(a) == _trace_bytes(b)


def test_a_cv_shape_with_zero_cv_equals_deterministic():
    det = single_chain_network(deterministic=False)
    nrm = _with_link(det, lead_time_dist=LeadTimeDist.NORMAL, lead_time_cv=0.0)
    a = run_replication(compile_scenario(Scenario(name="d", network=det, settings=make_settings())), 0, 0, [])
    b = run_replication(compile_scenario(Scenario(name="n", network=nrm, settings=make_settings())), 0, 0, [])
    assert _trace_bytes(a) == _trace_bytes(b)


@pytest.mark.parametrize("upd", [
    dict(lead_time_dist=LeadTimeDist.NORMAL, lead_time_cv=0.4, lead_time_weeks=4),
    dict(lead_time_dist=LeadTimeDist.TRIANGULAR, lead_time_min_weeks=2, lead_time_mode_weeks=3,
         lead_time_max_weeks=7, lead_time_weeks=4),
    dict(lead_time_dist=LeadTimeDist.UNIFORM, lead_time_min_weeks=2, lead_time_max_weeks=6,
         lead_time_weeks=4),
])
def test_two_policy_sets_on_one_seed_see_identical_lead_time_draws(upd):
    net = _with_link(single_chain_network(deterministic=False), **upd)
    base = Scenario(name="a", network=net, settings=make_settings())
    periodic = base.with_policies({"inventory_control": {"policy_type": "periodic"},
                                   "safety_stock_materials": {}})
    r0 = run_replication(compile_scenario(base), 0, 0, [])
    r1 = run_replication(compile_scenario(periodic), 0, 0, [])
    assert r0.lt_variates.any()
    assert np.array_equal(r0.lt_variates, r1.lt_variates)
    # …and the old world lead-time stream is not touched by the new shapes.
    assert r0.streams.leadtime.bit_generator.state == r1.streams.leadtime.bit_generator.state


def test_a_lanes_draws_do_not_depend_on_which_supplier_is_primary():
    net = dual_source_network()
    shaped = net.model_copy(update={"supplier_links": [
        net.supplier_links[0].model_copy(update=dict(
            lead_time_dist=LeadTimeDist.TRIANGULAR, lead_time_min_weeks=1,
            lead_time_mode_weeks=2, lead_time_max_weeks=3)),
        net.supplier_links[1].model_copy(update=dict(
            lead_time_dist=LeadTimeDist.UNIFORM, lead_time_min_weeks=2, lead_time_max_weeks=4)),
    ]})
    flipped = shaped.model_copy(update={"supplier_links": [
        shaped.supplier_links[0],
        shaped.supplier_links[1].model_copy(update={"primary": True}),
    ]})

    def by_lane(network):
        c = compile_scenario(Scenario(name="x", network=network, settings=make_settings()))
        ctx = run_replication(c, 0, 0, [])
        m = c.model
        return {(m.sup_ids[m.link_sup[k]], m.mat_ids[m.link_mat[k]]): ctx.lt_variates[k]
                for k in range(m.n_links)}

    a, b = by_lane(shaped), by_lane(flipped)
    assert a.keys() == b.keys()
    for lane in a:
        assert np.array_equal(a[lane], b[lane]), lane


def test_lognormal_draws_are_unchanged_by_a_shaped_lane_beside_them():
    """The old stream's consumption order is untouched: adding a triangular lane
    beside a lognormal one leaves the lognormal lane's variates bit-identical."""
    net = dual_source_network()
    ln = net.model_copy(update={"supplier_links": [
        net.supplier_links[0].model_copy(update=dict(lead_time_dist=LeadTimeDist.LOGNORMAL,
                                                     lead_time_cv=0.5)),
        net.supplier_links[1],
    ]})
    both = ln.model_copy(update={"supplier_links": [
        ln.supplier_links[0],
        ln.supplier_links[1].model_copy(update=dict(
            lead_time_dist=LeadTimeDist.TRIANGULAR, lead_time_min_weeks=2,
            lead_time_mode_weeks=3, lead_time_max_weeks=4)),
    ]})
    ca = compile_scenario(Scenario(name="a", network=ln, settings=make_settings()))
    cb = compile_scenario(Scenario(name="b", network=both, settings=make_settings()))
    a = run_replication(ca, 0, 0, [])
    b = run_replication(cb, 0, 0, [])
    k = 0  # s1 is the cheaper, primary link: first in link order in both
    assert ca.model.sup_ids[ca.model.link_sup[k]] == "s1"
    assert np.array_equal(a.lt_variates[k], b.lt_variates[k])


def test_normal_floor_raises_are_counted_and_reported():
    net = _with_link(single_chain_network(deterministic=False),
                     lead_time_dist=LeadTimeDist.NORMAL, lead_time_cv=1.0, lead_time_weeks=1)
    res = run_scenario(Scenario(name="n", network=net, settings=make_settings()))
    [row] = res.lead_time_floor_raises
    assert row["supplier_id"] == "s1" and row["draws"] > 0
    calm = _with_link(single_chain_network(deterministic=False),
                      lead_time_dist=LeadTimeDist.NORMAL, lead_time_cv=0.05, lead_time_weeks=6)
    assert run_scenario(Scenario(name="c", network=calm, settings=make_settings())).lead_time_floor_raises == []


def test_a_bounded_lane_feeds_king_its_shape_cv():
    net = _with_link(single_chain_network(), lead_time_dist=LeadTimeDist.UNIFORM,
                     lead_time_min_weeks=2, lead_time_max_weeks=6, lead_time_weeks=4)
    m = compile_scenario(Scenario(name="u", network=net, settings=make_settings())).model
    assert m.link_lt_cv[0] == pytest.approx(np.sqrt(16 / 12) / 4)
    assert bool(m.link_lt_stochastic[0])
