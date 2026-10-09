/**
 * §4 D307 — the nexus-node score is DEMAND AT RISK, and these are its fixtures.
 *
 * The scorer is `supabase/functions/_shared/criticalNodes.ts`, bundled into
 * `predict-critical-nodes` and imported here by relative path (the same
 * isomorphic pattern as `grading.ts`). Every case below is small enough to be
 * worked by hand, and the expected numbers ARE the hand calculation — so a change
 * to the propagation rule moves a number a reader can check, not a snapshot.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  brandesBetweenness,
  DEFAULT_NEXUS_THRESHOLD,
  type LaneRow,
  resolveThreshold,
  scoreCriticalNodes,
} from "../../../../supabase/functions/_shared/criticalNodes";

const ROOT = join(__dirname, "..", "..", "..", "..");

const inbound = (s: string, m: string, rate: number, ratio?: number): LaneRow => ({
  data_source: "inbound", from_location: s, to_location: m,
  material_consumption_rate: rate, sourcing_ratio: ratio ?? null, weighted: null,
});
const bom = (m: string, p: string): LaneRow => ({
  data_source: "bom", from_location: m, to_location: p, sourcing_ratio: 1, weighted: null,
});
const outbound = (p: string, c: string, wk: number | null): LaneRow => ({
  data_source: "outbound", from_location: p, to_location: c, weighted: wk,
});

const byId = (rows: LaneRow[], threshold?: number) =>
  new Map(scoreCriticalNodes(rows, { threshold }).nodes.map((n) => [n.node_id, n]));

describe("the example project — the ground truth its own _about states", () => {
  // `scripts/example_project/dataset.json`: 1 product, 2 materials, 3 suppliers.
  // "S3 is a pricier second source for M1; S2 is the ONLY source of M2." The lanes
  // are built here the way `rebuild_supply_chain_lanes` builds them: an inbound
  // edge's rate is the supplier's weekly volume, an outbound edge's weight the
  // product's weekly demand.
  const ds = JSON.parse(
    readFileSync(join(ROOT, "scripts", "example_project", "dataset.json"), "utf8"),
  ) as {
    bom: Array<{ product_id: string; material_id: string }>;
    inbound: Array<{ supplier_id: string; material_id: string; volume: number; time_unit: string }>;
    outbound: Array<{ customer_id: string; product_id: string; volume: number; time_unit: string }>;
  };
  // Every row of the fixture is weekly; if that changes, this test must convert.
  expect(new Set([...ds.inbound, ...ds.outbound].map((r) => r.time_unit))).toEqual(new Set(["week"]));
  const rows: LaneRow[] = [
    ...ds.inbound.map((r) => inbound(r.supplier_id, r.material_id, r.volume)),
    ...ds.bom.map((r) => bom(r.material_id, r.product_id)),
    ...ds.outbound.map((r) => outbound(r.product_id, r.customer_id, r.volume)),
  ];
  const n = byId(rows);

  it("the sole source of M2 puts ALL demand at risk; each second source of M1 half of it", () => {
    expect(n.get("S2")!.score).toBe(1);
    expect(n.get("S2")!.sole_source_of).toEqual(["M2"]);
    // S1 and S3 each deliver 120/week of M1: losing either halves M1, and the
    // product needs M1, so half its demand is at risk — with no rebalancing,
    // which is the first-order assumption this score states.
    expect(n.get("S1")!.score).toBe(0.5);
    expect(n.get("S3")!.score).toBe(0.5);
    expect(n.get("S1")!.sole_source_of).toEqual([]);
  });

  it("the critical path is nexus; the customer is a demand endpoint, never a supply point", () => {
    for (const id of ["P1", "M1", "M2", "S2"]) expect(n.get(id)!.score, id).toBe(1);
    expect(n.get("C1")!.score).toBe(0);
    expect(n.get("C1")!.is_critical).toBe(false);
    expect(n.get("C1")!.rank).toBeNull();
  });
});

describe("criticality is not connectivity — the defect D307 names", () => {
  // A hub supplier H holds a 10 % share of ten materials; a one-lane supplier
  // ONE is the only source of the material the big product needs. The old score
  // was 70 % neighbour count and ranked H first by a wide margin.
  const rows: LaneRow[] = [
    inbound("ONE", "M0", 50),
    bom("M0", "BIG"),
    outbound("BIG", "C", 90),
    outbound("SMALL", "C", 10),
  ];
  for (let i = 1; i <= 10; i++) {
    rows.push(inbound("H", `M${i}`, 10), inbound(`ALT${i}`, `M${i}`, 90), bom(`M${i}`, "SMALL"));
  }
  const n = byId(rows);

  it("the sole source of the big product's material outranks the hub", () => {
    expect(n.get("ONE")!.score).toBe(0.9);
    // H: SMALL is 10 % of demand and loses at most 10 % of any one material.
    expect(n.get("H")!.score).toBe(0.01);
    expect(n.get("ONE")!.rank!).toBeLessThan(n.get("H")!.rank!);
    expect(n.get("ONE")!.is_critical).toBe(true);
    expect(n.get("H")!.is_critical).toBe(false);
  });
});

describe("the propagation rule", () => {
  it("a product loses the WORST of its materials, not the sum (Leontief)", () => {
    const n = byId([
      inbound("X", "M1", 30), inbound("Y", "M1", 70),
      inbound("X", "M2", 60), inbound("Z", "M2", 40),
      bom("M1", "P"), bom("M2", "P"),
      outbound("P", "C", 100),
    ]);
    expect(n.get("X")!.score).toBe(0.6);
    expect(n.get("X")!.products_affected).toBe(1);
  });

  it("weights products by weekly demand", () => {
    const n = byId([
      inbound("S", "MA", 1), bom("MA", "A"), outbound("A", "C", 30),
      inbound("T", "MB", 1), bom("MB", "B"), outbound("B", "C", 70),
    ]);
    expect(n.get("S")!.score).toBe(0.3);
    expect(n.get("T")!.score).toBe(0.7);
  });

  it("is absolute, not a quota: a diversified material has no nexus supplier", () => {
    const rows: LaneRow[] = [bom("M", "P"), outbound("P", "C", 10)];
    for (let i = 0; i < 20; i++) rows.push(inbound(`S${i}`, "M", 5));
    const res = scoreCriticalNodes(rows);
    const suppliers = res.nodes.filter((x) => x.node_id.startsWith("S"));
    expect(suppliers.every((s) => s.score === 0.05 && !s.is_critical)).toBe(true);
    // ...while the material itself is still a single point of failure.
    expect(res.nodes.find((x) => x.node_id === "M")!.is_critical).toBe(true);
  });

  it("aggregates a material bought at two plants by volume, not by averaging ratios", () => {
    const n = byId([
      { ...inbound("S", "M", 90), sourcing_ratio: 1 },   // plant A: S is the only source
      { ...inbound("T", "M", 10), sourcing_ratio: 1 },   // plant B: T is the only source
      bom("M", "P"), outbound("P", "C", 1),
    ]);
    expect(n.get("S")!.score).toBe(0.9);
    expect(n.get("S")!.sole_source_of).toEqual([]);
  });

  it("is deterministic under row order", () => {
    const rows = [
      inbound("A", "M", 1), inbound("B", "M", 3), bom("M", "P"), bom("N", "P"),
      inbound("C", "N", 2), outbound("P", "C1", 4), outbound("P", "C2", 6),
    ];
    const a = scoreCriticalNodes(rows);
    const b = scoreCriticalNodes([...rows].reverse());
    expect(b).toEqual(a);
  });
});

describe("substitutions are stated, never silent (§5 T2)", () => {
  it("no outbound volume → products weighted equally, and the result says so", () => {
    const res = scoreCriticalNodes([
      inbound("S", "M1", 1), bom("M1", "P1"), outbound("P1", "C", null),
      inbound("T", "M2", 1), bom("M2", "P2"), outbound("P2", "C", null),
    ]);
    expect(res.demand_basis).toBe("equal_per_product");
    expect(res.substitutions.map((s) => s.code)).toContain("demand_volume_missing");
    expect(res.nodes.find((x) => x.node_id === "S")!.score).toBe(0.5);
  });

  it("no inbound volume → the ETL's sourcing_ratio, and the result says so", () => {
    const res = scoreCriticalNodes([
      inbound("S", "M", 0, 0.25), inbound("T", "M", 0, 0.75),
      bom("M", "P"), outbound("P", "C", 1),
    ]);
    expect(res.substitutions.find((s) => s.code === "sourcing_share_missing")!.count).toBe(1);
    expect(res.nodes.find((x) => x.node_id === "T")!.score).toBe(0.75);
  });

  it("an unknown edge kind is left out and counted", () => {
    const res = scoreCriticalNodes([
      { data_source: "multi_tier", from_location: "X", to_location: "Y" },
      bom("M", "P"), outbound("P", "C", 1),
    ]);
    expect(res.substitutions.find((s) => s.code === "edge_kind_unknown")!.count).toBe(1);
    expect(res.nodes.map((x) => x.node_id)).not.toContain("X");
  });

  it("a clean graph states none", () => {
    expect(scoreCriticalNodes([inbound("S", "M", 1), bom("M", "P"), outbound("P", "C", 1)])
      .substitutions).toEqual([]);
  });
});

describe("threshold and betweenness", () => {
  it("accepts (0, 1] and falls back to the default otherwise", () => {
    expect(resolveThreshold(0.25)).toBe(0.25);
    expect(resolveThreshold("0.5")).toBe(0.5);
    for (const bad of [0, -1, 1.5, "x", null, undefined]) {
      expect(resolveThreshold(bad)).toBe(DEFAULT_NEXUS_THRESHOLD);
    }
  });

  it("the threshold decides nexus; the score does not move with it", () => {
    const rows = [inbound("S", "M", 1), inbound("T", "M", 3), bom("M", "P"), outbound("P", "C", 1)];
    expect(byId(rows, 0.3).get("S")!.is_critical).toBe(false);
    expect(byId(rows, 0.2).get("S")!.is_critical).toBe(true);
    expect(byId(rows, 0.3).get("S")!.score).toBe(byId(rows, 0.2).get("S")!.score);
  });

  it("betweenness is exact and directed: the middle of a→b→c carries the one path", () => {
    const out = new Map([["a", new Set(["b"])], ["b", new Set(["c"])]]);
    const cb = brandesBetweenness(["a", "b", "c"], out);
    expect(cb.get("b")).toBe(0.5); // 1 pair through b, normalized by (3−1)(3−2)
    expect(cb.get("a")).toBe(0);
    expect(cb.get("c")).toBe(0);
  });
});
