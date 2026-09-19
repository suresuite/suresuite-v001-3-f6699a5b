/**
 * The graph layer's vocabulary — Phase 8 / WP 8.3 / §4 D119.
 *
 * WHY THIS FILE EXISTS. Four network pages, a map component, one SQL function and
 * the engine each decided independently what a node IS, and they disagreed by
 * construction: none of them read a type, they each inferred one at render time
 * from a different signal. `supply_chain_data.from_location`'s own contract says
 * why that can never be made safe — it is "a supplier, a material, or the plant,
 * depending on which lane produced it".
 *
 * WP 8.1 authored the answer once, in the data: `node_list.echelon`, derived by
 * `classify_node_echelon`, CHECK-constrained to the seven values below. This file
 * is the TypeScript side of that one declaration. It is not a second copy of the
 * rule — there is no rule here, only the vocabulary the database enforces and the
 * shape a page reads it in.
 *
 * The seven values and their order are the CHECK constraint on
 * `public.node_list.echelon`. If this union and that constraint ever disagree, the
 * constraint is right.
 */

/**
 * A node's ROLE in the supply chain. A role, not a depth — that distinction is
 * the whole of D119: a BOM three levels deep does not mean three tiers of
 * suppliers, and a tier-2 supplier is not "a material at level 2".
 *
 * `unknown` is a real value and is NOT the same as an absent one. The database
 * keeps the same distinction: NULL means the echelon was never derived, `unknown`
 * means it was derived and the node could not be placed. Rendering the second as
 * a guess is what T1 forbids, and defaulting an unrecognised node to `supplier`
 * is what `ProductLevelNetwork` does today.
 */
export const ECHELONS = [
  'customer',
  'product',
  'subassembly',
  'material',
  'supplier',
  'plant',
  'unknown',
] as const;

export type Echelon = (typeof ECHELONS)[number];

/** Narrow an arbitrary string from the database without inventing a default. */
export function asEchelon(value: string | null | undefined): Echelon | null {
  if (!value) return null;
  return (ECHELONS as readonly string[]).includes(value) ? (value as Echelon) : null;
}

/**
 * The order the chain runs in, outside-in from supply to demand. Used for column
 * position and for sorting a legend, and it is the ONLY place that order is
 * written down — `ProcessLevelNetwork` sorts its legend by `level`, which is the
 * column D119 is about.
 *
 * `plant` sits between what it consumes and what it ships; `unknown` sorts last
 * so an unplaceable node is visibly at the end rather than silently mixed in.
 */
export const ECHELON_ORDER: Record<Echelon, number> = {
  supplier: 0,
  material: 1,
  subassembly: 2,
  plant: 3,
  product: 4,
  customer: 5,
  unknown: 6,
};

/**
 * A node of a project's supply graph, as the pages read it.
 *
 * IDENTITY IS `{ echelon, id }` AND NOT `id` ALONE. §4 D123: the id is a bare
 * string shared by three semantically different lanes, so a firm that both
 * supplies the plant and buys from it collapses into one node and the graph
 * acquires a cycle the real network does not have. §15 measured zero such firms in
 * production today (run 35433474185), which is why WP 8.1 did not spend a
 * migration on making the database key compound — but a page that carries the
 * role beside the id can tell them apart the day one appears, and one that
 * carries only the id never can.
 */
export interface GraphNode {
  /** The node id as the edge tables spell it. Not unique across roles — see above. */
  id: string;
  /** What the node IS, read from `node_list.echelon`. `null` = never derived. */
  echelon: Echelon | null;
  /** Display label. Usually the id; a name where the data carries one. */
  label: string;
  /**
   * Depth in the BOM tree, from `node_list.bom_depth` — `bom_multi_level.level`,
   * the table that owns the measurement. `null` for a node in no BOM.
   *
   * NOT `supply_chain_data_multi_tier.level`, which two live writers disagree
   * about (§4 D132) and one of which discards the real depth for a literal 2.
   */
  bomDepth: number | null;
  /** Tiers upstream of the plant, from `node_list.supply_tier`. `null` = unknown. */
  supplyTier: number | null;
  /** Edge count in, out, and total flow through — computed from the edge list. */
  inDegree: number;
  outDegree: number;
  flow: number;
  /**
   * A metric a user chose to size by, or `null`. Kept separate from the
   * structural fields because SIZE ENCODES MAGNITUDE and nothing else: both
   * network pages currently size every node by a function of the graph's own node
   * count, which carries no data about the node at all.
   */
  metric: number | null;
}

/** A directed, weighted edge. Direction is load-bearing: the lanes are directed. */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** `weighted` from the lane tables — the flow this edge carries. */
  flow: number;
  /** Which lane produced it: `inbound`, `bom` or `outbound`. */
  lane: string;
}
