"""Registry export contract (Part IX §9.6), traces, legacy adapter."""
from __future__ import annotations

import numpy as np
import pytest

from scsim import DisruptionEvent, Scenario
from scsim.core.engine import compile_scenario, run_replication, run_scenario
from scsim.io.legacy_graph import from_legacy_graph
from scsim.io.registry_export import build_registry
from scsim.io.traces import trace_frame, write_trace
from scsim.policies.registry import catalog

from .conftest import make_settings, single_chain_network

EXPECTED_CATALOG = {
    # catalog_ref → (status, stage)
    "P-P.1": ("implemented", "plant"),
    "P-P.2": ("planned", "plant"),
    "P-C.1": ("implemented", "customer"),
    "P-S.1": ("implemented", "supplier"),
    "P-P.3": ("implemented", "plant"),
    "P-P.4": ("implemented", "plant"),
    "P-S.2": ("implemented", "supplier"),
    "P-S.3": ("planned", "supplier"),
    "P-P.6": ("planned", "plant"),
    "P-T.1": ("planned", "transport"),
    "P-P.5": ("implemented", "plant"),
    "P-S.4": ("implemented", "supplier"),
    "P-P.8": ("planned", "plant"),
    "P-P.7": ("planned", "plant"),
    "P-T.4": ("planned", "transport"),
    "P-P.9": ("implemented", "plant"),
    "P-T.2": ("implemented", "transport"),
    "P-T.3": ("planned", "transport"),
    "P-C.2": ("planned", "customer"),
    "P-C.3": ("planned", "customer"),
    "P-P.10": ("planned", "plant"),
    "P-X.1": ("planned", "cross"),
}


def test_full_part_iv_catalog_registered():
    entries = {e.catalog_ref: e for e in catalog()}
    assert set(entries) == set(EXPECTED_CATALOG)
    for ref, (status, stage) in EXPECTED_CATALOG.items():
        assert entries[ref].status.value == status, ref
        assert entries[ref].stage.value == stage, ref


def test_registry_payload_complete():
    reg = build_registry()
    assert reg["engine_version"]
    assert len(reg["policies"]) == 22
    for pol in reg["policies"]:
        assert pol["params_schema"].get("properties") is not None or \
            pol["params_schema"].get("type") == "object"
        assert pol["summary"], f"{pol['id']} missing summary (docs CI gate)"
        if pol["status"] == "implemented":
            assert pol["hooks"], f"{pol['id']} implemented but no hooks exported"
        else:
            assert pol["milestone"], f"{pol['id']} planned but no milestone"
    assert [p["id"] for p in reg["pipeline"]["phases"]] == [
        "PH-00", "PH-10", "PH-20", "PH-30", "PH-40", "PH-50",
        "PH-60", "PH-70", "PH-80", "PH-90", "PH-99",
    ]
    assert {k["name"] for k in reg["kpis"]} >= {"fill_rate", "cost_of_resilience",
                                                "resilience_index"}
    assert "simulation_settings" in reg["entities"]


def test_param_schemas_carry_units():
    reg = build_registry()
    pp1 = next(p for p in reg["policies"] if p["id"] == "inventory_control")
    props = pp1["params_schema"]["properties"]
    assert props["coverage_weeks"].get("unit") == "weeks"
    assert props["coverage_weeks"].get("scope") == "G/M"


# --------------------------------------------------------------------- traces

def test_trace_roundtrip(tmp_path):
    sc = Scenario(name="t", network=single_chain_network(), settings=make_settings())
    ctx = run_replication(compile_scenario(sc), 0, 0, [])
    out = write_trace(ctx, tmp_path / "rep0.csv")
    assert out.exists()
    cols = trace_frame(ctx)
    assert cols["fill_rate"].shape == (sc.settings.horizon,)


# ------------------------------------------------------------- legacy adapter

class _FakeGraph:
    """Duck-typed stand-in for the sim-worker NetworkX DiGraph."""

    def __init__(self):
        self._nodes = {
            "sup1": {"node_type": "supplier", "name": "Supplier A"},
            "sup2": {"node_type": "supplier", "name": "Supplier B"},
            "mat1": {"node_type": "material"},
            "prod1": {"node_type": "product", "weekly_demand": 100.0, "unit_price": 10.0},
            "cust1": {"node_type": "customer"},
        }
        self._in_edges = {
            "mat1": [("sup1", "mat1", {"edge_type": "supply", "lead_time": 2.0, "unit_price": 1.0}),
                     ("sup2", "mat1", {"edge_type": "supply", "lead_time": 3.0, "unit_price": 1.3})],
            "prod1": [("mat1", "prod1", {"edge_type": "bom", "consumption_rate": 1.0})],
            "cust1": [("prod1", "cust1", {"edge_type": "outbound", "volume": 100.0})],
        }

    def nodes(self, data=False):
        return list(self._nodes.items()) if data else list(self._nodes)

    def in_edges(self, node, data=False):
        return list(self._in_edges.get(node, []))


def test_legacy_adapter_builds_runnable_scenario():
    policies = {"default": {
        "inventory": {"type": "min_max", "safety_stock_method": "service_level",
                      "service_level_target": 0.95},
        "fulfillment": {"backorder_allowed": True, "max_backorder_days": 14},
        "sourcing": {"strategy": "primary_backup"},
        "recovery": {"response": ["expedite_freight"]},
    }}
    schedule = [{"target": "sup1", "start_day": 140, "duration_days": 56, "magnitude_pct": 100}]
    conv = from_legacy_graph(_FakeGraph(), policies, horizon_weeks=70, seed=7,
                             model_seeds=2, disruption_schedule=schedule)
    sc = conv.scenario
    assert {p for p in sc.policies} >= {"inventory_control", "unmet_demand_handling",
                                        "safety_stock_materials", "backup_supplier",
                                        "expedited_shipments"}
    assert sc.events and sc.events[0].target_id == "sup1"
    res = run_scenario(sc, debug=True)
    assert 0.0 <= res.aggregates["fill_rate"]["mean"] <= 1.0
    assert res.stats.engine_version


def test_legacy_adapter_notes_surface_approximations():
    conv = from_legacy_graph(
        _FakeGraph(), {}, horizon_weeks=70,
        disruption_schedule=[{"target": "sup1", "start_day": 140, "duration_days": 28,
                              "magnitude_pct": 50}],
    )
    assert any("mapped to a full" in n for n in conv.notes)


def test_legacy_adapter_maps_plant_targets():
    """plant:* / node:plant reach the engine as NODE_PLANT instead of being skipped."""
    from scsim.entities.enums import EffectType, TargetType

    conv = from_legacy_graph(
        _FakeGraph(), {}, horizon_weeks=70, model_seeds=2,
        disruption_schedule=[
            {"target": "plant:main", "start_day": 140, "duration_days": 56, "magnitude_pct": 100},
            {"target": "node:plant", "start_day": 280, "duration_days": 28, "magnitude_pct": 40},
        ],
    )
    halt, throttle = conv.scenario.events
    assert halt.target_type == TargetType.NODE_PLANT
    assert halt.effect_type == EffectType.LEAD_TIME_EXTENSION
    assert throttle.target_type == TargetType.NODE_PLANT
    assert throttle.effect_type == EffectType.CAPACITY_REDUCTION
    assert throttle.capacity_factor == pytest.approx(0.60)
    assert not any("skipped" in n for n in conv.notes)
    res = run_scenario(conv.scenario, debug=True)
    assert res.aggregates["lost_sales_value"]["mean"] > 0.0
