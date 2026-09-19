/**
 * The echelon rule, on the client — Phase 8 / WP 8.3 / §4 D127.
 *
 * ── WHY THIS FILE EXISTS AT ALL, GIVEN WP 8.1 ──────────────────────────────
 *
 * WP 8.1 authored a node's echelon ONCE, in `node_list.echelon`, derived by
 * `classify_node_echelon`. That is the answer and `useGraphNodes` is how a page
 * reads it. **But it is not reachable yet**: `supabase-migrations.yml` is
 * `branches: [main]`, so the column does not exist in production until this work
 * merges — and until then a page that reads `echelon` renders nothing.
 *
 * So this is the SAME RULE, applied to the edge rows a page already has, and it is
 * deliberately a MIRROR rather than a second opinion:
 *
 *   * `echelonMirror.test.ts` parses `classify_node_echelon`'s own branch order out
 *     of its migration and fails if the order below differs. The two cannot drift
 *     without a red test naming the divergence.
 *   * The precedent is `ingest_normalize_at_promotion()`, which restates the
 *     generated unit module in SQL "because SQL cannot import the generated module"
 *     (`normalize-at-promotion`). This is the inverse direction, for the same
 *     reason: a page cannot call a plpgsql function on data it holds in memory.
 *
 * **It is not a ninth classifier.** The eight D127 counts each invent a DIFFERENT
 * rule from a different signal. This one implements the one rule, and a gate
 * compares it to the authority. When the migration reaches production the page
 * swaps its source to `useGraphNodes` and this file's only caller disappears.
 */
import type { Echelon } from './types';

/** One edge row as the lanes carry it. `level` is deliberately NOT read here. */
export interface LaneRow {
  from_location?: string | null;
  to_location?: string | null;
  data_source?: string | null;
}

/** One `bom_multi_level` row — the table that OWNS the BOM depth. */
export interface BomRow {
  material_id?: string | null;
  higher_level_component_id?: string | null;
  level?: number | null;
}

/** The lane roles a node holds. Six booleans, one pass over the rows. */
interface Roles {
  outboundTarget: boolean;   // a customer
  outboundSource: boolean;   // a product
  inboundSource: boolean;    // a supplier
  inboundTarget: boolean;    // a purchased material
  bomSource: boolean;        // consumed by something
  bomTarget: boolean;        // built from something
}

const clean = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * The priority order, and it is the whole rule.
 *
 * Mirrors `classify_node_echelon`'s branches in the same sequence. `plant` is not
 * reachable from lane rows alone — the plant appears in no lane as a node — so a
 * caller that knows the project's plant name passes it and the rule can answer.
 */
function echelonFor(r: Roles, isPlant: boolean): Echelon {
  const onlyOutboundTarget =
    r.outboundTarget && !r.outboundSource && !r.bomSource && !r.bomTarget && !r.inboundSource && !r.inboundTarget;
  const onlyInboundSource =
    r.inboundSource && !r.outboundTarget && !r.outboundSource && !r.bomSource && !r.bomTarget && !r.inboundTarget;

  if (onlyOutboundTarget) return 'customer';
  if (onlyInboundSource) return 'supplier';
  if (r.bomSource && r.bomTarget) return 'subassembly';
  if (r.outboundSource || r.bomTarget) return 'product';
  if (r.inboundTarget || r.bomSource) return 'material';
  if (r.outboundTarget) return 'customer';
  if (r.inboundSource) return 'supplier';
  if (isPlant) return 'plant';
  return 'unknown';
}

/** The branch order, exported so the mirror test can compare it to the SQL. */
export const ECHELON_PRIORITY: readonly Echelon[] = [
  'customer',      // outbound target and nothing else
  'supplier',      // inbound source and nothing else
  'subassembly',   // BOTH a BOM target and a BOM source
  'product',       // outbound source, or a BOM target that is not also a source
  'material',      // inbound target, or a BOM source
  'customer',      // an outbound target holding another role too
  'supplier',      // an inbound source holding another role too
  'plant',
  'unknown',
] as const;

export interface TypedFromLanes {
  echelon: Echelon;
  /** From `bom_multi_level`, never from the lane's `level` column (§4 D140). */
  bomDepth: number | null;
}

/**
 * Derive every node's echelon and BOM depth from the rows a page already holds.
 *
 * `bomRows` is what makes this worth doing rather than reading the lane's `level`:
 * §4 D140 — two live ETLs write that column by different rules, and the deployed one
 * stamps a LITERAL 2 on every `bom_multi_level` row. §15 measured a project whose
 * BOM is four levels deep and whose entire bom lane sits at level 2, so its 260
 * materials and 66 products rendered as one flat column. `bom_multi_level.level` is
 * the real depth and neither writer touches it.
 *
 * Pass `bomRows` empty and `bomDepth` is null everywhere — honestly unknown, not 0,
 * because answering an unknown depth with a number is §4 D134.
 */
export function typedNodesFromLanes(
  laneRows: readonly LaneRow[],
  bomRows: readonly BomRow[] = [],
  plantName?: string | null,
): Map<string, TypedFromLanes> {
  const roles = new Map<string, Roles>();
  const roleFor = (id: string): Roles => {
    let r = roles.get(id);
    if (!r) {
      r = { outboundTarget: false, outboundSource: false, inboundSource: false,
            inboundTarget: false, bomSource: false, bomTarget: false };
      roles.set(id, r);
    }
    return r;
  };

  for (const row of laneRows) {
    const lane = (row.data_source ?? '').toLowerCase();
    const from = clean(row.from_location);
    const to = clean(row.to_location);
    if (from) {
      const r = roleFor(from);
      if (lane === 'outbound') r.outboundSource = true;
      else if (lane === 'inbound') r.inboundSource = true;
      else if (lane === 'bom') r.bomSource = true;
    }
    if (to) {
      const r = roleFor(to);
      if (lane === 'outbound') r.outboundTarget = true;
      else if (lane === 'inbound') r.inboundTarget = true;
      else if (lane === 'bom') r.bomTarget = true;
    }
  }

  // MIN, mirroring `node_bom_depth`: a material used by two assemblies at different
  // depths has more than one true depth, and the shallowest says how close to a
  // finished product it sits. A node that is only ever a PARENT at level 1 is the
  // finished product — depth 0.
  const depth = new Map<string, number>();
  const note = (id: string | null, d: number) => {
    if (id === null || !Number.isFinite(d)) return;
    const prev = depth.get(id);
    if (prev === undefined || d < prev) depth.set(id, d);
  };
  for (const b of bomRows) {
    const lvl = Number(b.level);
    if (!Number.isFinite(lvl)) continue;
    note(clean(b.material_id), lvl);
    note(clean(b.higher_level_component_id), Math.max(lvl - 1, 0));
  }

  const plant = clean(plantName ?? null);
  const out = new Map<string, TypedFromLanes>();
  for (const [id, r] of roles) {
    out.set(id, { echelon: echelonFor(r, plant !== null && id === plant), bomDepth: depth.get(id) ?? null });
  }
  return out;
}
