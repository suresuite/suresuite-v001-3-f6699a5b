"""Per-project warm graph cache with LRU eviction.

Loads the supply chain graph from three Supabase tables:
  bom_single_level    → material→product BOM arcs  (edge_type="bom")
  inbound_logistics   → supplier→material arcs      (edge_type="supply")
  outbound_logistics  → product demand and customer arcs

Policy loading merges policy_defaults + policy_overrides into:
  { "default": {family: {...}}, "node:<id>": {family: {...}} }
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import networkx as nx

log = logging.getLogger(__name__)


@dataclass
class CachedGraph:
    project_id: str
    graph: nx.DiGraph
    policies: dict[str, Any] = field(default_factory=dict)
    last_kpis: dict[str, Any] = field(default_factory=dict)
    last_used: float = field(default_factory=time.time)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class GraphCache:
    def __init__(self, supabase_url: str, service_role_key: str, idle_ttl: int = 600):
        self._url = supabase_url.rstrip("/")
        self._key = service_role_key
        self._idle_ttl = idle_ttl
        self._cache: dict[str, CachedGraph] = {}
        self._client = httpx.AsyncClient(
            base_url=f"{self._url}/rest/v1",
            headers={
                "apikey": self._key,
                "Authorization": f"Bearer {self._key}",
                "Accept": "application/json",
                "Prefer": "return=representation",
            },
            timeout=15.0,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def get(self, project_id: str) -> CachedGraph:
        cg = self._cache.get(project_id)
        if cg is None:
            graph = await self._load_graph(project_id)
            policies = await self._load_policies(project_id)
            cg = CachedGraph(project_id=project_id, graph=graph, policies=policies)
            self._cache[project_id] = cg
            log.info(
                "warmed project %s  nodes=%d  edges=%d",
                project_id, graph.number_of_nodes(), graph.number_of_edges(),
            )
        cg.last_used = time.time()
        return cg

    def invalidate_policies(self, project_id: str) -> None:
        """Drop cached policies so next get_effective_policies() re-fetches."""
        if project_id in self._cache:
            self._cache[project_id].policies = {}
            log.debug("invalidated policies for %s", project_id)

    async def get_effective_policies(self, project_id: str) -> dict:
        """Return cached policies, refreshing from DB if cache is empty."""
        cg = self._cache.get(project_id)
        if cg and cg.policies:
            return cg.policies
        policies = await self._load_policies(project_id)
        if cg:
            cg.policies = policies
        return policies

    async def evict_idle(self) -> None:
        cutoff = time.time() - self._idle_ttl
        to_drop = [pid for pid, cg in self._cache.items() if cg.last_used < cutoff]
        for pid in to_drop:
            self._cache.pop(pid, None)
            log.info("evicted idle project %s", pid)

    # ------------------------------------------------------------------ helpers

    async def _get_json(self, path: str, params: dict) -> list[dict]:
        try:
            r = await self._client.get(path, params=params)
            if r.status_code == 200:
                data = r.json()
                return data if isinstance(data, list) else []
            log.warning("GET %s → %s  %s", path, r.status_code, r.text[:200])
        except Exception as exc:
            log.warning("GET %s failed: %s", path, exc)
        return []

    # ------------------------------------------------------------------ graph loader

    async def _load_graph(self, project_id: str) -> nx.DiGraph:
        """Build NetworkX DiGraph from bom_single_level + inbound + outbound logistics."""
        g: nx.DiGraph = nx.DiGraph()

        # inbound_logistics → supplier→material edges
        rows = await self._get_json(
            "/inbound_logistics",
            {
                "select": "supplier_id,material_id,lead_time,unit_price,volume,time_unit",
                "project_id": f"eq.{project_id}",
            },
        )
        for row in rows:
            sup_id = str(row["supplier_id"])
            mat_id = str(row["material_id"])
            if not g.has_node(sup_id):
                g.add_node(sup_id, node_type="supplier", name=sup_id)
            if not g.has_node(mat_id):
                g.add_node(mat_id, node_type="material", name=mat_id)
            lt_raw = float(row.get("lead_time") or 2.0)
            time_unit = str(row.get("time_unit") or "week").lower()
            # Normalise to weeks: if days unit or value > 30 assume days
            lt_weeks = lt_raw / 7.0 if ("day" in time_unit or lt_raw > 30) else lt_raw
            g.add_edge(
                sup_id, mat_id,
                edge_type="supply",
                lead_time=lt_weeks,
                lead_time_std=lt_weeks * 0.15,
                lt_dist="normal",
                unit_price=float(row.get("unit_price") or 1.0),
                volume=float(row.get("volume") or 0.0),
            )

        # bom_single_level → material→product edges
        rows = await self._get_json(
            "/bom_single_level",
            {
                "select": "product_id,material_id,consumption_rate",
                "project_id": f"eq.{project_id}",
            },
        )
        for row in rows:
            mat_id = str(row["material_id"])
            prd_id = str(row["product_id"])
            if not g.has_node(mat_id):
                g.add_node(mat_id, node_type="material", name=mat_id)
            if not g.has_node(prd_id):
                g.add_node(prd_id, node_type="product", name=prd_id)
            g.add_edge(
                mat_id, prd_id,
                edge_type="bom",
                consumption_rate=float(row.get("consumption_rate") or 1.0),
            )

        # outbound_logistics → product demand + customer nodes
        rows = await self._get_json(
            "/outbound_logistics",
            {
                "select": "product_id,customer_id,volume,time_unit,unit_price,expected_lead_time",
                "project_id": f"eq.{project_id}",
            },
        )
        product_demand: dict[str, float] = {}
        product_price:  dict[str, float] = {}
        for row in rows:
            prd_id  = str(row["product_id"])
            cust_id = str(row["customer_id"])
            vol = float(row.get("volume") or 0.0)
            t_unit = str(row.get("time_unit") or "week").lower()
            # time_unit is the volume period (docs/data-simulation-mapping.md §3);
            # the shipped templates use "yearly".
            if "year" in t_unit or "annual" in t_unit:
                weekly_vol = vol * 7.0 / 365.25
            elif "quarter" in t_unit:
                weekly_vol = vol * 7.0 / 91.3125
            elif "month" in t_unit:
                weekly_vol = vol * 7.0 / 30.4375
            elif "day" in t_unit or t_unit == "daily":
                weekly_vol = vol * 7.0
            else:
                weekly_vol = vol
            product_demand[prd_id] = product_demand.get(prd_id, 0.0) + weekly_vol
            if row.get("unit_price"):
                product_price[prd_id] = float(row["unit_price"])
            if not g.has_node(cust_id):
                g.add_node(cust_id, node_type="customer", name=cust_id)
            if not g.has_node(prd_id):
                g.add_node(prd_id, node_type="product", name=prd_id)
            g.add_edge(
                prd_id, cust_id,
                edge_type="outbound",
                volume=weekly_vol,
                expected_lead_time=float(row.get("expected_lead_time") or 1.0),
            )

        for prd_id, demand in product_demand.items():
            if g.has_node(prd_id):
                g.nodes[prd_id]["weekly_demand"] = demand
        for prd_id, price in product_price.items():
            if g.has_node(prd_id):
                g.nodes[prd_id]["unit_price"] = price

        return g

    # ------------------------------------------------------------------ policy loader

    async def _load_policies(self, project_id: str) -> dict[str, Any]:
        """
        Returns effective policy bundle:
          { "default": {family: {...}}, "node:<id>": {family: {...}}, ... }
        """
        effective: dict[str, Any] = {"default": {}}

        families = ("sourcing", "inventory", "transport", "fulfillment", "production", "recovery", "demand")
        defaults_rows = await self._get_json(
            "/policy_defaults",
            {
                "select": ",".join(families),
                "project_id": f"eq.{project_id}",
            },
        )
        if defaults_rows:
            for family in families:
                val = defaults_rows[0].get(family)
                if isinstance(val, dict) and val:
                    effective["default"][family] = val

        override_rows = await self._get_json(
            "/policy_overrides",
            {
                "select": "scope,target_key,family,patch",
                "project_id": f"eq.{project_id}",
            },
        )
        for row in override_rows:
            scope  = row.get("scope", "node")
            key    = f"{scope}:{row['target_key']}"
            family = row["family"]
            patch  = row.get("patch") or {}
            if isinstance(patch, dict) and patch:
                effective.setdefault(key, {}).setdefault(family, {}).update(patch)

        return effective
