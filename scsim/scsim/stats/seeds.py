# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Keyed SeedSequence tree — Part VIII §3–4 (hard requirements).

Three realms hang off the project root, each addressed by a structural
spawn_key (never by sequential spawning, so stream identity is independent
of creation order):

* WORLD   — (realm, model_rep, stream_id): demand, leadtime. Scenario- and
  portfolio-independent by construction → CRN holds across every scenario
  and portfolio of a project.
* HAZARD  — (realm, event_rep, event_index, draw_id): start/duration/
  magnitude draws per disruption event.
* POLICY  — (realm, model_rep, event_rep, policy_key): policy_key is a
  stable 64-bit digest of the policy_id string. Adding/removing policy #22
  cannot perturb the draws of policies #1–21 or of the world streams
  (determinism guarantee §9.4; asserted by golden test G-RNG).

World streams are NEVER handed to policies — :class:`ReplicationStreams`
keeps them on separate attributes and the SimContext only exposes
``ctx.rng(policy_id)``.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import numpy as np

_REALM_WORLD = 0
_REALM_HAZARD = 1
_REALM_POLICY = 2

_WORLD_DEMAND = 0
_WORLD_LEADTIME = 1
# PLAN.md §25 WP 15.1 — the demand-style lead-time shapes (normal, triangular,
# uniform). One child stream PER LANE, keyed by a digest of `supplier::material`
# rather than by the lane's position: the link order follows the chosen primary
# (a policy), and a positional stream would hand a lane another lane's draws
# under a different primary. A new key, so `_WORLD_LEADTIME` — and every
# lognormal/gamma draw — is untouched.
_WORLD_LEADTIME_LANE = 2

HAZARD_START = 0
HAZARD_DURATION = 1
HAZARD_MAGNITUDE = 2


def policy_key(policy_id: str) -> int:
    """Stable 64-bit key for a policy id (platform/run independent)."""
    digest = hashlib.sha256(policy_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


@dataclass
class ReplicationStreams:
    """All RNG streams for one (model_rep, event_rep) replication cell."""

    project_seed: int
    model_rep: int
    event_rep: int
    demand: np.random.Generator
    leadtime: np.random.Generator
    _policy_cache: dict[str, np.random.Generator] = field(default_factory=dict)

    def policy_rng(self, policy_id: str) -> np.random.Generator:
        """Child stream keyed by policy_id — the ONLY RNG a policy may use."""
        rng = self._policy_cache.get(policy_id)
        if rng is None:
            seq = np.random.SeedSequence(
                entropy=self.project_seed,
                spawn_key=(_REALM_POLICY, self.model_rep, self.event_rep, policy_key(policy_id)),
            )
            rng = np.random.default_rng(seq)
            self._policy_cache[policy_id] = rng
        return rng


def world_streams(project_seed: int, model_rep: int, event_rep: int) -> ReplicationStreams:
    demand = np.random.default_rng(
        np.random.SeedSequence(entropy=project_seed, spawn_key=(_REALM_WORLD, model_rep, _WORLD_DEMAND))
    )
    leadtime = np.random.default_rng(
        np.random.SeedSequence(entropy=project_seed, spawn_key=(_REALM_WORLD, model_rep, _WORLD_LEADTIME))
    )
    return ReplicationStreams(
        project_seed=project_seed,
        model_rep=model_rep,
        event_rep=event_rep,
        demand=demand,
        leadtime=leadtime,
    )


def lane_leadtime_rng(project_seed: int, model_rep: int, supplier_id: str,
                      material_id: str) -> np.random.Generator:
    """The WORLD stream of one supplier × material lane's shaped lead time.

    World realm, so it is scenario- and portfolio-independent (CRN), and keyed by
    the lane's ids, so it is independent of which other lanes exist, of their
    order, and of which supplier a policy made primary.
    """
    lane = policy_key(f"{supplier_id}::{material_id}")
    seq = np.random.SeedSequence(
        entropy=project_seed, spawn_key=(_REALM_WORLD, model_rep, _WORLD_LEADTIME_LANE, lane)
    )
    return np.random.default_rng(seq)


def hazard_rng(project_seed: int, event_rep: int, event_index: int, draw_id: int) -> np.random.Generator:
    seq = np.random.SeedSequence(
        entropy=project_seed, spawn_key=(_REALM_HAZARD, event_rep, event_index, draw_id)
    )
    return np.random.default_rng(seq)


def replication_grid(model_seeds: int, event_seeds: int, any_stochastic_event: bool) -> list[tuple[int, int]]:
    """(model_rep, event_rep) cells. Event axis collapses when all events are fixed."""
    e = event_seeds if any_stochastic_event else 1
    return [(i, j) for i in range(model_seeds) for j in range(e)]
