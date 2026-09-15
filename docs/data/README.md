# `docs/data/` — the data-layer reference

Every page here opens with a **status banner** saying whether it is GENERATED (edit the
generator, never the page), AUTHORED (edit it by hand, and expect it to drift) or
DEPRECATED (superseded — the banner names by what). Read the banner before editing.

| Page | Status | |
|---|---|---|
| `tables/*.md` | GENERATED | one page per table — columns, types, units, substitutions, lineage. Rendered from `data-contract.generated.json` by `npm run contract:generate`; `npm run contract:check` fails if a page differs from what the contract generates. **Do not edit.** *(empty until WP 1.4)* |
| `field-mapping.md` | AUTHORED | how stored project data becomes a simulation run — the hand-maintained half of the contract, kept in step with `project_map.py` and `datamap.py` until WP 1.2–1.4 generate it |
| `lifecycle.md` | AUTHORED | where each piece of project state lives and how long it survives |

The two authored pages moved here from the top level in WP 0.3; tombstones remain at
`docs/data-simulation-mapping.md` and `docs/simulation-data-lifecycle.md` because
around two dozen code comments still cite the old paths.

## The plan lives elsewhere

| Document | What it is |
|---|---|
| **`docs/PLAN.md`** | **The single plan.** Architecture, defects, transparency standard, the 78-page documentation manual, 26 work packages, verification SQL, drift log. The authority for all data-layer evidence — `npm run check:docs` enforces it. |
| `docs/PLAN-PROMPTS.md` | Derived view: one execution prompt per work package. |
| `docs/archive/legacy-help-site/` | The retired `/help` site. Deprecated — read its README first. |
| `scsim/docs/reference/*` | Generated from the engine registry by `gen_docs.py`, under its own `--check` gate. |
