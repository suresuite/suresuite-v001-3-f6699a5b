"""Adapter: sim-worker graph + policy dict → scsim Scenario.

The existing SureSuite ``sim-worker`` loads a project as a NetworkX DiGraph
(node_type ∈ {supplier, material, product, customer}; edges ``supply``
(lead_time weeks, unit_price), ``bom`` (consumption_rate), ``outbound``)
plus an effective-policy dict keyed ``default`` / ``node:<id>``. This module
converts that world into an scsim Scenario so the worker can run the
phase-pipeline engine without re-ingesting data.

The mapping is STRUCTURAL, not parameter-exact (legacy absolute levels like
``order_up_to`` become coverage-based κ defaults); every approximation is
returned in ``notes`` so callers can surface them. Duck-typed on the graph
(``.nodes(data=True)`` / ``.in_edges(..., data=True)``) — no networkx
dependency in scsim.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from scsim.entities.config import SimulationSettings
from scsim.entities.disruption import DisruptionEvent
from scsim.entities.enums import TargetType, WarmupMethod
from scsim.entities.network import (
    BomLine,
    Customer,
    Material,
    Network,
    Product,
    Supplier,
    SupplierLink,
)
from scsim.entities.scenario import Scenario


@dataclass
class ConversionResult:
    scenario: Scenario
    notes: list[str] = field(default_factory=list)


def _merged_policy(policies: dict, node_id: str, family: str) -> dict:
    default = (policies.get("default") or {}).get(family) or {}
    override = (policies.get(f"node:{node_id}") or {}).get(family) or {}
    return {**default, **override}


def from_legacy_graph(
    graph: Any,
    policies: dict | None = None,
    *,
    horizon_weeks: int = 156,
    seed: int = 42,
    model_seeds: int = 30,
    disruption_schedule: list[dict] | None = None,
    name: str = "legacy_project",
) -> ConversionResult:
    policies = policies or {}
    notes: list[str] = []

    sup_nodes, mat_nodes, prod_nodes, cust_nodes = [], [], [], []
    for node, data in graph.nodes(data=True):
        kind = data.get("node_type")
        if kind == "supplier":
            sup_nodes.append((str(node), data))
        elif kind == "material":
            mat_nodes.append((str(node), data))
        elif kind == "product":
            prod_nodes.append((str(node), data))
        elif kind == "customer":
            cust_nodes.append((str(node), data))
    if not (sup_nodes and mat_nodes and prod_nodes):
        raise ValueError("legacy graph needs at least one supplier, material and product")

    links: list[SupplierLink] = []
    link_cost_by_mat: dict[str, float] = {}
    for mat_id, _ in mat_nodes:
        for sup_id, _, edata in graph.in_edges(mat_id, data=True):
            if edata.get("edge_type") not in ("supply", None):
                continue
            lt = max(1, round(float(edata.get("lead_time") or 2.0)))
            cost = float(edata.get("unit_price") or 1.0)
            cost = cost if cost > 0 else 1.0
            links.append(SupplierLink(
                supplier_id=str(sup_id), material_id=mat_id,
                cost=cost, lead_time_weeks=min(lt, 51),
            ))
            link_cost_by_mat[mat_id] = min(link_cost_by_mat.get(mat_id, cost), cost)

    bom: list[BomLine] = []
    for prod_id, _ in prod_nodes:
        for mat_id, _, edata in graph.in_edges(prod_id, data=True):
            if edata.get("edge_type") == "bom" or "consumption_rate" in edata:
                bom.append(BomLine(
                    product_id=prod_id, material_id=str(mat_id),
                    rate=float(edata.get("consumption_rate") or 1.0),
                ))

    suppliers = [Supplier(id=sid, name=str(d.get("name", sid))) for sid, d in sup_nodes]
    materials = []
    for mid, d in mat_nodes:
        inv = _merged_policy(policies, mid, "inventory")
        materials.append(Material(
            id=mid, name=str(d.get("name", mid)),
            cost=link_cost_by_mat.get(mid, 1.0),
            holding_cost_rate=min(50.0, max(5.0, float(inv.get("holding_cost_pct", 0.20)) * 100.0)),
        ))

    products = []
    for pid, d in prod_nodes:
        prod_pol = _merged_policy(policies, pid, "production")
        cap_day = float(prod_pol.get("capacity_units_per_day", d.get("capacity_units_per_day", 1000.0)))
        util = float(prod_pol.get("utilization_cap_pct", 85.0)) / 100.0
        weekly_demand = float(d.get("weekly_demand", 100.0))
        products.append(Product(
            id=pid, name=str(d.get("name", pid)),
            unit_price=float(d.get("unit_price", 1.0)) or 1.0,
            demand_mode=weekly_demand,
            production_capacity=max(cap_day * 7.0 * util, 1e-6),
        ))

    customers = [Customer(id=cid, name=str(d.get("name", cid))) for cid, d in cust_nodes]

    network = Network(
        suppliers=suppliers, materials=materials, products=products,
        bom=bom, supplier_links=links, customers=customers,
    )

    # Legacy warm-up convention (min(15, horizon/4)) → manual warm-up.
    warmup = min(15, horizon_weeks // 4)
    settings = SimulationSettings(
        project_seed=seed,
        horizon=max(52, min(horizon_weeks, 520)),
        model_seeds=max(1, min(model_seeds, 200)),
        warmup_method=WarmupMethod.MANUAL,
        warmup_end=warmup,
        analysis_window=max(13, min(156, horizon_weeks - warmup)),
    )
    if horizon_weeks < 52:
        notes.append(f"horizon raised from {horizon_weeks} to 52 weeks (engine floor)")

    scenario_policies = _map_policies(policies, notes)
    events = _map_events(disruption_schedule or [], network, warmup, notes)

    return ConversionResult(
        scenario=Scenario(
            name=name, network=network, settings=settings,
            events=events, policies=scenario_policies,
        ),
        notes=notes,
    )


def _map_policies(policies: dict, notes: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    inv = (policies.get("default") or {}).get("inventory") or {}
    fulfil = (policies.get("default") or {}).get("fulfillment") or {}
    sourcing = (policies.get("default") or {}).get("sourcing") or {}
    recovery = (policies.get("default") or {}).get("recovery") or {}

    type_map = {
        "min_max": "min_max", "s_S": "min_max", "continuous_review": "min_max",
        "base_stock": "base_stock", "rop": "rop_q", "periodic_review": "periodic",
    }
    out["inventory_control"] = {
        "policy_type": type_map.get(str(inv.get("type", "min_max")), "min_max"),
    }
    notes.append("inventory_control: legacy absolute order_up_to replaced by coverage-based κ "
                 "(nominal 8 weeks) — structural mapping, not parameter-exact")

    ss_method = str(inv.get("safety_stock_method", "fixed_days"))
    if ss_method in ("service_level", "demand_variability"):
        sl = float(inv.get("service_level_target", 0.95)) * 100.0
        out["safety_stock_materials"] = {
            "classification": "uniform",
            "uniform_service_level": min(99.9, max(80.0, sl)),
        }
    elif ss_method == "king_method":
        out["safety_stock_materials"] = {"classification": "king"}
    else:
        out["safety_stock_materials"] = {
            "classification": "fixed_days",
            "fixed_days_cover": min(84.0, max(0.0, float(inv.get("safety_stock_days", 7.0)))),
        }

    if bool(fulfil.get("backorder_allowed", False)):
        out["unmet_demand_handling"] = {
            "rule": "backorder",
            "backorder_horizon": max(0, min(26, round(float(fulfil.get("max_backorder_days", 14)) / 7))),
            "backorder_penalty": float(fulfil.get("backorder_cost_per_day", 0.0)) * 7.0,
        }
    else:
        out["unmet_demand_handling"] = {"rule": "lost_sales"}

    responses = set(recovery.get("response") or [])
    if str(sourcing.get("strategy", "single")) in ("primary_backup", "dual_sourcing", "multi") \
            or "dual_source_activate" in responses:
        out["backup_supplier"] = {}
    if responses & {"mode_shift", "expedite_freight", "reroute"}:
        out["expedited_shipments"] = {}
    if "capacity_flex" in responses:
        out["short_term_capacity"] = {}
    return out


def _map_events(
    schedule: list[dict], network: Network, warmup: int, notes: list[str]
) -> list[DisruptionEvent]:
    sup_ids = {s.id for s in network.suppliers}
    events: list[DisruptionEvent] = []
    for entry in schedule[:5]:
        raw = str(entry.get("target", ""))
        target = raw.split(":", 1)[1] if ":" in raw else raw
        if target not in sup_ids:
            notes.append(f"disruption target {raw!r} is not a supplier — skipped "
                         f"(material/plant targets land in M7)")
            continue
        start_week = max(1, round(float(entry.get("start_day", 0)) / 7.0))
        duration = max(1, min(52, round(float(entry.get("duration_days", 7)) / 7.0)))
        magnitude = float(entry.get("magnitude_pct", 100.0))
        if magnitude < 100.0:
            notes.append(
                f"event on {target!r}: magnitude {magnitude:.0f}% mapped to a full "
                f"lead-time-extension outage — partial capacity cuts need finite supplier "
                f"capacities (ST-2 path)"
            )
        events.append(DisruptionEvent(
            target_type=TargetType.NODE_SUPPLIER,
            target_id=target,
            start=start_week,
            duration=duration,
        ))
    if len(schedule) > 5:
        notes.append(f"{len(schedule) - 5} disruption entries beyond the 5-event cap dropped")
    return events
