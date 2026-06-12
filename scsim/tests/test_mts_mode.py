"""MTS fulfillment mode (ADR 0001): golden #6, P-P.4, the MTS-vs-MTO TTS
comparison (M7 exit criterion), and forecast mechanics."""
from __future__ import annotations

import numpy as np
import pytest

from scsim import (
    BomLine,
    DisruptionEvent,
    Material,
    Network,
    Product,
    Scenario,
    Supplier,
    SupplierLink,
)
from scsim.core.engine import CompileError, compile_scenario, run_replication, run_scenario
from scsim.disruption.injector import resolve_events
from scsim.entities.enums import DemandModel, ForecastModel, FulfillmentMode

from .conftest import make_settings, single_chain_network


def mts_chain(*, deterministic=True, fg_base_stock=None) -> Network:
    return Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=2.0)],
        products=[Product(
            id="p1", unit_price=10.0, demand_mode=100.0,
            demand_model=DemandModel.DETERMINISTIC if deterministic else DemandModel.TRIANGULAR,
            production_capacity=200.0,
            fulfillment_mode=FulfillmentMode.MTS,
            fg_base_stock=fg_base_stock,
        )],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[
            SupplierLink(supplier_id="s1", material_id="m1", cost=2.0, lead_time_weeks=2)
        ],
    )


def scenario(net, events=None, policies=None, **kw) -> Scenario:
    return Scenario(name="mts", network=net, settings=make_settings(**kw),
                    events=events or [], policies=policies or {})


OUTAGE = [DisruptionEvent(target_id="s1", start=20, duration=14)]


# --------------------------------------------------------- golden #6 semantics

def test_golden6_mts_steady_state_serves_from_stock():
    """Deterministic MTS chain: FR = 1 every week, FG hovers at its target
    (cycle stock = one week of forecast), production tracks demand."""
    res = run_scenario(scenario(mts_chain()), debug=True)
    assert np.allclose(res.fr_series, 1.0)
    assert res.aggregates["lost_sales_value"]["mean"] == 0.0
    compiled = compile_scenario(scenario(mts_chain()))
    ctx = run_replication(compiled, 0, 0, [], debug=True)
    # FG never overshoots the thin cycle target in steady state.
    assert ctx.fg_on_hand[0] == pytest.approx(100.0, abs=1.0)


def test_golden6_drain_and_replenish():
    """Outage drains FG to zero (drain), production refills it after recovery
    (replenish) — the canonical MTS trace shape."""
    big_fg = mts_chain(fg_base_stock=400.0)  # explicit S^FG = 4 weeks of demand
    compiled = compile_scenario(scenario(big_fg, OUTAGE))
    events = resolve_events(compiled.model, 10, 0)
    ctx = run_replication(compiled, 0, 0, events, debug=True)
    fg = ctx.trace.fg_value
    pre = fg[18]
    trough = fg[20:40].min()
    post = fg[55:].mean()
    assert trough < pre * 0.25, "FG must drain through the outage"
    assert post == pytest.approx(pre, rel=0.05), "FG must replenish to target after recovery"


def test_golden6_byte_identical_across_runs():
    sc = scenario(mts_chain(fg_base_stock=400.0), OUTAGE)
    from scsim.io.traces import trace_frame
    e1 = compile_scenario(sc)
    e2 = compile_scenario(sc)
    ev1 = resolve_events(e1.model, 10, 0)
    ev2 = resolve_events(e2.model, 10, 0)
    t1 = trace_frame(run_replication(e1, 0, 0, ev1))
    t2 = trace_frame(run_replication(e2, 0, 0, ev2))
    for key in t1:
        assert t1[key].tobytes() == t2[key].tobytes(), key


# --------------------------------------------- M7 exit: MTS-vs-MTO TTS contrast

def test_mts_with_fg_buffer_survives_longer_than_mto():
    """The FG buffer sits downstream of the CODP: with the same material
    position, MTS + P-P.4 keeps serving weeks after MTO starts losing."""
    mto = run_scenario(scenario(single_chain_network(), OUTAGE), debug=True)
    mts = run_scenario(
        scenario(mts_chain(), OUTAGE,
                 {"fg_safety_stock": {"sizing": "fixed_units", "fixed_units": 400.0}}),
        debug=True,
    )
    assert mts.aggregates["tts_weeks"]["mean"] > mto.aggregates["tts_weeks"]["mean"]
    assert mts.aggregates["lost_sales_value"]["mean"] < mto.aggregates["lost_sales_value"]["mean"]
    assert mts.aggregates["cost_fg_ss_holding"]["mean"] > 0


# ------------------------------------------------------------------- P-P.4

def test_pp4_infeasible_on_pure_mto_network():
    sc = scenario(single_chain_network(), policies={"fg_safety_stock": {}})
    with pytest.raises(CompileError, match="MTS-only"):
        compile_scenario(sc)


def test_pp4_service_level_zero_under_deterministic_demand():
    """Like P-P.3: z·σ sizing buys nothing when σ_D = 0 — and costs nothing."""
    res = run_scenario(scenario(mts_chain(deterministic=True),
                                policies={"fg_safety_stock": {"sizing": "service_level"}}),
                       debug=True)
    assert res.aggregates["cost_fg_ss_holding"]["mean"] == 0.0


def test_pp4_buffers_stochastic_demand():
    base = run_scenario(scenario(mts_chain(deterministic=False), OUTAGE, model_seeds=3),
                        debug=True)
    buffered = run_scenario(
        scenario(mts_chain(deterministic=False), OUTAGE,
                 {"fg_safety_stock": {"sizing": "fixed_days", "fixed_days_cover": 12.0}},
                 model_seeds=3),
        debug=True,
    )
    assert buffered.aggregates["fill_rate"]["mean"] >= base.aggregates["fill_rate"]["mean"]
    assert buffered.aggregates["cost_fg_ss_holding"]["mean"] > 0


# ------------------------------------------------------------------ forecast

@pytest.mark.parametrize("fm", [ForecastModel.NAIVE, ForecastModel.MA,
                                ForecastModel.EXP_SMOOTHING, ForecastModel.PERFECT])
def test_forecast_models_track_stationary_demand(fm):
    net = mts_chain(deterministic=False)
    net.products[0].forecast_model = fm
    compiled = compile_scenario(scenario(net))
    ctx = run_replication(compiled, 0, 0, [], debug=True)
    # After warm-up any §3.3 model tracks the stationary mean within noise.
    assert ctx.forecast[0] == pytest.approx(100.0, rel=0.35)
    assert np.all(ctx.trace.fill_rate >= 0.0)


def test_forecast_bias_lever_shifts_targets():
    net_hi = mts_chain()
    net_hi.products[0].forecast_bias = 30.0
    compiled = compile_scenario(scenario(net_hi))
    ctx = run_replication(compiled, 0, 0, [], debug=True)
    assert ctx.fg_target[0] == pytest.approx(130.0, rel=0.01)


def test_grng_holds_for_mts():
    """Forecasting consumes no RNG: demand trajectories stay identical across
    MTS portfolios (§9.4 extended to 0.2.0)."""
    base = scenario(mts_chain(deterministic=False), OUTAGE)
    loaded = base.with_policies({
        "fg_safety_stock": {"sizing": "fixed_days", "fixed_days_cover": 8.0},
        "expedited_shipments": {},
    })
    e0 = compile_scenario(base)
    e1 = compile_scenario(loaded)
    r0 = run_replication(e0, 0, 0, resolve_events(e0.model, 10, 0))
    r1 = run_replication(e1, 0, 0, resolve_events(e1.model, 10, 0))
    assert np.array_equal(r0.trace.demand_value, r1.trace.demand_value)
