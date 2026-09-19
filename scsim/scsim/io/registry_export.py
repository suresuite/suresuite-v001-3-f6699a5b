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
import re
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
from scsim.stress import battery as stress_battery

# The engine author's implemented/planned shorthand in ST_DEFINITIONS, with the
# whitespace in front of it so a strip cannot leave "(manuscript )" behind.
_GLYPH = re.compile("\\s*[\u2705\u274c\ufe0f]+")

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


def stress_tests() -> list[dict[str, Any]]:
    """The stress battery as a DECLARATION — §4 D106.

    ``ST_DEFINITIONS`` in ``scsim/stress/battery.py`` is the engine's own
    catalog of ST-1…ST-7 and it was reachable only by a text scan over the
    Python literal: §4 D90's weakest door, and the archived manual had already
    drifted from it (it carried a ``status`` column for all seven that the engine
    does not). §3 and blueprint §6.2 make this module the single source of truth
    for what the engine declares, so the battery belongs here.

    ``entrypoint`` is resolved by ``getattr`` at import time rather than parsed
    out of a call site: the fact a consumer needs is "is there a callable that
    runs this cell", and Python answering that is stronger evidence than any
    scan of ``_run_battery(…, "ST-n", …)``. It is the module's PUBLIC name, so a
    consumer can also say WHERE the battery lives — it is a ``scsim`` library
    API and not a product surface (§4 D111), and a declaration that hands over
    the import path lets the page state that from data instead of asserting it.
    """
    out: list[dict[str, Any]] = []
    for test_id, description in stress_battery.ST_DEFINITIONS.items():
        fn = f"run_st{test_id.removeprefix('ST-')}"
        callable_ = getattr(stress_battery, fn, None)
        out.append({
            "id": test_id,
            # The author's implemented/planned glyph is stripped: `entrypoint`
            # carries that fact from a callable rather than from a glyph, and this
            # string is product copy the moment a page renders it (§3.5 forbids
            # emoji there). The mathematical marks (×, Δ, φ, ∩) stay — they are
            # notation, not decoration.
            "description": _GLYPH.sub("", description).strip(),
            "entrypoint": f"scsim.stress.{fn}" if callable(callable_) else None,
        })
    return out


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
        # Part VI — the stress battery, declared rather than scanned (§4 D106).
        "stress_tests": stress_tests(),
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
