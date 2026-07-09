"""Multi-level BOM → effective single-level arcs (datamap flattening).

The engine models one BOM level (product → raw material). Projects uploaded
with bom_multi_level rows (child material_id ← parent
higher_level_component_id at consumption_rate) must reach the engine as
root→leaf arcs whose rate is the sum over paths of the product of edge
rates — the same propagation combine-project applies to demand. A project
whose BOM produced zero arcs used to die inside the engine with pydantic's
"bom too_short"; it must now fail loudly and diagnosably, or not at all.
"""
from sim_worker.datamap import _flatten_multi_level_bom, build_project_data


def _multi(parent, child, rate, level=1):
    return {
        "higher_level_component_id": parent,
        "material_id": child,
        "consumption_rate": rate,
        "level": level,
    }


def test_chain_multiplies_rates():
    rows = [_multi("P", "A", 2.0, 1), _multi("A", "M", 3.0, 2)]
    flat = _flatten_multi_level_bom(rows)
    assert flat == [{"product_id": "P", "material_id": "M", "consumption_rate": 6.0}]


def test_parallel_paths_sum():
    # P consumes M directly (1) and via A (2 * 3) → effective 7.
    rows = [
        _multi("P", "A", 2.0, 1),
        _multi("P", "M", 1.0, 1),
        _multi("A", "M", 3.0, 2),
    ]
    flat = _flatten_multi_level_bom(rows)
    assert flat == [{"product_id": "P", "material_id": "M", "consumption_rate": 7.0}]


def test_multiple_roots_and_leaves():
    rows = [
        _multi("P1", "M1", 2.0),
        _multi("P2", "A", 1.0),
        _multi("A", "M1", 4.0, 2),
        _multi("A", "M2", 5.0, 2),
    ]
    flat = _flatten_multi_level_bom(rows)
    assert flat == [
        {"product_id": "P1", "material_id": "M1", "consumption_rate": 2.0},
        {"product_id": "P2", "material_id": "M1", "consumption_rate": 4.0},
        {"product_id": "P2", "material_id": "M2", "consumption_rate": 5.0},
    ]


def test_missing_rate_defaults_to_one_like_single_level():
    rows = [_multi("P", "A", None, 1), _multi("A", "M", 3.0, 2)]
    flat = _flatten_multi_level_bom(rows)
    assert flat == [{"product_id": "P", "material_id": "M", "consumption_rate": 3.0}]


def test_cycle_terminates_and_drops_looping_path():
    rows = [
        _multi("P", "A", 2.0, 1),
        _multi("A", "B", 3.0, 2),
        _multi("B", "A", 1.0, 3),  # cycle A↔B
        _multi("A", "M", 5.0, 2),
    ]
    flat = _flatten_multi_level_bom(rows)
    assert {"product_id": "P", "material_id": "M", "consumption_rate": 10.0} in flat


def test_build_project_data_flattens_multi_rows():
    data = build_project_data(
        suppliers=[{"supplier_id": "S"}],
        materials=[{"material_id": "M", "cost": 4.0}],
        products=[{"product_id": "P", "sell_price": 25.0, "demand_mean": 300}],
        inbound=[{"supplier_id": "S", "material_id": "M", "unit_price": 4.0, "lead_time": 2}],
        bom=[_multi("P", "A", 2.0, 1), _multi("A", "M", 3.0, 2)],
        outbound=[{"product_id": "P", "customer_id": "C", "unit_price": 25.0, "volume": 300}],
        policies={},
        scenario={"horizon_days": 30, "replications": 1},
        project_model=None,
    )
    assert [(b.product_id, b.material_id, b.consumption_rate) for b in data.bom] == [
        ("P", "M", 6.0)
    ]


def test_build_project_data_single_level_unchanged():
    data = build_project_data(
        suppliers=[], materials=[], products=[],
        inbound=[],
        bom=[{"product_id": "P", "material_id": "M", "consumption_rate": 1.5}],
        outbound=[],
        policies={}, scenario={}, project_model=None,
    )
    assert [(b.product_id, b.material_id, b.consumption_rate) for b in data.bom] == [
        ("P", "M", 1.5)
    ]


def test_engine_error_is_diagnosable_when_bom_empty():
    import pytest
    from scsim.io.project_map import from_project_data

    data = build_project_data(
        suppliers=[{"supplier_id": "S"}],
        materials=[{"material_id": "M", "cost": 4.0}],
        products=[{"product_id": "P", "sell_price": 25.0, "demand_mean": 300}],
        inbound=[{"supplier_id": "S", "material_id": "M", "unit_price": 4.0, "lead_time": 2}],
        bom=[],
        outbound=[{"product_id": "P", "customer_id": "C", "unit_price": 25.0, "volume": 300}],
        policies={},
        scenario={"horizon_days": 30, "replications": 1},
        project_model=None,
    )
    with pytest.raises(ValueError, match="no usable BOM arcs"):
        from_project_data(data)
