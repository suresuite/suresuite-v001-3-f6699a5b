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
type Col = { name: string; check?: string | null };
type Constraint = { kind: string; name?: string; definition?: string; implicit?: boolean; columns?: string[] };
type Table = { name: string; columns?: Col[]; indexes?: Index[]; constraints?: Constraint[] };
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

/**
 * §4 D59 — AN INLINE `CHECK` IS A CONSTRAINT, AND IT WAS READ BY NOTHING.
 *
 * The column parser read a type, a NOT NULL and a DEFAULT and dropped the rest,
 * so only a NAMED table-level `ADD CONSTRAINT … CHECK` was recorded. 64 inline
 * column-level CHECKs were not — `ingest_files` alone lost `source_kind`'s
 * vocabulary, `byte_size >= 0` and the SHA-256 shape.
 *
 * ── WHAT MAKING IT REAL IMMEDIATELY CAUGHT ────────────────────────────────
 *
 * Four rehearsals started failing, because their fixtures had been writing rows
 * production would reject and nothing had ever checked. `140` was inserting
 * `'{}'::jsonb` into `proposals.provenance`, a TEXT column with a three-value
 * vocabulary — the column list and the VALUES list had been misaligned since the
 * file was written, and the row it created could never have existed. That is
 * D59's stated harm exactly, arriving from the other direction: an assertion
 * made against a database missing the constraint proves nothing about one that
 * has it.
 *
 * ── WHY IT IS LIFTED AND NOT EMITTED FROM THE COLUMN ──────────────────────
 *
 * `liftImplicitConstraints` already materialises a column's PRIMARY KEY and
 * UNIQUE as named constraints so a later `DROP CONSTRAINT` can find them. CHECK
 * needed the same treatment and for the same reason: `20260721000001` drops
 * `ai_chat_events_event_kind_check` and re-adds a WIDER vocabulary. Carried as a
 * column flag, the original would have survived its own removal and the
 * rehearsed database would enforce a rule production dropped.
 */
describe("WP 6.2 · D59 · an inline CHECK becomes a real constraint", () => {
  const checks = artifact.tables.flatMap((t) =>
    (t.constraints ?? []).filter((c) => c.kind === "CHECK").map((c) => ({ table: t.name, ...c })),
  );

  it("the artifact records far more CHECKs than the named-only 24", () => {
    // 24 was every NAMED table-level `ADD CONSTRAINT … CHECK`. The inline ones
    // were invisible. A bare count is a weak assertion, so the two below name
    // specific constraints — this one only catches a wholesale regression.
    expect(checks.length).toBeGreaterThan(60);
  });

  it("`ingest_files`'s three inline CHECKs are among them — D59 names these", () => {
    const names = checks.filter((c) => c.table === "ingest_files").map((c) => c.name);
    expect(names.length, "ingest_files has no CHECK constraints recorded").toBeGreaterThanOrEqual(3);
  });

  it("an inline CHECK is LIFTED, so a later DROP CONSTRAINT can remove it", () => {
    // `ai_chat_events_event_kind_check` is created inline, dropped and re-added
    // wider by 20260721000001, then dropped and re-added again by 20260723000001.
    // Exactly one must survive, and it must be the LAST definition — not the
    // inline original.
    const t = artifact.tables.find((x) => x.name === "ai_chat_events")!;
    const got = (t.constraints ?? []).filter((c) => c.name === "ai_chat_events_event_kind_check");
    expect(got.length, "the constraint is recorded twice — the inline one survived its own DROP").toBe(1);
    // The survivor must be the ADD CONSTRAINT, not the lift. `implicit` is the
    // marker: a lifted inline check carries it, a named table-level one does not.
    // Asserted this way rather than against the vocabulary's text, because the
    // vocabulary is what keeps changing and the PROVENANCE is what must not.
    expect(
      got[0].implicit ?? false,
      "the surviving definition is the inline original, so a rule production " +
        "widened is still being enforced at its old, narrower vocabulary.",
    ).toBe(false);
  });

  it("a dropped inline CHECK clears the column flag it was lifted from", () => {
    // The symmetry `liftImplicitConstraints` already keeps for UNIQUE and
    // PRIMARY KEY: leave the flag set and the generated page renders a rule that
    // no longer exists (§5 T1).
    for (const t of artifact.tables) {
      for (const c of t.columns ?? []) {
        if (!c.check) continue;
        // Matched on COLUMNS, not on a computed name. A lifted constraint is
        // named for the table as it was spelled when the lift happened, and
        // Postgres does not rename constraints when a table is renamed — so
        // `ingest_runs` still carries `erp_sync_runs_triggered_by_check`, which
        // is faithful. Computing the name here asserted the rename had rewritten
        // it, which would have been wrong about the database.
        const lifted = (t.constraints ?? []).some(
          (k) => k.kind === "CHECK" && k.implicit && (k.columns ?? []).includes(c.name),
        );
        expect(
          lifted,
          `${t.name}.${c.name} still carries an inline check but no constraint was ` +
            `lifted from it — it was dropped, and the column flag was not cleared.`,
        ).toBe(true);
      }
    }
  });
});
