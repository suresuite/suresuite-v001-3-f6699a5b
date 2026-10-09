/**
 * One edge per lane pair, its weight SUMMED — §4 D306.
 *
 * Both lane tables are written by one demand walk (`rebuild_supply_chain_lanes`), and
 * `weighted` is the flow that walk puts on ONE ROW. A drawn edge can stand for several
 * rows: the deep lane writes a BOM edge once per ROOT product it serves (`path_root`),
 * and every lane writes a pair once per PLANT. The flow through the drawn edge is the
 * sum of those rows — the material is needed for every product it ends up in.
 *
 * Both network pages used to keep the FIRST row per pair and drop the rest. The read
 * RPC orders by `bom_depth, created_at, id`, every row of a rebuild is inserted in one
 * statement, so `created_at` ties and the tie breaks on a random uuid: a shared
 * component's edge showed one root's share, and which root was arbitrary.
 *
 * This is the one place a drawn edge's weight is computed, and the one place its label
 * is formatted, so the Product-level and Process-level views cannot disagree about the
 * same number.
 */

/** A lane row, as either read RPC returns it. */
export interface LaneEdgeRow {
  from_location: string | null;
  to_location: string | null;
  data_source?: string | null;
  plant_name?: string | null;
  weighted?: number | null;
  material_consumption_rate?: number | null;
}

export interface SummedLaneEdge {
  source: string;
  target: string;
  /** Σ `weighted` over every row this edge stands for. */
  flow: number;
  /**
   * The edge's `material_consumption_rate`, counted ONCE PER PLANT. Rows for different
   * root products of one plant repeat the same rate — it is a property of the BOM edge,
   * not of the root — so summing them would multiply it by the number of roots.
   */
  consumptionRate: number;
  /** The lane of the first row read for the pair. */
  lane: string;
  /** How many rows were summed into this edge. */
  rows: number;
}

const finite = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);

/**
 * Group lane rows into drawn edges. A blank endpoint and a self-loop are not edges.
 * The result is in first-seen order, and its numbers do not depend on row order.
 */
export function sumLaneEdges(rows: readonly LaneEdgeRow[]): SummedLaneEdge[] {
  const byPair = new Map<string, SummedLaneEdge & { ratePlants: Set<string> }>();

  for (const r of rows) {
    const source = (r.from_location ?? '').trim();
    const target = (r.to_location ?? '').trim();
    if (!source || !target || source === target) continue;

    const key = `${source}\u0000${target}`;
    let e = byPair.get(key);
    if (!e) {
      e = {
        source,
        target,
        flow: 0,
        consumptionRate: 0,
        lane: (r.data_source ?? '').toLowerCase(),
        rows: 0,
        ratePlants: new Set(),
      };
      byPair.set(key, e);
    }

    e.rows++;
    e.flow += finite(r.weighted);
    const plant = (r.plant_name ?? '').trim();
    if (!e.ratePlants.has(plant)) {
      e.ratePlants.add(plant);
      e.consumptionRate += finite(r.material_consumption_rate);
    }
  }

  return [...byPair.values()].map(({ ratePlants: _ratePlants, ...edge }) => edge);
}

/**
 * The text an edge carries: its weekly flow, rounded, with thousands separators.
 * Blank for no flow — the arc is still drawn, at the minimum width (`edgeWidthForFlow`).
 * A positive flow too small to round to 1 says `<1` rather than a misleading `0`.
 */
export function flowLabel(flow: number): string {
  if (!Number.isFinite(flow) || flow <= 0) return '';
  const rounded = Math.round(flow);
  return rounded === 0 ? '<1' : rounded.toLocaleString('en-US');
}
