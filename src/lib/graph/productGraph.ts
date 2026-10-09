/**
 * The PRODUCT-LEVEL graph — Phase 8 / WP 8.4.
 *
 * ── WHAT THIS VIEW IS, AS SPECIFIED ────────────────────────────────────────
 *
 * Product-level is four echelons and nothing else:
 *
 *     Supplier → purchased Material → finished Product → Customer
 *
 * The **material** is the one a supplier actually delivers — the purchased leaf of
 * the bill of materials, not an intermediate the plant builds. The **product** is the
 * one a customer actually buys. Everything the plant makes in between is deliberately
 * NOT on this page: the multi-level structure is the Process-level view's subject.
 *
 * So the BOM is COLLAPSED. A purchased material connects straight to the finished
 * product it ends up inside, however many sub-assemblies sit between them.
 *
 * ── WHY THIS FILE EXISTS: NOTHING LIVE PRODUCES THAT ───────────────────────
 *
 * The deployed ETL (`combine_project_into_supply_chain`) writes the bom lane as
 * `material → IMMEDIATE PARENT`, one row per BOM row, with `weighted` computed as
 * total outbound volume × that row's own consumption rate — which ignores the rest of
 * the chain. So `supply_chain_data` holds the BOM TREE, and the page drew the tree.
 *
 * That is also why the page looked wrong in a second way. A sub-assembly is a bom
 * `from_location` (a material) AND a bom `to_location` (a product) — so the old
 * `buildGroupClassification`, which assigns by lane and lets the LAST row win, put
 * every sub-assembly in the Product column or the Material column depending on the
 * order rows came back in.
 *
 * ── THE EDGE RULE, WHICH IS THE PART THAT HAS TO BE RIGHT ──────────────────
 *
 * Collapsing nodes without collapsing quantities would leave every edge weight
 * describing one BOM hop of a path it no longer draws. Every edge's weight is the
 * SAME number the Process-level view draws for that lane (§4 D306), because both are
 * the lanes' `weighted`, written by one demand walk (`rebuild_supply_chain_lanes`):
 *
 *   Supplier → Material   Σ `weighted`: the material's demand times this supplier's
 *                         share of it, summed over plants.
 *   Material → Product    the demand PROPAGATED down the BOM, PER PLANT: the product's
 *                         demand in that plant times the product of the consumption
 *                         rates along every path from that product down to that
 *                         material, summed over paths and over plants. On the rows
 *                         the ETL writes today — already collapsed, carrying the
 *                         effective rate — this is exactly Σ `weighted`; on tree-shaped
 *                         rows it still collapses the tree.
 *   Product → Customer    Σ `weighted`: the weekly outbound volume.
 *
 * One drawn edge per pair, its flow summed (`sumLaneEdges`).
 *
 * A material that reaches no finished product produces NO edge and is REPORTED
 * (`unreachedMaterials`) rather than dropped quietly — T3, a view publishing the limit
 * of its own computation.
 */
import type { Echelon } from './types';
import { sumLaneEdges } from './laneEdges';

/** One `supply_chain_data` row, as the page already holds it. */
export interface FlatLaneRow {
  from_location: string;
  to_location: string;
  data_source?: string | null;
  /** The plant the row belongs to. The BOM walk never crosses plants, as in SQL. */
  plant_name?: string | null;
  /** On a bom row: how much of `from_location` per unit of `to_location`. */
  material_consumption_rate?: number | null;
  sourcing_ratio?: number | null;
  weighted?: number | null;
}

export interface ProductLevelEdge {
  source: string;
  target: string;
  /** Flow on this edge per week — the lanes' `weighted`, summed (§4 D306). */
  flow: number;
  lane: 'inbound' | 'bom' | 'outbound';
  /** How many BOM hops this edge stands for. 1 on inbound/outbound. */
  hops: number;
}

export interface ProductLevelGraph {
  /** Every node, with the echelon it holds in THIS view. */
  nodes: Map<string, { echelon: Echelon }>;
  edges: ProductLevelEdge[];
  /**
   * Purchased materials that reach no finished product through the BOM. Published,
   * not swallowed: it means the BOM is incomplete or the product is not in outbound,
   * and a user needs to know which rather than wonder where a node went (T3).
   */
  unreachedMaterials: string[];
  /** Sub-assemblies collapsed away — the count makes the abstraction visible. */
  collapsedIntermediates: number;
}

const id = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};
const num = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);
const plantKey = (plant: string, node: string) => `${plant}\u0000${node}`;

/**
 * Build the four-echelon product view from the flat lane rows.
 *
 * `MAX_DEPTH` bounds the upward walk. A malformed BOM can contain a cycle — a
 * component listed as its own ancestor — and an unbounded walk would hang the page
 * rather than draw a wrong graph. A truncated path is reported through
 * `unreachedMaterials`, which is the honest outcome: we could not establish where
 * that material ends up.
 */
export function buildProductLevelGraph(rows: readonly FlatLaneRow[]): ProductLevelGraph {
  const MAX_DEPTH = 32;

  const suppliers = new Set<string>();
  const purchased = new Set<string>();   // materials a supplier delivers
  const products = new Set<string>();    // things a customer buys
  const customers = new Set<string>();

  // (plant, parent) -> children, with the rate of child per unit of parent. Keyed by
  // PLANT because a BOM belongs to a plant: two plants making one product with two
  // recipes need (d₁ × r₁) + (d₂ × r₂), and an unkeyed walk gave (d₁ + d₂) × (r₁ + r₂).
  const childrenOf = new Map<string, { child: string; rate: number }[]>();
  const inboundRows: FlatLaneRow[] = [];
  const outboundRows: FlatLaneRow[] = [];
  // Demand per (plant, finished product), from outbound.
  const demandOf = new Map<string, { plant: string; product: string; demand: number }>();

  for (const r of rows) {
    const lane = (r.data_source ?? '').toLowerCase();
    const from = id(r.from_location);
    const to = id(r.to_location);
    if (!from || !to) continue;
    const plant = (r.plant_name ?? '').trim();

    if (lane === 'inbound') {
      suppliers.add(from);
      purchased.add(to);
      inboundRows.push(r);
    } else if (lane === 'outbound') {
      products.add(from);
      customers.add(to);
      outboundRows.push(r);
      const key = plantKey(plant, from);
      const d = demandOf.get(key) ?? { plant, product: from, demand: 0 };
      d.demand += num(r.weighted);
      demandOf.set(key, d);
    } else if (lane === 'bom') {
      // `from` is consumed into `to`. `to` is the parent. A blank rate is 0, as in the
      // SQL walk — never 1, which would invent a recipe the BOM does not state.
      const key = plantKey(plant, to);
      const list = childrenOf.get(key) ?? [];
      list.push({ child: from, rate: num(r.material_consumption_rate) });
      childrenOf.set(key, list);
    }
  }

  // ── the collapse: walk DOWN from each (plant, product), accumulating the demand, and
  //    record a (material, product) flow whenever the walk reaches a purchased leaf.
  //    Downward from the product is the right direction: it visits each product's own
  //    tree once, and the multiplier composes naturally on the way.
  const materialToProduct = new Map<string, Map<string, number>>();
  const intermediates = new Set<string>();

  const descend = (plant: string, product: string, node: string, qty: number, depth: number, seen: Set<string>) => {
    if (depth > MAX_DEPTH || seen.has(node)) return;
    const children = childrenOf.get(plantKey(plant, node));
    if (!children || children.length === 0) return;
    const nextSeen = new Set(seen).add(node);
    for (const { child, rate } of children) {
      const childQty = qty * rate;
      if (purchased.has(child)) {
        let byProduct = materialToProduct.get(child);
        if (!byProduct) { byProduct = new Map(); materialToProduct.set(child, byProduct); }
        byProduct.set(product, (byProduct.get(product) ?? 0) + childQty);
      }
      // A node can be BOTH purchased and an assembly the plant builds further. It is
      // recorded as a material above AND descended through here, because both are true.
      if (childrenOf.has(plantKey(plant, child))) {
        if (!purchased.has(child)) intermediates.add(child);
        descend(plant, product, child, childQty, depth + 1, nextSeen);
      }
    }
  };

  for (const { plant, product, demand } of demandOf.values()) {
    descend(plant, product, product, demand, 0, new Set());
  }

  // ── nodes: exactly the four echelons this view is about.
  const nodes = new Map<string, { echelon: Echelon }>();
  for (const s of suppliers) if (!products.has(s)) nodes.set(s, { echelon: 'supplier' });
  for (const m of purchased) if (!products.has(m)) nodes.set(m, { echelon: 'material' });
  for (const p of products) nodes.set(p, { echelon: 'product' });
  for (const c of customers) if (!nodes.has(c)) nodes.set(c, { echelon: 'customer' });

  // ── edges: one per pair, its flow summed over every row it stands for.
  const edges: ProductLevelEdge[] = [];

  for (const e of sumLaneEdges(inboundRows)) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
    edges.push({ source: e.source, target: e.target, flow: e.flow, lane: 'inbound', hops: 1 });
  }

  for (const [material, byProduct] of materialToProduct) {
    if (!nodes.has(material)) continue;
    for (const [product, flow] of byProduct) {
      if (!nodes.has(product) || material === product) continue;
      // The propagated requirement: what this product's demand needs of this
      // material, through every path between them, in every plant.
      edges.push({ source: material, target: product, flow, lane: 'bom', hops: 1 });
    }
  }

  for (const e of sumLaneEdges(outboundRows)) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
    edges.push({ source: e.source, target: e.target, flow: e.flow, lane: 'outbound', hops: 1 });
  }

  const unreachedMaterials = [...purchased]
    .filter((m) => nodes.has(m) && !materialToProduct.has(m))
    .sort();

  return { nodes, edges, unreachedMaterials, collapsedIntermediates: intermediates.size };
}
