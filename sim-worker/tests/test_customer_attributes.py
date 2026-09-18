"""§4 D69 — the `customers` table reaches the engine.

THE DEFECT. `project_map.from_project_data` built its customer entities as

    customers=[Customer(id=c, name=c) for c in sorted(customers)]

from the ids found on outbound arcs, and never read the `customers` table.
`sim-worker` did not even fetch it. So every customer arrived with the entity
DEFAULTS — `segment="default"`, `priority_weight=1.0` — and two P-C.2
(`customer_allocation`) features were inert on every project ever run:

  * `priority` ordering falls back to `Customer.priority_weight` for any
    customer its `priority_weights` param does not name, and the fallback was
    always 1.0, so it could not order anything;
  * `sla_tiers` is keyed BY SEGMENT, and every customer was in `"default"`, so
    no tier ever matched and every guaranteed fill floor was 0.0.

The second is the one worth reading twice: the engine ALREADY warned about it
(P-C.2's `unknown_sla_segment` feasibility issue), and the warning named the
symptom while nothing named the cause — the segments it compared against were a
constant. A user filling in a customer's priority or segment changed nothing, on
every project, with no error.

WHAT THIS PINS. The ingestion path end to end, `build_project_data` →
`from_project_data`, which is the same path `test_validation_parity` uses. The
id set and the attribute set are deliberately separate concerns — an id can come
from an outbound arc with no row in the table — so both directions are asserted.
"""
from __future__ import annotations

import pytest

pytest.importorskip("scsim")

from scsim.io import from_project_data  # noqa: E402

from sim_worker.datamap import build_project_data  # noqa: E402


def _data(customers: list[dict] | None):
    return build_project_data(
        suppliers=[{"supplier_id": "S1", "name": "S1"}],
        materials=[{"material_id": "M1", "cost": 4.0}],
        products=[{"product_id": "P1", "sell_price": 25.0, "demand_mean": 300}],
        inbound=[{"supplier_id": "S1", "material_id": "M1", "unit_price": 4.0, "lead_time": 2}],
        bom=[{"product_id": "P1", "material_id": "M1", "consumption_rate": 1.0}],
        outbound=[
            {"product_id": "P1", "customer_id": "C1", "unit_price": 25.0,
             "volume": 200, "time_unit": "week"},
            {"product_id": "P1", "customer_id": "C2", "unit_price": 25.0,
             "volume": 100, "time_unit": "week"},
        ],
        customers=customers,
        policies={"default": {"inventory": {"type": "min_max"}}},
        scenario={"horizon_days": 365, "seed": 1, "replications": 1, "crn": True},
        project_model="make_to_stock",
    )


def _by_id(result):
    return {c.id: c for c in result.scenario.network.customers}


def test_segment_and_priority_reach_the_engine():
    """The whole defect, stated positively."""
    cust = _by_id(from_project_data(_data([
        {"customer_id": "C1", "name": "Acme", "segment": "gold", "priority_weight": 3.5},
        {"customer_id": "C2", "name": "Beta", "segment": "silver", "priority_weight": 0.5},
    ])))

    assert cust["C1"].segment == "gold"
    assert cust["C1"].priority_weight == pytest.approx(3.5)
    assert cust["C1"].name == "Acme"
    assert cust["C2"].segment == "silver"
    assert cust["C2"].priority_weight == pytest.approx(0.5)


def test_more_than_one_segment_exists_at_all():
    """`sla_tiers` is keyed by segment, so ONE segment means no tier can match.

    Asserted separately from the values above because it is the property P-C.2
    actually needs, and the old mapper satisfied every per-customer assertion you
    could write about `id` while failing this one for every project.
    """
    result = from_project_data(_data([
        {"customer_id": "C1", "segment": "gold", "priority_weight": 3.5},
        {"customer_id": "C2", "segment": "silver", "priority_weight": 0.5},
    ]))
    segments = {c.segment for c in result.scenario.network.customers}
    assert segments == {"gold", "silver"}


def test_a_customer_with_no_row_keeps_the_engine_defaults():
    """An id on an outbound arc with no row in the table is not an error.

    It must still appear — dropping it would remove its demand — and it keeps
    the documented defaults rather than inheriting another customer's.
    """
    cust = _by_id(from_project_data(_data([
        {"customer_id": "C1", "segment": "gold", "priority_weight": 3.5},
    ])))

    assert set(cust) == {"C1", "C2"}
    assert cust["C2"].segment == "default"
    assert cust["C2"].priority_weight == pytest.approx(1.0)


def test_no_customers_table_at_all_behaves_as_before():
    """The pre-fix behaviour, kept as the floor: absent rows change nothing."""
    cust = _by_id(from_project_data(_data(None)))

    assert set(cust) == {"C1", "C2"}
    assert all(c.segment == "default" for c in cust.values())
    assert all(c.priority_weight == pytest.approx(1.0) for c in cust.values())


def test_a_null_column_falls_back_rather_than_failing_validation():
    """A row that exists with NULL attributes is the common production shape.

    `Customer.segment` is typed `str` (defaulting to `"default"`) and
    `priority_weight` is a `float` with `ge=0`, so passing `None` through would
    RAISE a validation error rather than fall back. The mapper therefore
    overrides a default only when the table actually says something.
    """
    cust = _by_id(from_project_data(_data([
        {"customer_id": "C1", "name": None, "segment": None, "priority_weight": None},
    ])))

    assert cust["C1"].segment == "default"
    assert cust["C1"].priority_weight == pytest.approx(1.0)
    assert cust["C1"].name == "C1"


def test_a_row_naming_an_id_with_no_demand_is_reported_not_silent():
    """A customer row whose id appears on no outbound arc has nothing to allocate.

    It is not an error — the table is allowed to describe customers the current
    graph does not trade with — but it is worth saying, because the alternative
    is a user editing a priority that provably cannot matter.
    """
    result = from_project_data(_data([
        {"customer_id": "C1", "segment": "gold", "priority_weight": 3.5},
        {"customer_id": "GHOST", "segment": "gold", "priority_weight": 9.0},
    ]))

    assert any(
        wd["entity"] == "customers" and "GHOST" in wd["reason"]
        for wd in result.warning_dicts
    )
