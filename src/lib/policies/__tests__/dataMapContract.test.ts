import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_MAP_CONTRACT, DATASET_LABEL } from "@/lib/policies/dataMap";
import registry from "@/lib/policies/registry.generated.json";

/**
 * The Data map's "Uploaded data → engine" tab is pinned to the READER, not to
 * a document: every table `sim-worker/sim_worker/datamap.py` fetches is a
 * dataset here, every column it selects by name is a row, and every field the
 * engine registry declares a data requirement for is listed. Before this test
 * the contract had drifted three ways — no `bom_multi_level` (the table the
 * engine prefers), no `customers` (read since §4 D69), no `lead_time_unit`
 * (read since D9) — and nothing noticed.
 */
const root = resolve(__dirname, "../../../..");
const datamapPy = readFileSync(resolve(root, "sim-worker/sim_worker/datamap.py"), "utf8");

const contractFields = new Set(
  DATA_MAP_CONTRACT.flatMap((r) => r.field.split(" / ").map((f) => `${r.dataset}.${f.trim()}`)),
);

/** `rows("table")` and `rows(\n "table", "a,b,c"\n)` calls in the worker's loader. */
function workerReads(): Array<{ table: string; cols: string[] }> {
  const out: Array<{ table: string; cols: string[] }> = [];
  for (const m of datamapPy.matchAll(/\brows\(\s*"([a-z_]+)"(?:\s*,\s*"([^"]+)")?\s*,?\s*\)/g)) {
    out.push({ table: m[1], cols: m[2] ? m[2].split(",").map((c) => c.trim()) : [] });
  }
  return out;
}

describe("Data map contract ↔ what the worker reads", () => {
  it("finds the worker's reads at all (the parser is not vacuous)", () => {
    const tables = workerReads().map((r) => r.table);
    for (const t of ["inbound_logistics", "outbound_logistics", "bom_multi_level", "bom_single_level", "customers"]) {
      expect(tables, t).toContain(t);
    }
  });

  it("every table the worker reads is a Data map dataset", () => {
    for (const { table } of workerReads()) {
      expect(Object.keys(DATASET_LABEL), table).toContain(table);
    }
  });

  it("every column the worker selects by name is a Data map row", () => {
    for (const { table, cols } of workerReads()) {
      for (const c of cols) expect(contractFields.has(`${table}.${c}`), `${table}.${c}`).toBe(true);
    }
  });

  it("every field the engine registry declares a data requirement for is a Data map row", () => {
    const fields = new Set<string>(registry.base_data_requirements.map((b: { field: string }) => b.field));
    for (const p of registry.policies as Array<{ data_requirements?: Array<{ field: string }> }>) {
      for (const d of p.data_requirements ?? []) fields.add(d.field);
    }
    for (const f of fields) expect(contractFields.has(f), f).toBe(true);
  });

  it("a column the Data map calls NOT READ is not selected by the worker", () => {
    // The reverse of the rows test: if the engine starts reading plant_name,
    // expected_lead_time or level, the Data map must stop saying it does not.
    const selected = new Map<string, Set<string>>();
    for (const { table, cols } of workerReads()) if (cols.length) selected.set(table, new Set(cols));
    for (const r of DATA_MAP_CONTRACT) {
      if (r.engineField !== null) continue;
      const cols = selected.get(r.dataset);
      if (!cols) continue; // a `select *` table: the mapper's own fields decide (checked by the row chains)
      expect(cols.has(r.field), `${r.dataset}.${r.field} is marked not read but the worker selects it`).toBe(false);
    }
  });

  it("the sub-assembly rule the products row states is the worker's", () => {
    expect(datamapPy).toMatch(/subassemblies=sorted\(\{/);
  });

  it("the demand-distribution chain puts the product master FIRST, as the engine does", () => {
    const row = DATA_MAP_CONTRACT.find((r) => r.dataset === "products" && r.field === "demand_distribution")!;
    expect(row.chain.indexOf("master")).toBeLessThan(row.chain.indexOf("SCENARIO"));
    expect(readFileSync(resolve(root, "scsim/scsim/io/project_map.py"), "utf8")).toMatch(
      /if product_dist:[\s\S]{0,120}if scenario_model and scenario_model\.get\("kind"\)/,
    );
  });
});
