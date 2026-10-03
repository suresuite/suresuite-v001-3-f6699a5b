# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Planning baseline — what the engine does BEFORE Phase 14 (PLAN.md §24 WP 14.0).

Characterization tests: each assertion pins today's behaviour and names the
work package that will deliberately flip it (design doc
``docs/design/mrp-multi-stage-planning.md`` §1 and its appendix probe 1). A
package that flips one rewrites the assertion and its comment in the same
commit; until then a change here is an unplanned behaviour change.
"""
from __future__ import annotations

import numpy as np

from scsim import Scenario
from scsim.core.context import SimContext
from scsim.core.engine import _initialize_state, compile_scenario
from scsim.core.phases import PhaseId
from scsim.stats.seeds import world_streams

from .conftest import make_settings, single_chain_network


def _run_with_schedule(compiled, edit, record):
    """The engine's own week loop (run_replication) with the pre-drawn world
    schedule edited after it is drawn — appendix probe 1's method."""
    model = compiled.model
    streams = world_streams(model.settings.project_seed, 0, 0)
    ctx = SimContext(model, streams, [], keep_matrices=True, debug=True)
    ctx._params = compiled.params_by_id
    for pol in compiled.policies:
        pol.setup(ctx)
    _initialize_state(compiled, ctx)
    edit(ctx)
    out = []
    for t in range(model.settings.horizon):
        ctx.week = t
        for ph in PhaseId:
            for _prio, _bh, fn in compiled.dispatch[ph]:
                fn(ctx)
        out.append(record(ctx))
    return ctx, np.array(out)


def _step_100_to_150(ctx):
    ctx.demand_schedule[:, 25:] = 150.0


def test_baseline_a_mto_material_demand_ignores_a_demand_step():
    """(a) — FLIPPED BY WP 14.5 (§4 D284 (a) closed).

    Before Phase 14, PH-70's `material_demand` was a compile-time constant for
    MTO: demand stepped 100 → 150 at week 25 and material demand read 100 in
    EVERY week, and every material was ordered from it. It still is for a
    reorder-point material — its levels are sized from the stationary mean, as
    designed. An `mrp` material is ordered from the GROSS REQUIREMENT instead,
    BOMᵀ × planned production, which follows the step from the week it happens.
    """
    sc = Scenario(name="step", network=single_chain_network(),
                  settings=make_settings(horizon=60),
                  policies={"inventory_control": {"policy_type": "mrp"}})
    compiled = compile_scenario(sc)
    ctx, rec = _run_with_schedule(
        compiled, _step_100_to_150,
        lambda c: (float(c.material_demand[0]), float(c.gross_requirements[0, 0])))
    assert np.all(ctx.trace.D[0, 25:] == 150.0)       # the step did happen
    assert np.all(rec[:, 0] == 100.0)                  # the reorder-point basis stays stationary
    assert np.all(rec[25:, 1] == 150.0)                # … and MRP's requirement follows the step
    assert np.all(rec[1:25, 1] == 100.0)


def test_baseline_b_backlog_is_per_product():
    """(b) The backlog is one number per PRODUCT, not per customer row.

    P-C.1's age buckets are ``[n_prods × (horizon + 1)]`` and
    ``ctx.backlog`` is ``[n_prods]`` (§4 D284 (c)). WP 14.3 FLIPS THIS: the
    buckets become per customer × product row; ``ctx.backlog`` stays the
    product sum for every existing reader.
    """
    sc = Scenario(name="bo", network=single_chain_network(),
                  settings=make_settings(horizon=60),
                  policies={"unmet_demand_handling": {"rule": "backorder",
                                                      "backorder_horizon": 3}})
    compiled = compile_scenario(sc)
    ctx, _ = _run_with_schedule(compiled, lambda c: None, lambda c: 0.0)
    buckets = ctx.policy_state["unmet_demand_handling"]["age_buckets"]
    assert buckets.shape == (compiled.model.n_prods, 3 + 1)
    assert ctx.backlog.shape == (compiled.model.n_prods,)
