"""Shared fixtures: canonical mini-networks used across the suite."""
from __future__ import annotations

import pytest

from scsim import (
    BomLine,
    DisruptionEvent,
    Material,
    Network,
    Product,
    Scenario,
    SimulationSettings,
    Supplier,
    SupplierLink,
)
from scsim.entities.enums import DemandModel, WarmupMethod


def make_settings(**kw) -> SimulationSettings:
    base = dict(
        project_seed=42,
        horizon=70,
        model_seeds=2,
        warmup_method=WarmupMethod.MANUAL,
        warmup_end=10,
        analysis_window=50,
    )
    base.update(kw)
    return SimulationSettings(**base)


def single_chain_network(*, deterministic=True, supplier_capacity=None) -> Network:
    """Golden #1 topology: one supplier → one material → one product."""
    return Network(
        suppliers=[Supplier(id="s1", capacity_per_week=supplier_capacity)],
        materials=[Material(id="m1", cost=2.0)],
        products=[Product(
            id="p1", unit_price=10.0, demand_mode=100.0,
            demand_model=DemandModel.DETERMINISTIC if deterministic else DemandModel.TRIANGULAR,
            production_capacity=200.0,
        )],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[
            SupplierLink(supplier_id="s1", material_id="m1", cost=2.0, lead_time_weeks=2)
        ],
    )


def dual_source_network() -> Network:
    """Golden #2 topology: two qualified suppliers for the same material."""
    net = single_chain_network()
    return Network(
        suppliers=[Supplier(id="s1"), Supplier(id="s2")],
        materials=net.materials,
        products=net.products,
        bom=net.bom,
        supplier_links=[
            SupplierLink(supplier_id="s1", material_id="m1", cost=2.0, lead_time_weeks=2),
            SupplierLink(supplier_id="s2", material_id="m1", cost=2.6, lead_time_weeks=3),
        ],
    )


def bom_blocked_network() -> Network:
    """Golden #3 topology: product needs BOTH materials. m1 is dual-sourced;
    m2 is single-sourced from s2 — the manuscript's BoM-peer bottleneck."""
    return Network(
        suppliers=[Supplier(id="s1"), Supplier(id="s2")],
        materials=[Material(id="m1", cost=2.0), Material(id="m2", cost=4.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=100.0,
                          demand_model=DemandModel.DETERMINISTIC, production_capacity=200.0)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0),
             BomLine(product_id="p1", material_id="m2", rate=1.0)],
        supplier_links=[
            SupplierLink(supplier_id="s1", material_id="m1", cost=2.0, lead_time_weeks=2),
            SupplierLink(supplier_id="s2", material_id="m1", cost=2.5, lead_time_weeks=3),
            SupplierLink(supplier_id="s2", material_id="m2", cost=4.0, lead_time_weeks=3),
        ],
    )


def shared_material_network() -> Network:
    """P-P.9 playground: two products competing for one shared material.
    The premium product's private material m2 comes from the NON-disrupted
    supplier s2, so under an s1 outage the only lever is who gets m_shared."""
    return Network(
        suppliers=[Supplier(id="s1"), Supplier(id="s2")],
        materials=[Material(id="m_shared", cost=3.0), Material(id="m2", cost=1.0)],
        products=[
            Product(id="cheap", unit_price=10.0, demand_mode=100.0, production_capacity=130.0),
            Product(id="premium", unit_price=50.0, demand_mode=80.0, production_capacity=100.0),
        ],
        bom=[BomLine(product_id="cheap", material_id="m_shared", rate=1.0),
             BomLine(product_id="premium", material_id="m_shared", rate=1.0),
             BomLine(product_id="premium", material_id="m2", rate=1.0)],
        supplier_links=[
            SupplierLink(supplier_id="s1", material_id="m_shared", cost=3.0, lead_time_weeks=3),
            SupplierLink(supplier_id="s2", material_id="m_shared", cost=3.9, lead_time_weeks=4),
            SupplierLink(supplier_id="s2", material_id="m2", cost=1.0, lead_time_weeks=2),
        ],
    )


@pytest.fixture
def single_chain() -> Scenario:
    return Scenario(name="single", network=single_chain_network(), settings=make_settings())


@pytest.fixture
def outage_event() -> DisruptionEvent:
    return DisruptionEvent(target_id="s1", start=20, duration=14)
