"""Network science metrics for supply chain resilience analysis.

These metrics expose structural vulnerabilities that operational KPIs miss:
  - Betweenness centrality:  which nodes are bottlenecks on all paths
  - Single points of failure: nodes with no redundant upstream sources
  - Critical path length:    longest weighted (lead_time) path end-to-end
  - Supplier concentration:  Herfindahl index per material
  - Network depth:           number of tiers from raw material to customer

Used by the frontend ProjectIntelligence panel to surface risk insights
without running a full Monte Carlo simulation.
"""
from __future__ import annotations

import math
from typing import Any

import networkx as nx


def compute_network_metrics(graph: nx.DiGraph) -> dict[str, Any]:
    """
    Return a dict of network-level resilience metrics.

    All values are JSON-serialisable (no numpy types).
    """
    if graph.number_of_nodes() == 0:
        return _empty_metrics()

    result: dict[str, Any] = {}

    # --- Betweenness centrality (normalised 0–1) ---
    try:
        bc = nx.betweenness_centrality(graph, normalized=True, weight=None)
        result["betweenness_centrality"] = {k: round(v, 4) for k, v in bc.items()}
        if bc:
            top_node = max(bc, key=bc.__getitem__)
            result["highest_betweenness_node"] = top_node
            result["highest_betweenness_score"] = round(bc[top_node], 4)
    except Exception:
        result["betweenness_centrality"] = {}

    # --- Single points of failure ---
    # A supplier node with no peer supplying the same material = SPOF
    spof: list[str] = []
    for node, data in graph.nodes(data=True):
        if data.get("node_type") != "material":
            continue
        suppliers_for_m = [
            s for s, _, d in graph.in_edges(node, data=True)
            if graph.nodes.get(s, {}).get("node_type") == "supplier"
               or d.get("edge_type") == "supply"
        ]
        if len(suppliers_for_m) == 1:
            spof.append(suppliers_for_m[0])
    result["single_points_of_failure"] = list(set(spof))
    result["spof_count"] = len(result["single_points_of_failure"])

    # --- Critical path: longest lead-time-weighted path supplier → customer ---
    try:
        # DAG longest path using negated lead_time weights
        cp_length = _critical_path_weeks(graph)
        result["critical_path_weeks"] = round(cp_length, 2)
    except Exception:
        result["critical_path_weeks"] = None

    # --- Network depth (number of tiers) ---
    result["network_depth"] = _network_depth(graph)

    # --- Supplier concentration per material (Herfindahl-Hirschman Index) ---
    hhi_by_material: dict[str, float] = {}
    for node, data in graph.nodes(data=True):
        if data.get("node_type") != "material":
            continue
        volumes = [
            float(d.get("volume", 1.0))
            for _, _, d in graph.in_edges(node, data=True)
            if d.get("edge_type") == "supply" or graph.nodes.get(_, {}).get("node_type") == "supplier"
        ]
        hhi_by_material[node] = _hhi(volumes)
    result["supplier_concentration_hhi"] = {k: round(v, 4) for k, v in hhi_by_material.items()}
    result["mean_supplier_hhi"] = round(
        sum(hhi_by_material.values()) / max(len(hhi_by_material), 1), 4
    )

    # --- Connectivity summary ---
    result["n_nodes"] = graph.number_of_nodes()
    result["n_edges"] = graph.number_of_edges()
    result["n_suppliers"] = sum(
        1 for _, d in graph.nodes(data=True) if d.get("node_type") == "supplier"
    )
    result["n_materials"] = sum(
        1 for _, d in graph.nodes(data=True) if d.get("node_type") == "material"
    )
    result["n_products"] = sum(
        1 for _, d in graph.nodes(data=True) if d.get("node_type") == "product"
    )

    # --- Resilience score: composite 0–1 ---
    result["resilience_score"] = _composite_resilience(result)

    return result


def ttr_weeks(
    graph: nx.DiGraph,
    baseline_fill_rate: float,
    ts_fill_rate: list[float],
    disruption_start: int = 0,
) -> float | None:
    """
    Time-to-recovery: first week after disruption_start where fill_rate
    recovers to ≥ 95% of baseline.  Returns None if never recovered.
    """
    threshold = 0.95 * baseline_fill_rate
    for i, fr in enumerate(ts_fill_rate[disruption_start:], start=disruption_start):
        if fr >= threshold:
            return float(i - disruption_start)
    return None


def resilience_index(
    baseline_revenue: float,
    disrupted_revenue: float,
) -> float:
    """RI = disrupted / baseline.  1.0 = no impact; 0.0 = total loss."""
    if baseline_revenue <= 0:
        return 0.0
    return round(min(1.0, disrupted_revenue / baseline_revenue), 4)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _critical_path_weeks(graph: nx.DiGraph) -> float:
    """Longest weighted path (sum of edge lead_time) through the DAG."""
    if not nx.is_directed_acyclic_graph(graph):
        # Break cycles for the purpose of CP analysis
        g2 = nx.DiGraph(graph)
        for u, v in list(nx.find_cycle(g2)):
            g2.remove_edge(u, v)
    else:
        g2 = graph

    # Use dynamic programming on topological order
    dist: dict[str, float] = {n: 0.0 for n in g2.nodes}
    for n in nx.topological_sort(g2):
        for _, succ, data in g2.out_edges(n, data=True):
            w = float(data.get("lead_time", 0.0))
            if dist[n] + w > dist[succ]:
                dist[succ] = dist[n] + w
    return max(dist.values()) if dist else 0.0


def _network_depth(graph: nx.DiGraph) -> int:
    """Number of tiers = longest path by hop count (unweighted)."""
    try:
        return nx.dag_longest_path_length(graph)
    except Exception:
        return 0


def _hhi(volumes: list[float]) -> float:
    """Herfindahl-Hirschman Index: 1/n (equal share) → 1.0 (monopoly)."""
    total = sum(volumes)
    if total <= 0 or not volumes:
        return 1.0  # no data → treat as monopoly (worst case)
    shares = [v / total for v in volumes]
    return sum(s ** 2 for s in shares)


def _composite_resilience(m: dict) -> float:
    """
    Simple composite score 0–1 where higher = more resilient.
      +0.4 if spof_count == 0
      +0.3 based on mean_supplier_hhi (lower HHI = better)
      +0.3 based on betweenness (lower peak = better)
    """
    score = 0.0
    if m.get("spof_count", 1) == 0:
        score += 0.4
    hhi = float(m.get("mean_supplier_hhi", 1.0))
    score += 0.3 * max(0.0, 1.0 - hhi)
    bc_peak = float(m.get("highest_betweenness_score", 1.0))
    score += 0.3 * max(0.0, 1.0 - bc_peak)
    return round(score, 4)


def _empty_metrics() -> dict[str, Any]:
    return {
        "betweenness_centrality": {},
        "highest_betweenness_node": None,
        "highest_betweenness_score": 0.0,
        "single_points_of_failure": [],
        "spof_count": 0,
        "critical_path_weeks": None,
        "network_depth": 0,
        "supplier_concentration_hhi": {},
        "mean_supplier_hhi": 1.0,
        "n_nodes": 0,
        "n_edges": 0,
        "n_suppliers": 0,
        "n_materials": 0,
        "n_products": 0,
        "resilience_score": 0.0,
    }
