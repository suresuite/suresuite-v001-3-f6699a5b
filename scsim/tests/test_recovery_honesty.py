"""Disruption timing and recovery metrics (audit 2026-09-22, WP 3: F-03/F-04/F-05).

The chain the audit traced: a disruption the user authors at "day 10" maps to
engine week 1; `DisruptionEvent.start` is an ABSOLUTE week (manuscript §3.7 —
t* is absolute, and the auto branch draws it absolute too, from U{t_w..t_w+2});
KPIs are measured over [t_w, …); so the event lay entirely in warm-up. Then
`_ttr_tts` found no pre-disruption weeks, substituted a baseline of 1.0, and
reported the censored window length as a "time to recover".

What these pin:

* a fixed start before t_w is SHIFTED to t_w and COUNTED — never silently
  excluded (the `event_shifts` list reaches `mapping_warnings` in the bridge);
* no row carries a substituted baseline: with no pre-disruption week the three
  recovery measures are ABSENT and `recovery_measurable` is 0;
* a censored measure is not a measurement: `ttr_weeks` is absent when the chain
  never recovered inside the window, and `ttr_censored` says so.
"""
from __future__ import annotations

import numpy as np
import pytest

from scsim import DisruptionEvent
from scsim.core.engine import run_scenario
from scsim.kpi.compute import _ttr_tts
from scsim.disruption.injector import ResolvedEvent

from .conftest import make_settings, single_chain_network
from scsim import Scenario


def _sc(events, **kw) -> Scenario:
    return Scenario(name="t", network=single_chain_network(), events=events,
                    settings=make_settings(**kw))


def _ev(start: int, end: int) -> ResolvedEvent:
    return ResolvedEvent(supplier_idx=0, effect=None, start=start, end=end,
                         capacity_factor=0.0, overflow_rule=None,
                         onset_profile=None, recovery_profile=None, ramp_weeks=0)


# ── F-03: an event before the window is shifted and said, never excluded ──

def test_fixed_start_inside_warmup_is_shifted_to_the_window_and_counted():
    res = run_scenario(_sc([DisruptionEvent(target_id="s1", start=2, duration=14)],
                           warmup_end=10))
    [shift] = res.event_shifts
    assert shift["authored_week"] == 2 and shift["used_week"] == 10
    assert shift["replications"] == res.stats.n_replications
    # it is IN the window now: the undisrupted chain fills 100%, this one does not
    clean = run_scenario(_sc([], warmup_end=10))
    assert res.aggregates["fill_rate"]["mean"] < clean.aggregates["fill_rate"]["mean"]


def test_start_after_warmup_is_left_alone():
    res = run_scenario(_sc([DisruptionEvent(target_id="s1", start=20, duration=6)],
                           warmup_end=10))
    assert res.event_shifts == []


# ── F-04: no substituted baseline ─────────────────────────────────────────

def test_no_pre_window_means_no_baseline_and_no_recovery_measures():
    fr = np.full(60, 0.9)
    m = _ttr_tts(fr, 10, 60, [_ev(10, 16)])  # t* == t_w → no pre-disruption week
    assert m.baseline is None and m.ttr is None and m.tts is None
    assert not m.measurable


def test_no_row_carries_a_substituted_baseline():
    res = run_scenario(_sc([DisruptionEvent(target_id="s1", start=2, duration=6)],
                           warmup_end=10))
    for row in res.kpis:
        assert "pre_disruption_fill_rate" not in row
        assert "ttr_weeks" not in row and "tts_weeks" not in row
        assert row["recovery_measurable"] == 0.0


# ── F-05: censoring survives ──────────────────────────────────────────────

def test_a_censored_recovery_is_flagged_not_averaged():
    fr = np.concatenate([np.full(20, 0.95), np.full(40, 0.5)])  # never recovers
    m = _ttr_tts(fr, 10, 60, [_ev(20, 26)])
    assert m.baseline == pytest.approx(0.95) and m.ttr is None and m.ttr_censored
    assert m.tts == 0.0 and not m.tts_censored


def test_a_recovery_inside_the_window_is_measured():
    fr = np.concatenate([np.full(20, 0.95), np.full(5, 0.5), np.full(35, 0.95)])
    m = _ttr_tts(fr, 10, 60, [_ev(20, 25)])
    assert m.ttr == 5.0 and not m.ttr_censored


def test_never_leaving_the_band_is_ttr_zero_and_tts_censored():
    fr = np.full(60, 0.95)
    m = _ttr_tts(fr, 10, 60, [_ev(20, 25)])
    assert m.ttr == 0.0 and m.tts is None and m.tts_censored


def test_resilience_index_counts_a_censored_recovery_at_the_full_window():
    from scsim.kpi.compute import censored_mean
    rows = [{"recovery_measurable": 1.0, "ttr_weeks": 4.0, "ttr_censored": 0.0},
            {"recovery_measurable": 1.0, "ttr_censored": 1.0},
            {"recovery_measurable": 0.0}]
    assert censored_mean(rows, "ttr_weeks", "ttr_censored", 52.0) == (4.0 + 52.0) / 2
    assert censored_mean([{"recovery_measurable": 0.0}], "ttr_weeks", "ttr_censored", 52.0) is None
