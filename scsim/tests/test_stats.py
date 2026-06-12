"""Statistical engine hard requirements (Part VIII)."""
from __future__ import annotations

import numpy as np
import pytest

from scsim.entities.enums import WarmupMethod
from scsim.stats.bootstrap import bootstrap_mean, t_halfwidth
from scsim.stats.seeds import (
    HAZARD_START,
    hazard_rng,
    policy_key,
    replication_grid,
    world_streams,
)
from scsim.stats.warmup import conway, detect_warmup, mser5


# ----------------------------------------------------------------- seed tree

def test_world_streams_reproducible():
    a = world_streams(42, model_rep=3, event_rep=1).demand.normal(size=5)
    b = world_streams(42, model_rep=3, event_rep=1).demand.normal(size=5)
    assert np.allclose(a, b)


def test_world_streams_independent_across_reps():
    a = world_streams(42, 0, 0).demand.normal(size=5)
    b = world_streams(42, 1, 0).demand.normal(size=5)
    assert not np.allclose(a, b)


def test_world_streams_event_rep_invariant():
    """World streams are keyed by model_rep only — the event axis must not
    perturb demand draws (snapshot reuse + CRN across stress cells)."""
    a = world_streams(42, 2, 0).demand.normal(size=8)
    b = world_streams(42, 2, 5).demand.normal(size=8)
    assert np.allclose(a, b)


def test_policy_streams_keyed_by_policy_id():
    s = world_streams(42, 0, 0)
    x1 = s.policy_rng("backup_supplier").normal(size=4)
    s2 = world_streams(42, 0, 0)
    _ = s2.policy_rng("expedited_shipments").normal(size=100)  # unrelated consumption
    x2 = s2.policy_rng("backup_supplier").normal(size=4)
    assert np.allclose(x1, x2), "policy #22 must not perturb policy #1 (§9.4)"


def test_policy_key_stable():
    assert policy_key("backup_supplier") == policy_key("backup_supplier")
    assert policy_key("a") != policy_key("b")


def test_hazard_streams_keyed_by_event():
    a = hazard_rng(42, event_rep=0, event_index=0, draw_id=HAZARD_START).integers(0, 100, 5)
    b = hazard_rng(42, event_rep=0, event_index=1, draw_id=HAZARD_START).integers(0, 100, 5)
    assert not np.array_equal(a, b)


def test_replication_grid_collapses_for_fixed_events():
    assert len(replication_grid(30, 18, any_stochastic_event=False)) == 30
    assert len(replication_grid(30, 18, any_stochastic_event=True)) == 540


# -------------------------------------------------------------------- warmup

def test_mser5_finds_transient():
    rng = np.random.default_rng(0)
    series = np.concatenate([np.linspace(0.2, 0.95, 40), 0.95 + 0.01 * rng.normal(size=160)])
    cut = mser5(series)
    assert 20 <= cut <= 60


def test_conway_rule():
    series = np.array([0.1, 0.2, 0.5, 0.93, 0.95, 0.94, 0.96, 0.95, 0.94])
    # 0.1/0.2/0.5/0.93 are each still the minimum of their remainder; 0.95 at
    # index 4 is the first value that is neither min nor max of what follows.
    assert conway(series) == 4


def test_most_conservative_takes_later_week():
    rng = np.random.default_rng(1)
    series = np.concatenate([np.linspace(0.0, 0.9, 30), 0.9 + 0.005 * rng.normal(size=170)])
    rep = detect_warmup(series, WarmupMethod.MOST_CONSERVATIVE)
    assert rep.adopted_week == max(rep.conway_week, rep.mser5_week)


# ------------------------------------------------------------------ bootstrap

def test_bootstrap_detects_clear_effect():
    rng = np.random.default_rng(2)
    res = bootstrap_mean(rng.normal(0.5, 0.1, size=30), resamples=2000, seed=7)
    assert res.significant and res.ci_low > 0 and res.stars != ""


def test_bootstrap_null_not_significant():
    rng = np.random.default_rng(3)
    res = bootstrap_mean(rng.normal(0.0, 1.0, size=30), resamples=2000, seed=7)
    assert res.ci_low < 0 < res.ci_high


def test_bootstrap_deterministic_given_seed():
    x = np.random.default_rng(4).normal(size=25)
    r1 = bootstrap_mean(x, resamples=1000, seed=11)
    r2 = bootstrap_mean(x, resamples=1000, seed=11)
    assert (r1.ci_low, r1.ci_high) == (r2.ci_low, r2.ci_high)


def test_t_halfwidth_shrinks_with_n():
    rng = np.random.default_rng(5)
    assert t_halfwidth(rng.normal(size=50)) < t_halfwidth(rng.normal(size=8))
