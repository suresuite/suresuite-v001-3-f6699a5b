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
    "P-C.2": ("implemented", "customer"),
    "P-C.3": ("planned", "customer"),
    "P-C.6": ("implemented", "customer"),
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
    assert len(reg["policies"]) == 23
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


# ------------------------------------------------- data requirements (§8.1)

# The dataset.column vocabulary of docs/data-simulation-mapping.md §4 — the
# frontend (dataMap.ts) and the sim-command gate key their evaluators on it.
_KNOWN_DATASETS = {
    "materials", "products", "suppliers",
    "inbound_logistics", "outbound_logistics", "bom_single_level",
    # `customers` joined the vocabulary in WP 6.2 (§4 D94): P-C.2 reads
    # `Customer.priority_weight` and `Customer.segment` on every run and declared
    # neither, so three separate gates that derive "what the engine reads" from
    # the registry were blind to them. This allow-list is the fourth — it had to
    # move in the same change, which is §4 D101's lesson (a gate pinned to a
    # value a declaration moved).
    "customers",
}
_LEVELS = {"required", "recommended", "defaulted"}


def test_registry_exports_data_requirements():
    reg = build_registry()

    # Base requirements: the always-on world-model economics with fallbacks.
    base = {r["field"]: r for r in reg["base_data_requirements"]}
    for field in ("materials.cost", "products.sell_price", "products.demand_mean"):
        assert base[field]["level"] == "required", field
        assert base[field]["fallback"], f"{field} must name its fallback chain"
    assert base["products.production_capacity"]["level"] == "recommended"
    assert base["suppliers.capacity_per_week"]["level"] == "defaulted"

    # Per-policy requirements: the manifest's policy-conditional half.
    by_id = {p["id"]: p for p in reg["policies"]}
    p5 = {r["field"]: r for r in by_id["short_term_capacity"]["data_requirements"]}
    assert p5["products.production_capacity"]["level"] == "required"
    pc2 = {r["field"]: r for r in by_id["customer_allocation"]["data_requirements"]}
    assert pc2["outbound_logistics.volume"]["level"] == "required"
    # §4 D94 — the two Customer attributes P-C.2 reads on every run. `defaulted`
    # and not `recommended`: `Customer` carries a default for both, so an absent
    # value is a substitution to report (T2) and never a blocked dispatch.
    for field in ("customers.priority_weight", "customers.segment"):
        assert pc2[field]["level"] == "defaulted", field
        assert pc2[field]["fallback"], f"{field} declares no fallback"

    # Vocabulary discipline: every declared field must parse as a known
    # dataset.column reference with a valid level (else the generated
    # validators cannot grade it).
    all_reqs = list(reg["base_data_requirements"])
    for pol in reg["policies"]:
        all_reqs.extend(pol["data_requirements"])
    assert all_reqs, "manifest must not be empty"
    for r in all_reqs:
        dataset, _, column = r["field"].partition(".")
        assert dataset in _KNOWN_DATASETS, r["field"]
        assert column, r["field"]
        assert r["level"] in _LEVELS, r["field"]
        assert r["reason"], f"{r['field']} missing reason"


def test_registry_exports_machine_readable_fallback_specs():
    """§8.2: the engine's fallback chains export as ordered steps the platform
    graders dispatch on — each step either a named reducer (data-derived,
    grade info) or a neutral constant (grade warn), mirroring the
    MappingWarning level project_map.py emits when that step resolves."""
    reg = build_registry()
    base = {r["field"]: r for r in reg["base_data_requirements"]}

    # materials.cost carries TWO data-derived steps, in the engine's order:
    # weight by the volume actually bought through each lane, and fall back to
    # the cheapest quote only when no lane carries a volume to weight by.
    cost = base["materials.cost"]["fallback_spec"]
    assert [s["reducer"] for s in cost] == [
        "volume_weighted_inbound_price", "cheapest_inbound_price", None,
    ]
    assert cost[2]["constant"] == 1.0
    assert [s["grade"] for s in cost] == ["info", "info", "warn"]

    assert base["products.sell_price"]["fallback_spec"][0]["reducer"] == \
        "demand_weighted_outbound_price"
    assert base["products.demand_mean"]["fallback_spec"][1]["constant"] == 0.0
    assert base["inbound_logistics.lead_time"]["fallback_spec"][0]["constant"] == 2.0

    # Every step is well-formed: exactly one of reducer/constant, a valid grade.
    for r in reg["base_data_requirements"]:
        for s in r.get("fallback_spec", []):
            assert s["grade"] in ("info", "warn"), r["field"]
            assert (s["reducer"] is None) != (s["constant"] is None), r["field"]


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


# ------------------------------------------------- stress battery (§4 D106)

def test_registry_declares_the_stress_battery():
    """The battery is a DECLARATION, not a text scan over a Python literal.

    §4 D106: `ST_DEFINITIONS` was reachable only by parsing the literal out of
    `scsim/stress/battery.py`, which is §4 D90's weakest door — and the archived
    manual had already drifted from it. §3 makes this module the single source of
    truth for what the engine declares, so the battery is exported here.
    """
    from scsim.stress.battery import ST_DEFINITIONS

    reg = build_registry()
    tests = reg["stress_tests"]
    assert [t["id"] for t in tests] == list(ST_DEFINITIONS), \
        "the export must carry every declared cell, in the engine's own order"

    # `entrypoint` is resolved by getattr, so it answers "is there a callable"
    # rather than "does a docstring claim one". ST-1 and ST-2 are runnable; the
    # rest are declared and wait on M7.
    runnable = {t["id"]: t["entrypoint"] for t in tests if t["entrypoint"]}
    assert runnable == {
        "ST-1": "scsim.stress.run_st1",
        "ST-2": "scsim.stress.run_st2",
    }, runnable

    # No glyph survives into the description, and no stray space is left where
    # one was: "(manuscript ✅)" must become "(manuscript)", not "(manuscript )".
    for t in tests:
        assert not set(t["description"]) & set("✅❌️"), t["id"]
        assert " )" not in t["description"], t["id"]
        assert t["description"] == t["description"].strip()
    st1 = next(t for t in tests if t["id"] == "ST-1")
    assert "(manuscript)" in st1["description"], st1["description"]


# ------------------------------------------------- policy bundle keys (§4 D90)

def test_policy_bundle_keys_match_what_the_mapper_reads():
    """The declaration and the reader may not drift — §4 D90.

    `POLICY_BUNDLE_KEYS` says which policy parameter or entity field each
    /policies bundle key feeds. It makes no runtime decision, so nothing would
    break if it went stale — which is exactly why it needs a gate. A declaration
    nothing checks is the defect §4 D21 and D22 are, and this one is published
    through the registry into the frontend's resolution chains.

    BOTH DIRECTIONS. A key declared here that the mapper does not read is fiction;
    a key the mapper reads that is not declared here is door 3 reopening.
    """
    import re
    from pathlib import Path

    from scsim.io.project_map import POLICY_BUNDLE_KEYS

    src = Path(__file__).resolve().parents[1].joinpath(
        "scsim", "io", "project_map.py").read_text()
    # The declaration block itself must not count as a read, or every entry
    # corroborates itself and the gate is vacuous.
    start = src.index("POLICY_BUNDLE_KEYS")
    end = src.index("def base_data_requirements")
    body = src[:start] + src[end:]

    declared = {k["key"] for k in POLICY_BUNDLE_KEYS}
    assert len(declared) == len(POLICY_BUNDLE_KEYS), "a key is declared twice"

    # Direction 1 — everything declared is read by the mapper, as a bundle key.
    for key in sorted(declared):
        assert re.search(rf"""\.get\(\s*["']{re.escape(key)}["']""", body), (
            f"{key} is declared in POLICY_BUNDLE_KEYS and the mapper never reads it")

    # Direction 2 — every FAMILY dict read is declared. The families are the
    # /policies bundle's own namespaces; a `.get` on one of them is a bundle key.
    family_vars = {"inv": "inventory", "fulfil": "fulfillment", "src": "sourcing",
                   "prod_pol": "production", "sourcing": "sourcing"}
    # Keys the mapper reads that are NOT grid fields: the grid declares what it
    # renders (`columnSpecs`), and a bundle key with no column is not door 3's
    # subject — door 3 is about CELLS whose only evidence is this file.
    not_rendered = {
        "ratios", "strategy", "safety_stock_method", "backorder_allowed",
        "max_backorder_days", "backorder_cost_per_day", "allocation",
        "tier_overrides", "fulfillment_strategy",
        "min_share_pct", "review_period_days",
        "primary_source", "material_price", "initial_on_hand", "holding_cost_pct",
        "sourcing_firm", "moq", "lead_time_distribution", "ordering_cost",
        "supplier_capacity_per_day", "capacity_machine_per_day",
        "capacity_labor_per_day", "production_cost_per_unit", "mode",
        "cost_per_km", "production_lead_time_mean_days",
    }
    seen: set[str] = set()
    for var, _family in family_vars.items():
        for m in re.finditer(rf"""\b{var}\.get\(\s*["']([a-z_]+)["']""", body):
            seen.add(m.group(1))
    undeclared = sorted(seen - declared - not_rendered)
    assert not undeclared, (
        "the mapper reads these bundle keys and POLICY_BUNDLE_KEYS does not declare "
        f"them: {undeclared}. Either declare them (they are door 3) or add them to "
        "`not_rendered` with the reason they are not a grid cell (§4 D90).")


def test_registry_publishes_the_policy_bundle_keys():
    reg = build_registry()
    keys = reg["policy_bundle_keys"]
    assert len(keys) >= 9, keys
    for k in keys:
        assert k["key"] and k["family"] and k["target"], k
        # `transform` is the part a reader cannot get anywhere else: it says what
        # happens to the number between the cell and the engine, which is what
        # makes a chain followable rather than merely present (§5 T1).
        assert len(k["transform"]) > 30, f"{k['key']} declares no usable transform"
    # One of them lands on an ENTITY field rather than a policy parameter, and
    # that is the case door 2 could never have covered — a Params addition would
    # have been the wrong fix.
    entity = [k for k in keys if k["catalog_ref"] is None]
    assert [k["key"] for k in entity] == [
        "capacity_units_per_day", "utilization_cap_pct"], entity
    # Both of them are also SHADOWED, and by the same master column — the plant
    # grid's two capacity cells are unreachable together or not at all (§4 D167).
    assert {k["key"]: k.get("shadowed_by") for k in entity} == {
        "capacity_units_per_day": "products.production_capacity",
        "utilization_cap_pct": "products.production_capacity",
    }
    # A `shadowed_by` that names nothing the engine reads is fiction, so it must
    # resolve to a declared base data requirement.
    fields = {r["field"] for r in reg["base_data_requirements"]}
    for k in keys:
        if k.get("shadowed_by"):
            assert k["shadowed_by"] in fields, k


# --------------------------------------------- what an EMPTY column means (D167)

def test_empty_means_is_declared_for_the_one_column_that_has_one():
    """`suppliers.capacity_per_week` is NULL = ∞, and the registry now says so.

    Until WP 9.3 the statement had two authors: this table said "unlimited" in
    the prose `fallback` field, and the frontend's `columnSpecs.ts` carried the
    token and the tooltip the grid actually rendered. The frontend's copy was
    the only machine-readable one, so the engine's own declaration could not be
    read by the surface that displayed it — §2.1 `single-source`, one layer
    below markdown, which is the class §4 D101/D127 name.
    """
    from scsim.io.project_map import base_data_requirements

    reqs = {r.field: r for r in base_data_requirements()}
    cap = reqs["suppliers.capacity_per_week"]
    assert cap.empty_means is not None
    assert cap.empty_means.token == "∞"
    assert "unlimited" in cap.empty_means.meaning.lower()
    # It is the declared meaning of a blank, NOT a substitution — the two are
    # opposite answers and `DataRequirement` refuses both at once.
    assert cap.fallback_spec == ()


def test_a_requirement_may_not_declare_both_a_fallback_and_an_empty_meaning():
    from scsim.policies.base import DataRequirement, EmptyMeaning, FallbackStep

    with pytest.raises(ValueError, match="never both"):
        DataRequirement(
            field="x.y", level="defaulted", reason="r",
            fallback_spec=(FallbackStep(grade="warn", constant=1.0),),
            empty_means=EmptyMeaning(token="∞", meaning="unlimited"),
        )


def test_the_registry_publishes_empty_means():
    reg = build_registry()
    rows = {r["field"]: r for r in reg["base_data_requirements"]}
    assert rows["suppliers.capacity_per_week"]["empty_means"] == {
        "token": "∞",
        "meaning": rows["suppliers.capacity_per_week"]["empty_means"]["meaning"],
    }
    # Every OTHER requirement declares None, so a surface can test the key
    # rather than special-casing one field name.
    others = [f for f, r in rows.items()
              if r["empty_means"] is not None and f != "suppliers.capacity_per_week"]
    assert others == [], others
