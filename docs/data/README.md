# `docs/data/` — generated table reference

Machine-generated, one page per table, rendered from `data-contract.generated.json`
by `npm run contract:generate` (lands in WP 1.4).

**Do not edit anything here.** `npm run contract:check` fails if a page differs from
what the contract generates.

| | |
|---|---|
| `tables/*.md` | one page per table — columns, types, units, substitutions, lineage |
| *(empty until WP 1.4)* | |

## The plan lives elsewhere

| Document | What it is |
|---|---|
| **`docs/PLAN.md`** | **The single plan.** Architecture, defects, transparency standard, the 78-page documentation manual, 26 work packages, verification SQL, drift log. The authority for all data-layer evidence — `npm run check:docs` enforces it. |
| `docs/PLAN-PROMPTS.md` | Derived view: one execution prompt per work package. |
| `docs/archive/legacy-help-site/` | The retired `/help` site. Deprecated — read its README first. |
| `scsim/docs/reference/*` | Generated from the engine registry by `gen_docs.py`, under its own `--check` gate. |
