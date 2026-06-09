"""Seed control with numpy's SeedSequence for independent, reproducible streams."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ReplicationStreams:
    rep_index: int
    seed: int
    demand: np.random.Generator
    lead_time: np.random.Generator
    disruption: np.random.Generator
    misc: np.random.Generator


def make_streams(master_seed: int, n_reps: int) -> list[ReplicationStreams]:
    """Produce independent sub-streams per replication using SeedSequence.spawn.

    Layout (sub-stream order matters for CRN across scenarios):
        [0] demand, [1] lead_time, [2] disruption, [3] misc
    """
    root = np.random.SeedSequence(master_seed)
    rep_seqs = root.spawn(n_reps)
    out: list[ReplicationStreams] = []
    for i, sq in enumerate(rep_seqs):
        d, l, p, m = sq.spawn(4)
        out.append(
            ReplicationStreams(
                rep_index=i,
                seed=int(sq.entropy if isinstance(sq.entropy, int) else master_seed + i),
                demand=np.random.default_rng(d),
                lead_time=np.random.default_rng(l),
                disruption=np.random.default_rng(p),
                misc=np.random.default_rng(m),
            )
        )
    return out
