"""A run can be stopped from its progress observer (audit 2026-09-22, F-06).

`_notify_progress` swallows every observer exception — a broken observer must
never kill a run — which also made a CANCEL impossible: the only hook the
engine calls between replications could not stop it. `RunCancelled` is the one
exception it re-raises. Anything else is still swallowed.
"""
from __future__ import annotations

import pytest

from scsim import RunCancelled, Scenario
from scsim.core.engine import run_scenario

from .conftest import make_settings, single_chain_network


def _sc() -> Scenario:
    return Scenario(name="c", network=single_chain_network(),
                    settings=make_settings(model_seeds=10))


def test_run_cancelled_from_the_observer_stops_the_run():
    seen = []

    def progress(done, total, row, series):
        seen.append(done)
        if done == 3:
            raise RunCancelled("cancelled by user")

    with pytest.raises(RunCancelled):
        run_scenario(_sc(), progress=progress)
    assert seen == [1, 2, 3]  # no replication ran after the cancel


def test_any_other_observer_error_is_still_swallowed():
    def progress(done, total, row, series):
        raise ValueError("observer bug")

    res = run_scenario(_sc(), progress=progress)
    assert res.stats.n_replications == 10


# ── audit F-13: a sequentially stopped run says so ─────────────────────────

def test_the_result_records_which_stopping_rule_applied():
    from scsim import DisruptionEvent
    from scsim.entities.enums import ReplicationStopping

    fixed = run_scenario(_sc())
    assert fixed.stats.stopping_rule == "fixed"

    seq = Scenario(
        name="s", network=single_chain_network(),
        events=[DisruptionEvent(target_id="s1", start=20, duration=6)],
        settings=make_settings(model_seeds=10,
                               replication_stopping=ReplicationStopping.SEQUENTIAL_CI,
                               ci_halfwidth_target=0.05))
    assert run_scenario(seq).stats.stopping_rule == "sequential_ci"
