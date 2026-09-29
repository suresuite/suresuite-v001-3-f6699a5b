import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { resolvePrimarySupplier } from "@/lib/sim/stressTargets";

/**
 * Audit 2026-09-29 — the single-source audit's findings, PROVED rather than
 * described (PLAN.md §4 D180–D196, §16 · *Audit 2026-09-29*).
 *
 * Every `it.fails` below asserts the RULE — one fact, one author — and fails
 * today because the rule is broken. `it.fails` passes while its body fails, so
 * the suite stays green while the defect exists, and it turns RED the day a fix
 * lands: whoever closes the finding must delete `.fails` in the same commit,
 * which is the ratchet. This is a findings pass: nothing here changes behaviour.
 *
 * Source-pinned where the logic is inline in a component or a migration body
 * (the `supplierStageNeverBlank.test.ts` precedent — no DOM tooling here);
 * behavioural where an exported function exists.
 */

const root = resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** The body of the LATEST migration that defines `public.<fn>`. */
function latestFunctionBody(fn: string): string {
  const dir = resolve(root, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const head = new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${fn}\\s*\\(`, "i");
  for (const f of files.reverse()) {
    const sql = readFileSync(resolve(dir, f), "utf8");
    const m = head.exec(sql);
    if (!m) continue;
    const rest = sql.slice(m.index);
    const end = rest.search(/\$(fn|function|\$)?\$;\s*$/m);
    return end > 0 ? rest.slice(0, end) : rest;
  }
  throw new Error(`no migration defines public.${fn}`);
}

describe("D191 · a blank BOM consumption rate means 1.0 to the contract and the engine, 0 to the graph", () => {
  it("the contract declares 1.0 (the premise)", () => {
    expect(read("supabase/contract/bom_multi_level.contract.yaml")).toMatch(/missing_default: "1\.0"/);
    expect(read("sim-worker/sim_worker/datamap.py")).toMatch(/or 1\.0/);
  });
  it.fails("the lane writer applies the SAME default", () => {
    expect(latestFunctionBody("rebuild_supply_chain_lanes")).not.toMatch(/COALESCE\(b\.consumption_rate, 0\)/);
  });
});

describe("D181 · 'primary supplier' has three authors", () => {
  // M1 is bought from A (100/wk at 10) and B (10/wk at 5). The engine's primary
  // link is the CHEAPEST (`scsim/scsim/core/context.py`: sorted by cost, lead
  // time, id) — B. M2 is bought only from B. So the engine orders M1 and M2 from
  // B and nothing from A unless P-S.2 is on.
  const rows = [
    { supplier_id: "A", material_id: "M1", volume: 100, time_unit: "week", unit_price: 10 },
    { supplier_id: "B", material_id: "M1", volume: 10, time_unit: "week", unit_price: 5 },
    { supplier_id: "B", material_id: "M2", volume: 50, time_unit: "week", unit_price: 3 },
  ];
  it.fails("the `supplier:primary` stress target is a supplier the engine orders from", () => {
    const r = resolvePrimarySupplier(rows);
    expect("primary" in r && r.primary.supplierId).toBe("B");
  });
  it.fails("the Supplier grid ranks a material's primary by the engine's rule (cost first)", () => {
    // useStageRows' matMeta ranking: highest volume → lowest price → lowest lead time.
    const src = read("src/hooks/useStageRows.tsx");
    expect(src).not.toMatch(/Rank unique suppliers: highest volume/);
  });
});

describe("D182 · the Supplier grid's demand placeholder is not the engine's demand", () => {
  it.fails("it sums a product's outbound lanes (the engine sums; the grid averages)", () => {
    expect(read("src/hooks/useStageRows.tsx")).not.toMatch(/const dPerDay = avg\(outVolByProduct\.get\(parent\)/);
  });
  it.fails("its lead time reads `lead_time_unit`, as the engine does", () => {
    const src = read("src/hooks/useStageRows.tsx");
    const builder = src.slice(src.indexOf("const inboundByKey"), src.indexOf("const outboundByKey"));
    expect(builder).toMatch(/lead_time_unit/);
  });
});

describe("D183 · the Data Map names a demand-distribution default the engine does not use", () => {
  it("the engine takes the SCENARIO's kind before triangular (the premise)", () => {
    expect(read("scsim/scsim/io/project_map.py")).toMatch(
      /if product_dist:[\s\S]{0,120}if scenario_model and scenario_model\.get\("kind"\):[\s\S]{0,120}return "triangular"/,
    );
    expect(read("src/hooks/useScenarios.tsx")).toMatch(/kind: "poisson"/);
  });
  it.fails("the Data Map's stated default is the scenario's model, not a bare 'triangular'", () => {
    expect(read("src/hooks/useDataMap.tsx")).not.toMatch(
      /product_demand_distribution: masterField\(prods, "demand_distribution", \{ status: "default", detail: "triangular" \}\)/,
    );
  });
});

describe("D184 · which BOM table a project uses has five authors", () => {
  it("the engine and the lane fallback pick by ROW PRESENCE (the premise)", () => {
    expect(read("sim-worker/sim_worker/datamap.py")).toMatch(/if not bom:\s*\n\s*bom = await rows\("bom_single_level"/);
    expect(read("src/lib/policies/projectLanes.ts")).toMatch(/multi\.length > 0 \? "bom_multi_level" : "bom_single_level"/);
  });
  it.fails("the master side-effect writer reads the multi-level BOM too", () => {
    expect(latestFunctionBody("ensure_item_masters")).toMatch(/bom_multi_level/);
  });
  it.fails("get_project_datasets picks by the rows, not by `bom_level = 'single'`", () => {
    expect(latestFunctionBody("get_project_datasets")).not.toMatch(/v_bom_level = 'single'/);
  });
  it.fails("the lane writer reads ONE BOM table, the same one the engine reads", () => {
    const body = latestFunctionBody("rebuild_supply_chain_lanes");
    expect(/bom_multi_level/.test(body) && /bom_single_level/.test(body)).toBe(false);
  });
});

describe("D185 · `projects.bom_level` has two spellings of 'multi'", () => {
  it.fails("the admin page recognises the value the project page writes", () => {
    expect(read("src/pages/DataManager.tsx")).toMatch(/<RadioGroupItem value="multi"/);
    // AdminProjects labels anything but 'multi_level' as "single BOM".
    expect(read("src/pages/admin/AdminProjects.tsx")).not.toMatch(/p\.bom_level === 'multi_level' \? 'multi-level BOM' : 'single BOM'/);
  });
});

describe("D186 · /network/interactive-space tests a HEAD count through `data`, which postgrest-js leaves null", () => {
  it("postgrest-js never sets `data` on a HEAD request (the premise)", () => {
    const lib = read("node_modules/@supabase/postgrest-js/dist/cjs/PostgrestBuilder.js");
    expect(lib).toMatch(/let data = null;[\s\S]{0,400}if \(this\.method !== 'HEAD'\)/);
  });
  it.fails("the availability check reads `count`", () => {
    expect(read("src/pages/InteractiveNetworkSpace.tsx")).not.toMatch(
      /head: true \}\)[\s\S]{0,120}return \(data as any\) > 0;/,
    );
  });
});
