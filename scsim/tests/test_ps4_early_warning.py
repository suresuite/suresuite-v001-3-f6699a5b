"""P-S.4 early_warning_failover (M7 / Phase A).

Monitoring compresses the disruption-start → firm-knows lag served by
ctx.events_visible(), so reactive policies (P-S.1 here) engage earlier.
The world's physics never change — only when the firm learns about them.
"""
from __future__ import annotations

import pytest

from scsim import DisruptionEvent, Scenario
from scsim.core.engine import run_scenario
from scsim.policies.registry import check_portfolio, get_entry, instantiate

from .conftest import dual_source_network, make_settings


def scenario(events=None, policies=None, **settings_kw) -> Scenario:
    return Scenario(
        name="t", network=dual_source_network(),
        settings=make_settings(**settings_kw),
        events=events or [], policies=policies or {},
    )


OUTAGE = dict(target_id="s1", start=20, duration=14)

# A thin material buffer (κ=2 flat) makes response time bind: the default
# 8-week cover exceeds any lag+backup-lead-time sum, hiding detection speed.
THIN_BUFFER = {"coverage_weeks": {"nominal": 2, "alert": 2, "crisis": 2}}


def test_registered_as_implemented():
    entry = get_entry("early_warning_failover")
    assert entry.plugin_cls is not None
    assert entry.catalog_ref == "P-S.4"
    instantiate("early_warning_failover", {"detection_lag_weeks": 0})


def test_warning_compresses_detection_and_reduces_loss():
    """World lag 4w: blind firm reroutes 4 weeks late; monitored firm (lag 0)
    reroutes immediately — strictly less loss, same physics."""
    blind = run_scenario(scenario(
        events=[DisruptionEvent(**OUTAGE)],
        policies={"backup_supplier": {}, "inventory_control": THIN_BUFFER},
        detection_lag_weeks=4,
    ), debug=True)
    monitored = run_scenario(scenario(
        events=[DisruptionEvent(**OUTAGE)],
        policies={"backup_supplier": {}, "inventory_control": THIN_BUFFER,
                  "early_warning_failover": {"detection_lag_weeks": 0}},
        detection_lag_weeks=4,
    ), debug=True)
    assert monitored.aggregates["lost_sales_value"]["mean"] < \
        blind.aggregates["lost_sales_value"]["mean"]


def test_monitored_lag_never_exceeds_world_lag():
    """A monitored lag ABOVE the scenario's lag must not delay detection:
    effective lag = min(monitored, world) ⇒ results equal the unmonitored run
    (up to the standing monitoring cost, zero here)."""
    base = run_scenario(scenario(
        events=[DisruptionEvent(**OUTAGE)],
        policies={"backup_supplier": {}, "inventory_control": THIN_BUFFER},
        detection_lag_weeks=1,
    ), debug=True)
    worse_monitor = run_scenario(scenario(
        events=[DisruptionEvent(**OUTAGE)],
        policies={"backup_supplier": {}, "inventory_control": THIN_BUFFER,
                  "early_warning_failover": {"detection_lag_weeks": 4}},
        detection_lag_weeks=1,
    ), debug=True)
    assert worse_monitor.aggregates["lost_sales_value"]["mean"] == \
        pytest.approx(base.aggregates["lost_sales_value"]["mean"])


def test_monitoring_cost_is_standing():
    """The €/yr fee lands in C^res weekly, disruption or not."""
    quiet = run_scenario(scenario(
        policies={"backup_supplier": {},
                  "early_warning_failover": {"detection_lag_weeks": 0,
                                             "monitoring_cost": 5200.0}},
        detection_lag_weeks=2,
    ), debug=True)
    free = run_scenario(scenario(
        policies={"backup_supplier": {},
                  "early_warning_failover": {"detection_lag_weeks": 0}},
        detection_lag_weeks=2,
    ), debug=True)
    delta = quiet.aggregates["cost_of_resilience"]["mean"] - \
        free.aggregates["cost_of_resilience"]["mean"]
    assert delta > 0.0


def test_feasibility_warnings():
    # No lag to compress: monitored lag ≥ world lag (default world lag is 0).
    sc = scenario(policies={"backup_supplier": {},
                            "early_warning_failover": {"detection_lag_weeks": 1}})
    codes = {i.code for i in check_portfolio(sc)}
    assert "no_lag_to_compress" in codes
    # No knowledge consumer enabled.
    sc = scenario(policies={"early_warning_failover": {"detection_lag_weeks": 0}},
                  detection_lag_weeks=2)
    codes = {i.code for i in check_portfolio(sc)}
    assert "no_knowledge_consumer" in codes
