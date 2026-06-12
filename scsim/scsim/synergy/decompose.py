"""Synergy decomposition under CRN (Part V, manuscript synergy equations).

synergy_X(AB) = Δ_X(portfolio AB) − Σ_i Δ_X(component i), computed PER
REPLICATION on CRN-paired deltas, then percentile-bootstrapped (two-sided,
10k resamples by default). Positive synergy_R: the combination recovers
more revenue than its parts; negative: submodular overlap (the manuscript's
P-S.1 + P-T.2 case).

Requires a ``PortfolioStudy`` whose portfolios include the combination and
every component, all run under the same world streams (the engine
guarantees this by construction — see stats/seeds.py).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from scsim.core.engine import PortfolioStudy
from scsim.policies.registry import get_entry
from scsim.stats.bootstrap import BootstrapResult, bootstrap_mean


@dataclass(frozen=True)
class SynergyResult:
    portfolio: str
    components: tuple[str, ...]
    synergy_revenue: BootstrapResult       # pp of S0's lost revenue
    synergy_cost: BootstrapResult          # pp of S0's C^res
    per_rep_revenue: np.ndarray
    per_rep_cost: np.ndarray
    overlap_diagnostics: tuple[str, ...]   # shared constraint tags (submodularity hints)

    def as_dict(self) -> dict:
        return {
            "portfolio": self.portfolio,
            "components": list(self.components),
            "synergy_revenue": self.synergy_revenue.as_dict(),
            "synergy_cost": self.synergy_cost.as_dict(),
            "overlap_diagnostics": list(self.overlap_diagnostics),
        }


def decompose(
    study: PortfolioStudy,
    portfolio: str,
    components: list[str],
) -> SynergyResult:
    """Δ_portfolio − Σ Δ_components on CRN-paired per-replication deltas."""
    for name in [portfolio, *components]:
        if name not in study.deltas:
            raise KeyError(f"{name!r} not in study (have: {sorted(study.deltas)})")

    n = len(study.deltas[portfolio]["delta_revenue"])
    for name in components:
        if len(study.deltas[name]["delta_revenue"]) != n:
            raise ValueError(
                "replication counts differ across portfolios — synergy requires the same "
                "CRN grid (disable sequential stopping for portfolio studies)"
            )

    syn_r = study.deltas[portfolio]["delta_revenue"].copy()
    syn_c = study.deltas[portfolio]["delta_cost"].copy()
    for name in components:
        syn_r = syn_r - study.deltas[name]["delta_revenue"]
        syn_c = syn_c - study.deltas[name]["delta_cost"]

    overlap = _overlap_diagnostics(study, components)
    seed = study.settings_seed
    return SynergyResult(
        portfolio=portfolio,
        components=tuple(components),
        synergy_revenue=bootstrap_mean(syn_r, study.bootstrap_resamples, study.ci_level, seed),
        synergy_cost=bootstrap_mean(syn_c, study.bootstrap_resamples, study.ci_level, seed + 1),
        per_rep_revenue=syn_r,
        per_rep_cost=syn_c,
        overlap_diagnostics=overlap,
    )


def _overlap_diagnostics(study: PortfolioStudy, components: list[str]) -> tuple[str, ...]:
    """Constraint tags targeted by ≥2 component portfolios — submodularity hints."""
    tag_owners: dict[str, list[str]] = {}
    for name in components:
        res = study.portfolios.get(name)
        if res is None:
            continue
        # Component portfolio policy ids are encoded in the scenario name suffix
        # convention; fall back to the policy list captured in result KPIs.
        for pid in _policies_of(study, name):
            entry = get_entry(pid)
            if entry.constraint_targeted is not None:
                tag_owners.setdefault(entry.constraint_targeted.value, []).append(name)
    return tuple(
        f"{tag}: targeted by {sorted(set(owners))}"
        for tag, owners in sorted(tag_owners.items())
        if len(set(owners)) >= 2
    )


def _policies_of(study: PortfolioStudy, name: str) -> list[str]:
    meta = getattr(study, "portfolio_policies", None)
    if meta and name in meta:
        return list(meta[name])
    return []


def breadth_ladder(
    study: PortfolioStudy,
    ladder: list[tuple[str, list[str]]],
) -> list[dict]:
    """Breadth-vs-benefit rows for the inverted-U chart (Part IV §4.6 rule 6).

    ``ladder`` = [(portfolio_name, component_policy_ids), ...] ordered by breadth.
    """
    rows = []
    for name, pids in ladder:
        if name not in study.deltas:
            continue
        d = study.deltas[name]
        rows.append({
            "portfolio": name,
            "breadth": len(pids),
            "delta_revenue_mean": float(d["delta_revenue"].mean()),
            "delta_cost_mean": float(d["delta_cost"].mean()),
            "in_guidance_band": 2 <= len(pids) <= 3,
        })
    return rows
