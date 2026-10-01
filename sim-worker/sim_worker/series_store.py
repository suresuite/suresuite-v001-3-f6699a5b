"""The warm tier of a run's results — Phase 10 / WP 10.6 · §4 D246.

A run's weekly per-replication series used to live in Postgres as JSONB on every
`run_replications` row, forever, and travelled through realtime with the row.
They now go to ONE object per run in the private `run-results` bucket, as
zstd-compressed Parquet in long form — one row per (replication, week), one
float column per series — and the replication rows keep only their KPIs, with
`simulation_runs.series_object` pointing at the object.

The column vocabulary is not restated here: it is whatever keys the bridge put
in each replication's `time_series`, which is scsim's `WEEKLY_SERIES` (the
published subset) — `scsim/scsim/io/traces.py` writes the same frame per
replication for the engine's own traces. This module only changes WHERE the
series are kept, and `read_series` gives back exactly what `write` was handed.

pyarrow is a worker dependency, not a browser one: the Pyodide engine keeps
writing JSONB (it has no pyarrow), and `available()` is how the worker decides.
"""
from __future__ import annotations

import io
from typing import Any

try:
    import pyarrow as pa
    import pyarrow.parquet as pq

    _HAS_PYARROW = True
except ImportError:  # pragma: no cover — exercised by the fallback test
    _HAS_PYARROW = False

#: The bucket and the object layout. A path names its project first, so a
#: project delete can sweep its prefix.
BUCKET = "run-results"


def available() -> bool:
    return _HAS_PYARROW


def object_path(project_id: str, run_id: str) -> str:
    return f"{project_id}/{run_id}/series.parquet"


def series_keys(reps: list[dict[str, Any]]) -> list[str]:
    """Every series key any replication carries, in first-seen order."""
    seen: dict[str, None] = {}
    for r in reps:
        for k in (r.get("time_series") or {}):
            seen.setdefault(k, None)
    return list(seen)


def write(reps: list[dict[str, Any]]) -> bytes:
    """One run's replications → zstd Parquet bytes (long form).

    Columns: ``rep_index``, ``model_rep``, ``event_rep``, ``week``, then one
    float64 column per series. A replication missing a series (or shorter than
    the longest) contributes nulls there — absent stays absent."""
    if not _HAS_PYARROW:
        raise RuntimeError("pyarrow is not installed")
    keys = series_keys(reps)
    rep_col: list[int] = []
    model_col: list[int | None] = []
    event_col: list[int | None] = []
    week_col: list[int] = []
    cols: dict[str, list[float | None]] = {k: [] for k in keys}
    for r in reps:
        ts = r.get("time_series") or {}
        weeks = max((len(v) for v in ts.values() if isinstance(v, list)), default=0)
        kp = r.get("kpis") or {}
        for w in range(weeks):
            rep_col.append(int(r["rep_index"]))
            model_col.append(_int_or_none(kp.get("model_rep")))
            event_col.append(_int_or_none(kp.get("event_rep")))
            week_col.append(w)
            for k in keys:
                v = ts.get(k)
                cols[k].append(float(v[w]) if isinstance(v, list) and w < len(v) and v[w] is not None else None)
    table = pa.table({
        "rep_index": pa.array(rep_col, pa.int32()),
        "model_rep": pa.array(model_col, pa.int32()),
        "event_rep": pa.array(event_col, pa.int32()),
        "week": pa.array(week_col, pa.int32()),
        **{k: pa.array(v, pa.float64()) for k, v in cols.items()},
    })
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd")
    return buf.getvalue()


def read_series(data: bytes) -> dict[int, dict[str, list[float | None]]]:
    """The inverse: rep_index → {series key → weekly values}."""
    if not _HAS_PYARROW:
        raise RuntimeError("pyarrow is not installed")
    t = pq.read_table(io.BytesIO(data)).to_pydict()
    keys = [k for k in t if k not in ("rep_index", "model_rep", "event_rep", "week")]
    out: dict[int, dict[str, list[float | None]]] = {}
    for i, rep in enumerate(t["rep_index"]):
        series = out.setdefault(int(rep), {k: [] for k in keys})
        for k in keys:
            series[k].append(t[k][i])
    # A key a replication never carried reads back as all-null — drop it, so the
    # round trip returns exactly the dict the bridge produced.
    for rep, series in out.items():
        out[rep] = {k: v for k, v in series.items() if any(x is not None for x in v)}
    return out


def _int_or_none(v: Any) -> int | None:
    try:
        return None if v is None else int(v)
    except (TypeError, ValueError):
        return None
