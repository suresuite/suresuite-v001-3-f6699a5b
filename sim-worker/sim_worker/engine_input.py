"""The engine's input, described so a person can read it — PLAN.md §4 D289.

A policy version's "Export" used to write the stored policy bundle, one column per
family key, with the Zod defaults filled in and a provenance row under every value
row. It was hard to read, and it was not what the engine receives: the engine reads
the policy version TOGETHER WITH a dataset version, through the mapper, and the
export showed neither the dataset nor the mapping.

This describes `MappingResult` — the object `compute_run_from_project` hands to
`run_scenario` — rather than re-deriving anything:

* ``scenario`` — `mapping.scenario`, dumped. Every number a run simulates is in it.
* ``fields`` — each entity field's unit and meaning, from the scsim models' own
  ``json_schema_extra`` (the same metadata the registry export publishes).
* ``row_sources`` — where each master-backed value came from (override · item
  master · lanes · derived · default), from `mapping.resolved`, placed on the row it
  fills by the bundle key's declared ``target`` (`POLICY_BUNDLE_KEYS`).
* ``sources`` — the same, as one long list, including targets that are policy
  parameters rather than entity fields.
* ``policies`` — every policy the run applies, with its parameters VALIDATED the
  way the engine validates them (so an engine default is shown, and marked as one),
  plus the built-in buffers that run with catalog defaults when the mapping names
  none of their parameters.
* ``warnings`` — the mapper's notes: every substitution it made.

No database, no clock: the caller passes what the run would read.
"""
from __future__ import annotations

import typing
from typing import Any, Optional

# Network list → the key the mapper's `resolved` uses for one of its rows. A
# supplier link's MOQ is resolved per MATERIAL (`materials.moq`, "applied to every
# supplier link of the material"), so its row is found by its material.
_ROW_KEY = {
    "suppliers": lambda r: str(r.get("id")),
    "materials": lambda r: str(r.get("id")),
    "products": lambda r: str(r.get("id")),
    "customers": lambda r: str(r.get("id")),
    "supplier_links": lambda r: str(r.get("material_id")),
    "customer_links": lambda r: f"{r.get('customer_id')}::{r.get('product_id')}",
}

# The entity class a bundle key's `target` names → the network list it lives in.
_TARGET_LIST = {
    "Supplier": "suppliers",
    "SupplierLink": "supplier_links",
    "Material": "materials",
    "Product": "products",
    "Customer": "customers",
    "CustomerLink": "customer_links",
}


# Abbreviations a planner reads in capitals ("FG base stock", not "Fg base stock").
_ACRONYMS = {"fg", "moq", "cv", "sla", "bom", "ci", "crn", "abc", "xyz", "ma", "rop", "id", "kpi"}


def _humanize(name: str) -> str:
    words = name.replace("_", " ").strip().split()
    out = [w.upper() if w.lower() in _ACRONYMS else w.lower() for w in words]
    if out and out[0] == out[0].lower():
        out[0] = out[0].capitalize()
    return " ".join(out)


def _field_meta(model: type) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for name, f in model.model_fields.items():
        extra = f.json_schema_extra if isinstance(f.json_schema_extra, dict) else {}
        out[name] = {
            "label": f.title or _humanize(name),
            "unit": extra.get("unit") or "",
            "notes": extra.get("notes") or (f.description or ""),
        }
    return out


def _list_item_model(annotation: Any) -> Optional[type]:
    if typing.get_origin(annotation) is list:
        (arg,) = typing.get_args(annotation) or (None,)
        if isinstance(arg, type) and hasattr(arg, "model_fields"):
            return arg
    return None


def field_guide() -> dict[str, dict[str, dict[str, Any]]]:
    """Unit and meaning of every field the engine input carries, keyed by the
    network list (`products`, `supplier_links`, …), `settings` and `events`."""
    from scsim.entities.config import SimulationSettings
    from scsim.entities.disruption import DisruptionEvent
    from scsim.entities.network import Network

    guide: dict[str, dict[str, dict[str, Any]]] = {}
    for name, f in Network.model_fields.items():
        model = _list_item_model(f.annotation)
        if model is not None:
            guide[name] = _field_meta(model)
    guide["network"] = {
        n: m for n, m in _field_meta(Network).items() if n not in guide
    }
    guide["settings"] = _field_meta(SimulationSettings)
    guide["events"] = _field_meta(DisruptionEvent)
    return guide


def _resolve_ref(schema: dict, root: dict) -> dict:
    ref = schema.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        return root.get("$defs", {}).get(ref.split("/")[-1], {})
    return schema


def _object_branch(schema: dict, root: dict) -> dict:
    """The branch of an `anyOf` that describes an object (a nullable model)."""
    schema = _resolve_ref(schema, root)
    for alt in schema.get("anyOf") or []:
        alt = _resolve_ref(alt, root)
        if alt.get("properties") or alt.get("additionalProperties"):
            return alt
    return schema


def _flatten(value: Any, schema: dict, root: dict, raw: Any, path: list[str],
             meta: dict, out: list[dict], display: list[str]) -> None:
    """One row per leaf parameter. `raw` is what the mapping passed at this path
    (None when it passed nothing), so a value the engine filled from its own
    default is marked as one. `display` is the path as a person reads it: a
    parameter by its label, a map key (a material, a customer × product row) as
    it is."""
    obj = _object_branch(schema, root)
    if isinstance(value, dict) and value and (obj.get("properties") or obj.get("additionalProperties")):
        props = obj.get("properties") or {}
        extra = obj.get("additionalProperties")
        for key, sub in value.items():
            named = key in props
            sub_schema = props.get(key) if named else (extra if isinstance(extra, dict) else {})
            sub_meta = _resolve_ref(sub_schema or {}, root) if named else meta
            sub_raw = raw.get(key) if isinstance(raw, dict) else None
            shown = _humanize(key) if named else str(key)
            _flatten(sub, sub_schema or {}, root, sub_raw, path + [str(key)], sub_meta, out,
                     display + [shown])
        return
    out.append({
        "path": path,
        "display": display,
        "value": value,
        "label": _humanize(path[-1] if path else ""),
        "unit": meta.get("unit") or "",
        "notes": meta.get("notes") or meta.get("description") or "",
        "set_by_mapping": raw is not None,
    })


def describe_policies(policies: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Every policy the run applies, its parameters as the engine validates them."""
    from scsim.entities.scenario import BUILT_IN_POLICY_IDS
    from scsim.policies.registry import get_entry

    out: list[dict[str, Any]] = []
    ids = list(policies) + [p for p in BUILT_IN_POLICY_IDS if p not in policies]
    for pid in ids:
        raw = policies.get(pid)
        entry = get_entry(pid)
        model = entry.params_model
        validated = model.model_validate(raw or {}).model_dump(mode="json")
        schema = model.model_json_schema()
        rows: list[dict] = []
        props = schema.get("properties") or {}
        for key, val in validated.items():
            prop = props.get(key) or {}
            meta = _resolve_ref(prop, schema)
            _flatten(val, prop, schema, (raw or {}).get(key), [key], meta, rows, [_humanize(key)])
        out.append({
            "id": pid,
            "catalog_ref": entry.catalog_ref,
            "name": entry.name,
            "summary": entry.summary,
            "in_mapping": raw is not None,
            "params": rows,
        })
    return out


def _sources(mapping: Any, network: dict[str, Any]) -> tuple[dict, list[dict]]:
    from scsim.io.project_map import POLICY_BUNDLE_KEYS

    target_of = {k["master"]: k["target"] for k in POLICY_BUNDLE_KEYS if k.get("master")}
    row_sources: dict[str, dict[str, dict[str, dict[str, Any]]]] = {}
    flat: list[dict] = []
    for master, by_entity in sorted(mapping.resolved.items()):
        target = target_of.get(master, "")
        cls, _, field = target.partition(".")
        lst = _TARGET_LIST.get(cls)
        for entity, rec in sorted(by_entity.items()):
            flat.append({
                "target": target, "master": master, "entity": entity,
                "source": rec.get("source"), "value": rec.get("value"),
            })
            if not lst or lst not in network or not field:
                continue
            key_of = _ROW_KEY[lst]
            for i, row in enumerate(network[lst]):
                if key_of(row) == entity:
                    row_sources.setdefault(lst, {}).setdefault(str(i), {})[field] = {
                        "source": rec.get("source"), "value": rec.get("value"), "master": master,
                    }
    return row_sources, flat


def describe(mapping: Any) -> dict[str, Any]:
    """The engine input of one run, from the `MappingResult` the run computes."""
    from scsim import ENGINE_VERSION

    scenario = mapping.scenario.model_dump(mode="json")
    row_sources, flat = _sources(mapping, scenario.get("network") or {})
    from sim_worker.build import code_version

    return {
        "engine_version": ENGINE_VERSION,
        "engine_build": code_version(),
        "scenario": scenario,
        "fields": field_guide(),
        "row_sources": row_sources,
        "sources": flat,
        "policies": describe_policies(mapping.scenario.policies),
        "warnings": mapping.warning_dicts,
    }
