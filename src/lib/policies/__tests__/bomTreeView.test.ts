/**
 * §4 D176 — the Supplier stage's BOM tree is a READ of the derivation.
 *
 * The fixture mirrors `supabase/rehearsal/310_one_etl_depth_and_demand.sql`'s
 * hand-checked math: PROD ships 10/week, the chain is
 * PROD ← M1(×2) ← M2(×3) ← M3(×4), so M3's inherited flow is 10·2·3·4 = 240
 * and its effective rate 24. MP sits under BOTH PROD (level 1) and M1
 * (level 2) — the multi-parent case whose flows the ETL sums per path.
 */
import { describe, expect, it } from "vitest";
import { buildBomTreeView, type TreeEntry } from "../bomTreeView";

const bomRows = [
  { material_id: "M1", higher_level_component_id: "PROD", level: 1 },
  { material_id: "M2", higher_level_component_id: "M1", level: 2 },
  { material_id: "M3", higher_level_component_id: "M2", level: 3 },
  { material_id: "MP", higher_level_component_id: "PROD", level: 1 },
  { material_id: "MP", higher_level_component_id: "M1", level: 2 },
];

const deepRows = [
  { data_source: "outbound", from_location: "PROD", to_location: "CUST", weighted: 10, path_root: "PROD" },
  { data_source: "bom", from_location: "M1", to_location: "PROD", path_root: "PROD", bom_depth: 1, material_consumption_rate: 2, weighted: 20 },
  { data_source: "bom", from_location: "M2", to_location: "M1", path_root: "PROD", bom_depth: 2, material_consumption_rate: 3, weighted: 60 },
  { data_source: "bom", from_location: "M3", to_location: "M2", path_root: "PROD", bom_depth: 3, material_consumption_rate: 4, weighted: 240 },
  { data_source: "bom", from_location: "MP", to_location: "PROD", path_root: "PROD", bom_depth: 1, material_consumption_rate: 1, weighted: 10 },
  { data_source: "bom", from_location: "MP", to_location: "M1", path_root: "PROD", bom_depth: 2, material_consumption_rate: 1, weighted: 20 },
];

const supplierRows = [
  { key: "SUP1::M3", supplier_id: "SUP1", material_id: "M3" },
  { key: "SUP2::M3", supplier_id: "SUP2", material_id: "M3" },
  { key: "(unassigned supplier)::MP", supplier_id: "(unassigned supplier)", material_id: "MP", __needs_supplier: true },
  { key: "SUP5::NOBOM", supplier_id: "SUP5", material_id: "NOBOM", __not_in_bom: true },
];

const nodes = (es: TreeEntry[]) => es.filter((e): e is Extract<TreeEntry, { kind: "node" }> => e.kind === "node");
const lanes = (es: TreeEntry[]) => es.filter((e): e is Extract<TreeEntry, { kind: "lane" }> => e.kind === "lane");

describe("buildBomTreeView (D176)", () => {
  const out = buildBomTreeView({ bomRows, deepRows, supplierRows });

  it("the 240 check: every displayed number is the derivation's, eff = flow ÷ root demand", () => {
    const m3 = nodes(out).find((n) => n.nodeId === "M3");
    expect(m3).toMatchObject({ depth: 3, edgeRate: 4, flowPerWeek: 240, effRate: 24, derived: true });
    const root = out.find((e) => e.kind === "root");
    expect(root).toMatchObject({ nodeId: "PROD", demandPerWeek: 10 });
  });

  it("parity: for every derived node, effRate × root demand equals the stored flow", () => {
    for (const n of nodes(out).filter((n) => n.derived && n.effRate !== null)) {
      expect((n.effRate as number) * 10).toBeCloseTo(n.flowPerWeek as number, 9);
    }
  });

  it("a multi-parent material occurs under each parent; lanes attach at the shallowest occurrence only", () => {
    const mp = nodes(out).filter((n) => n.nodeId === "MP");
    expect(mp).toHaveLength(2);
    const carrier = mp.find((n) => n.carriesLanes);
    const other = mp.find((n) => !n.carriesLanes);
    expect(carrier?.parentId).toBe("PROD"); // depth 1 beats depth 2
    expect(other?.canonicalPath).toEqual(carrier?.path);
    const mpLanes = lanes(out).filter((l) => l.row.material_id === "MP");
    expect(mpLanes).toHaveLength(1);
    expect(mpLanes[0].path).toEqual(carrier?.path);
  });

  it("every supplier row appears exactly once, and unknown materials land in the tail section", () => {
    const keys = lanes(out).map((l) => l.row.key).sort();
    expect(keys).toEqual(supplierRows.map((r) => r.key).sort());
    const section = out.find((e) => e.kind === "section" && e.id === "not_in_bom");
    expect(section).toMatchObject({ count: 1 });
    const noBomLane = lanes(out).find((l) => l.row.material_id === "NOBOM");
    const sectionIdx = out.indexOf(section as TreeEntry);
    expect(out.indexOf(noBomLane as TreeEntry)).toBeGreaterThan(sectionIdx);
  });

  it("an uploaded edge with no derived row is flagged, never computed around", () => {
    const es = buildBomTreeView({
      bomRows: [...bomRows, { material_id: "M9", higher_level_component_id: "PROD", level: 1 }],
      deepRows,
      supplierRows: [],
    });
    const m9 = nodes(es).find((n) => n.nodeId === "M9");
    expect(m9).toMatchObject({ derived: false, edgeRate: null, effRate: null, flowPerWeek: null });
  });

  it("a derived edge reaching no shipping product is counted in its own section", () => {
    const es = buildBomTreeView({
      bomRows,
      deepRows: [...deepRows, { data_source: "bom", from_location: "ORPHX", to_location: "GONE", path_root: null, weighted: 5 }],
      supplierRows: [],
    });
    expect(es.find((e) => e.kind === "section" && e.id === "unreachable")).toMatchObject({ count: 1 });
  });

  it("a cycle in the upload terminates the walk instead of hanging it", () => {
    const es = buildBomTreeView({
      bomRows: [...bomRows, { material_id: "PROD", higher_level_component_id: "M3", level: 4 }],
      deepRows,
      supplierRows,
    });
    // the looping edge is dropped exactly as the SQL walk drops it
    expect(nodes(es).filter((n) => n.nodeId === "PROD")).toHaveLength(0);
    expect(nodes(es).find((n) => n.nodeId === "M3")).toBeTruthy();
  });

  it("a blank-parent component feeds every shipping product (D129), but a root's own row is not an edge (D171)", () => {
    const es = buildBomTreeView({
      bomRows: [
        ...bomRows,
        { material_id: "TOPC", higher_level_component_id: "", level: 0 },
        { material_id: "PROD", higher_level_component_id: null, level: 0 }, // the poisoned root row
      ],
      deepRows,
      supplierRows: [],
    });
    expect(nodes(es).filter((n) => n.nodeId === "TOPC")).toHaveLength(1); // one root here
    expect(nodes(es).filter((n) => n.nodeId === "PROD")).toHaveLength(0);
  });

  it("sub-assemblies and leaves are told apart by the upload's own shape", () => {
    const m1 = nodes(out).find((n) => n.nodeId === "M1");
    const m3 = nodes(out).find((n) => n.nodeId === "M3");
    expect(m1?.echelon).toBe("subassembly");
    expect(m3?.echelon).toBe("material");
  });
});
