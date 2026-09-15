# Legacy help site — ARCHIVED

> **Status:** DEPRECATED — superseded by `docs/PLAN.md` §6
> **Archived:** Phase 0 / WP 0.3
> **Do not revive.** Mine for narrative content only.

These files powered the old `/help` documentation site. Those routes rendered
`NotFound` from before this archive until WP 5.2a, which published the replacement
manual at `/docs` and turned `/help` into a redirect to it. Nothing in this
directory has ever been reachable since the archive, and nothing in it is rendered
now.

## Why it was archived

Full analysis in `docs/PLAN.md` §6.1. The short version:

1. **It documented names the user never sees.** One quantity, three names —
   the user types `sell_price`, it is stored as `sell_price`, the engine calls it
   `unit_price`, and these docs showed `unit_price`. Same for
   `demand_mean` → `demand_mode` and `demand_distribution` → `demand_model`.
   A planner holding `products.csv` could not find one of their own headers.
2. **It was hand-copied from the Pydantic models** and unguarded, while
   `scsim/scripts/gen_docs.py` already renders the same facts from the registry
   with a `--check` CI gate.
3. **It was written for the manuscript** — `b_p`, `ν`, `§3.1`, `MSER-5`.
4. **It was organized by engine entity**, not by the file or the cell the user
   actually touches.
5. **It was grouped by audience**, forcing readers to self-classify.

## Worth mining before this is forgotten

Narrative that exists nowhere else and should be carried into the new pages:

- the ACCURATE / Horizon Europe project framing (`docBodies.tsx` — `AccurateCallout`)
- the planner workflow and use-cases-by-page walkthroughs
- the glossary
- the stress-test catalogue ST-1 … ST-7 descriptions

## Do NOT mine

These duplicate `registry.generated.json` and are rendered by `gen_docs.py`:
the policy catalogue, simulation parameters (`SIM_PARAM_GROUPS`), KPI
definitions, probability distributions.

## Still in `src/`, deliberately

- `src/components/docs/DocsLayout.tsx` — good chrome, reused as-is
- `src/components/docs/registry.ts` — good shape; entries rewritten, type kept
