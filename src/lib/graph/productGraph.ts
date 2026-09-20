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
 * describing one BOM hop of a path it no longer draws.
 *
 *   Supplier → Material   the inbound flow, per supplier, as uploaded.
 *   Material → Product    the demand PROPAGATED down the BOM: the product's own
 *                         demand times the product of the consumption rates along
 *                         every path from that product down to that material. A
 *                         material reached by two paths sums them, because it is
 *                         needed for both.
 *   Product → Customer    the outbound volume, as uploaded.
 *
 * A material that reaches no finished product produces NO edge and is REPORTED
 * (`unreachedMaterials`) rather than dropped quietly — T3, a view publishing the limit
 * of its own computation.
 */
import type { Echelon } from './types';

/** One `supply_chain_data` row, as the page already holds it. */
export interface FlatLaneRow {
  from_location: string;
  to_location: string;
  data_source?: string | null;
  /** On a bom row: how much of `from_location` per unit of `to_location`. */
  material_consumption_rate?: number | null;
  sourcing_ratio?: number | null;
  weighted?: number | null;
}

export interface ProductLevelEdge {
  source: string;
  target: string;
  /** Flow on this edge, in the lane's own units. */
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

  // parent -> children, with the rate of child per unit of parent.
  const childrenOf = new Map<string, { child: string; rate: number }[]>();
  const inbound: { supplier: string; material: string; flow: number }[] = [];
  const outbound: { product: string; customer: string; flow: number }[] = [];

  for (const r of rows) {
    const lane = (r.data_source ?? '').toLowerCase();
    const from = id(r.from_location);
    const to = id(r.to_location);
    if (!from || !to) continue;

    if (lane === 'inbound') {
      suppliers.add(from);
      purchased.add(to);
      inbound.push({ supplier: from, material: to, flow: num(r.weighted) || num(r.sourcing_ratio) });
    } else if (lane === 'outbound') {
      products.add(from);
      customers.add(to);
      outbound.push({ product: from, customer: to, flow: num(r.weighted) });
    } else if (lane === 'bom') {
      // `from` is consumed into `to`. `to` is the parent.
      const list = childrenOf.get(to) ?? [];
      list.push({ child: from, rate: num(r.material_consumption_rate) || 1 });
      childrenOf.set(to, list);
    }
  }

  // Demand per finished product, from outbound.
  const demandOf = new Map<string, number>();
  for (const o of outbound) demandOf.set(o.product, (demandOf.get(o.product) ?? 0) + o.flow);

  // ── the collapse: walk DOWN from each product, accumulating the multiplier, and
  //    record a (material, product) pair whenever the walk reaches a purchased leaf.
  //    Downward from the product is the right direction: it visits each product's own
  //    tree once, and the multiplier composes naturally on the way.
  const materialToProduct = new Map<string, Map<string, number>>();
  const intermediates = new Set<string>();

  const descend = (product: string, node: string, multiplier: number, depth: number, seen: Set<string>) => {
    if (depth > MAX_DEPTH || seen.has(node)) return;
    const children = childrenOf.get(node);
    if (!children || children.length === 0) return;
    const nextSeen = new Set(seen).add(node);
    for (const { child, rate } of children) {
      const qty = multiplier * rate;
      if (purchased.has(child)) {
        let byProduct = materialToProduct.get(child);
        if (!byProduct) { byProduct = new Map(); materialToProduct.set(child, byProduct); }
        byProduct.set(product, (byProduct.get(product) ?? 0) + qty);
      }
      // A node can be BOTH purchased and an assembly the plant builds further. It is
      // recorded as a material above AND descended through here, because both are true.
      if (childrenOf.has(child)) {
        if (!purchased.has(child)) intermediates.add(child);
        descend(product, child, qty, depth + 1, nextSeen);
      }
    }
  };

  for (const product of products) descend(product, product, 1, 0, new Set());

  // ── nodes: exactly the four echelons this view is about.
  const nodes = new Map<string, { echelon: Echelon }>();
  for (const s of suppliers) if (!products.has(s)) nodes.set(s, { echelon: 'supplier' });
  for (const m of purchased) if (!products.has(m)) nodes.set(m, { echelon: 'material' });
  for (const p of products) nodes.set(p, { echelon: 'product' });
  for (const c of customers) if (!nodes.has(c)) nodes.set(c, { echelon: 'customer' });

  // ── edges.
  const edges: ProductLevelEdge[] = [];

  for (const i of inbound) {
    if (!nodes.has(i.supplier) || !nodes.has(i.material)) continue;
    edges.push({ source: i.supplier, target: i.material, flow: i.flow, lane: 'inbound', hops: 1 });
  }

  for (const [material, byProduct] of materialToProduct) {
    if (!nodes.has(material)) continue;
    for (const [product, qtyPerUnit] of byProduct) {
      if (!nodes.has(product)) continue;
      edges.push({
        source: material,
        target: product,
        // The propagated requirement: what this product's demand needs of this
        // material, through every path between them.
        flow: (demandOf.get(product) ?? 0) * qtyPerUnit,
        lane: 'bom',
        hops: 1,
      });
    }
  }

  for (const o of outbound) {
    if (!nodes.has(o.product) || !nodes.has(o.customer)) continue;
    edges.push({ source: o.product, target: o.customer, flow: o.flow, lane: 'outbound', hops: 1 });
  }

  const unreachedMaterials = [...purchased]
    .filter((m) => nodes.has(m) && !materialToProduct.has(m))
    .sort();

  return { nodes, edges, unreachedMaterials, collapsedIntermediates: intermediates.size };
}
