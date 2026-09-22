"""Inventory over time (G19 / WP 9.1) — the weekly inventory series, and the
identities that tie them to the per-item evidence.

The point of these tests is that the aggregate chart a user reads and the
per-item explorer beside it are THE SAME NUMBER at two levels of detail. Before
`WEEKLY_SERIES` existed, "which weekly series exist" was authored in six places
and `fg_value` — finished-goods inventory, computed on every replication since
the trace was written — fell into the gap between two of them and was never
published (§4 D163).
"""
from __future__ import annotations

import numpy as np

from scsim.core.context import PUBLISHED_SERIES_KEYS, WEEKLY_SERIES
from scsim.core.engine import compile_scenario, run_scenario
from scsim.entities.enums import TraceVerbosity
from scsim.entities.scenario import Scenario

from .conftest import bom_blocked_network, make_settings, single_chain_network
from .test_mts_mode import mts_chain


def _scenario(net, **settings_kw) -> Scenario:
    return Scenario(name="t", network=net, settings=make_settings(**settings_kw),
                    events=[], policies={})


def test_result_delivers_exactly_the_declared_published_series():
    """The declaration is the contract at the result boundary, not a comment."""
    res = run_scenario(_scenario(single_chain_network(), model_seeds=2))
    delivered = set(res.extra_series) | {"fill_rate"}
    assert delivered == set(PUBLISHED_SERIES_KEYS)
    # `fill_rate` travels as `fr_series`, so it must NOT also be an extra.
    assert "fill_rate" not in res.extra_series


def test_inventory_series_exist_on_ordinary_multi_rep_runs():
    """The property that makes the chart usable.

    The per-item matrices need `FULL_DEBUG` and exactly one replication, so
    they are absent from every run a user actually makes. These four are plain
    scalars: they are present at ordinary verbosity, on every replication.
    """
    sc = _scenario(single_chain_network(), model_seeds=3)
    res = run_scenario(sc)
    assert res.item_series is None  # not an inspection run
    for key in ("on_hand_value", "fg_value", "on_hand_units", "fg_units"):
        series = res.extra_series[key]
        assert series.shape == (3, sc.settings.horizon), key
        assert np.isfinite(series).all(), key


def test_on_hand_units_is_the_unweighted_sum_of_the_per_item_matrix():
    """Units aggregate ← per-material evidence, exactly.

    The companion identity for VALUE (`Σ on_hand × cost == on_hand_value`) is
    asserted in test_item_series.py; this is the same reconciliation one weight
    down, and together they say the two levels of detail cannot drift.
    """
    sc = _scenario(bom_blocked_network(), model_seeds=1,
                   trace_verbosity=TraceVerbosity.FULL_DEBUG)
    res = run_scenario(sc)
    per_item_total = res.item_series["material.on_hand"].sum(axis=0)
    assert np.allclose(per_item_total, res.extra_series["on_hand_units"][0])


def test_fg_value_is_fg_units_valued_at_cogs():
    """Finished-goods inventory: the series that was measured and discarded.

    There is no per-product on-hand MATRIX in the trace — the product-side
    matrices are demand/production/fulfillment/backlog/lost — so finished goods
    cannot be reconciled against per-item evidence the way materials can. What
    can be checked is that the two finished-goods series are the same stock in
    two denominations, and that an MTS product genuinely holds stock, so this
    is not a pair of zeroes agreeing with each other.
    """
    sc = _scenario(mts_chain(), model_seeds=1)
    compiled = compile_scenario(sc)
    res = run_scenario(sc, compiled=compiled)
    fg_units = res.extra_series["fg_units"][0]
    fg_value = res.extra_series["fg_value"][0]
    cogs = float(compiled.model.fg_unit_cogs[0])  # single-product fixture
    assert cogs > 0
    assert np.allclose(fg_value, fg_units * cogs)
    assert (fg_units > 0).any(), "an MTS product should hold finished goods"


def test_mto_holds_no_finished_goods():
    """The other half of the claim — the series tracks the mode, not a constant."""
    res = run_scenario(_scenario(single_chain_network(), model_seeds=1))
    assert np.allclose(res.extra_series["fg_units"][0], 0.0)
    assert np.allclose(res.extra_series["fg_value"][0], 0.0)


def test_declaration_is_internally_coherent():
    """Cheap guards on the vocabulary itself, since everything now derives from it."""
    keys = [s.key for s in WEEKLY_SERIES]
    assert len(keys) == len(set(keys)), "duplicate series key"
    for s in WEEKLY_SERIES:
        assert s.aggregation in {"level", "flow", "ratio"}, s.key
        assert s.unit and s.doc, s.key
    # Inventory is a stock: a reader that sums it across weeks counts the same
    # goods repeatedly, so the declaration must keep saying so.
    by_key = {s.key: s for s in WEEKLY_SERIES}
    for key in ("on_hand_value", "fg_value", "on_hand_units", "fg_units"):
        assert by_key[key].aggregation == "level", key
        assert by_key[key].published, key


def test_raising_the_trace_does_not_change_inventory_series():
    """Behaviour-neutral, the Tier-2 guarantee the inspection surface also holds."""
    base = run_scenario(_scenario(single_chain_network(), model_seeds=1))
    insp = run_scenario(_scenario(single_chain_network(), model_seeds=1,
                                  trace_verbosity=TraceVerbosity.FULL_DEBUG))
    for key in ("on_hand_value", "fg_value", "on_hand_units", "fg_units"):
        assert np.array_equal(base.extra_series[key], insp.extra_series[key]), key
