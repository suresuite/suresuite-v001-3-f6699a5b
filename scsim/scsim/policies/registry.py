"""Policy registry — the single catalog behind the engine, the
``/scsim/registry`` payload, the generated docs, and the frontend forms
(Part IX §9.6).

Implemented (✅) policies register a runnable plugin class. Planned (🧩)
policies register their catalog metadata + Params schema only; compiling a
scenario that enables one raises ``PolicyNotImplementedError`` with the
milestone reference instead of silently no-opping.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from scsim.entities.enums import ConstraintTag, PolicyStatus, Stage, StrategyClass
from scsim.policies.base import (
    DataRequirement,
    FeasibilityIssue,
    PolicyParams,
    PolicyPlugin,
)


class UnknownPolicyError(KeyError):
    pass


class PolicyNotImplementedError(NotImplementedError):
    pass


@dataclass(frozen=True)
class CatalogEntry:
    id: str
    catalog_ref: str
    name: str
    stage: Stage
    strategy_class: StrategyClass
    constraint_targeted: Optional[ConstraintTag]
    requires_predeployment: bool
    status: PolicyStatus
    summary: str
    params_model: type[PolicyParams]
    plugin_cls: Optional[type[PolicyPlugin]]  # None for planned policies
    milestone: str = ""                       # for planned policies: when it lands
    data_requirements: tuple[DataRequirement, ...] = ()  # facet 5 (§8.1)


_REGISTRY: dict[str, CatalogEntry] = {}


def register_plugin(cls: type[PolicyPlugin]) -> type[PolicyPlugin]:
    """Class decorator for implemented policies."""
    entry = CatalogEntry(
        id=cls.id,
        catalog_ref=cls.catalog_ref,
        name=cls.id,
        stage=cls.stage,
        strategy_class=cls.strategy_class,
        constraint_targeted=cls.constraint_targeted,
        requires_predeployment=cls.requires_predeployment,
        status=cls.status,
        summary=cls.summary,
        params_model=cls.Params,
        plugin_cls=cls,
        data_requirements=tuple(getattr(cls, "data_requirements", ()) or ()),
    )
    if cls.id in _REGISTRY:
        raise ValueError(f"duplicate policy id {cls.id!r}")
    _REGISTRY[cls.id] = entry
    return cls


def register_planned(
    *,
    id: str,
    catalog_ref: str,
    stage: Stage,
    strategy_class: StrategyClass,
    constraint_targeted: Optional[ConstraintTag],
    requires_predeployment: bool,
    summary: str,
    params_model: type[PolicyParams],
    milestone: str,
    data_requirements: tuple[DataRequirement, ...] = (),
) -> None:
    if id in _REGISTRY:
        raise ValueError(f"duplicate policy id {id!r}")
    _REGISTRY[id] = CatalogEntry(
        id=id,
        catalog_ref=catalog_ref,
        name=id,
        stage=stage,
        strategy_class=strategy_class,
        constraint_targeted=constraint_targeted,
        requires_predeployment=requires_predeployment,
        status=PolicyStatus.PLANNED,
        summary=summary,
        params_model=params_model,
        plugin_cls=None,
        milestone=milestone,
        data_requirements=data_requirements,
    )


def get_entry(policy_id: str) -> CatalogEntry:
    _ensure_loaded()
    try:
        return _REGISTRY[policy_id]
    except KeyError:
        raise UnknownPolicyError(
            f"unknown policy {policy_id!r}; known: {sorted(_REGISTRY)}"
        ) from None


def instantiate(policy_id: str, raw_params: dict) -> PolicyPlugin:
    entry = get_entry(policy_id)
    if entry.plugin_cls is None:
        raise PolicyNotImplementedError(
            f"policy {policy_id!r} ({entry.catalog_ref}) is in the catalog but not yet "
            f"implemented (lands in {entry.milestone}). Remove it from the portfolio or "
            f"pin an engine version that ships it."
        )
    params = entry.params_model.model_validate(raw_params)
    return entry.plugin_cls(params)


def catalog() -> list[CatalogEntry]:
    _ensure_loaded()
    return sorted(_REGISTRY.values(), key=lambda e: e.catalog_ref)


def _ensure_loaded() -> None:
    """Import the policy modules exactly once (registration side effects)."""
    if _REGISTRY:
        return
    import scsim.policies.builtin.p_p1_inventory_control  # noqa: F401
    import scsim.policies.builtin.p_c1_unmet_demand  # noqa: F401
    import scsim.policies.strategic.p_s1_backup_supplier  # noqa: F401
    import scsim.policies.strategic.p_s2_proactive_multi_sourcing  # noqa: F401
    import scsim.policies.strategic.p_p3_safety_stock  # noqa: F401
    import scsim.policies.strategic.p_p4_fg_safety_stock  # noqa: F401
    import scsim.policies.anticipation.p_p5_short_term_capacity  # noqa: F401
    import scsim.policies.anticipation.p_s4_early_warning  # noqa: F401
    import scsim.policies.improvisation.p_p9_material_allocation  # noqa: F401
    import scsim.policies.improvisation.p_c2_customer_allocation  # noqa: F401
    import scsim.policies.improvisation.p_t2_expedited_shipments  # noqa: F401
    import scsim.policies.planned  # noqa: F401


# --------------------------------------------------------------------------
# Portfolio composition rules — Part IV §4.6 (engine-enforced)
# --------------------------------------------------------------------------

def check_portfolio(scenario) -> list[FeasibilityIssue]:
    """Feasibility (errors) + path-dependency / submodularity hints (warnings).

    Errors abort compilation; warnings ride along in the run metadata.
    """
    from scsim.entities.enums import SupplierProfile

    issues: list[FeasibilityIssue] = []
    net = scenario.network
    enabled = list(scenario.policies.keys())

    # Rule 1 — feasibility, delegated to each implemented plugin.
    for pid in enabled:
        entry = get_entry(pid)
        if entry.plugin_cls is None:
            continue
        plugin = instantiate(pid, scenario.policies[pid])
        result = plugin.feasibility(scenario)
        issues.extend(result.issues)

    # Rule 3 — constraint-overlap submodularity warning: ≥2 capital-intensive
    # (predeployment) policies on the same constraint tag (manuscript: S1+S5 case).
    by_tag: dict[str, list[str]] = {}
    for pid in enabled:
        entry = get_entry(pid)
        if entry.requires_predeployment and entry.constraint_targeted:
            by_tag.setdefault(entry.constraint_targeted.value, []).append(entry.catalog_ref)
    for tag, refs in by_tag.items():
        if len(refs) >= 2:
            issues.append(FeasibilityIssue(
                "warning", "constraint_overlap",
                f"{' + '.join(refs)} both pre-deploy against '{tag}' — submodular "
                f"(diminishing) returns are likely; check the synergy decomposition.",
            ))

    # Rule 6 — breadth indicator vs the inverted-U band (optimum typically 2–3).
    breadth = len(scenario.portfolio)
    if breadth >= 4:
        issues.append(FeasibilityIssue(
            "warning", "breadth_above_band",
            f"portfolio breadth {breadth} is above the inverted-U guidance band (2–3): "
            f"marginal strategies tend to add cost faster than resilience.",
        ))

    # Single-sourcing context surfaced once (drives several §4.6 hints).
    single_sourced = [
        s.id for s in net.suppliers
        if net.supplier_profile(s.id) == SupplierProfile.SINGLE_SOURCED
        and any(l.supplier_id == s.id for l in net.supplier_links)
    ]
    if "backup_supplier" in enabled and single_sourced:
        issues.append(FeasibilityIssue(
            "warning", "single_sourced_peers",
            f"{len(single_sourced)} supplier(s) are single-sourced "
            f"({', '.join(single_sourced[:3])}{'…' if len(single_sourced) > 3 else ''}); "
            f"backup_supplier cannot protect materials they exclusively source — a BoM peer "
            f"shortage still blocks production (manuscript Part I).",
        ))
    return issues
