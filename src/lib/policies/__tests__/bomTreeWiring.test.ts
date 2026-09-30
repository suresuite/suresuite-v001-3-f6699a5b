/**
 * §4 D180 — source-level wiring gates for the Supplier stage's BOM tree.
 *
 * The repository has no DOM test tooling, so what the grid DOES with the pure
 * model (`bomTreeModel.test.ts`) is pinned here on the source, as
 * `supplierStageNeverBlank.test.ts` does for D178/D179. Every assertion below
 * was run against the pre-D180 `StagePolicyTable.tsx` and FAILS there.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const TABLE = "src/components/policies/StagePolicyTable.tsx";
const MODEL = "src/lib/policies/bomTreeView.ts";

describe("the tree is presentation over the unchanged flat set (D180)", () => {
  const src = read(TABLE);

  it("the model is built from the WHOLE flat row set — filters never shrink the structure", () => {
    expect(src).toMatch(/buildBomTreeModel\(\{[\s\S]{0,200}supplierRows: dataRows as/);
  });

  it("in the tree the Material filter OPENS paths and removes no row; other filters behave as today", () => {
    expect(src).toMatch(/!\(treeActive && colId === materialColId\)/);
    expect(src).toMatch(/revealForFilter\(treeModel, materialFilter\)/);
  });

  it("flat mode and every other stage keep KEY_W exactly; only the tree widens Material", () => {
    expect(src).toMatch(
      /if \(!treeActive\) \{\s*const flat = spec\.keyCols\.map\(\(c, i\) => \(\{ id: c\.id, w: i === 0 \? keyW\.a : keyW\.b, left: i === 0 \? 0 : keyW\.a \}\)\);\s*if \(!flatQty\) return flat;/,
    );
    // A single-level BOM adds ONE frozen column, Qty / assy, between Material
    // and Supplier — at the tree's own width — and changes neither key width.
    expect(src).toMatch(/return \[flat\[0\], \{ id: "__qty", w: TREE_QTY_W, left: keyW\.a \}, \.\.\.flat\.slice\(1\)\];/);
    expect(src).toMatch(/const flatQty = stageKey === "supplier" && !treeActive && qtyByMaterial\.size > 0;/);
    // one constant feeds both the <col> and the sticky offset (columnFit.ts §0.2)
    expect(src).toMatch(/\{keyDefs\.map\(\(d\) => \(\s*<col key=\{d\.id\} style=\{\{ width: d\.w \}\} \/>/);
  });

  it("a sub-assembly's line renders as its tree row with read-only value cells (D18's class)", () => {
    expect(src).toMatch(/if \(occ\.ownRow\) \{[\s\S]{0,400}readOnlyValues: true/);
    expect(src).toMatch(/if \(tree\?\.readOnlyValues\) \{/);
  });

  it("every tree line goes through renderRow — the Supplier cell and value cells are the flat ones", () => {
    expect(src).toMatch(/renderRow\(v\.row as Record<string, unknown>, undefined, \{/);
  });
});

describe("the tree's numbers are the derivation's, read through the model (D180, I1)", () => {
  const src = read(TABLE);

  it("qty per product comes from the model's one summation, never a sum in the component", () => {
    expect(src).toMatch(/M\.qtyPerRoot\(occ\.id\)/);
    expect(/\.weighted\b/.test(src), "the component reads a derived `weighted` itself").toBe(false);
    expect(/higher_level_component_id/.test(src), "the component reads BOM shape itself (a second walk)").toBe(false);
  });

  it("the node's kind is the one upload-shape test the tree builder already makes (D127)", () => {
    const model = read(MODEL);
    expect(model).toMatch(/export function buildBomTreeModel/);
    expect(model.match(/children\.has\(/g) ?? []).toHaveLength(1);
    expect(model).toMatch(/kind: e\.echelon/);
  });

  it("a stale derived lane says so in the Material header — nothing is recomputed to hide it", () => {
    expect(src).toMatch(/treeModel\.stale \? "numbers from an old calculation — run Combine · " : ""/);
  });

  it("the where-used row never estimates a missing quantity", () => {
    expect(src).toMatch(/q\.qty !== null\s*\?[\s\S]{0,300}: `A parent edge under \$\{q\.rootId\} is not derived, or it has no demand — qty not shown/);
  });
});

describe("nothing hides a material or a line without saying so (D180, §5.3 T2)", () => {
  const src = read(TABLE);

  it("a collapsed occurrence's hover says what it contains", () => {
    expect(src).toMatch(/occ\.inside\.materials[\s\S]{0,200}occ\.inside\.lines[\s\S]{0,80}inside/);
  });

  it("the header counts the lines open against every line the stage holds", () => {
    expect(src).toMatch(/BOM tree · \$\{treeVisible\.shownLines\} of \$\{treeModel\.totalLines\} lines open/);
  });

  it("Repeat labels is shown disabled and explained in Compact — never hidden", () => {
    expect(src).toMatch(/Outline and Tabular only — Compact has one label column/);
  });
});
