import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { qtyCellText, qtyPerAssemblyByMaterial } from "@/lib/policies/singleBomQty";

describe("single-level Qty / assy — the engine's value, not the upload's blank", () => {
  it("the premise: the engine runs a blank or 0 single-level rate as 1.0", () => {
    const py = readFileSync(resolve(__dirname, "../../../../sim-worker/sim_worker/datamap.py"), "utf8");
    expect(py).toMatch(/BomArc\([\s\S]{0,120}consumption_rate=_num\(r\.get\("consumption_rate"\)\) or 1\.0\)/);
  });

  it("reads the uploaded rate per product, and substitutes 1 exactly where the engine does", () => {
    const m = qtyPerAssemblyByMaterial([
      { product_id: "P2", material_id: "M1", consumption_rate: 3 },
      { product_id: "P1", material_id: "M1", consumption_rate: "2" },
      { product_id: "P1", material_id: "M2", consumption_rate: null },
      { product_id: "P1", material_id: "M3", consumption_rate: 0 },
      { product_id: "", material_id: "M4", consumption_rate: 5 },
    ]);
    expect(m.get("M1")).toEqual([
      { productId: "P1", qty: 2, defaulted: false },
      { productId: "P2", qty: 3, defaulted: false },
    ]);
    expect(m.get("M2")).toEqual([{ productId: "P1", qty: 1, defaulted: true }]);
    expect(m.get("M3")).toEqual([{ productId: "P1", qty: 1, defaulted: true }]);
    expect(m.has("M4")).toBe(false);
  });

  it("one product shows its qty; several show the range, the count and every product in the tooltip", () => {
    expect(qtyCellText([{ productId: "P1", qty: 2, defaulted: false }]).text).toBe("2");
    const many = qtyCellText([
      { productId: "P1", qty: 2, defaulted: false },
      { productId: "P2", qty: 0.5, defaulted: false },
    ]);
    expect(many.text).toBe("0.50–2 · 2 products");
    expect(many.title).toBe("2 per P1\n0.50 per P2");
    const same = qtyCellText([
      { productId: "P1", qty: 2, defaulted: false },
      { productId: "P2", qty: 2, defaulted: false },
    ]);
    expect(same.text).toBe("2 · 2 products");
  });

  it("a defaulted rate says so, and a material outside the BOM shows a dash with the reason", () => {
    const d = qtyCellText([{ productId: "P1", qty: 1, defaulted: true }]);
    expect(d.defaulted).toBe(true);
    expect(d.title).toContain("the engine uses 1");
    expect(qtyCellText(undefined)).toEqual({ text: "—", title: "Not in the bill of materials", defaulted: false });
  });
});
