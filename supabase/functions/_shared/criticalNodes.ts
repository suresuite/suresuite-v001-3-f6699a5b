// Nexus-node scoring over the lane graph — what `predict-critical-nodes` computes.
//
// Like `grading.ts` and `laneVolumes.ts`, this is DEPENDENCY-FREE pure TypeScript
// so it is isomorphic: Deno bundles it into the edge function and vitest imports
// it by relative path. Nothing here may reach for `npm:`, `Deno.*` or `@/`.
//
// §4 D307 — WHAT THIS REPLACES. The previous scorer called a node "nexus" when it
// sat in the top 10 % of a connectivity blend: 60 % capped degree, 10 % a SECOND
// capped degree labelled "betweenness", 10 % undirected eigenvector, 10 %
// per-component closeness, 5 % in/out balance and 5 % a revenue weight that was
// always 0. It scored LANE ROWS by their source node, so the result lived on rows
// every rebuild deletes, and it measured how connected a node is — which is not
// what makes one critical. A supplier with one lane can be the only source of a
// material every product needs; a hub with twenty interchangeable partners is not.
//
// WHAT IT COMPUTES NOW — ONE QUANTITY, DEFINED. A node's score is its
// DEMAND AT RISK: the share of finished-goods demand that cannot be served if
// that node alone is lost and nothing is rerouted, rebalanced or drawn from stock.
// It is the first-order, static estimate of what a single-node outage simulation
// (scsim's ST-1 battery) measures dynamically, which is what makes the two
// comparable later (blueprint §11.2).
//
// The lane graph carries one edge kind per lane (`supply_chain_data.data_source`),
// and the kind — not a guess about the node — says how loss propagates:
//
//   inbound   supplier → material   SHARE: the material loses this supplier's
//                                   share of its supply.
//   bom       material → product    REQUIREMENT: a product needs ALL its
//                                   materials, so it loses the worst of them
//                                   (Leontief, no substitution between materials).
//   outbound  product → customer    DEMAND: the product's weekly demand is the
//                                   weight its loss carries.
//
// A node is NEXUS when its demand at risk is at least the threshold (default
// 10 % of finished-goods demand). That is an absolute property, not a quota: a
// well-diversified network can have none, and a single-product chain is nexus
// along its whole critical path, which is a true statement about it.
//
// This module reads no node TYPE. A node's role is authored once, on
// `node_list.echelon` (§4 D127), and the edge kind is a fact about the EDGE.

export const CRITICAL_NODES_METHOD = "demand_at_risk" as const;
export const DEFAULT_NEXUS_THRESHOLD = 0.1;

/** A share at or above this is a sole source (floating-point slack on 1.0). */
const SOLE_SOURCE_SHARE = 0.999;

/** The lane columns the scorer reads, as PostgREST returns them. */
export interface LaneRow {
  from_location: string | null;
  to_location: string | null;
  data_source: string | null;
  /** Weekly volume on the edge (D2-normalized by the ETL). */
  weighted?: number | string | null;
  /** On an inbound edge, the supplier's weekly volume of the material. */
  material_consumption_rate?: number | string | null;
  /** This edge's share of everything flowing into its destination. */
  sourcing_ratio?: number | string | null;
}

export interface NodeScore {
  node_id: string;
  /** Demand at risk, rounded to 4 dp — what `critical_node_score` stores. */
  score: number;
  is_critical: boolean;
  /** 1 = highest demand at risk; null when the node puts no demand at risk. */
  rank: number | null;
  /** Finished products whose output falls if this node is lost. */
  products_affected: number;
  /** Materials for which this node is the only source on an inbound lane. */
  sole_source_of: string[];
  /** Directed betweenness, normalized to [0, 1]. Breaks ties; never the score. */
  betweenness: number;
}

/** A rule the scorer applied because the data did not say. Stated, never silent (§5 T2). */
export interface ScoringSubstitution {
  code:
    | "demand_volume_missing"
    | "sourcing_share_missing"
    | "edge_kind_unknown"
    | "cycle_in_lane_graph";
  meaning: string;
  count: number;
}

export interface CriticalNodeResult {
  method: typeof CRITICAL_NODES_METHOD;
  threshold: number;
  /** How finished-goods demand was weighted: by weekly volume, or equally per product. */
  demand_basis: "weekly_volume" | "equal_per_product";
  nodes: NodeScore[];
  products: number;
  substitutions: ScoringSubstitution[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type Kind = "inbound" | "bom" | "outbound";

/** Resolve a threshold from a request: (0, 1], or the default. */
export function resolveThreshold(raw: unknown): number {
  const t = num(raw);
  return t !== null && t > 0 && t <= 1 ? t : DEFAULT_NEXUS_THRESHOLD;
}

export function scoreCriticalNodes(
  rows: LaneRow[],
  opts: { threshold?: number } = {},
): CriticalNodeResult {
  const threshold = resolveThreshold(opts.threshold);
  const substitutions: ScoringSubstitution[] = [];

  // ── 1 · Edges, aggregated by (kind, from, to) across plants ──────────────
  const nodes = new Set<string>();
  const inboundRate = new Map<string, Map<string, number>>(); // to → from → Σ rate
  const inboundRatio = new Map<string, Map<string, number[]>>(); // to → from → ratios
  const requires = new Map<string, Set<string>>(); // product → materials
  const demand = new Map<string, number>(); // product → Σ weekly demand
  const demandSeen = new Set<string>(); // products with an outbound edge
  const out = new Map<string, Set<string>>(); // directed adjacency, every kind
  let unknownKind = 0;

  const link = (a: string, b: string) => {
    if (!out.has(a)) out.set(a, new Set());
    out.get(a)!.add(b);
  };

  for (const r of rows) {
    const from = (r.from_location ?? "").trim();
    const to = (r.to_location ?? "").trim();
    if (!from || !to) continue;
    const kind = (r.data_source ?? "").trim() as Kind;
    if (kind !== "inbound" && kind !== "bom" && kind !== "outbound") {
      unknownKind++;
      continue;
    }
    nodes.add(from);
    nodes.add(to);
    link(from, to);

    if (kind === "inbound") {
      if (!inboundRate.has(to)) inboundRate.set(to, new Map());
      if (!inboundRatio.has(to)) inboundRatio.set(to, new Map());
      const rate = num(r.material_consumption_rate);
      const byFrom = inboundRate.get(to)!;
      byFrom.set(from, (byFrom.get(from) ?? 0) + (rate !== null && rate > 0 ? rate : 0));
      const ratio = num(r.sourcing_ratio);
      const ratios = inboundRatio.get(to)!;
      if (!ratios.has(from)) ratios.set(from, []);
      if (ratio !== null && ratio >= 0) ratios.get(from)!.push(ratio);
    } else if (kind === "bom") {
      if (!requires.has(to)) requires.set(to, new Set());
      requires.get(to)!.add(from);
    } else {
      demandSeen.add(from);
      const w = num(r.weighted);
      demand.set(from, (demand.get(from) ?? 0) + (w !== null && w > 0 ? w : 0));
    }
  }

  if (unknownKind > 0) {
    substitutions.push({
      code: "edge_kind_unknown",
      meaning:
        "lane rows whose data_source is not inbound, bom or outbound were left out of the graph",
      count: unknownKind,
    });
  }

  // ── 2 · Supply shares into each material ────────────────────────────────
  // By weekly volume, summed across plants; else the ETL's own sourcing_ratio;
  // else an equal split. The last two are substitutions and are counted.
  const share = new Map<string, Map<string, number>>(); // to → from → share
  let shareFallbacks = 0;
  for (const [to, byFrom] of inboundRate) {
    const total = [...byFrom.values()].reduce((s, v) => s + v, 0);
    const shares = new Map<string, number>();
    if (total > 0) {
      for (const [from, v] of byFrom) shares.set(from, v / total);
    } else {
      const ratios = inboundRatio.get(to)!;
      const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
      const known = [...ratios.entries()].filter(([, xs]) => xs.length > 0);
      const knownTotal = known.reduce((s, [, xs]) => s + mean(xs), 0);
      if (known.length === ratios.size && knownTotal > 0) {
        for (const [from, xs] of known) shares.set(from, mean(xs) / knownTotal);
      } else {
        for (const from of byFrom.keys()) shares.set(from, 1 / byFrom.size);
      }
      shareFallbacks++;
    }
    share.set(to, shares);
  }
  if (shareFallbacks > 0) {
    substitutions.push({
      code: "sourcing_share_missing",
      meaning:
        "materials with no weekly inbound volume: supplier shares taken from sourcing_ratio, or split equally when that was missing too",
      count: shareFallbacks,
    });
  }

  // ── 3 · Finished-goods demand ────────────────────────────────────────────
  const products = [...demandSeen].sort();
  const totalDemand = products.reduce((s, p) => s + (demand.get(p) ?? 0), 0);
  let demandBasis: CriticalNodeResult["demand_basis"] = "weekly_volume";
  const weightOf = new Map<string, number>();
  if (totalDemand > 0) {
    for (const p of products) weightOf.set(p, (demand.get(p) ?? 0) / totalDemand);
  } else if (products.length > 0) {
    demandBasis = "equal_per_product";
    for (const p of products) weightOf.set(p, 1 / products.length);
    substitutions.push({
      code: "demand_volume_missing",
      meaning:
        "no outbound lane carries a weekly volume, so every finished product is weighted equally",
      count: products.length,
    });
  }

  // ── 4 · A topological order, so loss propagates in one pass ─────────────
  const ids = [...nodes].sort();
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [, tos] of out) for (const t of tos) indeg.set(t, (indeg.get(t) ?? 0) + 1);
  const order: string[] = [];
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const t of [...(out.get(id) ?? [])].sort()) {
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  if (order.length < ids.length) {
    const placed = new Set(order);
    const cyclic = ids.filter((id) => !placed.has(id));
    substitutions.push({
      code: "cycle_in_lane_graph",
      meaning:
        "nodes on a cycle were propagated in id order after the acyclic part, so loss through the cycle is counted once",
      count: cyclic.length,
    });
    order.push(...cyclic);
  }
  const position = new Map(order.map((id, i) => [id, i]));

  // Reverse adjacency per edge kind, for the propagation rule.
  const shareIn = new Map<string, Array<[string, number]>>(); // material ← (supplier, share)
  for (const [to, shares] of share) shareIn.set(to, [...shares.entries()]);
  const requireIn = requires; // product ← materials

  // ── 5 · Demand at risk, per node ────────────────────────────────────────
  const reachableFrom = (start: string): string[] => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      for (const t of out.get(id) ?? []) if (!seen.has(t)) { seen.add(t); stack.push(t); }
    }
    return [...seen].sort((a, b) => position.get(a)! - position.get(b)!);
  };

  const risk = new Map<string, { dar: number; affected: number }>();
  for (const n of ids) {
    const loss = new Map<string, number>([[n, 1]]);
    for (const v of reachableFrom(n)) {
      if (v === n) continue;
      let shareLoss = 0;
      for (const [u, s] of shareIn.get(v) ?? []) shareLoss += s * (loss.get(u) ?? 0);
      let reqLoss = 0;
      for (const u of requireIn.get(v) ?? []) reqLoss = Math.max(reqLoss, loss.get(u) ?? 0);
      const l = Math.min(1, Math.max(shareLoss, reqLoss));
      if (l > 0) loss.set(v, l);
    }
    let dar = 0;
    let affected = 0;
    for (const p of products) {
      const l = loss.get(p) ?? 0;
      if (l > 0) {
        affected++;
        dar += (weightOf.get(p) ?? 0) * l;
      }
    }
    risk.set(n, { dar: Math.min(1, dar), affected });
  }

  // ── 6 · Sole sources ────────────────────────────────────────────────────
  const soleSourceOf = new Map<string, string[]>();
  for (const [material, shares] of share) {
    for (const [supplier, s] of shares) {
      if (s >= SOLE_SOURCE_SHARE) {
        if (!soleSourceOf.has(supplier)) soleSourceOf.set(supplier, []);
        soleSourceOf.get(supplier)!.push(material);
      }
    }
  }

  // ── 7 · Directed betweenness (Brandes, unweighted) — the tie-breaker ────
  const betweenness = brandesBetweenness(ids, out);

  // ── 8 · Rank and classify ───────────────────────────────────────────────
  const ranked = ids
    .filter((id) => risk.get(id)!.dar > 0)
    .sort((a, b) =>
      risk.get(b)!.dar - risk.get(a)!.dar ||
      betweenness.get(b)! - betweenness.get(a)! ||
      (a < b ? -1 : a > b ? 1 : 0)
    );
  const rankOf = new Map(ranked.map((id, i) => [id, i + 1]));

  const scored: NodeScore[] = ids.map((id) => {
    const { dar, affected } = risk.get(id)!;
    return {
      node_id: id,
      score: Math.round(dar * 10000) / 10000,
      is_critical: dar > 0 && dar >= threshold,
      rank: rankOf.get(id) ?? null,
      products_affected: affected,
      sole_source_of: (soleSourceOf.get(id) ?? []).sort(),
      betweenness: Math.round(betweenness.get(id)! * 10000) / 10000,
    };
  });

  return {
    method: CRITICAL_NODES_METHOD,
    threshold,
    demand_basis: demandBasis,
    nodes: scored,
    products: products.length,
    substitutions,
  };
}

/**
 * Exact directed betweenness (Brandes 2001), normalized by (n − 1)(n − 2).
 * The network-metrics analyzer's version samples the first 50 sources, which
 * is an approximation that depends on row order; this one is exact.
 */
export function brandesBetweenness(
  ids: string[],
  out: Map<string, Set<string>>,
): Map<string, number> {
  const cb = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const s of ids) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>(ids.map((id) => [id, []]));
    const sigma = new Map<string, number>(ids.map((id) => [id, 0]));
    const dist = new Map<string, number>(ids.map((id) => [id, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue = [s];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++];
      stack.push(v);
      for (const w of out.get(v) ?? []) {
        if (dist.get(w)! < 0) {
          dist.set(w, dist.get(v)! + 1);
          queue.push(w);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }
    const delta = new Map<string, number>(ids.map((id) => [id, 0]));
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      }
      if (w !== s) cb.set(w, cb.get(w)! + delta.get(w)!);
    }
  }
  const n = ids.length;
  const norm = n > 2 ? (n - 1) * (n - 2) : 1;
  for (const id of ids) cb.set(id, cb.get(id)! / norm);
  return cb;
}
