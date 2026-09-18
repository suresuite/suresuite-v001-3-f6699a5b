/**
 * WP 6.2 · §4 D49 — A COLUMN RENAME FOLLOWS ITS COLUMN, AND AN IMPOSSIBLE
 * INDEX IS NOT RECORDED.
 *
 * Postgres tracks a dependent object by attribute number, so an index or a
 * constraint follows its column through `RENAME COLUMN` without being restated.
 * The artifact records them by NAME, so unless the introspector rewrites them it
 * describes a database that cannot be built — and every gate comparing the
 * artifact against the MIGRATIONS stays green, because the migrations do say
 * what the artifact says.
 *
 * ── D49 NAMED THREE INDEXES AND THEY ARE NOT ONE DEFECT ───────────────────
 *
 * `idx_supply_chain_data_plant` is the rename case D49 describes: `20250822025432`
 * renamed `plant` to `plant_name` and the artifact kept indexing `plant`.
 *
 * The two on `supply_chain_data_multi_tier` are NOT. That table has never been
 * renamed and has never had a `material_id` or a `higher_level_component_id` —
 * it was created on 2025-09-08 without them, the indexes were written on
 * 2025-09-09, and no migration has ever added the columns. Those statements
 * raised `42703` when they ran (`IF NOT EXISTS` guards the index existing, not
 * the column), so the indexes are not in the database. That is §4 D48's class —
 * a statement that aborted in production and nothing ever said so.
 *
 * One defect row, two mechanisms, two different fixes. Checked rather than
 * assumed, because D49's stated cause would have sent the fix to the wrong place
 * for two of its three instances.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");

type Index = { name: string; columns?: string[]; added_by?: string | null };
type Col = { name: string };
type Table = { name: string; columns?: Col[]; indexes?: Index[] };
type Invalid = { table: string; index: string; missing_columns: string[] };

const artifact = JSON.parse(
  readFileSync(join(ROOT, "build", "schema.introspected.json"), "utf8"),
) as { tables: Table[]; invalid_indexes?: Invalid[] };

/** Only a BARE identifier is a column name. `created_at DESC` carries a sort
 *  direction and `md5(triple::text)` is an expression. */
const BARE = /^"?([A-Za-z_][A-Za-z_0-9$]*)"?$/;

describe("WP 6.2 · D49 · the introspector follows a column rename", () => {
  it("there are indexes to check — an empty artifact makes this vacuous", () => {
    const n = artifact.tables.reduce((a, t) => a + (t.indexes?.length ?? 0), 0);
    expect(n).toBeGreaterThan(20);
  });

  it("every recorded index names columns the table actually has", () => {
    // The invariant, stated over the whole artifact rather than over the three
    // instances D49 happened to measure.
    const broken: string[] = [];
    for (const t of artifact.tables) {
      const have = new Set((t.columns ?? []).map((c) => c.name));
      for (const idx of t.indexes ?? []) {
        for (const raw of idx.columns ?? []) {
          const bare = BARE.exec(String(raw))?.[1];
          if (bare && !have.has(bare)) broken.push(`${t.name}.${idx.name} -> ${bare}`);
        }
      }
    }
    expect(
      broken,
      "these indexes name columns their table does not have. Either a RENAME was " +
        "not followed into the index, or the CREATE INDEX raised 42703 when it ran " +
        "and the artifact is asserting an index the database does not contain.",
    ).toEqual([]);
  });

  it("the renamed column is followed INTO the index", () => {
    // The specific case, named, because the assertion above also passes if the
    // index were simply dropped — and dropping it would be the wrong fix here.
    // Production has this index, on the renamed column.
    const t = artifact.tables.find((x) => x.name === "supply_chain_data");
    const idx = t?.indexes?.find((i) => i.name === "idx_supply_chain_data_plant");
    expect(idx, "`idx_supply_chain_data_plant` is gone — it exists in production and must be recorded").toBeDefined();
    expect(idx!.columns).toEqual(["plant_name"]);
  });
});

describe("WP 6.2 · D49 · an impossible index is dropped, and SAID", () => {
  it("the two aborted indexes are recorded as invalid rather than as real", () => {
    const invalid = artifact.invalid_indexes ?? [];
    expect(invalid.map((i) => i.index).sort()).toEqual([
      "idx_supply_chain_data_multi_tier_higher_level_component_id",
      "idx_supply_chain_data_multi_tier_material_id",
    ]);
    for (const i of invalid) expect(i.missing_columns.length).toBeGreaterThan(0);
  });

  it("the list may not GROW — a new one is a migration that will abort", () => {
    // Not a ratchet's usual reason. These two are historical and cannot be
    // fixed by editing a migration nobody should rewrite. A THIRD would be a
    // statement somebody is about to ship that raises 42703 on deploy, and that
    // is worth failing the commit that writes it.
    expect(
      (artifact.invalid_indexes ?? []).length,
      "a new invalid index appeared. `CREATE INDEX … ON t(col)` where `t` has no " +
        "`col` raises 42703 — `IF NOT EXISTS` guards the index, not the column — " +
        "so the migration carrying it will abort in production.",
    ).toBeLessThanOrEqual(2);
  });

  it("and they are dropped from the table they claimed to be on", () => {
    const t = artifact.tables.find((x) => x.name === "supply_chain_data_multi_tier");
    const names = (t?.indexes ?? []).map((i) => i.name);
    expect(names).not.toContain("idx_supply_chain_data_multi_tier_material_id");
    expect(names).not.toContain("idx_supply_chain_data_multi_tier_higher_level_component_id");
  });
});
