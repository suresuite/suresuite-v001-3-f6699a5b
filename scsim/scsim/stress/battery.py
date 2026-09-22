"""Stress Test module — Part VI. ST-1 ✅ and ST-2 runnable; ST-3..7 declared.

A battery cell = one (target × effect × magnitude × duration) scenario run
with the CURRENT portfolio. Every cell shares the clean reference (one run,
no events) for SLA and the RI cost normalization; cells share world streams
by construction (CRN), so cross-cell comparisons are paired.

Budget: ``full`` uses the scenario's model_seeds × event_seeds;
``fast_scan`` (10×6, kpi_only) stamps every row with the wide-CI badge —
fast_scan numbers are never silently mixed with full-mode results (R4).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from scsim.core.engine import (
    ScenarioResult,
    compile_scenario,
    resolve_warmup,
    run_scenario,
)
from scsim.entities.config import WarmupReport
from scsim.entities.disruption import DisruptionEvent
from scsim.entities.enums import EffectType, RunMode, SupplierProfile, TargetType
from scsim.entities.scenario import Scenario
from scsim.kpi.compute import ResilienceIndex, censored_mean, resilience_index
from scsim.stats.bootstrap import aggregate_mean_ci

ST_DEFINITIONS: dict[str, str] = {
    "ST-1": "Supplier outage sweep (manuscript ✅): each supplier × LT-extension × Δt {5,8,10}.",
    "ST-2": "Supplier capacity-cut sweep: each supplier × φ {0.75,0.5,0.25,0} × {4,8} wks.",
    "ST-3": "Material shortage sweep (M7: material-scoped capacity).",
    "ST-4": "Edge/lane shock (M7: edge split).",
    "ST-5": "Demand surge (M7: demand-side events).",
    "ST-6": "Compound: ST-1 ∩ ST-5 (M7).",
    "ST-7": "Nexus-node attack: top-k ML-critical (M7; ml-service integration).",
}


@dataclass(frozen=True)
class StressCell:
    test: str
    supplier_id: str
    effect: str
    duration_weeks: int
    capacity_factor: Optional[float]
    rho_s: float                       # multi-sourcing rate overlay (manuscript Figs. 4–5)
    supplier_profile: str
    kpis: dict[str, dict[str, float]]  # KPI → mean/ci stats
    ri: ResilienceIndex
    n_replications: int
    wide_ci_badge: bool

    def as_dict(self) -> dict:
        return {
            "test": self.test,
            "supplier_id": self.supplier_id,
            "effect": self.effect,
            "duration_weeks": self.duration_weeks,
            "capacity_factor": self.capacity_factor,
            "rho_s": self.rho_s,
            "supplier_profile": self.supplier_profile,
            "kpis": self.kpis,
            **self.ri.as_dict(),
            "n_replications": self.n_replications,
            "wide_ci_badge": self.wide_ci_badge,
        }


@dataclass
class StressTestReport:
    test: str
    scenario_name: str
    engine_version: str
    run_mode: RunMode
    warmup: WarmupReport
    cells: list[StressCell] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    clean_reference: Optional[ScenarioResult] = None

    def scorecard(self) -> list[dict]:
        return [c.as_dict() for c in self.cells]

    def vulnerability_ranking(self) -> list[dict]:
        """Suppliers ranked by worst-cell RI (lower = more vulnerable)."""
        worst: dict[str, StressCell] = {}
        for c in self.cells:
            cur = worst.get(c.supplier_id)
            if cur is None or c.ri.ri < cur.ri.ri:
                worst[c.supplier_id] = c
        return [
            {"supplier_id": s, "worst_ri": c.ri.ri, "rho_s": c.rho_s,
             "profile": c.supplier_profile, "duration_weeks": c.duration_weeks}
            for s, c in sorted(worst.items(), key=lambda kv: kv[1].ri.ri)
        ]


def run_st1(
    scenario: Scenario,
    durations: tuple[int, ...] = (5, 8, 10),
    suppliers: Optional[list[str]] = None,
    debug: bool = False,
) -> StressTestReport:
    """ST-1 — the manuscript supplier outage sweep (LT-extension)."""
    cells = [
        {"supplier_id": s, "effect": EffectType.LEAD_TIME_EXTENSION,
         "duration": d, "capacity_factor": None}
        for s in (suppliers or [x.id for x in scenario.network.suppliers])
        for d in durations
    ]
    return _run_battery(scenario, "ST-1", cells, debug=debug)


def run_st2(
    scenario: Scenario,
    capacity_factors: tuple[float, ...] = (0.75, 0.5, 0.25, 0.0),
    durations: tuple[int, ...] = (4, 8),
    suppliers: Optional[list[str]] = None,
    debug: bool = False,
) -> StressTestReport:
    """ST-2 — capacity-cut sweep. Suppliers without finite capacity are skipped
    (with reasons) instead of failing the whole battery."""
    cells = [
        {"supplier_id": s, "effect": EffectType.CAPACITY_REDUCTION,
         "duration": d, "capacity_factor": phi}
        for s in (suppliers or [x.id for x in scenario.network.suppliers])
        for phi in capacity_factors
        for d in durations
    ]
    return _run_battery(scenario, "ST-2", cells, debug=debug)


def _run_battery(
    scenario: Scenario, test: str, cells: list[dict], debug: bool
) -> StressTestReport:
    from scsim.io.snapshots import SnapshotStore

    snapshots = SnapshotStore()  # one warm state per model seed, shared by all cells
    base = scenario.without_events(name=f"{scenario.name}__{test}_clean")
    base_compiled = compile_scenario(base)
    warmup = resolve_warmup(base_compiled)
    clean = run_scenario(base, debug=debug, compiled=base_compiled, snapshot_store=snapshots)
    window = min(
        warmup.adopted_week + scenario.settings.analysis_window, scenario.settings.horizon
    ) - warmup.adopted_week
    clean_revenue_by_rep = {
        cell[0]: clean.kpis[r]["revenue"] for r, cell in enumerate(clean.rep_cells)
    }

    report = StressTestReport(
        test=test,
        scenario_name=scenario.name,
        engine_version=clean.stats.engine_version,
        run_mode=scenario.settings.run_mode,
        warmup=warmup,
        clean_reference=clean,
    )
    net = scenario.network
    cap_by_sup = {s.id: s.capacity_per_week for s in net.suppliers}

    for spec in cells:
        sup = spec["supplier_id"]
        if spec["effect"] == EffectType.CAPACITY_REDUCTION and cap_by_sup.get(sup) is None:
            report.skipped.append({
                "supplier_id": sup, "reason":
                "capacity_reduction needs a finite supplier capacity_per_week (§3.5)"})
            continue
        event = DisruptionEvent(
            target_type=TargetType.NODE_SUPPLIER,
            target_id=sup,
            effect_type=spec["effect"],
            capacity_factor=spec["capacity_factor"] or 0.0,
            start=None,                       # steady state: U{t_w .. t_w+2}
            duration=spec["duration"],
        )
        sc = scenario.model_copy(
            update={"events": [event], "name": f"{scenario.name}__{test}__{sup}__{spec['duration']}w"},
            deep=True,
        )
        sc_compiled = compile_scenario(sc)
        sc_compiled.warmup = warmup
        res = run_scenario(sc, debug=debug, compiled=sc_compiled, snapshot_store=snapshots)

        sla, ri = _cell_sla_ri(res, clean, clean_revenue_by_rep, warmup.adopted_week, window)
        keys = ("fill_rate", "revenue", "lost_sales_value", "cost_of_resilience",
                "ttr_weeks", "tts_weeks", "max_backlog", "lost_inbound_units")
        kpis = {k: res.aggregates[k] for k in keys if k in res.aggregates}
        kpis["service_loss_area"] = aggregate_mean_ci(sla, float(scenario.settings.ci_level))
        report.cells.append(StressCell(
            test=test,
            supplier_id=sup,
            effect=spec["effect"].value,
            duration_weeks=spec["duration"],
            capacity_factor=spec["capacity_factor"],
            rho_s=net.multi_sourcing_rate(sup),
            supplier_profile=net.supplier_profile(sup).value,
            kpis=kpis,
            ri=ri,
            n_replications=res.stats.n_replications,
            wide_ci_badge=res.stats.wide_ci_badge or res.stats.below_replication_floor,
        ))
    return report


def _cell_sla_ri(
    res: ScenarioResult,
    clean: ScenarioResult,
    clean_revenue_by_rep: dict[int, float],
    t_w: int,
    window: int,
) -> tuple[np.ndarray, ResilienceIndex]:
    clean_row = {cell[0]: r for r, cell in enumerate(clean.rep_cells)}
    sla = np.zeros(len(res.rep_cells))
    for r, (i, _j) in enumerate(res.rep_cells):
        ref = clean.fr_series[clean_row[i], t_w:t_w + window]
        gap = ref - res.fr_series[r, t_w:t_w + window]
        sla[r] = float(np.maximum(gap, 0.0).sum())
    mean_clean_rev = float(np.mean([clean_revenue_by_rep[i] for i, _ in res.rep_cells]))
    ri = resilience_index(
        service_loss_area=float(sla.mean()),
        # Censored replications count at the full window (audit WP 3, F-05): the
        # aggregate means now exclude them, and reading those here would score a
        # chain that never recovered as a fast recovery. An unmeasurable cell
        # (no pre-disruption week) keeps the old neutral defaults, said here.
        ttr_weeks=_or(censored_mean(res.kpis, "ttr_weeks", "ttr_censored", window), 0.0),
        tts_weeks=_or(censored_mean(res.kpis, "tts_weeks", "tts_censored", window), window),
        cost_of_resilience=float(res.aggregates["cost_of_resilience"]["mean"]),
        window_weeks=window,
        clean_revenue=mean_clean_rev,
    )
    return sla, ri


def _or(x: float | None, default: float) -> float:
    return float(default if x is None else x)
