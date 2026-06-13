"""Convert a policy_versions.snapshot into the effective-policies dict shape
used by the engines (mirrors GraphCache._load_policies output):

    { "default": {family: {...}}, "node:<id>": {family: {...}}, "edge:<a→b>": ... }

Two snapshot shapes exist:
  * v2: { "schema_version": 2, "defaults": {7 families},
          "fulfillment_strategy": str,
          "overrides": [{scope, target_key, family, patch}, ...] }
  * v1 (legacy): flat { sourcing, inventory, ... } — defaults only, no overrides.
"""
from __future__ import annotations

from typing import Any

FAMILIES = (
    "sourcing",
    "inventory",
    "transport",
    "fulfillment",
    "production",
    "recovery",
    "demand",
)


def snapshot_to_policies(snapshot: dict[str, Any]) -> dict[str, Any]:
    effective: dict[str, Any] = {"default": {}}
    if not isinstance(snapshot, dict):
        return effective

    is_v2 = "defaults" in snapshot
    defaults = snapshot.get("defaults") if is_v2 else snapshot
    if isinstance(defaults, dict):
        for family in FAMILIES:
            val = defaults.get(family)
            if isinstance(val, dict) and val:
                effective["default"][family] = val

    strategy = snapshot.get("fulfillment_strategy")
    if isinstance(strategy, str) and strategy:
        effective["default"]["fulfillment_strategy"] = strategy

    if is_v2:
        for row in snapshot.get("overrides") or []:
            if not isinstance(row, dict):
                continue
            scope = row.get("scope", "node")
            target_key = row.get("target_key")
            family = row.get("family")
            patch = row.get("patch") or {}
            if not target_key or family not in FAMILIES:
                continue
            if isinstance(patch, dict) and patch:
                key = f"{scope}:{target_key}"
                effective.setdefault(key, {}).setdefault(family, {}).update(patch)

    return effective
