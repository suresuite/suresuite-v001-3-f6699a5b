"""run_scenario per-replication progress observer: live streaming contract.

The observer exists so callers (the sim-worker) can persist/broadcast each
replication as it finishes. Contract under test:
  * called once per replication with monotone `done` and the planned total,
  * the kpi row and weekly series match what ScenarioResult exposes,
  * a raising observer never affects the run (results byte-identical).
"""
from __future__ import annotations

import numpy as np

from scsim import Scenario
from scsim.core.context import PUBLISHED_SERIES_KEYS
from scsim.core.engine import run_scenario

from .conftest import make_settings, single_chain_network


def _scenario(**settings_kw) -> Scenario:
    return Scenario(
        name="progress", network=single_chain_network(),
        settings=make_settings(model_seeds=3, **settings_kw),
        events=[], policies={},
    )


def _rows_equal(a: dict, b: dict) -> bool:
    """Dict equality with NaN == NaN (KPI rows carry NaN for inert KPIs)."""
    if set(a) != set(b):
        return False
    return all(
        (a[k] == b[k]) or (np.isnan(a[k]) and np.isnan(b[k]))
        for k in a
    )


def test_progress_called_per_replication_with_result_shapes():
    calls: list[tuple[int, int, dict, dict]] = []
    result = run_scenario(
        _scenario(),
        progress=lambda done, total, row, series: calls.append((done, total, row, series)),
    )

    assert [c[0] for c in calls] == [1, 2, 3]
    assert all(c[1] == 3 for c in calls)
    horizon = result.fr_series.shape[1]
    for done, _total, row, series in calls:
        assert "fill_rate" in row
        # The observer carries exactly the declared published set — read from
        # the declaration rather than restated here, so this assertion cannot
        # become a seventh author of the vocabulary (§4 D163).
        assert set(series) == set(PUBLISHED_SERIES_KEYS)
        for arr in series.values():
            assert arr.shape == (horizon,)
    # The streamed rows are the rows the final result reports.
    for i, (_, _, row, series) in enumerate(calls):
        assert _rows_equal(row, result.kpis[i])
        assert np.array_equal(series["fill_rate"], result.fr_series[i])


def test_raising_observer_never_affects_the_run():
    def boom(done, total, row, series):  # noqa: ARG001
        raise RuntimeError("observer bug")

    clean = run_scenario(_scenario())
    observed = run_scenario(_scenario(), progress=boom)
    assert len(observed.kpis) == len(clean.kpis)
    assert all(_rows_equal(a, b) for a, b in zip(observed.kpis, clean.kpis))
    assert np.array_equal(observed.fr_series, clean.fr_series)
