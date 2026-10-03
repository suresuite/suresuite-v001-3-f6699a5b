"""Demand per customer × product row, from the data — PLAN.md §24 WP 14.2.

The tier-2 forecast buckets are already weekly rates (spread at promotion,
decision 7; `supabase/rehearsal/790`). These tests pin the reader's half: the
calendar `forecast_series` lays the buckets on, and that a run computed from a
frozen snapshot (`run_from_snapshots`, the one entry point the worker, the
browser and the package share) draws demand around exactly the uploaded series.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from scsim.io import from_project_data
from sim_worker.datamap import build_project_data, forecast_series
from sim_worker.local import project_data_from_snapshots, run_from_snapshots

ROOT = Path(__file__).resolve().parents[2]
DS = json.loads((ROOT / "scripts" / "example_project" / "dataset.json").read_text())
TABLES = {k: DS[k] for k in ("suppliers", "materials", "products", "bom", "inbound", "outbound")}
SCENARIO = {"horizon_days": 364, "replications": 1, "seed": 7, "crn": True, "warmup_mode": "auto"}


def _bucket(cid, pid, start, end, wq):
    return {"customer_id": cid, "product_id": pid, "period_start": start,
            "period_end": end, "weekly_quantity": wq}


def test_weekly_buckets_become_the_series_week_for_week():
    rows = [_bucket("C1", "P1", f"2026-11-{d:02d}", f"2026-11-{d + 7:02d}", q)
            for d, q in ((2, 60.0), (9, 80.0), (16, 160.0))]
    assert forecast_series(rows) == {("P1", "C1"): [60.0, 80.0, 160.0]}


def test_a_month_is_spread_evenly_and_a_week_across_the_boundary_takes_some_of_each():
    # November (30 d) 1 000 → 233.33/wk; December (31 d) 1 000 → 225.81/wk.
    nov, dec = 1000 * 7 / 30, 1000 * 7 / 31
    rows = [_bucket("C1", "P1", "2026-11-01", "2026-12-01", nov),
            _bucket("C1", "P1", "2026-12-01", "2027-01-01", dec)]
    s = forecast_series(rows)[("P1", "C1")]
    assert len(s) == 61 // 7                       # whole weeks before 1 January
    assert s[0] == pytest.approx(nov)
    # Week 4 is 29 Nov – 5 Dec: two November days and five December days.
    assert s[4] == pytest.approx(nov * 2 / 7 + dec * 5 / 7)
    assert sum(s) == pytest.approx(nov / 7 * 30 + dec / 7 * (8 * 7 - 30))


def test_one_calendar_for_every_row_and_uncovered_days_count_nothing():
    rows = [_bucket("C1", "P1", "2026-11-02", "2026-11-16", 70.0),
            _bucket("C2", "P1", "2026-11-09", "2026-11-16", 35.0)]
    s = forecast_series(rows)
    assert s[("P1", "C1")] == [70.0, 70.0]
    assert s[("P1", "C2")] == [0.0, 35.0]          # week 0 precedes C2's first bucket


def test_build_project_data_carries_the_row_spec_and_the_series():
    outbound = [dict(o) for o in TABLES["outbound"]]
    outbound[0].update(demand_distribution="normal", demand_mean=50.0, demand_variation=0.1)
    data = build_project_data(
        suppliers=TABLES["suppliers"], materials=TABLES["materials"], products=TABLES["products"],
        inbound=TABLES["inbound"], bom=TABLES["bom"], outbound=outbound, policies={}, scenario=SCENARIO,
        project_model="make_to_order",
        demand_forecasts=[_bucket("C1", "P1", "2026-01-05", "2026-01-12", 55.0),
                          _bucket("C7", "P1", "2026-01-05", "2026-01-12", 9.0)],
    )
    arcs = {(a.product_id, a.customer_id): a for a in data.outbound}
    c1 = arcs[("P1", "C1")]
    assert (c1.demand_distribution, c1.demand_mean, c1.demand_variation) == ("normal", 50.0, 0.1)
    assert c1.forecast == [55.0]
    # A forecast for a customer no outbound row names still reaches the run.
    assert arcs[("P1", "C7")].forecast == [9.0] and arcs[("P1", "C7")].volume is None


def _frozen(forecast_rows=None, spec=None):
    tables = copy.deepcopy(TABLES)
    if spec:
        tables["outbound"][0].update(spec)
    if forecast_rows is not None:
        tables["demand_forecasts"] = forecast_rows
    return {"schema_version": 3, "inputs": tables}


def test_a_frozen_run_draws_demand_around_the_uploaded_forecast():
    """`run_from_snapshots` reads the snapshot's `demand_forecasts`: with a
    deterministic row, the run's demand IS the uploaded series."""
    weeks = 60
    series = [40.0 + (w % 4) * 10 for w in range(weeks)]
    from datetime import date, timedelta
    rows = []
    d0 = date(2026, 1, 5)
    for w, q in enumerate(series):
        a, b = d0 + timedelta(days=7 * w), d0 + timedelta(days=7 * w + 7)
        rows.append(_bucket("C1", "P1", a.isoformat(), b.isoformat(), q))
    ds = _frozen(rows, {"demand_distribution": "deterministic"})
    data = project_data_from_snapshots(ds, {"schema_version": 2, "defaults": {}, "overrides": []},
                                       SCENARIO, "make_to_order")
    (link,) = from_project_data(data).scenario.network.customer_links
    assert link.forecast == series and link.demand_model == "deterministic"

    insp = {**SCENARIO, "inspection": True}
    out = run_from_snapshots(ds, {"schema_version": 2, "defaults": {}, "overrides": []}, insp,
                             "make_to_order")
    (prod,) = [r for r in out["item_series"] if r["kind"] == "product" and r["item_id"] == "P1"]
    values = prod["series"]["demand"]
    assert len(values) == 52
    assert values == pytest.approx(series[:52])


def test_a_snapshot_without_the_new_keys_runs_as_before():
    """Snapshots frozen before WP 14.2 have no `demand_forecasts` key: missing
    tables are empty, never invented, and the run is the one it always was."""
    base = run_from_snapshots(_frozen(), {"schema_version": 2, "defaults": {}, "overrides": []},
                              SCENARIO, "make_to_order")
    empty = run_from_snapshots(_frozen([]), {"schema_version": 2, "defaults": {}, "overrides": []},
                               SCENARIO, "make_to_order")
    assert base["kpis"]["mean_fill_rate"] == empty["kpis"]["mean_fill_rate"]
    assert base["series"] == empty["series"]
