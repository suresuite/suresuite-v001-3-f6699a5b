"""Per-replication KPI extraction + the Resilience Index (Part V).

All KPIs are computed over the analysis window [t_w, window_end). TTR/TTS
use the replication's own pre-disruption fill-rate band (baseline − 2 pp by
default); SLA and the deltas are study-level (CRN-paired) and live in
``core.engine.run_portfolio_study`` / ``stress``.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from scsim.core.context import COST_COMPONENTS, ResolvedEvent, SimContext

FR_BAND_PP = 0.02          # band half-width below the pre-disruption baseline
TTR_SUSTAIN_WEEKS = 3      # recovery must hold this long


def compute_replication_kpis(
    ctx: SimContext,
    t_w: int,
    window_end: int,
    events: list[ResolvedEvent],
) -> dict[str, float]:
    tr = ctx.trace
    w = slice(t_w, window_end)
    window_len = window_end - t_w

    demand_value = float(tr.demand_value[w].sum())
    fulfilled_value = float(tr.fulfilled_value[w].sum())
    produced_value = float(tr.revenue_value[w].sum())
    fill_rate = fulfilled_value / demand_value if demand_value > 0 else 1.0

    costs = ctx.cost.total_by_component(t_w, window_end)
    c_res = float(sum(costs.values()))

    row: dict[str, float] = {
        "fill_rate": fill_rate,
        "demand_value": demand_value,
        "produced_value": produced_value,
        "revenue": produced_value,
        "lost_sales_value": float(tr.lost_value[w].sum()),
        "lost_units": float(tr.lost_units[w].sum()),
        "max_backlog": float(tr.backlog_units[w].max()) if window_len else 0.0,
        "lost_inbound_units": float(tr.inbound_rejected[w].sum()),
        # Inventory is a `level` in WEEKLY_SERIES, so the window aggregate is a
        # MEAN — summing a stock over weeks counts the same goods repeatedly.
        "avg_on_hand_value": float(tr.on_hand_value[w].mean()) if window_len else 0.0,
        "avg_fg_value": float(tr.fg_value[w].mean()) if window_len else 0.0,
        "avg_on_hand_units": float(tr.on_hand_units[w].mean()) if window_len else 0.0,
        "avg_fg_units": float(tr.fg_units[w].mean()) if window_len else 0.0,
        "capacity_utilization": _utilization(ctx, t_w, window_end),
        "supplier_capacity_utilization": _supplier_utilization(ctx, t_w, window_end),
        # HOW MANY entities the capacity actually held back, over the window.
        # A utilization near 1.0 and a binding count of zero is a plant running
        # hot and coping; a binding count above zero is demand the capacity
        # refused, which is a different decision.
        "products_capacity_bound": float(
            (ctx.trace.prod_cap_bound[:, w].sum(axis=1) > 0).sum()
        ),
        "suppliers_capacity_bound": float(
            (ctx.trace.sup_cap_bound[:, w].sum(axis=1) > 0).sum()
        ),
        "cost_of_resilience": c_res,
    }
    for name in COST_COMPONENTS:
        row[f"cost_{name}"] = costs[name]

    if events:
        ttr, tts, baseline = _ttr_tts(tr.fill_rate, t_w, window_end, events)
        row["ttr_weeks"] = ttr
        row["tts_weeks"] = tts
        row["pre_disruption_fill_rate"] = baseline
    return row


def _utilization(ctx: SimContext, t_w: int, window_end: int) -> float:
    """Plant capacity utilization over the window — Σ produced / Σ available.

    ── THIS WAS NaN ON EVERY RUN A USER EVER MADE (§4 D167) ──────────────────

    It read ``ctx.trace.Q``, the per-product production matrix, which exists
    only under ``trace_verbosity=full_debug``. Every ordinary Monte Carlo run
    allocates no matrices, so this returned NaN, the bridge mapped NaN to null,
    and the /policies sanity panel printed **"not recorded"** — for the one
    quantity the engine clips production against in every week of every
    replication. §4 D113 removed a per-node utilization heatmap and told the
    reader the run-level measure survived "in the table above"; it did not.

    It is computed from the two weekly scalars now, so it is measured on every
    run. The aggregation is the one ``WeeklySeries`` declares for a ratio:
    the quotient of the summed parts, not the mean of the weekly quotients —
    the old form weighted a week that produced nothing exactly as heavily as
    the week the plant ran flat out.
    """
    tr = ctx.trace
    avail = float(tr.plant_capacity_units[t_w:window_end].sum())
    if avail <= 0:
        return float("nan")  # no capacity offered in the window: not measurable
    return float(tr.plant_capacity_used_units[t_w:window_end].sum()) / avail


def _supplier_utilization(ctx: SimContext, t_w: int, window_end: int) -> float:
    """Shipping utilization of the suppliers that declare a FINITE capacity.

    NaN — not 0.0 — when no supplier declares one, because that is the answer:
    an empty ``suppliers.capacity_per_week`` means unlimited, and there is no
    denominator to divide by. Reporting 0% would say the suppliers were idle;
    reporting 100% would say they were the constraint. Both are inventions.
    """
    tr = ctx.trace
    avail = float(tr.supplier_capacity_units[t_w:window_end].sum())
    if avail <= 0:
        return float("nan")
    return float(tr.supplier_capacity_used_units[t_w:window_end].sum()) / avail


def _ttr_tts(
    fr: np.ndarray, t_w: int, window_end: int, events: list[ResolvedEvent]
) -> tuple[float, float, float]:
    t_star = min(e.start for e in events)
    t_star = max(t_star, t_w)
    pre = fr[t_w:t_star]
    baseline = float(pre.mean()) if pre.size else 1.0
    band = baseline - FR_BAND_PP

    post = fr[t_star:window_end]
    if post.size == 0:
        return 0.0, 0.0, baseline
    below = post < band
    if not below.any():
        return 0.0, float(post.size), baseline  # never left the band: TTS censored at window

    tts = float(np.argmax(below))  # first week below the band
    first_below = int(np.argmax(below))
    ttr = float(post.size)  # censored default
    for k in range(first_below, post.size):
        seg = post[k:k + TTR_SUSTAIN_WEEKS]
        if seg.size and (seg >= band).all():
            ttr = float(k)
            break
    return ttr, tts, baseline


# ---------------------------------------------------------------------------
# Resilience Index (Part V) — components always shown
# ---------------------------------------------------------------------------

DEFAULT_RI_WEIGHTS = (0.35, 0.25, 0.15, 0.25)  # (SLA, TTR, TTS, cost)


@dataclass(frozen=True)
class ResilienceIndex:
    ri: float
    sla_norm: float    # ŠLA — service loss share of the window [0, 1]
    ttr_norm: float    # ŤTR — recovery time share of the window [0, 1]
    tts_norm: float    # ŤTS — survival share of the window [0, 1]
    cost_norm: float   # Č — C^res share of clean revenue [0, 1]
    weights: tuple[float, float, float, float]

    def as_dict(self) -> dict[str, float]:
        return {
            "resilience_index": self.ri,
            "sla_norm": self.sla_norm,
            "ttr_norm": self.ttr_norm,
            "tts_norm": self.tts_norm,
            "cost_norm": self.cost_norm,
        }


def resilience_index(
    service_loss_area: float,
    ttr_weeks: float,
    tts_weeks: float,
    cost_of_resilience: float,
    window_weeks: int,
    clean_revenue: float,
    weights: tuple[float, float, float, float] = DEFAULT_RI_WEIGHTS,
) -> ResilienceIndex:
    """RI = 100·[w1(1−ŠLA) + w2(1−ŤTR) + w3·ŤTS + w4(1−Č)].

    Normalizations (documented in docs/kpis.md): ŠLA = SLA / window (FR is in
    [0,1] so the window length bounds the area); ŤTR = TTR / window;
    ŤTS = TTS / window; Č = C^res / clean-baseline revenue, clipped to [0,1].
    """
    if abs(sum(weights) - 1.0) > 1e-9:
        raise ValueError("RI weights must sum to 1")
    win = max(window_weeks, 1)
    sla_n = float(np.clip(service_loss_area / win, 0.0, 1.0))
    ttr_n = float(np.clip(ttr_weeks / win, 0.0, 1.0))
    tts_n = float(np.clip(tts_weeks / win, 0.0, 1.0))
    cost_n = float(np.clip(cost_of_resilience / max(clean_revenue, 1e-9), 0.0, 1.0))
    w1, w2, w3, w4 = weights
    ri = 100.0 * (w1 * (1 - sla_n) + w2 * (1 - ttr_n) + w3 * tts_n + w4 * (1 - cost_n))
    return ResilienceIndex(ri, sla_n, ttr_n, tts_n, cost_n, weights)
