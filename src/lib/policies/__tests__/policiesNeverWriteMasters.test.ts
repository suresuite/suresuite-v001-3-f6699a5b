/**
 * PLAN.md §23 WP 13.1 · §4 D280 — /policies NEVER WRITES THE ITEM MASTERS.
 *
 * The owner's rule: the item masters (materials, products, suppliers, customers)
 * stay exactly as uploaded — Project manager, the Item Master editor and ERP
 * sync write them. A value changed on /policies is a policy override in the
 * policy version, read by the engine ahead of the master.
 *
 * Until WP 13.1 the grid's `saveAll` merged every master-backed draft onto the
 * full master row and sent it through `bulk_upsert_{materials,products,suppliers}`
 * (`useItemMasters.saveRows`), and `assign_material_supplier` inserted a supplier
 * master row. This gate fails if any of that returns — read off the SOURCE of
 * every file under `src/components/policies/` and the /policies page, and off
 * the LIVE definition of the one SQL writer the grid calls.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { liveDefinitions } from "../../../../scripts/data-contract/live-sql.mjs";

const ROOT = join(__dirname, "..", "..", "..", "..");
const POLICIES_DIR = join(ROOT, "src", "components", "policies");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "__tests__") continue;
      out.push(...sourcesUnder(p));
    } else if (/\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

const FILES = [...sourcesUnder(POLICIES_DIR), join(ROOT, "src", "pages", "ProjectPolicies.tsx")];

/** Every way a browser file has written an item master. */
const MASTER_WRITES: Array<[RegExp, string]> = [
  [/bulk_upsert_(materials|products|suppliers|customers)\b/, "an item-master upsert RPC"],
  [/\bsaveRows\b/, "useItemMasters().saveRows — the item-master upsert"],
  [
    /\.from\(\s*["'](materials|products|suppliers|customers)["']\s*\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\s*\(/,
    "a direct write to an item-master table",
  ],
  [/ensure_item_masters\b/, "ensure_item_masters — it creates master rows"],
];

describe("/policies writes overrides, never the item masters (§23 WP 13.1)", () => {
  it("scans the files it says it scans", () => {
    const names = FILES.map((f) => relative(ROOT, f));
    expect(names).toContain("src/components/policies/StagePolicyTable.tsx");
    expect(names).toContain("src/pages/ProjectPolicies.tsx");
    expect(names.length).toBeGreaterThan(10);
  });

  it("no file under src/components/policies/ or the /policies page writes an item master", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const [re, what] of MASTER_WRITES) {
        if (re.test(src)) hits.push(`${relative(ROOT, f)}: ${what}`);
      }
    }
    expect(hits, "/policies must never write the item masters — save the value as a policy override").toEqual([]);
  });

  it("the one SQL writer the grid calls, assign_material_supplier, writes no item master", () => {
    const live = (liveDefinitions() as { functions: Map<string, { sql: string }> }).functions;
    const def = live.get("assign_material_supplier");
    expect(def, "assign_material_supplier is gone — drop this assertion with it").toBeDefined();
    const body = def!.sql.replace(/--[^\n]*/g, "");
    expect(body).toMatch(/INSERT\s+INTO\s+public\.inbound_logistics/i);
    expect(
      body,
      "assign_material_supplier writes an item master again — the supplier-master insert was removed by 20261002000008",
    ).not.toMatch(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(public\.)?(materials|products|suppliers|customers)\b/i);
  });
});
