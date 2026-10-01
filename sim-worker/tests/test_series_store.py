"""WP 10.6 · §4 D246 — the warm tier of a run's results.

The weekly series of every replication go to ONE zstd Parquet object per run;
the replication rows keep their KPIs; a failed upload keeps the JSONB series, so
the tier can never lose data. And the run row stops dropping the min/max range
the bridge computes.
"""
from __future__ import annotations

import asyncio
import io
import json

import httpx
import pyarrow.parquet as pq

from sim_worker import series_store
from sim_worker.worker import SimWorker, build_run_update


def _reps():
    return [
        {"rep_index": 0, "seed_used": 42, "kpis": {"fill_rate": 0.9, "model_rep": 0.0, "event_rep": 0.0},
         "time_series": {"fill_rate": [0.8, 0.9, 1.0], "on_hand_units": [10.0, 12.5, 11.0]}},
        {"rep_index": 1, "seed_used": 42, "kpis": {"fill_rate": 0.85, "model_rep": 1.0, "event_rep": 0.0},
         "time_series": {"fill_rate": [0.7, 0.95], "on_hand_units": [9.0, 9.5]}},
    ]


def test_parquet_round_trip_is_exact():
    data = series_store.write(_reps())
    back = series_store.read_series(data)
    assert back == {r["rep_index"]: r["time_series"] for r in _reps()}


def test_the_object_is_zstd_long_form_with_the_cell():
    data = series_store.write(_reps())
    meta = pq.ParquetFile(io.BytesIO(data)).metadata
    assert meta.row_group(0).column(0).compression == "ZSTD"
    t = pq.read_table(io.BytesIO(data)).to_pydict()
    assert t["rep_index"] == [0, 0, 0, 1, 1]
    assert t["model_rep"] == [0, 0, 0, 1, 1]
    assert t["week"] == [0, 1, 2, 0, 1]


def test_the_object_is_smaller_than_the_jsonb_it_replaces():
    reps = [
        {"rep_index": i, "kpis": {"model_rep": float(i), "event_rep": 0.0},
         "time_series": {k: [round(0.5 + 0.001 * (w * 7 + i) % 0.5, 5) for w in range(520)]
                         for k in ("fill_rate", "on_hand_units", "fg_units", "backlog_units",
                                   "on_hand_value", "fg_value", "revenue_value")}}
        for i in range(30)
    ]
    jsonb = sum(len(json.dumps(r["time_series"])) for r in reps)
    assert len(series_store.write(reps)) < jsonb


def _worker(handler) -> SimWorker:
    w = SimWorker(redis_url="redis://localhost:6379",
                  supabase_url="https://example.supabase.co", service_role_key="k")
    w._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return w


def test_a_stored_object_strips_the_rows_and_names_itself():
    seen: list[httpx.Request] = []

    def ok(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"Key": "run-results/p/r/series.parquet"})

    patch, rows = asyncio.run(_worker(ok)._store_series("r", "p", _reps()))
    assert seen[0].url.path == "/storage/v1/object/run-results/p/r/series.parquet"
    assert seen[0].headers["x-upsert"] == "true"
    assert series_store.read_series(seen[0].content) == {r["rep_index"]: r["time_series"] for r in _reps()}
    assert patch == {"series_object": "p/r/series.parquet", "series_bytes": len(seen[0].content)}
    assert all(r["time_series"] == {} for r in rows)
    assert [r["kpis"] for r in rows] == [r["kpis"] for r in _reps()]


def test_a_failed_upload_keeps_the_series_in_the_rows():
    def refuse(req: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="storage down")

    def explode(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    for handler in (refuse, explode):
        patch, rows = asyncio.run(_worker(handler)._store_series("r", "p", _reps()))
        assert patch == {}
        assert rows == _reps()


def test_the_run_row_keeps_the_range_the_bridge_computes():
    upd = build_run_update({"source": "scsim", "engine_version": "0.2.8", "mean_fill_rate": 0.9,
                            "ci_fill_rate": 0.01, "min_fill_rate": 0.8, "max_fill_rate": 0.97,
                            "replications": []}, 0)
    assert upd["aggregate_kpis"]["fill_rate"] == 0.9
    assert upd["aggregate_kpis"]["_range"] == {"fill_rate": {"min": 0.8, "max": 0.97}}
