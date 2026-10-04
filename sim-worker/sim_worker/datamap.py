"""Fetch a project's stored rows from Supabase and build the canonical
``scsim.io.ProjectData`` — the worker's only ingestion path for scsim runs.

``build_project_data`` is pure (raw dict rows → ProjectData) and unit-testable;
``load_project_data`` does the PostgREST reads (service role) and calls it.
See docs/data-simulation-mapping.md.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import TYPE_CHECKING, Any, Optional

log = logging.getLogger(__name__)

if TYPE_CHECKING:  # httpx only used by load_project_data (the worker's DB reads);
    import httpx    # the serverless engine calls build_project_data directly.

from scsim.io import (
    BomArc,
    CustomerRow,
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


def _date(v: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def forecast_series(rows: list[dict]) -> dict[tuple[str, str], list[float]]:
    """``demand_forecasts`` buckets → one WEEKLY series per (product, customer).

    PLAN.md §24 WP 14.2 (design doc §9, point 4). Each tier-2 bucket already
    states its weekly rate (``weekly_quantity``, spread over its own days at
    promotion — decision 7) and its exclusive ``period_end``, so nothing here
    converts a unit. What it decides is the CALENDAR:

    * simulated week 0 starts on the project's EARLIEST ``period_start`` — one
      calendar for every row, so two customers' weeks line up;
    * simulated week w is the seven days starting 7·w days later, and its value
      is the sum, over those days, of each covering bucket's daily rate
      (``weekly_quantity / 7``) — a week straddling two months takes some of
      each, so the spread stays even across the boundary;
    * a row's series runs to the last week that lies WHOLLY before its last
      bucket's end; past it, the engine uses the row's mean, else its last value
      (WP 14.1). A day no bucket covers contributes nothing.
    """
    parsed = []
    for r in rows:
        start, end = _date(r.get("period_start")), _date(r.get("period_end"))
        wq = _num(r.get("weekly_quantity"))
        if not (r.get("product_id") and r.get("customer_id") and start and end and wq is not None):
            continue
        parsed.append((str(r["product_id"]), str(r["customer_id"]), start, end, wq))
    if not parsed:
        return {}
    anchor = min(p[2] for p in parsed)
    by_row: dict[tuple[str, str], list[tuple[int, int, float]]] = {}
    for pid, cid, start, end, wq in parsed:
        by_row.setdefault((pid, cid), []).append(
            ((start - anchor).days, (end - anchor).days, wq))
    out: dict[tuple[str, str], list[float]] = {}
    for key, buckets in sorted(by_row.items()):
        weeks = max(b[1] for b in buckets) // 7
        series = [0.0] * weeks
        for d0, d1, wq in buckets:
            for w in range(max(d0, 0) // 7, min((d1 + 6) // 7, weeks)):
                days = min(d1, 7 * w + 7) - max(d0, 7 * w)
                if days > 0:
                    # A whole week inside one bucket is the bucket's weekly rate,
                    # exactly; a partial week takes its share of days.
                    series[w] += wq if days == 7 else wq * days / 7.0
        if weeks:
            out[key] = series
    return out


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
    customers: Optional[list[dict]] = None,
    demand_forecasts: Optional[list[dict]] = None,
) -> ProjectData:
    forecasts = forecast_series(demand_forecasts or [])
    arc_keys = {(str(r["product_id"]), str(r["customer_id"]))
                for r in outbound if r.get("product_id") and r.get("customer_id")}
    return ProjectData(
        suppliers=[
            SupplierRow(
                id=str(r["supplier_id"]), name=r.get("name"),
                capacity_per_week=_num(r.get("capacity_per_week")),
                # None stays None: the mapper applies the engine's declared 1.0 and
                # SAYS it is the default (§23 WP 13.4) rather than a master value.
                reliability_score=_num(r.get("reliability_score")),
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
                # WP 14.4 — the FG policy and levels (MTS), and FG opening stock.
                fg_policy=r.get("fg_policy"),
                fg_base_stock=_num(r.get("fg_base_stock")),
                fg_reorder_point=_num(r.get("fg_reorder_point")),
                fg_cover_days=_num(r.get("fg_cover_days")),
                fg_initial_on_hand=_num(r.get("fg_initial_on_hand")),
            )
            for r in products if r.get("product_id")
        ],
        supply_arcs=[
            SupplyArc(
                supplier_id=str(r["supplier_id"]), material_id=str(r["material_id"]),
                unit_price=_num(r.get("unit_price")), lead_time=_num(r.get("lead_time")),
                lead_time_unit=r.get("lead_time_unit"), time_unit=r.get("time_unit"),
                volume=_num(r.get("volume")),
                # WP 15.2 (§25, D291): the lane's own lead-time spread.
                lead_time_dist=r.get("lead_time_dist"),
                lead_time_cv=_num(r.get("lead_time_cv")),
                lead_time_min=_num(r.get("lead_time_min")),
                lead_time_mode=_num(r.get("lead_time_mode")),
                lead_time_max=_num(r.get("lead_time_max")),
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
                # WP 14.2 — the row's own demand spec and its forecast series.
                demand_distribution=r.get("demand_distribution"),
                demand_mean=_num(r.get("demand_mean")),
                demand_variation=_num(r.get("demand_variation")),
                demand_min=_num(r.get("demand_min")),
                demand_max=_num(r.get("demand_max")),
                forecast=forecasts.get((str(r["product_id"]), str(r["customer_id"]))),
            )
            for r in outbound if r.get("product_id") and r.get("customer_id")
        ] + [
            # A forecast for a customer × product no outbound row names is still
            # that row's demand: it becomes an arc with no volume of its own.
            OutboundArc(product_id=pid, customer_id=cid, forecast=series)
            for (pid, cid), series in sorted(forecasts.items()) if (pid, cid) not in arc_keys
        ],
        # §4 D69 — the `customers` table was fetched by nothing, so every customer
        # reached the engine with `segment="default"` and `priority_weight=1.0`.
        # `ProjectData.customers` stays the ID list (ids also come from outbound
        # arcs); this carries the ATTRIBUTES for the ids the table describes.
        customer_rows=[
            CustomerRow(
                id=str(r["customer_id"]), name=r.get("name"),
                segment=r.get("segment"),
                priority_weight=_num(r.get("priority_weight")),
                # WP 14.3 — the customer's contracted floor, its rows' default
                # service target under sla_tier. Null = no floor, never 0.
                sla_fill_floor_pct=_num(r.get("sla_fill_floor_pct")),
            )
            for r in (customers or []) if r.get("customer_id")
        ],
        # §4 D174 — a master product CONSUMED by another product is a
        # sub-assembly. Declared here from the RAW BOM shape (the flattened
        # arcs above no longer show which nodes were intermediate): a
        # multi-level row's `material_id` under a real parent, or a
        # single-level row's `material_id`, is consumed. A parentless
        # multi-level row is NOT consumption — it is the root-row shape D171
        # settled. The mapper (`from_project_data`) excludes these ids from
        # the engine's product list with a mapping warning; without this, the
        # canonical sub-assembly dataset made every run impossible
        # (`products with empty BoM`).
        subassemblies=sorted({
            str(r["material_id"]).strip()
            for r in bom
            if r.get("material_id")
            and (r.get("product_id")
                 or str(r.get("higher_level_component_id") or "").strip())
            and str(r["material_id"]).strip() in {
                str(p["product_id"]).strip() for p in products if p.get("product_id")
            }
        }),
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


class ProjectReadError(RuntimeError):
    """A project table could not be READ — distinct from a table that is empty."""

    def __init__(self, table: str, detail: str) -> None:
        super().__init__(f"could not read {table}: {detail}")
        self.table = table


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
        """One project-scoped read. An EMPTY table returns []; a read that did
        not happen RAISES (audit F-08).

        This used to catch every exception and every non-200 and return [] for
        both — so a transient failure on `outbound_logistics` became a run with
        no demand, which then reported a perfect fill rate, and one wrong column
        name looked exactly like data the project did not have (§4 D69's note
        said so and could not close it). The worker marks the run `failed` with
        this message, which names the table and the status.
        """
        try:
            r = await http.get(
                f"{base}/rest/v1/{table}",
                params={"project_id": f"eq.{project_id}", "select": select},
                headers=headers,
            )
        except Exception as exc:
            raise ProjectReadError(table, f"request failed: {exc}") from exc
        if r.status_code != 200:
            raise ProjectReadError(table, f"HTTP {r.status_code}: {r.text[:200]}")
        try:
            body = r.json()
        except ValueError as exc:
            raise ProjectReadError(table, "response is not JSON") from exc
        if not isinstance(body, list):
            raise ProjectReadError(table, f"expected a list of rows, got: {str(body)[:200]}")
        return body

    # Best-effort BY DECLARATION: make sure a master row exists for every id in
    # the graph. A failure here changes no value the run reads — the mapper
    # names every BOM material with no master row and simulates it (§4 D166) —
    # so it does not fail the run; it is logged rather than swallowed.
    try:
        await http.post(
            f"{base}/rest/v1/rpc/ensure_item_masters",
            params={}, headers={**headers, "Content-Type": "application/json"},
            json={"p_project_id": project_id},
        )
    except Exception:
        log.warning("ensure_item_masters failed for project %s", project_id, exc_info=True)

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
        # D9: `lead_time_unit` must be SELECTed or the column below reads None
        # forever — PostgREST returns only what the projection names, so
        # adding the column to the table is not enough on its own.
        inbound=await rows(
            "inbound_logistics",
            "supplier_id,material_id,unit_price,lead_time,lead_time_unit,time_unit,volume,lead_time_dist,lead_time_cv,lead_time_min,lead_time_mode,lead_time_max",
        ),
        bom=bom,
        # One string literal, not two concatenated: `dataMapContract.test.ts` and
        # `graphHashCoverage.test.ts` parse this projection to prove every column
        # the run reads is mapped and hashed.
        outbound=await rows(
            "outbound_logistics",
            "product_id,customer_id,unit_price,volume,time_unit,demand_distribution,demand_mean,demand_variation,demand_min,demand_max",
        ),
        # WP 14.2 — the per-row forecast buckets, already spread to a weekly rate
        # at promotion (decision 7); `forecast_series` lays them on the run's weeks.
        demand_forecasts=await rows(
            "demand_forecasts",
            "customer_id,product_id,period_start,period_end,weekly_quantity",
        ),
        # §4 D69 — nothing fetched this table, so P-C.2's `priority` ordering and
        # its per-segment `sla_tiers` were inert on every project. Columns are
        # named explicitly for the same reason D9 gives above, and the names are
        # checked against the data contract rather than remembered: `rows()`
        # SWALLOWS a failed request and returns [], so one wrong column name
        # would leave every customer on the engine defaults and look exactly
        # like the defect being fixed. `sla_fill_floor_pct` is not selected —
        # `Customer` has no field for it (§16).
        customers=await rows("customers", "customer_id,name,segment,priority_weight,sla_fill_floor_pct"),
        policies=policies,
        scenario=scenario,
        project_model=project_model,
    )
