"""§4 D174 — a master product consumed by another product is a sub-assembly.

The BOM flatten models an intermediate through its components (root→leaf
arcs), so a ProductRow for it used to reach ``Network`` with an empty BoM and
the engine refused the WHOLE project — the 2026-09-23 acceptance audit's
``products with empty BoM: ['SA1']``, on the canonical dataset the product's
own upload templates describe. The mapper now excludes ids the caller declares
in ``ProjectData.subassemblies`` and SAYS so: info when the exclusion is pure
modeling, warn when the sub-assembly also ships (its own outbound demand is
then not simulated).
"""
from __future__ import annotations

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


def _with_subassembly(*, sub_ships: bool = False) -> ProjectData:
    """FP ← SUB ← RAW, already flattened (FP←RAW), with SUB a master row."""
    outbound = [OutboundArc("fp", "c1", unit_price=20.0, volume=100.0, time_unit="week")]
    if sub_ships:
        outbound.append(OutboundArc("sub", "c2", unit_price=5.0, volume=10.0, time_unit="week"))
    return ProjectData(
        suppliers=[SupplierRow(id="s1")],
        materials=[MaterialRow(id="raw", cost=2.0)],
        products=[
            ProductRow(id="fp", sell_price=20.0, demand_mean=100.0, production_capacity=200.0),
            ProductRow(id="sub", sell_price=5.0),
        ],
        supply_arcs=[SupplyArc(supplier_id="s1", material_id="raw", unit_price=2.0,
                               lead_time=2, lead_time_unit="week")],
        bom=[BomArc(product_id="fp", material_id="raw", consumption_rate=2.0)],
        outbound=outbound,
        subassemblies=["sub"],
        scenario=ScenarioSettings(),
    )


def test_subassembly_product_is_excluded_and_the_project_maps():
    res = from_project_data(_with_subassembly())
    net = res.scenario.network
    assert [p.id for p in net.products] == ["fp"]  # SUB is not an engine product
    note = [w for w in res.warnings if w.field == "subassembly"]
    assert len(note) == 1 and note[0].level == "info" and note[0].entity == "product:sub"


def test_shipping_subassembly_is_excluded_with_a_warn_not_an_info():
    res = from_project_data(_with_subassembly(sub_ships=True))
    note = [w for w in res.warnings if w.field == "subassembly"]
    assert len(note) == 1 and note[0].level == "warn"
    assert "not simulated" in note[0].reason


def test_no_declared_subassemblies_changes_nothing():
    d = _with_subassembly()
    d.subassemblies = []
    d.products = [p for p in d.products if p.id == "fp"]
    res = from_project_data(d)
    assert [p.id for p in res.scenario.network.products] == ["fp"]
    assert not [w for w in res.warnings if w.field == "subassembly"]
