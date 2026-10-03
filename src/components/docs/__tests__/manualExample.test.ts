import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseCsv } from "../../../../supabase/functions/_shared/csvParse";
import { validateRows } from "../../../../supabase/functions/_shared/ingestValidate";
import { INGEST_DATASETS } from "../../../../supabase/functions/_shared/ingestSpec.generated";
import evidence from "../../../../docs/manual-review/evidence.json";
const files: Record<string, string> = {
  suppliers: "item_master_suppliers", materials: "item_master_materials",
  products: "item_master_products", customers: "item_master_customers",
  bom_single_level: "bom_single_level", inbound_logistics: "inbound_logistics",
  outbound_logistics: "outbound_logistics",
};
const read = (name: string) => readFileSync(`public/examples/control-unit/${name}`, "utf8");
describe("downloadable example", () => {
  it.each(Object.entries(files))("%s passes the real CSV and contract validators", (file, dataset) => {
    const result = validateRows(parseCsv(read(`${file}.csv`)), INGEST_DATASETS[dataset]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.counts.rows_rejected).toBe(0);
    expect(result.fileFindings).toEqual([]);
  });
  it("keeps the operational identifiers connected", () => {
    const rows = (file: string) => validateRows(parseCsv(read(`${file}.csv`)), INGEST_DATASETS[files[file]]).rows.map(r => r.parsed);
    const ids = (file: string, key: string) => new Set(rows(file).map(r => r[key]));
    const materials = ids('materials', 'material_id'), products = ids('products', 'product_id');
    const suppliers = ids('suppliers', 'supplier_id'), customers = ids('customers', 'customer_id');
    for (const row of rows('bom_single_level')) { expect(materials.has(row.material_id)).toBe(true); expect(products.has(row.product_id)).toBe(true); }
    for (const row of rows('inbound_logistics')) { expect(materials.has(row.material_id)).toBe(true); expect(suppliers.has(row.supplier_id)).toBe(true); }
    for (const row of rows('outbound_logistics')) { expect(customers.has(row.customer_id)).toBe(true); expect(products.has(row.product_id)).toBe(true); }
  });
  it("ships completed local evidence for the requested protocol", () => {
    const protocol = JSON.parse(read('protocol.json'));
    const result = JSON.parse(read('verification.json'));
    for (const name of ['baseline', 'disruption', 'safety-stock']) {
      expect(result[name].run_update.status).toBe('done');
      expect(result[name].replications).toBe(protocol.scenario.replications);
      expect(result[name].replication_kpis).toHaveLength(protocol.scenario.replications);
    }
  });
});
describe("important source changes require documentation review", () => {
  it.each(evidence.sources)("$path retains its reviewed content", source => {
    const actual = createHash('sha256').update(readFileSync(source.path)).digest('hex');
    expect(actual, `Review the linked manual claims and tests before updating the evidence hash for ${source.path}`).toBe(source.sha256);
  });
});
