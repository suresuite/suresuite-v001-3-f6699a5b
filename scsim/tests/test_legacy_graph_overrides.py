"""Node/edge policy overrides in the legacy-graph conversion.

Supported per-target fields (material holding cost, product capacity) must be
applied; unsupported overrides must fall back to the default and be reported
in ConversionResult.notes.
"""
from __future__ import annotations

from scsim.io.legacy_graph import from_legacy_graph


class _FakeGraph:
    """Duck-typed minimal DiGraph: .nodes(data=True) + .in_edges(n, data=True)."""

    def __init__(self, nodes: dict[str, dict], edges: list[tuple[str, str, dict]]):
        self._nodes = nodes
        self._edges = edges

    def nodes(self, data: bool = False):
        return list(self._nodes.items()) if data else list(self._nodes)

    def in_edges(self, node: str, data: bool = False):
        return [(u, v, d) for u, v, d in self._edges if v == node]


def _graph() -> _FakeGraph:
    return _FakeGraph(
        nodes={
            "sup1": {"node_type": "supplier", "name": "Supplier A"},
            "mat1": {"node_type": "material", "name": "Material X"},
            "prod1": {"node_type": "product", "name": "Product P",
                      "weekly_demand": 100.0, "unit_price": 10.0},
            "cust1": {"node_type": "customer", "name": "Customer Z"},
        },
        edges=[
            ("sup1", "mat1", {"edge_type": "supply", "lead_time": 2.0, "unit_price": 1.0}),
            ("mat1", "prod1", {"edge_type": "bom", "consumption_rate": 1.0}),
            ("prod1", "cust1", {"edge_type": "outbound", "volume": 100.0}),
        ],
    )


def test_supported_node_overrides_applied():
    policies = {
        "default": {
            "inventory": {"holding_cost_pct": 0.20},
            "production": {"capacity_units_per_day": 1000.0, "utilization_cap_pct": 85.0},
        },
        "node:mat1": {"inventory": {"holding_cost_pct": 0.40}},
        "node:prod1": {"production": {"capacity_units_per_day": 500.0}},
    }
    result = from_legacy_graph(_graph(), policies, horizon_weeks=52, model_seeds=1)
    net = result.scenario.network
    mat = next(m for m in net.materials if m.id == "mat1")
    assert mat.holding_cost_rate == 40.0
    prod = next(p for p in net.products if p.id == "prod1")
    assert prod.production_capacity == 500.0 * 7.0 * 0.85


def test_unsupported_overrides_noted():
    policies = {
        "default": {"inventory": {"type": "min_max"}},
        "node:mat1": {"inventory": {"safety_stock_days": 21.0}},
        "edge:sup1→mat1": {"sourcing": {"strategy": "dual_sourcing"}},
    }
    result = from_legacy_graph(_graph(), policies, horizon_weeks=52, model_seeds=1)
    notes = "\n".join(result.notes)
    assert "node:mat1.inventory.safety_stock_days not supported" in notes
    assert "edge:sup1→mat1.sourcing.strategy not supported" in notes


def test_supported_overrides_not_noted():
    policies = {
        "default": {"inventory": {"holding_cost_pct": 0.20}},
        "node:mat1": {"inventory": {"holding_cost_pct": 0.30}},
    }
    result = from_legacy_graph(_graph(), policies, horizon_weeks=52, model_seeds=1)
    assert not any("holding_cost_pct not supported" in n for n in result.notes)


def test_composite_plant_key_capacity_applied():
    """The /policies plant grid writes "<plant>::<product>" (§4 D75).

    _SUPPORTED_OVERRIDE_FIELDS promises capacity survives per target; before
    the composite lookup it only did so for the bare "node:<product>" form,
    which no live UI writer produces.
    """
    policies = {
        "default": {
            "production": {"capacity_units_per_day": 1000.0, "utilization_cap_pct": 85.0},
        },
        "node:Focal plant::prod1": {"production": {"capacity_units_per_day": 500.0}},
    }
    result = from_legacy_graph(_graph(), policies, horizon_weeks=52, model_seeds=1)
    prod = next(p for p in result.scenario.network.products if p.id == "prod1")
    assert prod.production_capacity == 500.0 * 7.0 * 0.85
