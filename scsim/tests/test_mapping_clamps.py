"""Every clamp at the UI→engine boundary says so (audit 2026-09-22, F-21).

`project_map._clamp` used to return silently, and a dozen values a user typed
were bounded to the engine's range with the substitution recorded only in a
code comment or in `docs/data/field-mapping.md`. T2 says a substitution is
visible at the point of display, and `mapping_warnings` is what reaches it
(`RunProgressPanel` → `MappingWarningsCard`). The horizon FLOOR already did
this; every other site was the defect.

Two halves:

* behavioural — a value outside the range produces ONE warning naming the
  field, the value given and the value used; a value inside produces none;
* static — `_clamp` REQUIRES the warning sink, every call supplies it, and no
  second two-sided clamp idiom exists in the file to route around it. Clamp
  number thirteen cannot arrive silently.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from scsim.io import project_map
from scsim.io.project_map import (
    BomArc,
    MaterialRow,
    OutboundArc,
    ProductRow,
    ProjectData,
    ScenarioSettings,
    SupplierRow,
    SupplyArc,
    from_project_data,
)

SOURCE = Path(project_map.__file__)


def _base(**scenario_kw) -> ProjectData:
    return ProjectData(
        suppliers=[SupplierRow(id="s1")],
        materials=[MaterialRow(id="m1", cost=2.0)],
        products=[ProductRow(id="p1", sell_price=20.0, demand_mean=100.0,
                             production_capacity=200.0)],
        supply_arcs=[SupplyArc(supplier_id="s1", material_id="m1", unit_price=2.0,
                               lead_time=2, lead_time_unit="week")],
        bom=[BomArc(product_id="p1", material_id="m1", consumption_rate=1.0)],
        outbound=[OutboundArc(product_id="p1", customer_id="c1", unit_price=20.0,
                              volume=100.0, time_unit="week")],
        scenario=ScenarioSettings(**scenario_kw),
    )


def _clamped(res, field: str):
    return [w for w in res.warnings if w.field == field and "engine range" in w.reason]


def test_in_range_values_emit_no_clamp_warning():
    res = from_project_data(_base())
    assert [w for w in res.warnings if "engine range" in w.reason] == []


def test_horizon_ceiling_is_warned_not_only_the_floor():
    res = from_project_data(_base(horizon_days=4000))
    assert res.scenario.settings.horizon == 520
    [w] = _clamped(res, "horizon")
    assert "571" in w.reason and "520" in w.reason


def test_replications_bounded_and_said():
    res = from_project_data(_base(replications=500))
    assert res.scenario.settings.model_seeds == 200
    [w] = _clamped(res, "replications")
    assert "500" in w.reason and "200" in w.reason


def test_unsupported_ci_level_substitution_is_said():
    res = from_project_data(_base(ci_level=80))
    assert res.scenario.settings.ci_level == 95
    [w] = [w for w in res.warnings if w.field == "ci_level"]
    assert "80" in w.reason and "95" in w.reason


def test_holding_cost_clamp_is_said():
    d = _base()
    d.materials[0].holding_cost_pct = 0.8
    res = from_project_data(d)
    assert res.scenario.network.materials[0].holding_cost_rate == 50.0
    [w] = _clamped(res, "holding_cost_pct")
    assert w.entity == "material:m1" and "80" in w.reason and "50" in w.reason


def test_lead_time_ceiling_is_said():
    d = _base()
    d.supply_arcs[0].lead_time = 400
    res = from_project_data(d)
    [w] = _clamped(res, "lead_time")
    assert w.entity == "supply:s1->m1" and "400" in w.reason and "51" in w.reason


def test_disruption_duration_ceiling_is_said():
    d = _base(disruption_schedule=[
        {"target": "supplier:s1", "start_day": 140, "duration_days": 400}])
    res = from_project_data(d)
    assert res.scenario.events[0].duration == 52
    [w] = _clamped(res, "duration")
    assert "57" in w.reason and "52" in w.reason


def test_safety_stock_days_ceiling_is_said():
    d = _base()
    d.policies = {"default": {"inventory": {"safety_stock_method": "fixed_days",
                                            "safety_stock_days": 100}}}
    res = from_project_data(d)
    [w] = _clamped(res, "safety_stock_days")
    assert "100" in w.reason and "84" in w.reason


# ── the static half: the class cannot come back ──────────────────────────────

def _tree() -> ast.Module:
    return ast.parse(SOURCE.read_text())


def test_clamp_requires_a_warning_sink():
    sig = inspect.signature(project_map._clamp)
    for name in ("w", "entity", "field"):
        p = sig.parameters.get(name)
        assert p is not None, f"_clamp lost its `{name}` parameter"
        assert p.kind is inspect.Parameter.KEYWORD_ONLY, f"`{name}` must be keyword-only"
        assert p.default is inspect.Parameter.empty, f"`{name}` must have no default"


def test_every_clamp_call_names_its_field():
    calls = [n for n in ast.walk(_tree())
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "_clamp"]
    assert len(calls) >= 12, f"expected the dozen clamp sites, found {len(calls)}"
    for c in calls:
        kws = {k.arg for k in c.keywords}
        missing = {"w", "entity", "field"} - kws
        assert not missing, f"_clamp at line {c.lineno} omits {sorted(missing)}"


def _is_call(node: ast.AST, name: str) -> bool:
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == name


def test_no_second_clamp_idiom_routes_around_the_warning():
    """`max(lo, min(hi, v))` and `.clip(` outside `_clamp` would be clamp #13."""
    tree = _tree()
    clamp_def = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_clamp")
    inside = {id(n) for n in ast.walk(clamp_def)}
    offenders = []
    for n in ast.walk(tree):
        if id(n) in inside:
            continue
        for outer, inner in (("max", "min"), ("min", "max")):
            if _is_call(n, outer) and any(_is_call(a, inner) for a in n.args):
                offenders.append(f"{outer}({inner}(…)) at line {n.lineno}")
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "clip":
            offenders.append(f".clip() at line {n.lineno}")
    assert offenders == [], offenders
