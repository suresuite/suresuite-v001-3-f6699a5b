# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Week-0 material inventory (architecture.md "Initialization (warm start)").

I_m(0) = S_m − E[D_m]·T_s, and S_m is whatever the WHOLE PH-70 chain writes —
P-P.1's E[D]·(T_s + κ) plus P-P.3's safety stock on top. So the warm start is
E[D]·κ + SS, not E[D]·κ. The platform always maps P-P.3 (fixed_days, 7 d when
the project states nothing), which puts one extra week of demand on hand at
t=0: the 540 000-vs-480 000 report on a 60 000/wk BoM was this term."""
from __future__ import annotations

import numpy as np

from scsim import BomLine, Material, Network, Product, Scenario, Supplier, SupplierLink
from scsim.core.context import SimContext
from scsim.core.engine import _initialize_state, compile_scenario
from scsim.entities.enums import FulfillmentMode
from scsim.io.project_map import _map_policies
from scsim.stats.seeds import world_streams

from .conftest import make_settings


def _two_material_network() -> Network:
    """P001 at 20 000/wk, BoM M001×2 + M002×1, both on 6-week primary links."""
    return Network(
        materials=[Material(id="M001", cost=0.2), Material(id="M002", cost=0.1)],
        products=[Product(id="P001", unit_price=0.5, production_capacity=7000,
                          fulfillment_mode=FulfillmentMode.MTS, demand_mode=20000)],
        suppliers=[Supplier(id="S001"), Supplier(id="S004")],
        supplier_links=[
            SupplierLink(supplier_id="S001", material_id="M001", cost=0.2, lead_time_weeks=6),
            SupplierLink(supplier_id="S004", material_id="M002", cost=0.1, lead_time_weeks=6),
        ],
        bom=[BomLine(product_id="P001", material_id="M001", rate=2.0),
             BomLine(product_id="P001", material_id="M002", rate=1.0)],
    )


def _week0_on_hand(policies: dict) -> np.ndarray:
    """The replication preamble of run_replication, stopped at t=0."""
    sc = Scenario(name="warm", network=_two_material_network(),
                  settings=make_settings(), policies=policies)
    compiled = compile_scenario(sc)
    ctx = SimContext(compiled.model, world_streams(42, 0, 0), [], False)
    ctx._params = compiled.params_by_id
    for pol in compiled.policies:
        pol.setup(ctx)
    _initialize_state(compiled, ctx)
    return ctx.on_hand


def test_warm_start_without_safety_stock_is_demand_times_kappa():
    on_hand = _week0_on_hand({})
    np.testing.assert_allclose(on_hand, [40000 * 8, 20000 * 8])   # 480 000


def test_warm_start_carries_the_platform_default_safety_stock():
    """An empty policy bundle still maps P-P.3 at fixed_days/7 d, so t=0 holds
    E[D]·(κ + 7/7): one week of material demand above E[D]·κ."""
    w: list = []
    mapped = _map_policies({"default": {"inventory": {}}}, w,
                           sups_by_mat={"M001": {"S001"}, "M002": {"S004"}}, has_mts=True)
    assert mapped["safety_stock_materials"] == {"classification": "fixed_days",
                                                "fixed_days_cover": 7.0}
    on_hand = _week0_on_hand({"safety_stock_materials": mapped["safety_stock_materials"]})
    np.testing.assert_allclose(on_hand, [40000 * 9, 20000 * 9])   # 540 000
