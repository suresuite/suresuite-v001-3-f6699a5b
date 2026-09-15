# Data ↔ Simulation Mapping — moved

> **Status: DEPRECATED** → superseded by **[`docs/data/field-mapping.md`](data/field-mapping.md)**.
> This path is a tombstone. It holds no content of its own; nothing here is
> maintained, and nothing should be added.

The field-mapping contract now lives with the rest of the data-layer reference under
`docs/data/`, alongside [`lifecycle.md`](data/lifecycle.md) and the generated table
pages that land in WP 1.4.

This stub exists because roughly two dozen files — engine, worker, migrations,
frontend and design docs — cite the old path in their comments. Deleting it would
turn each of those into a dead reference; the stub turns them into one more hop.
It is removed once those citations are updated, which is WP 5.1's lineage work.

**The plan is `docs/PLAN.md`**, and its §4 is the only authority for data-layer
`file:line` evidence. `npm run check:docs` enforces that.
