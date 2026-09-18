/**
 * WP 6.2 · §4 D17 — AN EMPTY MASTER COLUMN THAT MEANS SOMETHING SAYS SO.
 *
 * `suppliers.capacity_per_week` is nullable and `item_master.sql:44` declares the
 * meaning: "NULL = ∞; finite enables partial capacity cuts". `dataMap.ts:134`
 * says the same in the engine's field map ("master → unlimited"). The resolver
 * said otherwise: `liveDefault = derivedVal ?? 0`, a hard-coded zero with
 * provenance `default`, whose colour is null and therefore draws NO DOT.
 *
 * §15 measured **60 of 60 suppliers** in the measured project with a null
 * capacity. So the mobile list read "Capacity 0" for every supplier in the
 * network — the exact inverse of unlimited — and the desktop grid showed a blank
 * cell, which is less wrong and still says nothing about what blank means.
 * `declared-fallback` (I6): a fallback absent from the contract may not exist in
 * code. This one was absent from everywhere except one `??`.
 *
 * The three assertions below are the three ways the fix can rot: the declaration
 * disappears, the resolver goes back to inventing a number, or `nullMeans` gets
 * put on a column where it cannot render.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGE_TABLE_SPEC, COLUMN_FIT, type ColSpec } from "../columnSpecs";
import { resolveCell } from "../resolveEffective";
import type { PolicyBundle } from "../schemas";

const ROOT = join(__dirname, "..", "..", "..", "..");

const allCols = Object.entries(STAGE_TABLE_SPEC).flatMap(([stage, spec]) =>
  (spec.cols as ColSpec[]).map((col) => ({ stage, col })),
);
const capacity = allCols.find((c) => c.col.field === "capacity_per_week")!.col;

/** The resolver's inputs, with every source of a value deliberately empty. */
function resolveEmpty(col: ColSpec) {
  return resolveCell({
    rowKey: "S1::M1",
    row: { supplier_id: "S1", material_id: "M1" },
    col,
    draft: undefined,
    families: [col.family],
    masterColByField: new Map([[col.field, col]]),
    // The supplier row EXISTS and its capacity is null — which is the whole
    // point. A missing master row would take a different branch.
    masterRowById: { suppliers: new Map([["S1", { capacity_per_week: null }]]) } as never,
    derived: {} as never,
    defaults: {} as PolicyBundle,
    overrides: [],
    scope: "edge",
    familyDefault: () => undefined,
  });
}

describe("WP 6.2 · D17 · a null capacity is unlimited, and the cell says so", () => {
  it("the column declares what its empty state means", () => {
    expect(
      capacity.master?.nullMeans?.token,
      "`capacity_per_week` no longer declares `nullMeans`. The resolver falls back " +
        "to inventing a number, and 60 of 60 suppliers read as zero capacity again.",
    ).toBe("∞");
    expect(capacity.master?.nullMeans?.title.length ?? 0).toBeGreaterThan(40);
  });

  it("the resolver does NOT substitute a number for it", () => {
    const r = resolveEmpty(capacity);
    expect(
      r.value,
      "a null capacity resolved to a number. `0` is the inverse of what the schema " +
        "says an empty capacity means (`item_master.sql:44`: NULL = ∞).",
    ).toBeUndefined();
    expect(r.placeholder).toBe("∞");
  });

  it("the substitution is VISIBLE — `contract` has a dot, `default` does not", () => {
    // T2 is the whole point: the old provenance was `default`, whose colour is
    // null, so `ProvenanceDot` rendered nothing at all. A silent substitution.
    const r = resolveEmpty(capacity);
    expect(r.provenance).toBe("contract");
    const ui = readFileSync(join(ROOT, "src/components/policies/policyGridUi.tsx"), "utf8");
    const row = ui.split("\n").find((l) => /^\s*contract:\s*\{/.test(l));
    expect(row, "`contract` is gone from the PROVENANCE table").toBeDefined();
    expect(
      /color:\s*null/.test(row!),
      "`contract` draws no dot — the substitution is invisible again, which is the " +
        "half of D17 that mattered: the old state was `default`, and `default` has " +
        "no colour, so nothing on screen said a substitution had happened.",
    ).toBe(false);
  });

  it("`nullMeans` is only declared where the cell can render it", () => {
    // `kindOf` forces a `nullMeans` column to the numeric widget, because the
    // fix makes `liveDefault` undefined and the numeric probe would otherwise
    // miss it. That is only correct for a column COLUMN_FIT calls numeric.
    for (const { stage, col } of allCols.filter((c) => c.col.master?.nullMeans)) {
      const fit = COLUMN_FIT[col.field];
      expect(
        fit?.kind,
        `${stage}.${col.field} declares \`nullMeans\` and is not a numeric column, so ` +
          `\`kindOf\` forcing it to the number widget is wrong for it`,
      ).toMatch(/^(int|num)$/);
    }
  });
});
