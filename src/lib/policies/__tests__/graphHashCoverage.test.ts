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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
/**
 * WP 5.3 — THE LIVE DEFINITION, NOT ONE NAMED FILE.
 *
 * This read `20260917000002_graph_hash_v2.sql` by name. `20260917000009` folded
 * the deep-tier topology into the snapshot (D75) and became the live builder,
 * and every assertion here went on passing — about a function the database no
 * longer runs. A green suite describing a superseded definition is worse than a
 * red one, and it is `dataPlaneAudit.test.ts`'s WP 3.0 lesson exactly: the
 * source has to be "whatever is live", never a filename somebody typed.
 */
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const DATAMAP = join(ROOT, "sim-worker", "sim_worker", "datamap.py");
const CONTRACT = JSON.parse(
  readFileSync(join(ROOT, "build", "data-contract.generated.json"), "utf8"),
) as { tables: Record<string, { tier?: string; columns?: Array<{ name: string; computed_by?: string | null }> }> };

/** Every migration, newest last — so the last definition of a function wins. */
const sql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n");

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

/**
 * `hash_network`'s tables. §11 settled THREE; WP 5.3 added the two the deep-tier
 * upload fills, because the centrality analyzers read them and D75 is what their
 * absence cost. "Network" is the right domain for them in the sense that
 * matters — they describe the graph between firms rather than the plant's own
 * dataset — so the split §11 drew still holds; only its membership grew.
 */
const NETWORK_TABLES = new Set([
  "tier2_suppliers", "tier3_suppliers", "multi_tier_supply_chain",
  "network_nodes", "network_edges",
]);

/**
 * Tables with NO column in the hash at all. `node_list` is derived end to end
 * (`refresh_node_list_for_project` builds it from `supply_chain_data`, which is
 * itself hashed through its own inputs) and `network_summary` is counts OF the
 * graph — hashing either would fold a derivation into the identity of the thing
 * it derives from.
 *
 * `network_nodes` and `network_edges` LEFT this list in WP 5.3: they carry the
 * uploaded topology the centrality analyzers read, which is an input, and
 * keeping them out wholesale is what D75 was.
 */
const STILL_WHOLLY_OUT = ["node_list", "network_summary"];

/**
 * Columns an analysis WRITES. No table may contribute one of these to the
 * snapshot, whatever tier it is labelled — this is the rule the table list above
 * used to stand in for.
 *
 * ── READ FROM THE CONTRACT SINCE WP 5.2b (I1) ─────────────────────────────
 *
 * This was a literal Set, and it was the SECOND authoring of a data fact: each
 * of these columns also says "ANALYSIS OUTPUT" in its sidecar `meaning` and
 * `note`. Two lists that must agree with nothing comparing them is what D21 and
 * D22 are, and the manual needed a third to tell a reader which half of
 * `network_nodes` they uploaded. So `computed_by` is now a declared field on the
 * sidecar and every reader derives from it — this suite, and §6.3 section 3's
 * pages.
 *
 * The set is asserted non-empty below: a contract that stopped declaring any
 * computed column would make the loop that uses this vacuous, and a check that
 * passes because it examines nothing is the trap D57 was.
 */
const COMPUTED_COLUMNS = new Set(
  Object.values(CONTRACT.tables)
    .flatMap((t) => t.columns ?? [])
    .filter((c) => c.computed_by)
    .map((c) => c.name),
);

/** Split the snapshot into its two domains and read each table's hashed columns. */
function snapshotDomains(): Record<"inputs" | "network", Record<string, Set<string>>> {
  // WP 5.3 — THE SNAPSHOT IS COMPOSED NOW, AND THE PARSER FOLLOWS IT.
  //
  // `20260917000009` builds v3 as "v2's object, with two blocks merged into its
  // `network` domain", so the live builder contains neither `'inputs',
  // jsonb_build_object` nor the eleven table blocks — they are in
  // `_build_dataset_snapshot_v2`, which is kept precisely so the composition is
  // reviewable and `rehearsal/150` can compare the two.
  //
  // Parsing only the live builder would report ZERO hashed columns and every
  // coverage assertion below would pass over an empty set. Parsing only v2 would
  // miss the fold. Both, unioned on the `network` domain, is the shape that is
  // actually hashed.
  const base = sql.slice(
    sql.lastIndexOf("CREATE OR REPLACE FUNCTION public._build_dataset_snapshot_v2(p_project_id"),
  );
  const inputsAt = base.indexOf("'inputs', jsonb_build_object");
  const networkAt = base.indexOf("'network', jsonb_build_object");
  expect(inputsAt, "the snapshot has no `inputs` domain").toBeGreaterThan(-1);
  expect(networkAt, "the snapshot has no `network` domain").toBeGreaterThan(inputsAt);

  const liveMarker = "CREATE OR REPLACE FUNCTION public._build_dataset_snapshot(p_project_id";
  const liveAt = sql.lastIndexOf(liveMarker);
  expect(liveAt, "no live `_build_dataset_snapshot`").toBeGreaterThan(-1);
  const live = sql.slice(liveAt, sql.indexOf("$$;", liveAt));
  expect(
    live,
    "the live builder does not compose the v2 base — if it inlines the domains " +
      "again, this parser is reading the wrong thing and must be rewritten with it",
  ).toContain("_build_dataset_snapshot_v2(p_project_id)");

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

  const merged = read(live);
  const networkBase = read(base.slice(networkAt));
  for (const [t, cols] of Object.entries(merged)) {
    networkBase[t] = new Set([...(networkBase[t] ?? []), ...cols]);
  }

  return {
    inputs: read(base.slice(inputsAt, networkAt)),
    network: networkBase,
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
    // The set is DERIVED now (see COMPUTED_COLUMNS). A contract that declared
    // none would make the loop below examine nothing and pass — the vacuous
    // gate D57 was. So the derivation is asserted before it is used.
    expect(
      COMPUTED_COLUMNS.size,
      "no sidecar declares `computed_by`, so the loop below cannot fail",
    ).toBeGreaterThanOrEqual(16);
    for (const [table, cols] of Object.entries(hashed)) {
      const known = new Set((CONTRACT.tables[table]?.columns ?? []).map((c) => c.name));
      expect([...cols].filter((c) => !known.has(c)), `${table} in the snapshot`).toEqual([]);
    }
  });
});

describe("the split is the one §11 settled", () => {
  it("`hash_network` covers exactly the five deep-tier tables", () => {
    expect(new Set(Object.keys(domains.network))).toEqual(NETWORK_TABLES);
  });

  it("the two WP 5.3 added contribute their INPUT columns and no computed one", () => {
    // The fold is the place this codebase is most likely to acquire an
    // analysis output inside the anchor, because the columns sit on the same
    // rows. Named explicitly rather than left to the general rule above, so a
    // reader of this file sees which five columns the fold is allowed to hash.
    // `id` is in each set because it appears in the block's ORDER BY, not
    // because it is hashed — a surrogate in the VALUE would make two identical
    // datasets hash differently, and `NOT_A_VALUE` above excludes it from the
    // coverage rule for exactly that reason. It is there as the tiebreaker that
    // makes the ordering TOTAL, which is D68: an ORDER BY fixes an order only as
    // far as it discriminates, and two nodes sharing a `uid` would otherwise
    // aggregate in whatever order the scan returned them.
    expect(domains.network.network_nodes).toEqual(new Set(["uid", "revenue", "id"]));
    expect(domains.network.network_edges).toEqual(
      new Set(["src_uid", "dst_uid", "relative_revenue", "id"]),
    );
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
    // WP 5.3 — THE RULE IS NOW ABOUT COLUMNS, AND THE TABLE LIST WAS A PROXY.
    //
    // This asserted that four TABLES are absent from the snapshot. That was a
    // usable stand-in while none of their columns was hashed, and D75 is what it
    // cost: `network_nodes` and `network_edges` carry the only inputs the two
    // centrality analyzers read, so excluding the tables wholesale left the
    // anchor blind to them and the store served a re-uploaded network the
    // previous graph's centralities.
    //
    // What the invariant actually says is that no analysis OUTPUT may enter the
    // identity of its own inputs. Stated as columns, `20260917000009` can fold
    // in `uid`, `revenue`, `src_uid`, `dst_uid` and `relative_revenue` — which
    // are uploaded — while `prominence` and the five centralities stay out, and
    // a future column added to the block is judged by the same rule instead of
    // by a list somebody has to remember to edit.
    for (const t of STILL_WHOLLY_OUT) {
      expect(Object.keys(hashed), `${t} is analysis output and is inside the hash`).not.toContain(t);
    }
    for (const [table, cols] of Object.entries(hashed)) {
      for (const c of cols) {
        expect(
          COMPUTED_COLUMNS.has(c),
          `${table}.${c} is written by an analysis and is inside the hash. Folding a ` +
            `result into the identity of its own inputs means every run invalidates ` +
            `itself and no cache can hit twice (I5, and WP 4.2's exit check).`,
        ).toBe(false);
      }
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
