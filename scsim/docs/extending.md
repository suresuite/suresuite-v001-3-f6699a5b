# Extending the engine (Part IX)

## Change-governance tiers

| Tier | Change | Ceremony | Version |
|---|---|---|---|
| 1 | New policy on EXISTING hooks | plugin file + registry entry + generated docs row (CI-enforced) + 1 validation experiment | none |
| 2 | New variable / entity field | behavior-neutral default + migration; golden traces stay byte-identical | patch |
| 3 | New phase or contract change | ADR + pipeline schema snapshot re-frozen (old set archived) + golden traces re-frozen | minor/major |

Results carry `engine_version` (`StatisticsReport`); cross-version
comparisons must be flagged in any UI, never silent. The pipeline definition
is schema-snapshotted (`scsim/pipeline_schema.json`); the snapshot test
fails the build on accidental drift.

## Tier 1 walkthrough: adding a policy

1. **Pick the phases** from the [pipeline contract](reference/pipeline.md).
   If the existing phases and state keys suffice, it's Tier 1.
2. **Write the Params model** (subclass `PolicyParams`; every field carries
   `unit`/`scope`/`notes` via `json_schema_extra` — the registry, frontend
   forms, and generated docs all read them; `extra="forbid"` makes typos
   validation errors).
3. **Write the plugin** (subclass `PolicyPlugin`): ClassVar metadata
   (`id`, `catalog_ref`, `stage`, `strategy_class`, `constraint_targeted`,
   `requires_predeployment`, `status`, `summary`), `hooks`, `on_phase`,
   optional `setup` / `cost_contribution` / `feasibility`. Decorate with
   `@register_plugin` and import the module in
   `scsim/policies/registry.py::_ensure_loaded`.
4. **Respect the contracts** — they are enforced, not advisory:
   * declare every read/write; the debug write-guard and load-time
     validation both bite;
   * if you write a key another hook writes in the same phase, pick a
     distinct priority and declare a `resolution` rule (see P-P.3 / P-S.1 /
     P-P.9 for the pattern);
   * randomness ONLY from `ctx.rng(self.id)` — never `numpy.random`
     globals, never the world streams. The G-RNG golden test will catch
     leaks;
   * per-replication mutable state lives in `ctx.policy_state[self.id]`,
     not on `self` (plugin instances are shared across replications);
   * costs go through `ctx.cost.add(component, amount)` (activation costs
     in-phase) or `cost_contribution` (standing costs, assessed at PH-99).
5. **Regenerate the docs** — `python scripts/gen_docs.py` — and commit the
   reference pages; `--check` gates CI.
6. **Ship one validation experiment**: a test that demonstrates the policy's
   directional claim (see `tests/test_policies.py` for the seven shipped
   examples — e.g. P-T.2's "cannot conjure units under a capacity cut").

A planned (🧩) policy that isn't ready to run still registers its full
parameter schema via `register_planned(...)` with a milestone; compiling a
scenario that enables it raises `PolicyNotImplementedError` with that
pointer — planned policies never silently no-op.

## Tier 2: new variables

Add the field to the Pydantic entity with a **behavior-neutral default**
(the `Lane` entity is the worked example: lead time 0, capacity ∞, cost 0 —
manuscript reproduction is untouched until a feature reads it). Golden
traces must remain byte-identical; bump the patch version.

## Tier 3: new phases

Example: Tier-2 supplier propagation as a `PH-85 upstream_cascade`. Add the
`PhaseSpec` to `PIPELINE`, define its owned keys, re-freeze
`pipeline_schema.json`, archive the old golden traces, write the ADR, and
bump minor/major. The snapshot test exists precisely to make skipping this
ceremony impossible.
