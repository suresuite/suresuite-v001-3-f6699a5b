/**
 * §4 D180 — the Supplier grid actually RENDERS the BOM tree at
 * `Project AA - ver3`'s size, in all three layouts, and leaves a single-level
 * project's grid without a trace of it.
 *
 * Rendered to static markup, as `bodies.test.tsx` does: this repository's
 * vitest runs in node with no DOM. The data hooks that need a session are
 * mocked; the grid, `renderRow`, the tree pass and the model are the real ones.
 * What this cannot see is behaviour after hydration (a click); the pure model
 * tests own that (`bomTreeModel.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { aaShape } from "@/lib/policies/__tests__/fixtures/aaShape";
import { DEFAULT_BUNDLE } from "@/lib/policies/schemas";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", email: "u@x" } }) }));
vi.mock("@/hooks/useGlobalProject", () => ({ useGlobalProject: () => ({ selectedProject: null }) }));
vi.mock("@/hooks/useTimeUnit", () => ({ useTimeUnit: () => ({ adaptLabel: (s: string) => s }) }));
vi.mock("@/hooks/useDatasetVersion", () => ({ useDatasetVersion: () => ({ snapshot: async () => null }) }));
vi.mock("@/hooks/useItemMasters", () => ({
  useItemMasters: () => ({
    materials: [],
    products: [],
    suppliers: [],
    derived: { materialCost: new Map(), sellPrice: new Map(), demandMean: new Map() },
    lanes: { inbound: [], outbound: [], bom: [], loaded: true },
    saveRows: async () => {},
    error: null,
  }),
}));

const { StagePolicyTable } = await import("../StagePolicyTable");

type Prefs = { layout: string; repeat: boolean; level: number | "all" };
function withPrefs(prefs: Prefs | null) {
  const store: Record<string, string> = prefs
    ? { "policy.table.bomTree.supplier": JSON.stringify({ P: prefs }) }
    : {};
  const ls = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
  };
  vi.stubGlobal("localStorage", ls);
  vi.stubGlobal("window", { innerWidth: 1440, localStorage: ls, addEventListener() {}, removeEventListener() {} });
}
afterEach(() => vi.unstubAllGlobals());

function render(o: { bomLevel: string; rows: Record<string, unknown>[]; bomRows?: unknown[]; deepRows?: unknown[] }) {
  return renderToStaticMarkup(
    createElement(StagePolicyTable, {
      projectId: "P",
      plantName: "Plant",
      stageKey: "supplier",
      defaults: DEFAULT_BUNDLE,
      overrides: [],
      fulfillmentStrategy: "make_to_stock",
      bulkUpsertOverrides: async () => {},
      stageRows: {
        rows: o.rows as never,
        loading: false,
        fallback: false,
        truncated: [],
        reload: () => {},
        bomLevel: o.bomLevel,
        bomRows: (o.bomRows ?? []) as never,
        deepRows: (o.deepRows ?? []) as never,
        loadError: null,
        deepError: null,
      },
    } as never),
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the BOM tree renders at AA-ver3's size (D180)", () => {
  const aa = aaShape();
  const input = { bomLevel: "multi", rows: aa.supplierRows, bomRows: aa.bomRows, deepRows: aa.deepRows };

  it("Compact at the L2 default: 37 rows, the Qty / assy column, the layout bar, the honest header", () => {
    withPrefs(null);
    const html = render(input);
    expect(count(html, "data-occ=")).toBe(37);
    expect(html).toContain("Qty / assy");
    expect(html).toContain("expand to");
    expect(html).toContain("BOM tree · 36 of 386 lines open");
    expect(html).toContain("Outline and Tabular only — Compact has one label column");
  });

  it.each(["compact", "outline", "tabular"])("%s, everything open: every material and every line is on screen", (layout) => {
    withPrefs({ layout, repeat: true, level: "all" });
    const t0 = performance.now();
    const html = render(input);
    const ms = performance.now() - t0;
    expect(html).toContain("BOM tree · 386 of 386 lines open");
    for (const r of aa.supplierRows) expect(html).toContain(`>${String(r.material_id)}<`);
    // the widest AA-sized render stays interactive-fast even on the server path
    expect(ms).toBeLessThan(4000);
  });

  it("a stale derived lane says so in the Material header", () => {
    withPrefs(null);
    const html = render({ ...input, deepRows: aa.deepRows.map((r) => ({ ...r, bom_depth: null })) });
    expect(html).toContain("numbers from an old calculation — run Combine · BOM tree");
  });
});

describe("a single-level project is untouched (D180)", () => {
  it("no tree, no Qty / assy, no layout bar — the flat grid names every line", () => {
    withPrefs(null);
    const rows = [
      { key: "S1::M001", supplier_id: "S1", material_id: "M001", __lane_count: 2 },
      { key: "S2::M001", supplier_id: "S2", material_id: "M001", __lane_count: 2 },
      { key: "S3::M002", supplier_id: "S3", material_id: "M002", __lane_count: 2 },
      { key: "S4::M002", supplier_id: "S4", material_id: "M002", __lane_count: 2 },
    ];
    const html = render({ bomLevel: "single", rows });
    expect(html).not.toContain("Qty / assy");
    expect(html).not.toContain("expand to");
    expect(html).not.toContain("BOM tree ·");
    expect(count(html, "data-occ=")).toBe(0);
    for (const r of rows) expect(html).toContain(r.supplier_id);
  });
});
