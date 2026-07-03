"""node:plant disruption targets (A5.1 / G11).

A plant disruption throttles or halts the plant's own production, unlike a
supplier disruption which chokes inbound material. Because the material
coverage buffer cannot cushion the plant itself, a plant halt is strictly
more severe than a supplier outage of equal length on the same chain.
"""
from __future__ import annotations

import numpy as np
import pytest

from scsim import DisruptionEvent, Network, Scenario
from scsim.core.engine import compile_scenario, run_replication, run_scenario
from scsim.entities.enums import EffectType, TargetType
from scsim.io.traces import trace_frame

from .conftest import make_settings, single_chain_network


def scenario(net: Network, events=None, policies=None, **kw) -> Scenario:
    return Scenario(
        name="t", network=net, settings=make_settings(**kw),
        events=events or [], policies=policies or {},
    )


def _plant_event(effect: EffectType, *, phi: float = 0.0, start=20, duration=14):
    return DisruptionEvent(
        target_type=TargetType.NODE_PLANT, target_id="plant",
        effect_type=effect, capacity_factor=phi, start=start, duration=duration,
    )


def test_plant_target_no_longer_raises():
    """node:plant used to hard-error at compile; now it compiles."""
    compile_scenario(scenario(single_chain_network(),
                              [_plant_event(EffectType.LEAD_TIME_EXTENSION)]))


def test_plant_halt_is_more_severe_than_supplier_outage():
    """A 14-week plant halt loses every week; a supplier outage of the same
    length is buffered by material coverage, so the plant halt loses more."""
    base = run_scenario(scenario(single_chain_network()), debug=True)
    plant = run_scenario(
        scenario(single_chain_network(), [_plant_event(EffectType.LEAD_TIME_EXTENSION)]),
        debug=True,
    )
    supplier = run_scenario(
        scenario(single_chain_network(), [DisruptionEvent(target_id="s1", start=20, duration=14)]),
        debug=True,
    )
    assert base.aggregates["lost_sales_value"]["mean"] == 0.0
    assert plant.aggregates["lost_sales_value"]["mean"] > \
        supplier.aggregates["lost_sales_value"]["mean"] > 0.0
    assert (plant.fr_series < 1.0).any()


def test_plant_capacity_reduction_is_partial():
    """φ=0.25 throttles capacity (200) below demand (100) → partial loss,
    strictly less than a full halt."""
    halt = run_scenario(
        scenario(single_chain_network(), [_plant_event(EffectType.LEAD_TIME_EXTENSION)]),
        debug=True,
    )
    throttle = run_scenario(
        scenario(single_chain_network(),
                 [_plant_event(EffectType.CAPACITY_REDUCTION, phi=0.25)]),
        debug=True,
    )
    lost_halt = halt.aggregates["lost_sales_value"]["mean"]
    lost_throttle = throttle.aggregates["lost_sales_value"]["mean"]
    assert 0.0 < lost_throttle < lost_halt


def test_plant_event_trace_byte_identical():
    """Plant events draw no new randomness — the trace is reproducible."""
    sc = scenario(single_chain_network(),
                  [_plant_event(EffectType.CAPACITY_REDUCTION, phi=0.3, duration=10)])
    t1 = trace_frame(run_replication(compile_scenario(sc), 0, 0, []))
    t2 = trace_frame(run_replication(compile_scenario(sc), 0, 0, []))
    for key in t1:
        assert t1[key].tobytes() == t2[key].tobytes(), f"column {key} not byte-identical"


def test_supplier_only_scenarios_unchanged():
    """Additive-only: with no plant event the plant state is inert, so a
    supplier chain still fills 100% (golden #1 invariant)."""
    res = run_scenario(scenario(single_chain_network()), debug=True)
    assert np.allclose(res.fr_series, 1.0)
    assert res.aggregates["lost_sales_value"]["mean"] == 0.0
