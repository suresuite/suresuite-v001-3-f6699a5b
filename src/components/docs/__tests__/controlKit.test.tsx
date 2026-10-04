import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { parseCsv } from "../../../../supabase/functions/_shared/csvParse";
import { validateRows } from "../../../../supabase/functions/_shared/ingestValidate";
import { INGEST_DATASETS } from "../../../../supabase/functions/_shared/ingestSpec.generated";
import { DOC_BODIES } from "../bodies";
import { getPage } from "../registry";
import { DocFigure } from "../DocFigure";

const root = resolve(__dirname, "../../../..");
const sampleDir = resolve(root, "public/examples/control-kit");
const datasets = [
  ["suppliers", "item_master_suppliers", 2], ["materials", "item_master_materials", 2],
  ["products", "item_master_products", 1], ["customers", "item_master_customers", 1],
  ["bom_single_level", "bom_single_level", 2], ["inbound_logistic", "inbound_logistics", 2],
  ["outbound_logistic", "outbound_logistics", 1],
] as const;

const parsed = Object.fromEntries(datasets.map(([file]) => {
  const csv = parseCsv(readFileSync(resolve(sampleDir, `${file}.csv`), "utf8"));
  return [file, csv.rows.map(row => Object.fromEntries(csv.headers.map((h, i) => [h, row.cells[i]])))];
}));

describe("downloadable control-kit example", () => {
  it.each(datasets)("%s passes the real ingestion contract", (file, dataset, count) => {
    const csv = parseCsv(readFileSync(resolve(sampleDir, `${file}.csv`), "utf8"));
    expect(csv.ok).toBe(true);
    const result = validateRows(csv, INGEST_DATASETS[dataset]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.rows).toHaveLength(count);
    expect(result.rows.flatMap(r => r.findings).filter(f => f.level === "error")).toEqual([]);
  });
  it("connects every BOM, supply and demand ID to its master", () => {
    const ids = (file: string, key: string) => new Set(parsed[file].map(r => r[key]));
    const materials = ids("materials", "material_id"), products = ids("products", "product_id");
    for (const row of parsed.bom_single_level) {
      expect(materials.has(row.material_id)).toBe(true);
      expect(products.has(row.product_id)).toBe(true);
    }
    for (const row of parsed.inbound_logistic) {
      expect(ids("suppliers", "supplier_id").has(row.supplier_id)).toBe(true);
      expect(materials.has(row.material_id)).toBe(true);
    }
    for (const row of parsed.outbound_logistic) {
      expect(ids("customers", "customer_id").has(row.customer_id)).toBe(true);
      expect(products.has(row.product_id)).toBe(true);
    }
    expect(parsed.bom_single_level.map(r => Number(r.consumption_rate))).toEqual([1, 2]);
  });
});

describe("reader-ready onboarding pages", () => {
  it.each(["your-first-project", "uploading-data", "how-your-data-flows"])("%s renders links, figures and no author brief", slug => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DOC_BODIES[slug])));
    expect(html).toContain('<figure');
    expect(html).toContain('role="img"');
    expect(html).not.toMatch(/not drawn yet|To fill it:|src\/assets\/manual|WP \d|§4 D\d/);
    for (const [, target] of html.matchAll(/href="(\/docs\/[^"?#]+)"/g)) {
      expect(getPage(target.slice('/docs/'.length)), target).toBeDefined();
    }
    for (const [, target] of html.matchAll(/href="(\/examples\/[^"?#]+)"/g)) {
      expect(existsSync(resolve(root, "public" + target)), target).toBe(true);
    }
  });
  it("keeps the unfilled interactive-space author brief out of published markup", () => {
    const html = renderToStaticMarkup(createElement(DocFigure, {id: "interactive-space"}));
    expect(html).toBe("");
  });
});
