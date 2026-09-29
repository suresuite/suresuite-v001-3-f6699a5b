# debug_init.py
import logging

# The init / κ diagnostics are DEBUG log lines in the engine (not print), so a
# run in the worker or the browser stays quiet; this script turns them on.
logging.basicConfig(level=logging.DEBUG, format="%(message)s")

from scsim import Scenario, Network, SimulationSettings, Material, Product, Supplier, SupplierLink, BomLine
from scsim.entities.enums import FulfillmentMode
from scsim.core.engine import run_scenario

net = Network(
    materials=[
        Material(id="M001", name="M001", cost=0.2, holding_cost_rate=20.0),
        Material(id="M002", name="M002", cost=0.1, holding_cost_rate=20.0),
    ],
    products=[
        Product(id="P001", name="P001", unit_price=0.5, production_capacity=7000,
                fulfillment_mode=FulfillmentMode.MTS, demand_mode=20000),
    ],
    suppliers=[
        Supplier(id="S001", name="S001"),
        Supplier(id="S004", name="S004"),
    ],
    supplier_links=[
        SupplierLink(supplier_id="S001", material_id="M001", cost=0.2, lead_time_weeks=6),
        SupplierLink(supplier_id="S004", material_id="M002", cost=0.1, lead_time_weeks=6),
    ],
    bom=[
        BomLine(product_id="P001", material_id="M001", rate=2.0),
        BomLine(product_id="P001", material_id="M002", rate=1.0),
    ],
)
sc = Scenario(
    name="debug", network=net,
    settings=SimulationSettings(horizon=52, model_seeds=1, project_seed=42),
)
res = run_scenario(sc, debug=True)