"""Warm-state snapshots — Part X §10.2.4.

The warm-up segment of every replication of a scenario family is identical
(events start at/after t_w). ``SnapshotStore`` caches the post-warm-up world
per (scenario-family digest, model_rep): state arrays + world RNG states.
Disruption experiments restore at t_w and simulate only the post-warm-up
weeks — the single biggest lever for big sweeps.

Invalidation key = SHA-256 over (network + settings + policy params +
ENGINE_VERSION). Policy RNG states are deliberately NOT captured: the ✅
policies draw nothing before a disruption is visible; if any policy DOES
draw during warm-up, the snapshot is refused for that family (correctness
over speed) — see ``SimContext.policy_rng_created_week``.

This store is engine-level plumbing; ``run_replication`` accepts it via the
``snapshot_store`` argument once the orchestration layer opts in.
"""
from __future__ import annotations

import copy
import hashlib
from dataclasses import dataclass
from typing import Optional

import numpy as np

from scsim import ENGINE_VERSION
from scsim.core.context import SimContext
from scsim.entities.scenario import Scenario


def family_digest(scenario: Scenario) -> str:
    """Scenario-family identity: everything EXCEPT the event list and name —
    every cell of a stress sweep shares one family."""
    payload = scenario.model_copy(
        update={"events": [], "name": "family"}, deep=True
    ).model_dump_json()
    return hashlib.sha256(f"{ENGINE_VERSION}|{payload}".encode()).hexdigest()[:24]


@dataclass
class WarmState:
    week: int
    on_hand: np.ndarray
    pipeline: np.ndarray
    queue: np.ndarray
    backlog: np.ndarray
    fg_on_hand: np.ndarray
    demand_rng_state: dict
    leadtime_rng_state: dict
    policy_state: dict
    trace_cols: dict[str, np.ndarray]
    cost_weekly: np.ndarray


class SnapshotInvalid(RuntimeError):
    pass


class SnapshotStore:
    def __init__(self) -> None:
        self._store: dict[tuple[str, int], WarmState] = {}

    def __len__(self) -> int:
        return len(self._store)

    def capture(self, digest: str, model_rep: int, ctx: SimContext, t_w: int) -> None:
        if any(week < t_w for week in ctx.policy_rng_created_week.values()):
            raise SnapshotInvalid(
                "a policy consumed RNG during warm-up; warm-state snapshots are "
                "event_rep-specific in that case and are disabled for this family"
            )
        tr = ctx.trace
        self._store[(digest, model_rep)] = WarmState(
            week=t_w,
            on_hand=ctx.on_hand.copy(),
            pipeline=ctx.pipeline.copy(),
            queue=ctx.queue.copy(),
            backlog=ctx.backlog.copy(),
            fg_on_hand=ctx.fg_on_hand.copy(),
            demand_rng_state=copy.deepcopy(ctx.streams.demand.bit_generator.state),
            leadtime_rng_state=copy.deepcopy(ctx.streams.leadtime.bit_generator.state),
            policy_state=copy.deepcopy(ctx.policy_state),
            trace_cols={
                "demand_value": tr.demand_value[:t_w].copy(),
                "fulfilled_value": tr.fulfilled_value[:t_w].copy(),
                "revenue_value": tr.revenue_value[:t_w].copy(),
                "lost_value": tr.lost_value[:t_w].copy(),
                "lost_units": tr.lost_units[:t_w].copy(),
                "backlog_units": tr.backlog_units[:t_w].copy(),
                "fill_rate": tr.fill_rate[:t_w].copy(),
                "inbound_rejected": tr.inbound_rejected[:t_w].copy(),
                "on_hand_value": tr.on_hand_value[:t_w].copy(),
            },
            cost_weekly=ctx.cost.weekly[:, :t_w].copy(),
        )

    def restore(self, digest: str, model_rep: int, ctx: SimContext) -> Optional[int]:
        """Load the warm state into ``ctx``; returns the resume week, or None."""
        ws = self._store.get((digest, model_rep))
        if ws is None:
            return None
        ctx.on_hand = ws.on_hand.copy()
        ctx.pipeline = ws.pipeline.copy()
        ctx.queue = ws.queue.copy()
        ctx.backlog = ws.backlog.copy()
        ctx.fg_on_hand = ws.fg_on_hand.copy()
        ctx.streams.demand.bit_generator.state = copy.deepcopy(ws.demand_rng_state)
        ctx.streams.leadtime.bit_generator.state = copy.deepcopy(ws.leadtime_rng_state)
        ctx.policy_state = copy.deepcopy(ws.policy_state)
        tr = ctx.trace
        for name, col in ws.trace_cols.items():
            getattr(tr, name)[: ws.week] = col
        ctx.cost.weekly[:, : ws.week] = ws.cost_weekly
        return ws.week
