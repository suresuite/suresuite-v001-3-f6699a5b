"""The ``/scsim/registry`` payload — Part IX §9.6.

Pydantic is canonical: this module renders the policy catalog (all 21,
implemented + planned), each Params JSON Schema with units/ranges/defaults,
the pipeline schema, the KPI dictionary, and the entity variable dictionary
into one JSON document. The frontend renders forms from this ONLY (no
hard-coded policies); Zod/Supabase validators are code-generated from the
same schemas; the MkDocs catalog pages are generated from it too
(scripts/gen_docs.py) — so docs cannot drift from code (Docs CI gate).
"""
from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel

from scsim import ENGINE_VERSION
from scsim.core.phases import pipeline_schema
from scsim.entities.config import SimulationSettings
from scsim.entities.disruption import DisruptionEvent
from scsim.entities.network import (
    BomLine,
    Customer,
    Lane,
    Material,
    Product,
    Supplier,
    SupplierLink,
)
from scsim.io.project_map import base_data_requirements
from scsim.kpi.definitions import KPI_DICTIONARY
from scsim.policies.registry import catalog

ENTITY_MODELS: dict[str, type[BaseModel]] = {
    "simulation_settings": SimulationSettings,
    "supplier": Supplier,
    "supplier_link": SupplierLink,
    "material": Material,
    "bom_line": BomLine,
    "product": Product,
    "customer": Customer,
    "lane": Lane,
    "disruption_event": DisruptionEvent,
}


def build_registry() -> dict[str, Any]:
    policies = []
    for entry in catalog():
        plugin_hooks = []
        if entry.plugin_cls is not None:
            proto = entry.plugin_cls(entry.params_model())
            plugin_hooks = [
                {
                    "phase": h.phase.value,
                    "priority": h.priority,
                    "reads": sorted(h.reads),
                    "writes": sorted(h.writes),
                    "resolution": h.resolution,
                }
                for h in proto.hooks
            ]
        policies.append({
            "id": entry.id,
            "catalog_ref": entry.catalog_ref,
            "stage": entry.stage.value,
            "strategy_class": entry.strategy_class.value,
            "constraint_targeted":
                entry.constraint_targeted.value if entry.constraint_targeted else None,
            "requires_predeployment": entry.requires_predeployment,
            "status": entry.status.value,
            "milestone": entry.milestone or None,
            "summary": entry.summary,
            "hooks": plugin_hooks,
            "params_schema": entry.params_model.model_json_schema(),
            "data_requirements": [r.as_dict() for r in entry.data_requirements],
        })
    return {
        "engine_version": ENGINE_VERSION,
        "policies": policies,
        # §8.1 — entity fields the always-on engine mechanics read (world model,
        # economics), with project_map.py's fallback chains. The per-policy
        # counterpart is each policy's "data_requirements".
        "base_data_requirements": [r.as_dict() for r in base_data_requirements()],
        "pipeline": pipeline_schema(),
        "kpis": [
            {"name": k.name, "symbol": k.symbol, "definition": k.definition, "unit": k.unit}
            for k in KPI_DICTIONARY
        ],
        "entities": {
            name: model.model_json_schema() for name, model in ENTITY_MODELS.items()
        },
    }


def registry_json(indent: int = 2) -> str:
    return json.dumps(build_registry(), indent=indent, sort_keys=True)


if __name__ == "__main__":
    # `python -m scsim.io.registry_export > registry.json` — the /scsim/registry
    # payload for the frontend forms and the Zod/Supabase validator codegen.
    print(registry_json())
