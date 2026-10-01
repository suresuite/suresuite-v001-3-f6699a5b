import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// WP 11.2 · §4 D264 · gate `single-source` — the simulation scope, ONE list.
//
// The engine's read set is authored in the worker (`sim-worker/sim_worker/datamap.py`,
// the only ingestion path for a scsim run). The hash every Validated Model, RunKey and
// staleness check binds — the `simulation` scope — is the snapshot's `inputs` domain
// digest. Those are two authors of one fact, and until this test they agreed by care:
// a table added to the engine's reads without the snapshot would leave every binding
// blind to it (D11's shape), and a table added to the snapshot without the engine would
// make a model stale over data no run reads. Both lists are PARSED here; nothing is
// copied by hand.

const ROOT = join(__dirname, "../../../..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** The latest definition of a function, by migration order. */
function latestDefinition(name: string): { file: string; sql: string } {
  let found: { file: string; sql: string } | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const def = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\(`, "g");
    let at = -1;
    for (const m of sql.matchAll(def)) at = m.index!;   // the file's last definition
    if (at < 0) continue;
    const tag = /AS (\$[a-zA-Z0-9_]*\$)/.exec(sql.slice(at))!;
    const open = at + tag.index + tag[0].length;
    const close = sql.indexOf(tag[1], open);
    found = { file: f, sql: sql.slice(at, close) };
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

/** The tables the snapshot's `inputs` domain hashes — between its `'inputs'` and
 *  `'network'` blocks, every `FROM public.<table>`. */
export function hashedSimulationTables(): string[] {
  const { sql } = latestDefinition("_build_dataset_snapshot_v2");
  const a = sql.indexOf("'inputs', jsonb_build_object(");
  const b = sql.indexOf("'network', jsonb_build_object(", a);
  expect(a, "the snapshot has no inputs domain").toBeGreaterThan(0);
  expect(b, "the snapshot has no network domain after its inputs").toBeGreaterThan(a);
  return [...new Set([...sql.slice(a, b).matchAll(/FROM\s+public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))].sort();
}

/** The tables the worker reads for a run — every `rows("<table>"` in `load_project_data`. */
export function engineReadTables(): string[] {
  const py = readFileSync(join(ROOT, "sim-worker", "sim_worker", "datamap.py"), "utf8");
  const body = py.slice(py.indexOf("async def load_project_data"));
  expect(body.length, "load_project_data is gone from datamap.py").toBeGreaterThan(100);
  return [...new Set([...body.matchAll(/\brows\(\s*"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1]))].sort();
}

describe("the simulation scope: what the engine reads IS what the scope hashes", () => {
  it("both lists parse to something — a parity of two empty lists checks nothing", () => {
    expect(engineReadTables().length).toBeGreaterThanOrEqual(8);
    expect(hashedSimulationTables().length).toBeGreaterThanOrEqual(8);
  });

  it("the tables the worker reads equal the tables the inputs domain hashes", () => {
    expect(
      hashedSimulationTables(),
      "the engine reads a table the simulation scope does not hash, or the scope hashes a " +
        "table the engine does not read. Add it to BOTH `datamap.py` and the snapshot's " +
        "`inputs` domain — or neither (§4 D264).",
    ).toEqual(engineReadTables());
  });

  it("the scope → hash mapping sends `simulation` to the inputs domain, once", () => {
    const { sql } = latestDefinition("_scope_hash_key");
    expect(sql).toMatch(/WHEN\s+'simulation'\s+THEN\s+'hash_inputs'/);
    // and every reader of a level hash goes through it rather than its own CASE
    expect(latestDefinition("current_level_hash").sql).toMatch(/_scope_hash_key\(p_scope\)/);
    expect(latestDefinition("analysis_get_or_start").sql).toMatch(/_scope_hash_key\(v_scope\)/);
  });

  it("hash_inputs is the digest of the inputs domain — the scope is named, not re-derived", () => {
    const { sql } = latestDefinition("_dataset_domain_hashes");
    expect(sql).toMatch(/'hash_inputs',\s*encode\(extensions\.digest\(\(p_snapshot\s*->\s*'inputs'\)::text/);
  });

  it("the bindings read the simulation scope from the snapshot, not the composite", () => {
    expect(latestDefinition("create_simulation_run").sql).toMatch(/SELECT dv\.hash_inputs, dv\.simulation_version_id INTO v_sim/);
    expect(latestDefinition("_insert_validated_model").sql).toMatch(/hash_inputs, simulation_version_id/);
    expect(latestDefinition("simulation_run_spec").sql).toMatch(/'simulation_hash', p_simulation_hash/);
  });
});
