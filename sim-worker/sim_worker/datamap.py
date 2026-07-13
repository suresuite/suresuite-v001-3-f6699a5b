"""Fetch a project's stored rows from Supabase and build the canonical
``scsim.io.ProjectData`` — the worker's only ingestion path for scsim runs.

``build_project_data`` is pure (raw dict rows → ProjectData) and unit-testable;
``load_project_data`` does the PostgREST reads (service role) and calls it.
See docs/data-simulation-mapping.md.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:  # httpx only used by load_project_data (the worker's DB reads);
    import httpx    # the serverless engine calls build_project_data directly.

from scsim.io import (
    BomArc,
    MaterialRow,
    OutboundArc,
    ProductRow,
    ProjectData,
    ScenarioSettings,
    SupplierRow,
    SupplyArc,
)


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _flatten_multi_level_bom(rows: list[dict]) -> list[dict]:
    """bom_multi_level rows → effective single-level rows.

    Each multi-level row is one edge: child ``material_id`` is consumed by
    parent ``higher_level_component_id`` at ``consumption_rate``. The engine
    models a single BOM level (product → raw material), so chains are
    collapsed the same way combine-project propagates demand down the tree:
    roots are the components that are never anyone's child (the finished
    products), leaves are the components that are never a parent (the raw
    materials), and the effective rate of a root→leaf pair is the sum over
    all paths of the product of edge rates. Rates default to 1.0 exactly like
    the single-level mapping below.
    """
    edges: dict[str, list[tuple[str, float]]] = {}
    parents: set[str] = set()
    children: set[str] = set()
    for r in rows:
        parent, child = r.get("higher_level_component_id"), r.get("material_id")
        if not parent or not child:
            continue
        parent, child = str(parent), str(child)
        edges.setdefault(parent, []).append((child, _num(r.get("consumption_rate")) or 1.0))
        parents.add(parent)
        children.add(child)

    flat: dict[tuple[str, str], float] = {}
    for root in sorted(parents - children):
        stack: list[tuple[str, float, tuple[str, ...]]] = [(root, 1.0, (root,))]
        while stack:
            node, eff, path = stack.pop()
            kids = edges.get(node)
            if not kids:  # leaf material
                key = (root, node)
                flat[key] = flat.get(key, 0.0) + eff
                continue
            for child, rate in kids:
                if child in path:  # cycle guard — drop the looping path
                    continue
                stack.append((child, eff * rate, path + (child,)))

    return [
        {"product_id": product, "material_id": material, "consumption_rate": rate}
        for (product, material), rate in sorted(flat.items())
    ]


def build_project_data(
    *,
    suppliers: list[dict],
    materials: list[dict],
    products: list[dict],
    inbound: list[dict],
    bom: list[dict],
    outbound: list[dict],
    policies: dict,
    scenario: dict,
    project_model: Optional[str],
) -> ProjectData:
    return ProjectData(
        suppliers=[
            SupplierRow(
                id=str(r["supplier_id"]), name=r.get("name"),
                capacity_per_week=_num(r.get("capacity_per_week")),
                reliability_score=_num(r.get("reliability_score")) or 1.0,
            )
            for r in suppliers if r.get("supplier_id")
        ],
        materials=[
            MaterialRow(
                id=str(r["material_id"]), name=r.get("name"),
                cost=_num(r.get("cost")), holding_cost_pct=_num(r.get("holding_cost_pct")),
                moq=_num(r.get("moq")), initial_on_hand=_num(r.get("initial_on_hand")),
                lead_time_dist=r.get("lead_time_dist"), lead_time_cv=_num(r.get("lead_time_cv")),
            )
            for r in materials if r.get("material_id")
        ],
        products=[
            ProductRow(
                id=str(r["product_id"]), name=r.get("name"),
                sell_price=_num(r.get("sell_price")),
                production_capacity=_num(r.get("production_capacity")),
                fulfillment_mode=r.get("fulfillment_mode"),
                demand_distribution=r.get("demand_distribution"),
                demand_mean=_num(r.get("demand_mean")), demand_cv=_num(r.get("demand_cv")),
                demand_min=_num(r.get("demand_min")), demand_max=_num(r.get("demand_max")),
            )
            for r in products if r.get("product_id")
        ],
        supply_arcs=[
            SupplyArc(
                supplier_id=str(r["supplier_id"]), material_id=str(r["material_id"]),
                unit_price=_num(r.get("unit_price")), lead_time=_num(r.get("lead_time")),
                lead_time_unit=r.get("lead_time_unit"), time_unit=r.get("time_unit"),
                volume=_num(r.get("volume")),
            )
            for r in inbound if r.get("supplier_id") and r.get("material_id")
        ],
        bom=[
            BomArc(product_id=str(r["product_id"]), material_id=str(r["material_id"]),
                   consumption_rate=_num(r.get("consumption_rate")) or 1.0)
            for r in (
                # Multi-level rows (child + parent component, no product_id)
                # are collapsed to effective product→material arcs; single-
                # level rows pass through unchanged. Both the worker and the
                # browser dataset funnel through here, so the two paths stay
                # in lockstep by construction.
                [r for r in bom if r.get("product_id")]
                + _flatten_multi_level_bom(
                    [r for r in bom
                     if not r.get("product_id") and r.get("higher_level_component_id")]
                )
            )
            if r.get("product_id") and r.get("material_id")
        ],
        outbound=[
            OutboundArc(
                product_id=str(r["product_id"]), customer_id=str(r["customer_id"]),
                unit_price=_num(r.get("unit_price")), volume=_num(r.get("volume")),
                time_unit=r.get("time_unit"),
            )
            for r in outbound if r.get("product_id") and r.get("customer_id")
        ],
        policies=policies or {},
        scenario=ScenarioSettings(
            horizon_days=int(_num(scenario.get("horizon_days")) or 1092),
            warmup_mode=str(scenario.get("warmup_mode", "auto")),
            warmup_days=int(_num(scenario.get("warmup_days")) or 105),
            replications=int(_num(scenario.get("replications")) or 30),
            seed=int(_num(scenario.get("seed")) or 42),
            crn=bool(scenario.get("crn", True)),
            ci_level=int(_num(scenario.get("ci_level")) or 95),
            demand_model=scenario.get("demand_model"),
            disruption_schedule=scenario.get("disruption_schedule") or [],
            stopping_rule=scenario.get("stopping_rule"),
            name=str(scenario.get("name", "scenario")),
            inspection=bool(scenario.get("inspection", False)),
        ),
        project_model=project_model,
    )


async def load_project_data(
    http: httpx.AsyncClient,
    base_url: str,
    service_role_key: str,
    project_id: str,
    *,
    scenario: dict,
    policies: dict,
    project_model: Optional[str],
) -> ProjectData:
    headers = {"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"}
    base = base_url.rstrip("/")

    async def rows(table: str, select: str = "*") -> list[dict]:
        try:
            r = await http.get(
                f"{base}/rest/v1/{table}",
                params={"project_id": f"eq.{project_id}", "select": select},
                headers=headers,
            )
            if r.status_code == 200 and isinstance(r.json(), list):
                return r.json()
        except Exception:
            pass
        return []

    # Best-effort: make sure a master row exists for every id in the graph.
    try:
        await http.post(
            f"{base}/rest/v1/rpc/ensure_item_masters",
            params={}, headers={**headers, "Content-Type": "application/json"},
            json={"p_project_id": project_id},
        )
    except Exception:
        pass

    # BOM: multi-level rows win when they exist — the same rule the frontend
    # lanes apply (src/lib/policies/projectLanes.ts) — so browser and server
    # read the identical BOM source for a given project.
    bom = await rows(
        "bom_multi_level", "material_id,higher_level_component_id,level,consumption_rate"
    )
    if not bom:
        bom = await rows("bom_single_level", "product_id,material_id,consumption_rate")

    return build_project_data(
        suppliers=await rows("suppliers"),
        materials=await rows("materials"),
        products=await rows("products"),
        inbound=await rows("inbound_logistics", "supplier_id,material_id,unit_price,lead_time,time_unit,volume"),
        bom=bom,
        outbound=await rows("outbound_logistics", "product_id,customer_id,unit_price,volume,time_unit"),
        policies=policies,
        scenario=scenario,
        project_model=project_model,
    )
