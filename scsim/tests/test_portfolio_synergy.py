"""Portfolio study under CRN: deltas vs S0, synergy decomposition, §4.6 rules."""
from __future__ import annotations

import numpy as np
import pytest

from scsim import DisruptionEvent, Scenario
from scsim.core.engine import run_portfolio_study
from scsim.policies.registry import check_portfolio
from scsim.synergy import breadth_ladder, decompose

from .conftest import dual_source_network, make_settings


@pytest.fixture(scope="module")
def study():
    sc = Scenario(
        name="study", network=dual_source_network(),
        settings=make_settings(model_seeds=3),
        events=[DisruptionEvent(target_id="s1", start=20, duration=14)],
    )
    return run_portfolio_study(sc, portfolios={
        "S1": {"backup_supplier": {}},
        "S5": {"expedited_shipments": {}},
        "S1+S5": {"backup_supplier": {}, "expedited_shipments": {}},
    }, debug=True)


def test_deltas_are_crn_paired(study):
    for name in ("S1", "S5", "S1+S5"):
        assert len(study.deltas[name]["delta_revenue"]) == len(study.s0.kpis)


def test_strategies_recover_revenue(study):
    assert study.deltas["S1"]["delta_revenue"].mean() > 0.5
    assert study.deltas["S5"]["delta_revenue"].mean() > 0.9  # expedite dominates long outages


def test_sla_positive_under_disruption(study):
    assert study.deltas["S1"]["service_loss_area"].mean() >= 0
    assert study.deltas["S5"]["service_loss_area"].mean() < \
        study.s0.aggregates["fill_rate"]["n"] * 100  # sanity bound


def test_s1_s5_synergy_negative_significant(study):
    """The manuscript's headline submodularity: both strategies fix the same
    inbound gap — combined gain < sum of parts."""
    syn = decompose(study, "S1+S5", ["S1", "S5"])
    assert syn.synergy_revenue.point < 0
    assert syn.synergy_revenue.significant


def test_synergy_requires_same_grid(study):
    with pytest.raises(KeyError):
        decompose(study, "S1+S5", ["S1", "missing"])


def test_breadth_ladder_band(study):
    rows = breadth_ladder(study, [
        ("S1", ["backup_supplier"]),
        ("S1+S5", ["backup_supplier", "expedited_shipments"]),
    ])
    assert rows[0]["in_guidance_band"] is False   # breadth 1 below band
    assert rows[1]["in_guidance_band"] is True    # breadth 2 in band


# ------------------------------------------------- §4.6 composition warnings

def test_breadth_warning_above_band():
    sc = Scenario(
        name="broad", network=dual_source_network(), settings=make_settings(),
        policies={
            "backup_supplier": {},
            "safety_stock_materials": {},
            "short_term_capacity": {},
            "material_allocation": {},
            "expedited_shipments": {},
        },
    )
    codes = {i.code for i in check_portfolio(sc)}
    assert "breadth_above_band" in codes


def test_constraint_overlap_warning():
    sc = Scenario(
        name="overlap", network=dual_source_network(), settings=make_settings(),
        policies={"backup_supplier": {}, "safety_stock_materials": {}},
    )
    issues = check_portfolio(sc)
    assert any(i.code == "constraint_overlap" for i in issues), \
        "two pre-deployed material_availability strategies must warn"
