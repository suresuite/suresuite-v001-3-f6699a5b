"""Replication traces — Part X §10.2.6.

One file per replication, Parquet (zstd) when pyarrow is available, CSV
fallback otherwise. Verbosity levels {kpi_only, weekly, full_debug} are
decided upstream (SimulationSettings.trace_verbosity): kpi_only writes
nothing here, weekly writes the scalar columns, full_debug additionally
embeds per-product matrices in long form.

Golden traces (Part VIII §5) are frozen through ``trace_frame`` — the same
deterministic column order byte-for-byte across runs.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from scsim.core.context import COST_COMPONENTS, SimContext

try:  # optional dependency (scsim[io])
    import pyarrow as pa
    import pyarrow.parquet as pq

    HAS_PYARROW = True
except ImportError:  # pragma: no cover
    HAS_PYARROW = False


def trace_frame(ctx: SimContext) -> dict[str, np.ndarray]:
    """Weekly scalar columns in deterministic order (golden-trace contract)."""
    tr = ctx.trace
    T = tr.horizon
    cols: dict[str, np.ndarray] = {
        "week": np.arange(T, dtype=np.int64),
        "demand_value": tr.demand_value,
        "fulfilled_value": tr.fulfilled_value,
        "revenue_value": tr.revenue_value,
        "lost_value": tr.lost_value,
        "lost_units": tr.lost_units,
        "backlog_units": tr.backlog_units,
        "fill_rate": tr.fill_rate,
        "inbound_rejected": tr.inbound_rejected,
        "on_hand_value": tr.on_hand_value,
    }
    for i, name in enumerate(COST_COMPONENTS):
        cols[f"cost_{name}"] = ctx.cost.weekly[i]
    return cols


def write_trace(ctx: SimContext, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    cols = trace_frame(ctx)
    if HAS_PYARROW and path.suffix == ".parquet":
        table = pa.table({k: pa.array(v) for k, v in cols.items()})
        pq.write_table(table, path, compression="zstd")
        return path
    if path.suffix == ".parquet":
        path = path.with_suffix(".csv")
    header = ",".join(cols)
    matrix = np.column_stack(list(cols.values()))
    np.savetxt(path, matrix, delimiter=",", header=header, comments="", fmt="%.10g")
    return path
