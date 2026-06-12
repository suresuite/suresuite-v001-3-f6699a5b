"""Part III dictionary validation behaviors."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from scsim import (
    BomLine,
    DisruptionEvent,
    Material,
    Network,
    Product,
    SimulationSettings,
    Supplier,
    SupplierLink,
)
from scsim.entities.disruption import DurationRange
from scsim.entities.enums import (
    EffectType,
    RampProfile,
    RunMode,
    SupplierProfile,
    TraceVerbosity,
    WarmupMethod,
)

from .conftest import dual_source_network, single_chain_network


def test_settings_defaults_match_plan():
    s = SimulationSettings(project_seed=1)
    assert (s.horizon, s.model_seeds, s.disruption_event_seeds) == (156, 30, 18)
    assert s.crn_enabled and s.bootstrap_resamples == 10_000 and s.ci_level == 95


def test_settings_manual_warmup_requires_week():
    with pytest.raises(ValidationError, match="warmup_end"):
        SimulationSettings(project_seed=1, warmup_method=WarmupMethod.MANUAL)


def test_settings_fast_scan_budget_enforced():
    s = SimulationSettings(project_seed=1, run_mode=RunMode.FAST_SCAN,
                           model_seeds=30, disruption_event_seeds=18)
    assert s.model_seeds == 10 and s.disruption_event_seeds == 6
    assert s.trace_verbosity == TraceVerbosity.KPI_ONLY


def test_triangular_floor_correction():
    p = Product(id="p", unit_price=1.0, demand_mode=100.0, production_capacity=10.0)
    a, b, c = p.triangular_params(global_floor_factor=0.30)
    assert (a, b, c) == (70.0, 100.0, 130.0)  # a = (1−ν)·b


def test_network_rejects_unsourced_material():
    with pytest.raises(ValidationError, match="no qualified supplier"):
        Network(
            suppliers=[Supplier(id="s1")],
            materials=[Material(id="m1", cost=1.0), Material(id="orphan", cost=1.0)],
            products=[Product(id="p1", unit_price=1.0, demand_mode=10.0, production_capacity=10.0)],
            bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
            supplier_links=[SupplierLink(supplier_id="s1", material_id="m1",
                                         cost=1.0, lead_time_weeks=1)],
        )


def test_network_rejects_product_without_bom():
    with pytest.raises(ValidationError, match="empty BoM"):
        Network(
            suppliers=[Supplier(id="s1")],
            materials=[Material(id="m1", cost=1.0)],
            products=[
                Product(id="p1", unit_price=1.0, demand_mode=10.0, production_capacity=10.0),
                Product(id="ghost", unit_price=1.0, demand_mode=10.0, production_capacity=10.0),
            ],
            bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
            supplier_links=[SupplierLink(supplier_id="s1", material_id="m1",
                                         cost=1.0, lead_time_weeks=1)],
        )


def test_supplier_typology_classifier():
    single = single_chain_network()
    assert single.supplier_profile("s1") == SupplierProfile.SINGLE_SOURCED
    dual = dual_source_network()
    assert dual.multi_sourcing_rate("s1") == 100.0
    assert dual.supplier_profile("s1") == SupplierProfile.HIGH_MULTI


def test_primary_supplier_is_min_cost():
    dual = dual_source_network()
    assert dual.primary_link("m1").supplier_id == "s1"  # 2.0 < 2.6


def test_event_ramp_only_for_capacity():
    with pytest.raises(ValidationError, match="capacity_reduction only"):
        DisruptionEvent(target_id="s1", onset_profile=RampProfile.RAMP_LINEAR, ramp_weeks=2)
    ev = DisruptionEvent(
        target_id="s1", effect_type=EffectType.CAPACITY_REDUCTION,
        capacity_factor=0.5, onset_profile=RampProfile.RAMP_LINEAR, ramp_weeks=2,
    )
    assert ev.ramp_weeks == 2


def test_event_stochastic_default():
    ev = DisruptionEvent(target_id="s1")
    assert ev.is_stochastic
    assert isinstance(ev.duration, DurationRange)
    assert (ev.duration.min, ev.duration.max) == (5, 10)  # manuscript U{5..10}
