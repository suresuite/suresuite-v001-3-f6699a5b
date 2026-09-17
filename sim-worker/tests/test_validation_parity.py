"""Engine ↔ platform-grader validation parity (§8.2).

The TS grading module (supabase/functions/_shared/grading.ts) claims to
mirror the engine's fallback semantics. This suite is the Python half of
that contract: the SAME golden fixture the deno tests lock
(fixtures/validation_parity/dataset.json) is fed through the worker's real
ingestion path (datamap.build_project_data → scsim from_project_data), and

  * the engine's WARN-level MappingWarnings must coincide, field-for-field
    and row-for-row, with the grader's warn findings (committed in
    expected_findings.json) for every field carrying a fallback_spec;
  * the unsourced-BOM variant must raise the hard ValueError the grader
    reports as its only `block`.

Info-grade findings are provenance notes and deliberately looser: the
engine stays silent for some data-derived fallbacks (e.g. demand from
outbound volume) that the grader still surfaces.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("scsim")

from scsim.io import from_project_data  # noqa: E402

from sim_worker.datamap import build_project_data  # noqa: E402

FIXTURE_DIR = (
    Path(__file__).resolve().parents[2]
    / "supabase" / "functions" / "_shared" / "fixtures" / "validation_parity"
)

# Engine MappingWarning (entity kind, field) → grader manifest field.
_ENTITY_FIELD_TO_MANIFEST = {
    ("supply", "cost"): "inbound_logistics.unit_price",
    ("supply", "lead_time"): "inbound_logistics.lead_time",
    ("material", "cost"): "materials.cost",
    ("product", "unit_price"): "products.sell_price",
    ("product", "demand_mean"): "products.demand_mean",
    ("product", "production_capacity"): "products.production_capacity",
}

# Fields whose warn semantics the engine expresses as MappingWarnings —
# exactly the base requirements carrying a fallback_spec. (demand_cv's warn
# is manifest-only: the engine defaults CV silently, which the manifest
# declares instead.)
_PARITY_FIELDS = set(_ENTITY_FIELD_TO_MANIFEST.values())


def _fixture() -> dict:
    return json.loads((FIXTURE_DIR / "dataset.json").read_text())


def _expected_warns() -> set[tuple[str, str]]:
    expected = json.loads((FIXTURE_DIR / "expected_findings.json").read_text())
    out: set[tuple[str, str]] = set()
    for f in expected:
        if f["severity"] != "warn" or f["field"] not in _PARITY_FIELDS:
            continue
        for row in f["rows"]:
            out.add((f["field"], row.replace("→", "->")))
    return out


def _project_data(ds: dict, fx: dict):
    return build_project_data(
        suppliers=ds["suppliers"],
        materials=ds["materials"],
        products=ds["products"],
        inbound=ds["inbound"],
        bom=ds["bom"],
        outbound=ds["outbound"],
        policies={"default": fx["defaults"]},
        scenario=fx["scenario"],
        project_model="make_to_stock",
    )


def _engine_warns(warnings) -> set[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    for w in warnings:
        if w.level != "warn":
            continue
        kind, _, entity_id = w.entity.partition(":")
        manifest_field = _ENTITY_FIELD_TO_MANIFEST.get((kind, w.field))
        if manifest_field is None:
            continue  # scenario/event/policy notes — not manifest fields
        out.add((manifest_field, entity_id))
    return out


def test_engine_warns_match_grader_warns():
    fx = _fixture()
    mapping = from_project_data(_project_data(fx["dataset"], fx))
    assert _engine_warns(mapping.warnings) == _expected_warns(), (
        "engine WARN MappingWarnings diverged from the shared grader's warn "
        "findings — grading.ts and project_map.py no longer mirror each other"
    )


def test_engine_emits_no_unexpected_warn_fields():
    """Every warn-class engine fallback on a manifest field must be declared
    in the registry (fallback_spec) — a new silent default fails here first."""
    fx = _fixture()
    mapping = from_project_data(_project_data(fx["dataset"], fx))
    for w in mapping.warnings:
        if w.level != "warn":
            continue
        kind, _, _ = w.entity.partition(":")
        if kind in ("scenario", "event", "policy"):
            continue
        assert (kind, w.field) in _ENTITY_FIELD_TO_MANIFEST, (
            f"engine warn on {w.entity}.{w.field} has no manifest mapping — "
            f"declare it in base_data_requirements (fallback_spec) and teach "
            f"grading.ts its reducer"
        )


def test_unsourced_bom_material_is_the_hard_block():
    fx = _fixture()
    ds = {
        **fx["dataset"],
        "materials": fx["dataset"]["materials"] + fx["unsourced_extra"]["materials"],
        "bom": fx["dataset"]["bom"] + fx["unsourced_extra"]["bom"],
    }
    with pytest.raises(ValueError, match="no supplier link"):
        from_project_data(_project_data(ds, fx))


def test_multi_level_variant_flattens_to_the_single_level_bom():
    """The fixture's multi_level_variant (P_OK's materials routed through the
    intermediate SUB_OK) must flatten to exactly dataset.bom's product→material
    pairs — the Python half of the normalizeBomRows parity grading_test.ts pins
    on the TS side. The intermediate must be collapsed away, never sourced."""
    fx = _fixture()
    data = _project_data({**fx["dataset"], "bom": fx["multi_level_variant"]["bom"]}, fx)
    assert sorted((b.product_id, b.material_id) for b in data.bom) == sorted(
        (b["product_id"], b["material_id"]) for b in fx["dataset"]["bom"]
    )
    from_project_data(data)  # engine maps it — no unsourced ValueError


def test_multi_level_unsourced_deep_leaf_raises_like_single_level():
    """A leaf material under the intermediate (not directly under a product)
    must still trace up to its root and raise the engine's hard failure —
    the case the gate's old per-edge parent→product_id mapping missed."""
    fx = _fixture()
    mlv = fx["multi_level_variant"]
    ds = {
        **fx["dataset"],
        "materials": fx["dataset"]["materials"] + fx["unsourced_extra"]["materials"],
        "bom": mlv["bom"] + mlv["unsourced_bom"],
    }
    with pytest.raises(ValueError, match="M_UNSOURCED"):
        from_project_data(_project_data(ds, fx))


def test_policy_activation_matches_shared_grader():
    """The fixture's activation_variant pins _map_policies' activation keys to
    the TS activeEnginePolicies mirror (grading_test.ts asserts the TS half)."""
    fx = _fixture()
    variant = fx["activation_variant"]
    data = build_project_data(
        suppliers=fx["dataset"]["suppliers"],
        materials=fx["dataset"]["materials"],
        products=fx["dataset"]["products"],
        inbound=fx["dataset"]["inbound"],
        bom=fx["dataset"]["bom"],
        outbound=fx["dataset"]["outbound"],
        policies={"default": variant["defaults"]},
        scenario=fx["scenario"],
        project_model="make_to_stock",
    )
    mapping = from_project_data(data)
    assert sorted(mapping.scenario.policies.keys()) == variant["expected_policies"]

    # Wired parameters, not just activation (G1 closure):
    pols = mapping.scenario.policies
    assert pols["proactive_multi_sourcing"]["weights"] == {
        "M_OK": {"S1": 60.0, "S2": 40.0}
    }
    assert pols["early_warning_failover"]["detection_lag_weeks"] == 1  # 7 days
    assert pols["fg_safety_stock"]["sizing"] == "service_level"
    assert pols["fg_safety_stock"]["service_level_pct"] == 95.0
    assert pols["material_allocation"]["activation"] == "during_disruption"


def test_sla_tiers_and_node_ratio_overrides_reach_the_engine():
    fx = _fixture()
    policies = {
        "default": {
            "fulfillment_strategy": "make_to_stock",
            "sourcing": {"strategy": "multi"},
            "fulfillment": {"allocation": "sla_tier",
                            "tier_overrides": {"gold": 0.98, "silver": 0.9}},
        },
        # Supplier-stage overrides (target_key "<supplier>::<material>"):
        # arc-level shares that don't sum to 100 are renormalized with a note.
        "node:S1::M_OK": {"sourcing": {"ratios": {"S1": 0.5}}},
        "node:S2::M_OK": {"sourcing": {"ratios": {"S2": 0.3}}},
    }
    ds = dict(fx["dataset"])
    # Two customers so P-C.2 activates.
    ds = {**ds, "outbound": ds["outbound"] + [
        {"product_id": "P_OK", "customer_id": "C2", "unit_price": 24.0,
         "volume": 50, "time_unit": "week"},
    ]}
    data = build_project_data(
        suppliers=ds["suppliers"], materials=ds["materials"], products=ds["products"],
        inbound=ds["inbound"], bom=ds["bom"], outbound=ds["outbound"],
        policies=policies, scenario=fx["scenario"], project_model="make_to_stock",
    )
    mapping = from_project_data(data)
    pols = mapping.scenario.policies
    assert pols["customer_allocation"] == {
        "rule": "sla_tier", "sla_tiers": {"gold": 98.0, "silver": 90.0}
    }
    weights = pols["proactive_multi_sourcing"]["weights"]["M_OK"]
    assert round(weights["S1"], 4) == 62.5 and round(weights["S2"], 4) == 37.5
    assert any(w.entity == "policy:proactive_multi_sourcing" and "renormalized" in w.reason
               for w in mapping.warnings)


# ── §4 D75 — per-product capacity, both surfaces ────────────────────────────
# The /policies plant grid keys production patches "<plant>::<product>". Before
# the engine learned that spelling, engine and grader agreed by accident: both
# ignored the row. This is the assertion that would have caught the divergence,
# and the one that fails if either side stops honouring the key.

def _policy_map(fx: dict, override_rows: list[dict]) -> dict:
    """policy_overrides rows → the worker's policies dict.

    Mirrors how the run assembles it (`policy_snapshot.py`, `graph_cache.py`):
    the map key is f"{scope}:{target_key}" and the patch sits under its family.
    """
    policies: dict = {"default": fx["defaults"]}
    for row in override_rows:
        key = f"{row['scope']}:{row['target_key']}"
        policies.setdefault(key, {})[row["family"]] = row["patch"]
    return policies


def _capacity_of(fx: dict, override_rows: list[dict], product_id: str):
    data = build_project_data(
        suppliers=fx["dataset"]["suppliers"], materials=fx["dataset"]["materials"],
        products=fx["dataset"]["products"], inbound=fx["dataset"]["inbound"],
        bom=fx["dataset"]["bom"], outbound=fx["dataset"]["outbound"],
        policies=_policy_map(fx, override_rows), scenario=fx["scenario"],
        project_model="make_to_stock",
    )
    mapping = from_project_data(data)
    product = next(p for p in mapping.scenario.network.products if p.id == product_id)
    return product.production_capacity, mapping.warnings


def test_composite_plant_key_capacity_reaches_the_engine():
    fx = _fixture()
    variant = fx["plant_override_variant"]
    target = variant["target_product"]
    cap, warns = _capacity_of(fx, variant["composite"], target)
    assert cap == pytest.approx(variant["expected_weekly_capacity"]["composite"])
    # …and the engine stops calling it defaulted, which is the half the grader
    # mirrors: grading_test.ts asserts the same product leaves the warn rows.
    assert (("products.production_capacity", target)) not in _engine_warns(warns)


def test_bare_product_key_capacity_still_reaches_the_engine():
    fx = _fixture()
    variant = fx["plant_override_variant"]
    cap, _ = _capacity_of(fx, variant["bare"], variant["target_product"])
    assert cap == pytest.approx(variant["expected_weekly_capacity"]["bare"])


def test_composite_key_wins_over_bare_key():
    """defaults < node:<product> < node:<owner>::<product> — the precedence
    grading.ts::productionByProduct implements on the other side."""
    fx = _fixture()
    variant = fx["plant_override_variant"]
    cap, _ = _capacity_of(
        fx, list(variant["bare"]) + list(variant["composite"]), variant["target_product"],
    )
    assert cap == pytest.approx(variant["expected_weekly_capacity"]["composite"])


def test_engine_and_grader_agree_on_which_rows_are_capacity_defaulted():
    """The parity claim itself, for the field D75 moved.

    The grader's answer for this variant is pinned in grading_test.ts; here the
    engine must reach the same set — every product that warns on capacity with
    the override applied, and only those.
    """
    fx = _fixture()
    variant = fx["plant_override_variant"]
    _, warns = _capacity_of(fx, variant["composite"], variant["target_product"])
    capacity_warns = {
        entity for field, entity in _engine_warns(warns)
        if field == "products.production_capacity"
    }
    assert capacity_warns == {"P_NO_DEMAND"}, (
        "engine capacity warns diverged from the grader's — grading.ts and "
        "project_map.py no longer mirror each other on per-product capacity"
    )
