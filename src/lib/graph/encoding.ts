/**
 * Visual encoding — Phase 8 / WP 8.3.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: every visual channel carries data, or it
 * is constant and the legend says so. An encoding that varies without carrying
 * information is a lie the user spends attention on.
 *
 * What was wrong before it:
 *
 *   SIZE   both network pages computed
 *          `Math.max(50 - Math.log(nodeCount) * 3, 30) * 1.05` — a function of the
 *          GRAPH'S node count. Every node in a graph got the same size, and that
 *          size changed when an unrelated node was added. Degree, flow and every
 *          centrality were ignored.
 *   WIDTH  flat 1.5 at 0.6 opacity on every edge, on both pages. `weighted` was
 *          loaded, stored on the edge, and never rendered.
 *   DEPTH  shaded on one page only, keyed on `supply_chain_data_multi_tier.level`,
 *          which two live writers disagree about (§4 D125) — so the ramp read a
 *          4-deep BOM as flat on the project a user reported.
 */
import type { Echelon, GraphEdge, GraphNode } from './types';

/** Size in px. Constant when nothing was chosen, so the legend can say "uniform". */
export const NODE_SIZE = { min: 18, max: 56, uniform: 30 } as const;

/** Edge stroke width in px. */
export const EDGE_WIDTH = { min: 1, max: 6, uniform: 1.5 } as const;

/**
 * Node diameter from a metric, scaled across the values actually present.
 *
 * AREA, not diameter, is proportional to the value — a diameter-linear scale makes
 * a 4× value look 16× bigger, which is the most common way a network view
 * overstates its own findings. `sqrt` is the correction and it is not optional.
 *
 * Returns `NODE_SIZE.uniform` when there is nothing to encode: no metric chosen, a
 * null value, or a domain with no spread. **A node whose metric is null is not
 * drawn small** — small would mean "a low value", and null means "no value". The
 * caller marks it instead (see `isMetricMissing`).
 */
export function sizeForMetric(
  value: number | null,
  domain: { min: number; max: number } | null,
): number {
  if (value === null || !Number.isFinite(value)) return NODE_SIZE.uniform;
  if (!domain || !Number.isFinite(domain.min) || !Number.isFinite(domain.max)) {
    return NODE_SIZE.uniform;
  }
  const span = domain.max - domain.min;
  if (span <= 0) return NODE_SIZE.uniform;
  const t = Math.min(1, Math.max(0, (value - domain.min) / span));
  const areaScaled = Math.sqrt(t);
  return NODE_SIZE.min + areaScaled * (NODE_SIZE.max - NODE_SIZE.min);
}

/** True when a node has no value for the chosen metric, so the page can say so. */
export function isMetricMissing(node: Pick<GraphNode, 'metric'>): boolean {
  return node.metric === null || !Number.isFinite(node.metric);
}

/** The observed range of a metric, or `null` when nothing carries one. */
export function metricDomain(nodes: ReadonlyArray<Pick<GraphNode, 'metric'>>): { min: number; max: number } | null {
  const values = nodes
    .map((n) => n.metric)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Edge width from the flow it carries. Log-scaled, because supply flows span
 * orders of magnitude and a linear scale renders every edge but the largest as a
 * hairline — which is how a flat 1.5 came to look acceptable.
 *
 * Zero and negative flow return `EDGE_WIDTH.min` rather than nothing: a zero-flow
 * arc is a real finding (§4 D2/D3's "rows that reached the grid weighted 0") and
 * hiding it would be the opposite of disclosing it.
 */
export function edgeWidthForFlow(flow: number, maxFlow: number): number {
  if (!Number.isFinite(flow) || flow <= 0) return EDGE_WIDTH.min;
  if (!Number.isFinite(maxFlow) || maxFlow <= 0) return EDGE_WIDTH.uniform;
  const t = Math.log1p(flow) / Math.log1p(maxFlow);
  return EDGE_WIDTH.min + Math.min(1, Math.max(0, t)) * (EDGE_WIDTH.max - EDGE_WIDTH.min);
}

/** The largest flow on any edge, for `edgeWidthForFlow`'s domain. */
export function maxFlow(edges: ReadonlyArray<Pick<GraphEdge, 'flow'>>): number {
  return edges.reduce((m, e) => (Number.isFinite(e.flow) ? Math.max(m, e.flow) : m), 0);
}

/**
 * A lightness shade for BOM depth, within one echelon's colour.
 *
 * Depth is an ORDERED quantity inside a category, so it is a lightness ramp and
 * not a second hue — using hue would claim a category change the data does not
 * have. Returns a CSS `color-mix` against white, so the base stays whatever
 * `palette.ts` says and this file holds no colour of its own.
 *
 * `null` depth returns the base colour unmixed: an unknown depth must not read as
 * a particular depth, which is exactly what `COALESCE(level, 0)` does in SQL
 * (§4 D119).
 */
export function depthShade(baseColor: string, depth: number | null, maxDepth: number): string {
  if (depth === null || !Number.isFinite(depth) || maxDepth <= 0) return baseColor;
  const t = Math.min(1, Math.max(0, depth / maxDepth));
  // 0 % at the top of the tree, 55 % white at the bottom — enough separation to
  // read at 8px without the deepest level washing out to unreadable.
  const white = Math.round(t * 55);
  return `color-mix(in srgb, ${baseColor} ${100 - white}%, white ${white}%)`;
}

/**
 * Structural column for a node, left to right along the flow.
 *
 * Derived from the ECHELON, never from `supply_chain_data_multi_tier.level`. That
 * is the single change that fixes the map a user reported: the level column is a
 * literal 2 for every BOM row on that project (§4 D125), so a 4-deep BOM rendered
 * as one flat column of 260 materials and 66 products. The echelon is read from
 * `node_list` and the depth from `bom_multi_level`, and neither is affected.
 */
export function columnForNode(
  node: Pick<GraphNode, 'echelon' | 'bomDepth'>,
  order: Record<Echelon, number>,
  maxDepth: number,
): number {
  const base = node.echelon ? order[node.echelon] : order.unknown;
  // Within the material/subassembly band, depth orders the sub-columns — so a
  // multi-level BOM reads as a tree rather than as a wall.
  if ((node.echelon === 'material' || node.echelon === 'subassembly') && node.bomDepth !== null) {
    const clamped = Math.min(Math.max(node.bomDepth, 0), Math.max(maxDepth, 1));
    return base + clamped / (Math.max(maxDepth, 1) + 1);
  }
  return base;
}
