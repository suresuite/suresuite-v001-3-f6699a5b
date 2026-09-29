/**
 * §4 D180 — the Supplier stage's BOM tree as something a user can navigate.
 *
 * Two fixtures:
 *   · `aaShape()` reproduces `Project AA - ver3` as §15 measured it (runs
 *     36555596249 / 36559225602): one product, uploaded levels L0–L4 holding
 *     2 / 5 / 29 / 45 / 315 edge rows, 65 sub-assemblies each under ONE parent,
 *     195 purchased materials, 136 extra parent edges over 49 shared
 *     materials, 321 supplier links + 65 "(made in-house)" lines = 386.
 *   · the REAL 15-parent branch of ASNA2050DCJ3208 with its production edge
 *     rates (B20) — Σ 299 per DB366 (S14A), which is the engine's flatten
 *     (B8: 195 of 195 agree on AA-ver3 after Combine).
 */
import { describe, expect, it } from "vitest";
import {
  buildBomTreeModel,
  expandToLevel,
  occKey,
  revealForFilter,
  revealKeys,
  visibleTreeRows,
  type BomTreeModel,
} from "../bomTreeView";

import { aaShape, type Row } from "./fixtures/aaShape";

const allRowKeys = (m: BomTreeModel): string[] => {
  const keys: string[] = [];
  for (const o of m.occs) {
    for (const l of o.lanes) keys.push(l.key);
    if (o.ownRow) keys.push(o.ownRow.key);
  }
  for (const t of m.tail) keys.push(t.row.key);
  return keys.sort();
};

describe("buildBomTreeModel at AA-ver3's size (D180)", () => {
  const input = aaShape();
  const model = buildBomTreeModel(input);

  it("the upload's shape: 1 root, 65 sub-assemblies, 195 materials, 136 repeats, depth 5", () => {
    expect(model.roots).toEqual(["R"]);
    expect(model.occs.filter((o) => o.kind === "subassembly")).toHaveLength(65);
    expect(new Set(model.occs.filter((o) => o.kind === "material").map((o) => o.id)).size).toBe(195);
    expect(model.occs.filter((o) => !o.canonical)).toHaveLength(136);
    expect(model.maxDepth).toBe(5);
  });

  it("every flat supplier row is in the model EXACTLY once — the flat set is untouched", () => {
    expect(allRowKeys(model)).toEqual(input.supplierRows.map((r) => r.key).sort());
    expect(model.totalLines).toBe(386);
  });

  it("each sub-assembly IS its (made in-house) line — the node row and the line are one row", () => {
    const subs = model.occs.filter((o) => o.kind === "subassembly");
    expect(subs.every((o) => o.ownRow?.__in_house === true && o.lanes.length === 0)).toBe(true);
  });

  it("repeat occurrences carry no lines; the canonical one carries them all", () => {
    for (const o of model.occs.filter((x) => !x.canonical)) {
      expect(o.lanes).toHaveLength(0);
      expect(model.byKey.get(o.canonicalKey)?.canonical).toBe(true);
    }
  });

  it("expand to L2 (the default) shows 37 rows; everything open shows 718 — every line", () => {
    const l2 = visibleTreeRows(model, { open: expandToLevel(model, 2), layout: "compact", whereOpen: null });
    expect(l2.rows).toHaveLength(37);
    expect(l2.shownLines).toBe(36); // the 2 + 5 + 29 sub-assembly lines on screen
    const all = visibleTreeRows(model, { open: expandToLevel(model, "all"), layout: "compact", whereOpen: null });
    expect(all.rows).toHaveLength(1 + 65 + 195 + 136 + 321);
    expect(all.shownLines).toBe(386);
  });

  it("a collapsed occurrence reports what it contains", () => {
    const root = model.byKey.get(occKey(["R"]))!;
    expect(root.inside).toEqual({ materials: 195, lines: 386 });
  });

  it("builds and lays out at AA-ver3's size without lag", () => {
    const t0 = performance.now();
    for (let n = 0; n < 10; n++) {
      const m = buildBomTreeModel(input);
      visibleTreeRows(m, { open: expandToLevel(m, "all"), layout: "tabular", whereOpen: null });
      revealForFilter(m, "x1");
    }
    expect((performance.now() - t0) / 10).toBeLessThan(50);
  });
});

describe("qty per finished product and where-used (D180)", () => {
  // The real branch: ASNA2050DCJ3208 under 15 parents, production rates (B20).
  const rd = 1.91649555099247;
  const rates = [5, 3, 7, 8, 8, 18, 40, 40, 60, 50, 40, 3, 7, 6, 4];
  const parents = rates.map((_, i) => `P${String(i + 1).padStart(2, "0")}`);
  const bomRows: Row[] = [{ material_id: "WP1", higher_level_component_id: "DB366 (S14A)", level: 0 }];
  const deepRows: Row[] = [
    { data_source: "outbound", from_location: "DB366 (S14A)", to_location: "AAMC", weighted: rd, bom_depth: 0 },
    { data_source: "bom", from_location: "WP1", to_location: "DB366 (S14A)", path_root: "DB366 (S14A)", bom_depth: 0, material_consumption_rate: 1, weighted: rd },
  ];
  parents.forEach((p, i) => {
    bomRows.push({ material_id: p, higher_level_component_id: "WP1", level: 1 });
    deepRows.push({ data_source: "bom", from_location: p, to_location: "WP1", path_root: "DB366 (S14A)", bom_depth: 1, material_consumption_rate: 1, weighted: rd });
    bomRows.push({ material_id: "ASNA2050DCJ3208", higher_level_component_id: p, level: 2 });
    deepRows.push({
      data_source: "bom", from_location: "ASNA2050DCJ3208", to_location: p, path_root: "DB366 (S14A)",
      bom_depth: 2, material_consumption_rate: rates[i], weighted: rd * rates[i],
    });
  });
  const supplierRows = Array.from({ length: 6 }, (_, i) => ({
    key: `S${i + 1}::ASNA2050DCJ3208`, supplier_id: `S${i + 1}`, material_id: "ASNA2050DCJ3208",
  }));
  const model = buildBomTreeModel({ bomRows, deepRows, supplierRows });

  it("ASNA2050DCJ3208: 299 per DB366 (S14A), 573.03 / wk — the engine's number", () => {
    const [q] = model.qtyPerRoot("ASNA2050DCJ3208");
    expect(q.rootId).toBe("DB366 (S14A)");
    expect(q.edges).toBe(15);
    expect(q.qty).toBeCloseTo(299, 9);
    expect(q.flowPerWeek).toBeCloseTo(573.03, 2);
  });

  it("where-used lists all 15 parents with their own rate; the flows sum to the qty × demand", () => {
    const w = model.whereUsed("ASNA2050DCJ3208");
    expect(w.map((x) => x.parentId)).toEqual(parents);
    expect(w.map((x) => x.edgeRate)).toEqual(rates);
    expect(w.reduce((s, x) => s + (x.flowPerWeek ?? 0), 0)).toBeCloseTo(299 * rd, 9);
    expect(w.every((x) => x.occKey !== null)).toBe(true);
  });

  it("the six lines live once, under the canonical (first shallowest) occurrence", () => {
    const occs = model.occs.filter((o) => o.id === "ASNA2050DCJ3208");
    expect(occs).toHaveLength(15);
    expect(occs.filter((o) => o.canonical)).toHaveLength(1);
    expect(occs.find((o) => o.canonical)?.lanes).toHaveLength(6);
  });

  it("an edge with no derived row makes the qty UNKNOWN — never estimated", () => {
    const m = buildBomTreeModel({
      bomRows: [...bomRows, { material_id: "ASNA2050DCJ3208", higher_level_component_id: "WP1", level: 1 }],
      deepRows,
      supplierRows,
    });
    const [q] = m.qtyPerRoot("ASNA2050DCJ3208");
    expect(q.qty).toBeNull();
    expect(m.whereUsed("ASNA2050DCJ3208").find((x) => x.parentId === "WP1")).toMatchObject({ derived: false });
  });

  it("a parent the upload names but no product reaches is still listed in where-used", () => {
    const m = buildBomTreeModel({
      bomRows: [...bomRows, { material_id: "ASNA2050DCJ3208", higher_level_component_id: "ORPHAN", level: 2 }],
      deepRows,
      supplierRows,
    });
    expect(m.whereUsed("ASNA2050DCJ3208").find((x) => x.parentId === "ORPHAN")).toMatchObject({ occKey: null, derived: false });
  });

  it("a repeated sub-assembly does not count its children's derived row twice", () => {
    // S sits under A and B; M under S. The derived row (M → S, R) is ONE row
    // holding S's total demand × rate; it occurs twice in the tree.
    const m = buildBomTreeModel({
      bomRows: [
        { material_id: "A", higher_level_component_id: "R", level: 0 },
        { material_id: "B", higher_level_component_id: "R", level: 0 },
        { material_id: "S", higher_level_component_id: "A", level: 1 },
        { material_id: "S", higher_level_component_id: "B", level: 1 },
        { material_id: "M", higher_level_component_id: "S", level: 2 },
      ],
      deepRows: [
        { data_source: "outbound", from_location: "R", to_location: "C", weighted: 10, bom_depth: 0 },
        { data_source: "bom", from_location: "A", to_location: "R", path_root: "R", material_consumption_rate: 1, weighted: 10 },
        { data_source: "bom", from_location: "B", to_location: "R", path_root: "R", material_consumption_rate: 1, weighted: 10 },
        { data_source: "bom", from_location: "S", to_location: "A", path_root: "R", material_consumption_rate: 1, weighted: 10 },
        { data_source: "bom", from_location: "S", to_location: "B", path_root: "R", material_consumption_rate: 1, weighted: 10 },
        { data_source: "bom", from_location: "M", to_location: "S", path_root: "R", material_consumption_rate: 3, weighted: 60 },
      ],
      supplierRows: [{ key: "X::M", supplier_id: "X", material_id: "M" }],
    });
    expect(m.occs.filter((o) => o.id === "M")).toHaveLength(2);
    expect(m.qtyPerRoot("M")[0].qty).toBe(6); // 2 paths × 3, not 12
    expect(m.whereUsed("M")).toHaveLength(1);
    expect(m.whereUsed("M")[0].flowPerWeek).toBe(60);
  });
});

describe("filter, reveal, layouts and states (D180)", () => {
  const input = aaShape();
  const model = buildBomTreeModel(input);
  const base = expandToLevel(model, 2);

  it("the Material filter opens the path to every match and removes NO row", () => {
    const { open, matches } = revealForFilter(model, "x179");
    expect(matches.size).toBeGreaterThan(0);
    const union = new Set([...base, ...open]);
    const before = visibleTreeRows(model, { open: base, layout: "compact", whereOpen: null }).rows.length;
    const after = visibleTreeRows(model, { open: union, layout: "compact", whereOpen: null });
    expect(after.rows.length).toBeGreaterThanOrEqual(before);
    for (const k of matches) {
      expect(after.rows.some((r) => r.t === "node" && r.occ.key === k)).toBe(true);
    }
    // the matched material's lines are on screen
    expect(after.rows.some((r) => r.t === "lane" && r.row.material_id === "X179")).toBe(true);
  });

  it("a one-character filter opens nothing (2+ characters)", () => {
    expect(revealForFilter(model, "x").open.size).toBe(0);
  });

  it("matching a repeat opens its canonical occurrence too, so its lines show", () => {
    const repeat = model.occs.find((o) => o.id === "X1" && !o.canonical)!;
    const { open } = revealForFilter(model, "X1");
    expect(open.has(repeat.canonicalKey)).toBe(true);
    for (const k of revealKeys(model, repeat.canonicalKey)) expect(open.has(k)).toBe(true);
  });

  it("tabular: an open material shares its row with its first line; collapsed, one row says how many", () => {
    const x1 = model.byKey.get(model.occs.find((o) => o.id === "X1" && o.canonical)!.key)!;
    const open = new Set([...revealKeys(model, x1.key)]);
    const tab = visibleTreeRows(model, { open, layout: "tabular", whereOpen: x1.key }).rows;
    const lines = tab.filter((r) => r.t === "lane" && r.occ?.key === x1.key);
    expect(lines).toHaveLength(x1.lanes.length);
    expect(lines[0]).toMatchObject({ carrier: true, continuation: false });
    expect(lines.slice(1).every((r) => r.t === "lane" && !r.carrier && r.continuation)).toBe(true);
    expect(tab.some((r) => r.t === "node" && r.occ.key === x1.key)).toBe(false);
    // where-used sits under the first line
    const idx = tab.findIndex((r) => r.t === "lane" && r.carrier && r.occ?.key === x1.key);
    expect(tab[idx + 1]).toMatchObject({ t: "where" });
    open.delete(x1.key);
    const closed = visibleTreeRows(model, { open, layout: "tabular", whereOpen: null }).rows;
    expect(closed.find((r) => r.t === "node" && r.occ.key === x1.key)).toMatchObject({ linesHere: x1.lanes.length });
  });

  it("lines with no BOM place are always on screen, whatever is collapsed", () => {
    const m = buildBomTreeModel({
      ...input,
      supplierRows: [...input.supplierRows, { key: "S9::NOBOM", supplier_id: "S9", material_id: "NOBOM", __not_in_bom: true }],
    });
    const v = visibleTreeRows(m, { open: new Set(), layout: "compact", whereOpen: null });
    expect(v.rows.some((r) => r.t === "lane" && r.row.key === "S9::NOBOM")).toBe(true);
    expect(v.rows.some((r) => r.t === "section" && r.id === "not_in_bom")).toBe(true);
  });

  it("a stale lane is recognised: every outbound row has a NULL bom_depth (pre-WP 8.2)", () => {
    const stale = buildBomTreeModel({
      ...input,
      deepRows: input.deepRows.map((r) => ({ ...r, bom_depth: null })),
    });
    expect(stale.stale).toBe(true);
    expect(model.stale).toBe(false);
    expect(buildBomTreeModel({ ...input, deepRows: [] }).stale).toBe(false);
  });

  it("a bought sub-assembly keeps its supplier lines nested instead of merging them", () => {
    const m = buildBomTreeModel({
      ...input,
      supplierRows: input.supplierRows
        .filter((r) => r.material_id !== "D1")
        .concat([{ key: "SX::D1", supplier_id: "SX", material_id: "D1" }]),
    });
    const d1 = m.occs.find((o) => o.id === "D1")!;
    expect(d1.ownRow).toBeNull();
    expect(d1.lanes.map((l) => l.key)).toEqual(["SX::D1"]);
  });
});
