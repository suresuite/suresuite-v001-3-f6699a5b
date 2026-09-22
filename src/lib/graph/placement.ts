/**
 * WHERE A NODE SITS AND WHAT IT IS — one rule for every page that draws the lanes.
 * Audit 2026-09-22 · F-09 · §4 D127.
 *
 * `/process-level-network` and `/interactive-network-space` drew the same project
 * and disagreed about the same node. The first derived type from the lane ROLES
 * (`typedNodesFromLanes`, the declared mirror of `classify_node_echelon`) and depth
 * from `bom_multi_level`; the second ran the integer ladder `getNodeTypeFromLevel`
 * over `supply_chain_data_multi_tier.level` — a column the deployed ETL stamped with
 * a literal 2 on every BOM row (§4 D140), so the ladder called every finished
 * product and sub-assembly a material.
 *
 * The rule lived INSIDE ProcessLevelNetwork's fetch, so the second page could not
 * reuse it and grew its own. It lives here now and both pages call it; the page
 * that disagreed has nothing left to disagree with. `placement.test.ts` feeds both
 * the literal-2 shape the audit measured and fails if a product comes back a
 * material.
 */
import { typedNodesFromLanes, type BomRow, type LaneRow } from './echelon';
import type { Echelon } from './types';

export interface PlacedNode {
  echelon: Echelon;
  /** From `bom_multi_level`; null outside the BOM, never substituted with 0 (§4 D134). */
  bomDepth: number | null;
  /**
   * The ordinate to lay the node out at: -1 customer, the BOM depth for anything in
   * the BOM, one beyond the deepest material a supplier feeds for a supplier. Only a
   * node with no role at all falls back to the lane's own `level`.
   */
  level: number;
}

export interface PlacementLaneRow extends LaneRow {
  level?: number | null;
}

/**
 * The legacy four-value vocabulary, DERIVED from the echelon — a mapping, not a
 * second rule, exactly as `classify_node_type` maps `classify_node_echelon` in SQL.
 * `subassembly` → material: a thing the plant builds AND consumes is input to
 * something else. `plant`/`unknown` → material only for legacy colour and filter
 * paths; every label a user reads goes through `labelForEchelon`.
 */
export function echelonToLegacyType(echelon: Echelon): 'supplier' | 'material' | 'product' | 'customer' {
  switch (echelon) {
    case 'customer': return 'customer';
    case 'product': return 'product';
    case 'supplier': return 'supplier';
    default: return 'material';
  }
}

/**
 * Every node named by the lanes, typed and placed.
 *
 * A supplier is in no BOM, so it has no depth of its own; it sits one step beyond the
 * deepest material it supplies. That is what both ETLs reached for with
 * `max_level + 1`, computed here from the real depth instead of the flattened copy.
 * A supplier feeding nothing in the BOM is placed one beyond the deepest material in
 * the project — a LAYOUT fallback; its `bomDepth` stays null.
 */
export function placeLaneNodes(
  laneRows: readonly PlacementLaneRow[],
  bomRows: readonly BomRow[] = [],
  plantName?: string | null,
): Map<string, PlacedNode> {
  const typed = typedNodesFromLanes(laneRows, bomRows, plantName);
  const depthOf = (id: string): number | null => typed.get(id)?.bomDepth ?? null;

  const deepestMaterialDepth = Math.max(0, ...[...typed.values()].map((v) => v.bomDepth ?? 0));
  const supplierOrdinate = new Map<string, number>();
  for (const row of laneRows) {
    if ((row.data_source ?? '').toLowerCase() !== 'inbound') continue;
    const supplier = (row.from_location ?? '').trim();
    if (!supplier) continue;
    const candidate = (depthOf((row.to_location ?? '').trim()) ?? deepestMaterialDepth) + 1;
    const prev = supplierOrdinate.get(supplier);
    if (prev === undefined || candidate > prev) supplierOrdinate.set(supplier, candidate);
  }

  // First row naming a node supplies its lane ordinate, deterministically — used only
  // for a node the rule cannot place (echelon unknown and no BOM depth).
  const laneLevel = new Map<string, number>();
  for (const row of laneRows) {
    for (const raw of [row.from_location, row.to_location]) {
      const id = (raw ?? '').trim();
      if (id && !laneLevel.has(id)) laneLevel.set(id, Number(row.level ?? 0));
    }
  }

  const out = new Map<string, PlacedNode>();
  for (const [id, lvl] of laneLevel) {
    const echelon = typed.get(id)?.echelon ?? 'unknown';
    const bomDepth = depthOf(id);
    const level =
      echelon === 'customer' ? -1
      : echelon === 'supplier' ? supplierOrdinate.get(id) ?? deepestMaterialDepth + 1
      : bomDepth ?? lvl;
    out.set(id, { echelon, bomDepth, level });
  }
  return out;
}
