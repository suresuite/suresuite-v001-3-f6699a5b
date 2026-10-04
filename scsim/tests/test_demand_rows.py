# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Demand per customer × product row — PLAN.md §24 WP 14.1, ADR 0002 (decisions 2, 8).

Rows carry a forecast series or a demand model; product demand is the row
sum; ``normal`` is a real normal clipped at 0 and counted; the plan's view
(``projected_demand_rows``) never reads a draw. A network with no row spec
draws per product exactly as before (``test_golden_digests.py`` is the
byte-level proof; ``test_no_row_spec_keeps_the_product_draw`` the direct one).
"""
from __future__ import annotations

import math

import numpy as np
import pytest
from pydantic import ValidationError

from scsim import (
    BomLine,
    Customer,
    CustomerLink,
    Material,
    Network,
    Product,
    Scenario,
    Supplier,
    SupplierLink,
)
from scsim.core.context import SimContext
from scsim.core.engine import compile_scenario, run_replication, run_scenario
from scsim.entities.enums import DemandModel
from scsim.io.project_map import OutboundArc, ProductRow, ProjectData, from_project_data
from scsim.stats.seeds import world_streams

from .conftest import make_settings, single_chain_network


def _net(links, products=None, customers=("c1", "c2")) -> Network:
    base = single_chain_network(deterministic=False)
    return Network(
        suppliers=base.suppliers, materials=base.materials,
        products=products or base.products, bom=base.bom, supplier_links=base.supplier_links,
        customers=[Customer(id=c) for c in customers], customer_links=links,
    )


def _ctx(net, **kw) -> SimContext:
    sc = Scenario(name="rows", network=net, settings=make_settings(**kw))
    compiled = compile_scenario(sc)
    return SimContext(compiled.model, world_streams(compiled.model.settings.project_seed, 0, 0),
                      [], keep_matrices=False, debug=True)


FORECAST = [60.0, 60.0, 80.0, 160.0, 100.0]  # the design doc §2 example's C1


# ---------------------------------------------------------------- the rows

def test_no_row_spec_keeps_the_product_draw():
    links = [CustomerLink(product_id="p1", customer_id="c1", share=60),
             CustomerLink(product_id="p1", customer_id="c2", share=40)]
    with_links = _ctx(_net(links))
    without = _ctx(single_chain_network(deterministic=False))
    assert not with_links.model.has_row_demand
    assert with_links.demand_schedule_rows is None
    assert with_links.demand_schedule.tobytes() == without.demand_schedule.tobytes()


def test_two_rows_product_demand_is_the_row_sum():
    links = [
        CustomerLink(product_id="p1", customer_id="c1", share=60, forecast=FORECAST,
                     demand_model="deterministic"),
        CustomerLink(product_id="p1", customer_id="c2", share=40, demand_model="normal",
                     demand_mean=40.0, demand_variation=0.2),
    ]
    ctx = _ctx(_net(links))
    m = ctx.model
    T, L = m.settings.horizon, m.settings.visibility_horizon
    assert m.has_row_demand and m.n_rows == 2
    assert ctx.demand_schedule_rows.shape == (2, T + L)
    np.testing.assert_allclose(ctx.demand_schedule[0], ctx.demand_schedule_rows.sum(axis=0))
    # The forecast row is deterministic around its series, then its last value.
    assert ctx.demand_schedule_rows[0, :5].tolist() == FORECAST
    assert np.all(ctx.demand_schedule_rows[0, 5:] == 100.0)
    # The plan reads the forecast and the mean, not the draws.
    np.testing.assert_allclose(ctx.projected_demand(0, 6)[0], [100, 100, 120, 200, 140, 140])
    np.testing.assert_allclose(ctx.projected_demand_rows(0, 3), [[60, 60, 80], [40, 40, 40]])


def test_the_engine_reads_rows_each_week():
    links = [
        CustomerLink(product_id="p1", customer_id="c1", share=60, forecast=FORECAST,
                     demand_model="deterministic"),
        CustomerLink(product_id="p1", customer_id="c2", share=40, demand_model="poisson",
                     demand_mean=40.0),
    ]
    sc = Scenario(name="r", network=_net(links), settings=make_settings())
    ctx = run_replication(compile_scenario(sc), 0, 0, [], debug=True)
    T = sc.settings.horizon
    np.testing.assert_allclose(ctx.trace.demand_value / 10.0,
                               ctx.demand_schedule_rows[:, :T].sum(axis=0))


def test_a_row_without_a_spec_takes_its_product_distribution_scaled_by_share():
    links = [
        CustomerLink(product_id="p1", customer_id="c1", share=75, demand_model="deterministic",
                     demand_mean=30.0),
        CustomerLink(product_id="p1", customer_id="c2", share=25),
    ]
    ctx = _ctx(_net(links))
    m = ctx.model
    # p1 is triangularAV(100, ν=0.3): mean 100, so the unspecified row's centre
    # is 25 and its draws stay inside 25 × [0.7, 1.3].
    assert m.row_centre[1, 0] == pytest.approx(25.0)
    row = ctx.demand_schedule_rows[1]
    assert row.min() >= 0.7 * 25 - 1e-9 and row.max() <= 1.3 * 25 + 1e-9
    assert m.mean_demand_p[0] == pytest.approx(30.0 + 25.0)


def test_unlinked_products_get_an_implicit_row():
    base = single_chain_network()
    net = Network(
        suppliers=base.suppliers, materials=base.materials,
        products=base.products + [Product(id="p2", unit_price=5.0, demand_mode=10.0,
                                          production_capacity=50.0)],
        bom=base.bom + [BomLine(product_id="p2", material_id="m1", rate=1.0)],
        supplier_links=base.supplier_links, customers=[Customer(id="c1")],
        customer_links=[CustomerLink(product_id="p1", customer_id="c1", demand_model="deterministic",
                                     demand_mean=90.0)],
    )
    ctx = _ctx(net)
    assert ctx.model.row_ids == ["c1::p1", "::p2"]
    assert ctx.model.row_ptr.tolist() == [0, 1, 2]
    np.testing.assert_allclose(ctx.demand_schedule[0], 90.0)


def test_triangular_forecast_row_scales_the_triangle_to_the_forecast_mean():
    links = [CustomerLink(product_id="p1", customer_id="c1", demand_model="triangular",
                          demand_min=50.0, demand_mean=100.0, demand_max=150.0,
                          forecast=[200.0] * 70)]
    ctx = _ctx(_net(links, customers=("c1",)))
    row = ctx.demand_schedule_rows[0, :70]
    assert row.min() >= 100.0 - 1e-9 and row.max() <= 300.0 + 1e-9
    assert ctx.projected_demand(0, 1)[0, 0] == 200.0


def test_a_short_forecast_warns_and_says_what_it_used():
    links = [CustomerLink(product_id="p1", customer_id="c1", demand_model="deterministic",
                          forecast=[50.0] * 10),
             CustomerLink(product_id="p1", customer_id="c2", demand_model="deterministic",
                          demand_mean=30.0, forecast=[40.0] * 10)]
    res = run_scenario(Scenario(name="s", network=_net(links), settings=make_settings()))
    reasons = {w["entity"]: w["reason"] for w in res.demand_warnings}
    assert "last value (50/wk)" in reasons["customer_row:c1::p1"]
    assert "mean (30/wk)" in reasons["customer_row:c2::p1"]


# ----------------------------------------------------------- validation

@pytest.mark.parametrize("kw, msg", [
    ({"demand_model": "normal", "demand_mean": 10.0}, "demand_variation"),
    ({"demand_model": "poisson"}, "demand_mean or a forecast"),
    ({"demand_model": "triangular", "demand_mean": 10.0}, "demand_min"),
    ({"demand_model": "triangular", "demand_min": 20.0, "demand_mean": 10.0, "demand_max": 30.0},
     "demand_min ≤ demand_mean"),
    ({"demand_model": "triangular_av", "demand_mean": 10.0, "demand_variation": 1.5}, "≤ 1"),
    ({"demand_model": "normal", "demand_mean": 10.0, "demand_variation": 0.2, "demand_max": 5.0},
     "triangular only"),
    ({"demand_mean": 10.0}, "without a demand_model"),
    ({"forecast": []}, "forecast is empty"),
    ({"forecast": [1.0, -2.0]}, "≥ 0"),
])
def test_invalid_row_specs_are_refused_with_a_clear_error(kw, msg):
    with pytest.raises(ValidationError, match=msg):
        CustomerLink(product_id="p1", customer_id="c1", **kw)


def test_normal_product_requires_a_cv():
    with pytest.raises(ValidationError, match="demand_cv"):
        Product(id="p", unit_price=1.0, demand_mode=10.0, production_capacity=20.0,
                demand_model=DemandModel.NORMAL)


# ------------------------------------------------------- the normal sampler

def _normal_product(mean, cv) -> list[Product]:
    return [Product(id="p1", unit_price=10.0, demand_mode=mean, demand_model=DemandModel.NORMAL,
                    demand_cv=cv, production_capacity=1e6)]


def test_normal_moments_over_a_long_horizon():
    ctx = _ctx(_net([], products=_normal_product(100.0, 0.2)), horizon=520)
    x = ctx.demand_schedule[0, :520]
    assert x.mean() == pytest.approx(100.0, abs=2.0)
    assert x.std(ddof=1) == pytest.approx(20.0, abs=1.5)
    assert ctx.demand_clips.sum() == 0


def test_normal_clip_count_and_mean_shift_at_cv_1_5():
    """σ = 150 on μ = 100: P(x < 0) = Φ(−2/3) ≈ 0.2525, and clipping raises the
    mean by E[max(0, −x)] = σφ(μ/σ) − μΦ(−μ/σ) ≈ 22.66."""
    T = 520
    ctx = _ctx(_net([], products=_normal_product(100.0, 1.5)), horizon=T)
    x = ctx.demand_schedule[0, :T]
    clips = int(ctx.demand_clips[0])
    assert clips == int((x == 0.0).sum())            # every clip is a 0, every 0 a clip
    assert clips / T == pytest.approx(0.2525, abs=0.04)
    phi = math.exp(-(2 / 3) ** 2 / 2) / math.sqrt(2 * math.pi)
    Phi = 0.5 * (1 + math.erf(-(2 / 3) / math.sqrt(2)))
    assert ctx.demand_clip_add[0] / T == pytest.approx(150 * phi - 100 * Phi, abs=5.0)


def test_normal_clips_reach_the_result_and_the_warning():
    sc = Scenario(name="n", network=_net([], products=_normal_product(100.0, 1.5)),
                  settings=make_settings(model_seeds=3))
    res = run_scenario(sc)
    (rep,) = res.demand_clips
    assert rep["product"] == "p1" and rep["replications"] == 3
    assert rep["clipped_draws"] > 0 and rep["mean_shift"] > 0
    (w,) = [w for w in res.demand_warnings if w["field"] == "demand_distribution"]
    assert w["entity"] == "product:p1" and "set to 0" in w["reason"]


def test_normal_row_clips_are_counted_per_row():
    links = [CustomerLink(product_id="p1", customer_id="c1", demand_model="normal",
                          demand_mean=50.0, demand_variation=1.5),
             CustomerLink(product_id="p1", customer_id="c2", demand_model="deterministic",
                          demand_mean=50.0)]
    ctx = _ctx(_net(links))
    assert ctx.demand_clips[0] == int((ctx.demand_schedule_rows[0, :70] == 0).sum()) > 0
    assert ctx.demand_clips[1] == 0


# ------------------------------------------------------- information honesty

def _peeking_planner(ctx, t, H):
    """A planner that cheats: it reads the drawn schedule. The honesty check
    below must catch it — that is what makes the check worth having."""
    return ctx.demand_schedule[:, t:t + H]


@pytest.mark.parametrize("links", [
    [],  # no row spec: the plan's view of the product draw
    [CustomerLink(product_id="p1", customer_id="c1", demand_model="normal", demand_mean=60.0,
                  demand_variation=0.3, forecast=FORECAST),
     CustomerLink(product_id="p1", customer_id="c2", demand_model="poisson", demand_mean=40.0)],
])
def test_projected_demand_never_reads_the_drawn_future(links):
    ctx = _ctx(_net(links))
    H = 8
    for t in (0, 10, 30):
        before = (ctx.projected_demand(t, H).copy(), ctx.projected_demand_rows(t, H).copy())
        cheat_before = _peeking_planner(ctx, t, H).copy()
        # Perturb every draw AFTER week t (and the rows that sum to them).
        ctx.demand_schedule[:, t + 1:] *= 3.0
        if ctx.demand_schedule_rows is not None:
            ctx.demand_schedule_rows[:, t + 1:] *= 3.0
        np.testing.assert_array_equal(ctx.projected_demand(t, H), before[0])
        np.testing.assert_array_equal(ctx.projected_demand_rows(t, H), before[1])
        assert not np.array_equal(_peeking_planner(ctx, t, H), cheat_before)


# ------------------------------------------------------------------- KPIs

def test_projection_kpis_only_with_row_specs_and_zero_for_a_perfect_forecast():
    plain = run_scenario(Scenario(name="p", network=single_chain_network(),
                                  settings=make_settings()))
    assert not any(k.startswith("demand_forecast") for k in plain.aggregates)
    links = [CustomerLink(product_id="p1", customer_id="c1", demand_model="deterministic",
                          forecast=[100.0 + (t % 5) for t in range(70)])]
    res = run_scenario(Scenario(name="f", network=_net(links, customers=("c1",)),
                                settings=make_settings()))
    assert res.aggregates["demand_forecast_bias"]["mean"] == pytest.approx(0.0, abs=1e-12)
    assert res.aggregates["demand_forecast_mape_p1"]["mean"] == pytest.approx(0.0, abs=1e-12)


def test_projection_kpis_measure_a_biased_forecast():
    # The plan expects 120; the world draws 100 ± (deterministic) → bias +20 %.
    links = [CustomerLink(product_id="p1", customer_id="c1", demand_model="deterministic",
                          demand_mean=100.0)]
    sc = Scenario(name="b", network=_net(links, customers=("c1",)), settings=make_settings())
    compiled = compile_scenario(sc)
    compiled.model.row_centre[:] = 120.0      # the plan's centre only
    ctx = run_replication(compiled, 0, 0, [])
    from scsim.kpi.compute import demand_projection_kpis
    k = demand_projection_kpis(ctx, 10, 60)
    # The draw used the same centre, so perturb only after drawing.
    assert k["demand_forecast_bias"] == pytest.approx(0.0)
    ctx.demand_schedule[:] = 100.0
    k = demand_projection_kpis(ctx, 10, 60)
    assert k["demand_forecast_bias"] == pytest.approx(0.2)
    assert k["demand_forecast_mape_p1"] == pytest.approx(0.2)


# ------------------------------------------------------------------ mapper

def _pd(products, outbound) -> ProjectData:
    from scsim.io.project_map import BomArc, MaterialRow, SupplierRow, SupplyArc
    return ProjectData(
        suppliers=[SupplierRow(id="S1")],
        materials=[MaterialRow(id="M1", cost=2.0)],
        products=products,
        supply_arcs=[SupplyArc(supplier_id="S1", material_id="M1", unit_price=2.0, lead_time=2)],
        bom=[BomArc(product_id="P1", material_id="M1")],
        outbound=outbound,
    )


def test_mapper_normal_is_a_real_normal_and_says_what_cv_means():
    res = from_project_data(_pd(
        [ProductRow(id="P1", sell_price=10.0, production_capacity=200.0,
                    demand_distribution="normal", demand_mean=100.0, demand_cv=0.25)],
        [OutboundArc(product_id="P1", customer_id="C1", volume=100.0, time_unit="week")]))
    (p,) = res.scenario.network.products
    assert p.demand_model == DemandModel.NORMAL and p.demand_cv == 0.25
    assert p.demand_mode == 100.0
    texts = [w.reason for w in res.warnings if w.field == "demand_distribution"]
    assert not any("unsupported" in t or "triangularAV" in t for t in texts)
    assert any("coefficient of variation" in t and "σ = 0.25 × 100 = 25/wk" in t for t in texts)


def test_mapper_triangular_keeps_demand_cv_as_the_av_fraction():
    res = from_project_data(_pd(
        [ProductRow(id="P1", sell_price=10.0, production_capacity=200.0,
                    demand_distribution="triangular", demand_mean=100.0, demand_cv=0.25)],
        [OutboundArc(product_id="P1", customer_id="C1", volume=100.0, time_unit="week")]))
    (p,) = res.scenario.network.products
    assert (p.demand_min, p.demand_mode, p.demand_max) == (75.0, 100.0, 125.0)


def test_mapper_carries_row_demand_specs_onto_customer_links():
    res = from_project_data(_pd(
        [ProductRow(id="P1", sell_price=10.0, production_capacity=200.0, demand_mean=100.0)],
        [OutboundArc(product_id="P1", customer_id="C1", volume=60.0, time_unit="week",
                     forecast=FORECAST),
         OutboundArc(product_id="P1", customer_id="C2", volume=40.0, time_unit="week",
                     demand_distribution="Normal", demand_mean=160.0, demand_variation=0.2),
         OutboundArc(product_id="P1", customer_id="C3", volume=10.0, time_unit="month",
                     demand_distribution="triangularAV", demand_mean=30.4375,
                     demand_variation=0.3)]))
    links = {(l.customer_id): l for l in res.scenario.network.customer_links}
    assert links["C1"].forecast == FORECAST and links["C1"].demand_model == "deterministic"
    assert links["C2"].demand_model == "normal" and links["C2"].demand_variation == 0.2
    # A monthly rate is a weekly one after the mapper (30.4375/month → 7/wk).
    assert links["C3"].demand_model == "triangular_av"
    assert links["C3"].demand_mean == pytest.approx(7.0)
    compiled = compile_scenario(res.scenario)
    assert compiled.model.has_row_demand


def test_mapper_drops_an_invalid_row_spec_with_a_warning():
    res = from_project_data(_pd(
        [ProductRow(id="P1", sell_price=10.0, production_capacity=200.0, demand_mean=100.0)],
        [OutboundArc(product_id="P1", customer_id="C1", volume=60.0, time_unit="week",
                     demand_distribution="normal", demand_mean=50.0),
         OutboundArc(product_id="P1", customer_id="C2", volume=40.0, time_unit="week",
                     demand_distribution="lognormal", demand_mean=50.0)]))
    links = res.scenario.network.customer_links
    assert all(not l.has_demand_spec for l in links)
    reasons = [w.reason for w in res.warnings if w.entity.startswith("customer_row:")]
    assert any("demand_variation" in r for r in reasons)
    assert any("'lognormal'" in r for r in reasons)


def test_mapper_without_row_fields_builds_the_links_it_always_built():
    res = from_project_data(_pd(
        [ProductRow(id="P1", sell_price=10.0, production_capacity=200.0, demand_mean=100.0)],
        [OutboundArc(product_id="P1", customer_id="C1", volume=60.0, time_unit="week"),
         OutboundArc(product_id="P1", customer_id="C2", volume=0.0, time_unit="week")]))
    links = res.scenario.network.customer_links
    assert [(l.customer_id, l.share) for l in links] == [("C1", 60.0)]


# ------------------------------------- the requested delivery schedule (P-C.4)

def _schedule_pd(policies):
    d = _pd(
        [ProductRow(id="P1", sell_price=10.0, production_capacity=200.0, demand_mean=100.0)],
        [OutboundArc(product_id="P1", customer_id="C1", volume=60.0, time_unit="week",
                     demand_distribution="normal", demand_mean=50.0, demand_variation=0.3,
                     forecast=FORECAST),
         OutboundArc(product_id="P1", customer_id="C2", volume=40.0, time_unit="week")])
    d.policies = policies
    return from_project_data(d)


SCHEDULE = [0.0, 120.0, 0.0, 80.0]


def test_a_delivery_schedule_is_the_rows_demand_exactly():
    """'schedule' runs the typed weekly quantities as firm demand: deterministic,
    the distribution and the uploaded forecast set aside, nothing past its end."""
    res = _schedule_pd({"node:C1::P1": {"demand": {"row_demand_mode": "schedule",
                                                    "row_demand_schedule": SCHEDULE}}})
    links = {l.customer_id: l for l in res.scenario.network.customer_links}
    c1 = links["C1"]
    assert c1.forecast == SCHEDULE and c1.demand_model == "deterministic"
    assert c1.demand_mean == 0.0 and c1.demand_variation is None
    model = compile_scenario(res.scenario).model
    r = model.row_ids.index("C1::P1")
    assert model.row_centre[r, :4].tolist() == SCHEDULE
    assert not model.row_centre[r, 4:].any()       # zero past its end, no warning tail
    assert not model.row_forecast_short or all(
        f["tail"] == 0.0 for f in model.row_forecast_short)


def test_a_saved_schedule_runs_when_the_mode_is_empty_and_not_under_model():
    empty = _schedule_pd({"node:C1::P1": {"demand": {"row_demand_schedule": SCHEDULE}}})
    (c1,) = [l for l in empty.scenario.network.customer_links if l.customer_id == "C1"]
    assert c1.forecast == SCHEDULE
    model = _schedule_pd({"node:C1::P1": {"demand": {"row_demand_mode": "model",
                                                      "row_demand_schedule": SCHEDULE}}})
    (c1,) = [l for l in model.scenario.network.customer_links if l.customer_id == "C1"]
    assert c1.forecast is None and c1.demand_model == "normal"


@pytest.mark.parametrize("bad", [[10, -1], [10, "x"], "10,20"])
def test_an_invalid_schedule_is_warned_and_the_row_keeps_its_data(bad):
    res = _schedule_pd({"node:C1::P1": {"demand": {"row_demand_mode": "schedule",
                                                    "row_demand_schedule": bad}}})
    (c1,) = [l for l in res.scenario.network.customer_links if l.customer_id == "C1"]
    assert c1.forecast == FORECAST and c1.demand_model == "normal"
    fields = {w.field for w in res.warnings if w.entity == "customer_row:C1::P1"}
    assert {"row_demand_schedule", "row_demand_mode"} <= fields


def test_a_schedule_on_a_row_with_no_uploaded_spec_gives_it_one():
    res = _schedule_pd({"node:C2::P1": {"demand": {"row_demand_mode": "schedule",
                                                    "row_demand_schedule": [5, 5]}}})
    (c2,) = [l for l in res.scenario.network.customer_links if l.customer_id == "C2"]
    assert c2.forecast == [5.0, 5.0] and c2.demand_model == "deterministic"
