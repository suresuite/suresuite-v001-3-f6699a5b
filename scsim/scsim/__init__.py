"""SCSIM — resilience-grade 3-echelon supply chain simulator.

Operationalizes the methodology of "Synergistic Effects of Combining
Resilience Strategies in Supply Chains" (Nguyen & Ivanov).

Public API:
    from scsim import Scenario, Network, SimulationSettings, DisruptionEvent
    from scsim.core.engine import run_scenario, run_portfolio_study
    from scsim.stress import run_st1, run_st2
    from scsim.io.registry_export import build_registry

`ENGINE_VERSION` is embedded in every result; cross-version comparisons
must be flagged in any UI (Part IX §9.5).
"""

__version__ = "0.2.0"

# Engine semantic version. Bump per change-governance tiers (Part IX §9.5):
#   Tier 2 (new variable, behavior-neutral default) -> patch
#   Tier 3 (new phase / contract change)            -> minor or major + ADR
ENGINE_VERSION = "0.2.2"  # Tier 2: explicit demand_min/demand_max product bounds (behavior-neutral when NULL)

from scsim.entities.config import SimulationSettings, StatisticsReport  # noqa: E402,F401
from scsim.entities.network import (  # noqa: E402,F401
    BomLine,
    Customer,
    CustomerLink,
    Lane,
    Material,
    Network,
    Product,
    Supplier,
    SupplierLink,
    triangular_av,
)
from scsim.entities.disruption import DisruptionEvent  # noqa: E402,F401
from scsim.entities.scenario import Scenario  # noqa: E402,F401
