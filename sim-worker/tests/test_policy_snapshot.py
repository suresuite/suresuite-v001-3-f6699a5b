"""snapshot_to_policies: policy_versions.snapshot → effective-policies dict."""
from __future__ import annotations

from sim_worker.policy_snapshot import snapshot_to_policies


def test_v2_snapshot_defaults_and_overrides():
    snapshot = {
        "schema_version": 2,
        "defaults": {
            "inventory": {"type": "min_max", "safety_stock_days": 7},
            "sourcing": {"strategy": "dual_sourcing"},
            "transport": {},
        },
        "fulfillment_strategy": "make_to_order",
        "overrides": [
            {"scope": "node", "target_key": "mat1", "family": "inventory",
             "patch": {"holding_cost_pct": 0.4}},
            {"scope": "edge", "target_key": "sup1→mat1", "family": "sourcing",
             "patch": {"strategy": "primary_backup"}},
        ],
    }
    out = snapshot_to_policies(snapshot)
    assert out["default"]["inventory"]["safety_stock_days"] == 7
    assert out["default"]["sourcing"]["strategy"] == "dual_sourcing"
    assert "transport" not in out["default"]  # empty family dropped
    assert out["default"]["fulfillment_strategy"] == "make_to_order"
    assert out["node:mat1"]["inventory"]["holding_cost_pct"] == 0.4
    assert out["edge:sup1→mat1"]["sourcing"]["strategy"] == "primary_backup"


def test_v1_snapshot_flat_defaults_only():
    snapshot = {
        "inventory": {"type": "base_stock"},
        "recovery": {"response": ["reroute"]},
    }
    out = snapshot_to_policies(snapshot)
    assert out["default"]["inventory"]["type"] == "base_stock"
    assert out["default"]["recovery"]["response"] == ["reroute"]
    assert list(k for k in out if k != "default") == []


def test_malformed_rows_skipped():
    snapshot = {
        "schema_version": 2,
        "defaults": {"inventory": {"type": "rop"}},
        "overrides": [
            "not-a-dict",
            {"scope": "node", "target_key": None, "family": "inventory", "patch": {"x": 1}},
            {"scope": "node", "target_key": "m1", "family": "bogus", "patch": {"x": 1}},
            {"scope": "node", "target_key": "m1", "family": "inventory", "patch": {}},
        ],
    }
    out = snapshot_to_policies(snapshot)
    assert out == {"default": {"inventory": {"type": "rop"}}}


def test_non_dict_input():
    assert snapshot_to_policies(None) == {"default": {}}  # type: ignore[arg-type]
