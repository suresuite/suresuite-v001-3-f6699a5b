/**
 * WP 4.1 — THE TRUST ANCHOR CANNOT SILENTLY STOP COVERING SOMETHING.
 *
 * §4 D11 was one table. What produced it was a RULE: `_build_dataset_snapshot`
 * was written to "mirror datamap.py exactly", which requires a person to
 * re-mirror a Python file every time the engine changes. Nobody did, three
 * times:
 *
 *   * `bom_multi_level` — which `datamap.py` PREFERS over the single-level
 *     table, so on a multi-level project the anchor hashed the one BOM table
 *     the run did not read (D11);
 *   * `lead_time_unit` — projected by `datamap.py` with a comment naming D9, so
 *     14 days and 14 weeks were the same dataset (D67);
 *   * `demand_min` / `demand_max` — added to `products` after v1 (D67).
 *
 * Fixing three columns fixes three columns. This file fixes the rule: the
 * snapshot must hash EVERY VALUE COLUMN of every tier-2 input table, and the
 * next column somebody adds fails here on the commit that adds it.
 *
 * It also guards the claim WP 4.2 is going to make about ABSENCE — that no
 * analysis OUTPUT contributes to `graph_hash`. That is mine not to break, and a
 * claim nothing tests is a claim that decays; so it is tested here rather than
 * left to care.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATION = join(ROOT, "supabase", "migrations", "20260917000002_graph_hash_v2.sql");
const DATAMAP = join(ROOT, "sim-worker", "sim_worker", "datamap.py");
const CONTRACT = JSON.parse(
  readFileSync(join(ROOT, "build", "data-contract.generated.json"), "utf8"),
) as { tables: Record<string, { tier?: string; columns?: Array<{ name: string }> }> };

const sql = readFileSync(MIGRATION, "utf8");

/**
 * Columns the snapshot does NOT hash, and each exclusion is a decision:
 *   · `id`          — a surrogate. Two identical datasets would hash differently.
 *   · `project_id`  — the snapshot is already scoped to one project.
 *   · timestamps    — when a row was touched is not what it says.
 *   · provenance    — WHERE a row came from is not WHAT it is; re-promoting an
 *                     unchanged row must not move the anchor.
 *   · `name`        — cosmetic, and `20260703000001`'s own rule: a rename must
 *                     never invalidate a run.
 */
const NOT_A_VALUE = new Set([
  "id", "project_id",
  "created_at", "updated_at",
  "ingest_run_id", "source_row_id",
  "source_system", "source_external_id", "source_synced_at",
  "name",
]);

/** The three §11 settled as `hash_network`; everything else tier-2 is an input. */
const NETWORK_TABLES = new Set(["tier2_suppliers", "tier3_suppliers", "multi_tier_supply_chain"]);

/**
 * The four DERIVED tables. They are what an analysis WROTE, they are WP 4.2's,
 * and folding a derived artifact into the identity of its own inputs is exactly
 * the confusion `input-hash` (I5) exists to prevent.
 */
const DERIVED_AND_OUT = ["node_list", "network_nodes", "network_edges", "network_summary"];

/** Split the snapshot into its two domains and read each table's hashed columns. */
function snapshotDomains(): Record<"inputs" | "network", Record<string, Set<string>>> {
  const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public._build_dataset_snapshot"));
  const inputsAt = body.indexOf("'inputs', jsonb_build_object");
  const networkAt = body.indexOf("'network', jsonb_build_object");
  expect(inputsAt, "the snapshot has no `inputs` domain").toBeGreaterThan(-1);
  expect(networkAt, "the snapshot has no `network` domain").toBeGreaterThan(inputsAt);

  const read = (chunk: string) => {
    const out: Record<string, Set<string>> = {};
    // Each table block ends at `FROM public.<table> <alias> WHERE`; the hashed
    // columns are the `<alias>.<column>` references before it.
    const re = /FROM public\.(\w+) (\w+) WHERE/g;
    let m: RegExpExecArray | null;
    let from = 0;
    while ((m = re.exec(chunk)) !== null) {
      const [, table, alias] = m;
      const block = chunk.slice(from, m.index);
      const cols = new Set<string>();
      const colRe = new RegExp(`\\b${alias}\\.(\\w+)`, "g");
      let c: RegExpExecArray | null;
      while ((c = colRe.exec(block)) !== null) cols.add(c[1]);
      out[table] = cols;
      from = m.index + m[0].length;
    }
    return out;
  };

  return {
    inputs: read(body.slice(inputsAt, networkAt)),
    network: read(body.slice(networkAt)),
  };
}

const domains = snapshotDomains();
const hashed = { ...domains.inputs, ...domains.network };

describe("the snapshot covers every tier-2 value column", () => {
  const tier2 = Object.entries(CONTRACT.tables)
    .filter(([, t]) => String(t.tier) === "2")
    .map(([name, t]) => [name, (t.columns ?? []).map((c) => c.name)] as const);

  it("the contract still describes eleven tier-2 tables", () => {
    // If this number moves, a tier-2 table was added or described and the two
    // tests below are about to become interesting. It is asserted so the change
    // is noticed HERE rather than in whichever of them happens to fail.
    expect(tier2.length).toBe(11);
  });

  it.each(
    Object.entries(CONTRACT.tables)
      .filter(([, t]) => String(t.tier) === "2")
      .map(([name, t]) => [name, (t.columns ?? []).map((c) => c.name)] as [string, string[]]),
  )("%s is in the snapshot, with every value column", (table, columns) => {
    const cols = hashed[table];
    expect(
      cols,
      `${table} is a tier-2 table and the snapshot does not hash it at all. ` +
        `Either it is an input and belongs in a domain, or it is derived and belongs in WP 4.2 — ` +
        `there is no third option (§5 T1).`,
    ).toBeTruthy();

    const missing = columns.filter((c) => !NOT_A_VALUE.has(c) && !cols.has(c));
    expect(
      missing,
      `${table}.${missing.join(", ")} is a value column the snapshot does not hash. ` +
        `A dataset that differs only there produces the same graph_hash, so a run ` +
        `stamped with it claims to have read data it did not read. That is D11 and ` +
        `D67 returning.`,
    ).toEqual([]);
  });

  it("hashes nothing that is not a column of the table it sits under", () => {
    for (const [table, cols] of Object.entries(hashed)) {
      const known = new Set((CONTRACT.tables[table]?.columns ?? []).map((c) => c.name));
      expect([...cols].filter((c) => !known.has(c)), `${table} in the snapshot`).toEqual([]);
    }
  });
});

describe("the split is the one §11 settled", () => {
  it("`hash_network` covers exactly the three deep-tier tables", () => {
    expect(new Set(Object.keys(domains.network))).toEqual(NETWORK_TABLES);
  });

  it("`hash_inputs` covers every other tier-2 table and nothing from the network", () => {
    for (const t of Object.keys(domains.inputs)) {
      expect(NETWORK_TABLES.has(t), `${t} is in both domains`).toBe(false);
      expect(String(CONTRACT.tables[t]?.tier), `${t} is not tier 2`).toBe("2");
    }
  });

  it("no DERIVED analysis output contributes to graph_hash (WP 4.2's exit check)", () => {
    // A claim about ABSENCE. WP 4.2 owns testing it from its own side; this is
    // the side that can break it, so it is asserted here too.
    for (const t of DERIVED_AND_OUT) {
      expect(Object.keys(hashed), `${t} is an analysis OUTPUT and is inside the hash`).not.toContain(t);
    }
  });

  it("the composite is composed OF the two domains, not of the whole text", () => {
    // Otherwise `hash_inputs` and `hash_network` are two columns computed beside
    // a hash that owes them nothing, and `rehearsal/110`'s decomposition check
    // is the only thing that would ever notice.
    const fn = sql.slice(sql.indexOf("FUNCTION public._dataset_graph_hash"));
    expect(fn.slice(0, 400)).toContain("public._dataset_domain_hashes(p_snapshot)");
  });

  it("the schema_version is inside what the composite hashes", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public._dataset_domain_hashes"));
    expect(fn.slice(0, 500)).toContain("'schema_version', p_snapshot -> 'schema_version'");
  });
});

describe("every column the ENGINE projects is hashed", () => {
  // The check D11 and D67 were both a failure of. `datamap.py` is the engine's
  // own statement of what it reads; if it names a column the anchor does not
  // cover, a run can differ from another run with the same hash.
  const py = readFileSync(DATAMAP, "utf8");

  /** `rows("table", "a,b,c")` — the explicit PostgREST projections. */
  const projections: Array<[string, string[]]> = [];
  const re = /rows\(\s*"(\w+)",\s*\n?\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(py)) !== null) {
    projections.push([m[1], m[2].split(",").map((c) => c.trim()).filter(Boolean)]);
  }

  it("datamap.py's projections are still readable — this test is worthless if they are not", () => {
    // A parse that silently finds nothing is a green test that checks nothing,
    // which is the failure mode this whole plan is about.
    expect(projections.length).toBeGreaterThanOrEqual(3);
    expect(projections.map(([t]) => t)).toContain("bom_multi_level");
  });

  it.each(projections)("%s: every projected column is in the snapshot", (table, columns) => {
    const cols = hashed[table];
    expect(cols, `datamap.py reads ${table} and the snapshot does not hash it`).toBeTruthy();
    const missing = columns.filter((c) => !NOT_A_VALUE.has(c) && !cols.has(c));
    expect(
      missing,
      `the engine projects ${table}.${missing.join(", ")} and the anchor ignores it`,
    ).toEqual([]);
  });

  it("the engine still PREFERS the deep BOM, which is why D11 mattered", () => {
    // If this stops being true the D11 story changes, and whoever changes it
    // should read this line rather than rediscover it.
    const bom = py.slice(py.indexOf('bom = await rows(\n        "bom_multi_level"'));
    expect(bom.slice(0, 300)).toContain("if not bom:");
    expect(bom.slice(0, 300)).toContain('rows("bom_single_level"');
  });
});
