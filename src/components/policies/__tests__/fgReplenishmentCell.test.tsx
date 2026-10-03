/**
 * The Plant stage's FG levels render in the SAME cell as the material
 * Replenishment parameters: symbol + input, only the levels the FG policy reads,
 * the engine's derived target greyed, a missing required level marked — static
 * markup, as `bomTreeRender.test.tsx` does (vitest runs in node with no DOM).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReplenishmentCell } from "@/components/policies/policyGridUi";
import { FG_POLICY_PARAMS } from "@/lib/policies/fgPolicyParams";
import { STAGE_TABLE_SPEC, vectorParamCols } from "@/lib/policies/columnSpecs";

type P = { field: string; value?: number; placeholder?: string; invalid?: string };
const render = (policyType: string, params: P[]) =>
  renderToStaticMarkup(
    createElement(ReplenishmentCell, {
      policyType,
      paramSpec: FG_POLICY_PARAMS,
      labelFor: (f: string) => f,
      params: params.map((p) => ({
        field: p.field,
        value: p.value,
        placeholder: p.placeholder,
        invalid: p.invalid,
        onCommit: () => undefined,
      })),
    }),
  );
const symbols = (html: string) =>
  [...html.matchAll(/cursor-help font-mono text-\[10px\] font-medium text-muted-foreground">([^<]+)</g)].map((m) => m[1]);

describe("FG replenishment cell", () => {
  it("shows only the levels each FG policy reads", () => {
    expect(symbols(render("base_stock", []))).toEqual(["S"]);
    expect(symbols(render("min_max", []))).toEqual(["s", "S"]);
    expect(symbols(render("days_of_cover", []))).toEqual(["D"]);
    // No κ, no basis — neither is an FG parameter.
    expect(render("min_max", [])).not.toContain("κ");
    expect(render("min_max", [])).not.toContain("days_of_supply");
  });

  it("greys the derived S and marks a missing required level", () => {
    const base = render("base_stock", [{ field: "fg_base_stock", placeholder: "≈1400" }]);
    expect(base).toContain('placeholder="≈1400"');
    const mm = render("min_max", [
      { field: "fg_reorder_point", invalid: "Min-max needs s and S" },
      { field: "fg_base_stock", value: 900 },
    ]);
    expect(mm).toContain('value="900"');
    expect(mm).toContain('title="Min-max needs s and S"');
  });

  it("the three FG level columns feed the cell and leave the header", () => {
    expect(vectorParamCols("plant", "fgParams").map((c) => c.field)).toEqual([
      "fg_reorder_point", "fg_base_stock", "fg_cover_days",
    ]);
    const plant = STAGE_TABLE_SPEC.plant.cols.map((c) => c.field);
    expect(plant).toContain("__fg_params");
    expect(plant.indexOf("fg_policy")).toBeLessThan(plant.indexOf("__fg_params"));
  });
});
