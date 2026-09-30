/**
 * The network-lens desktop layout — adaptive columns, node size, search suggestions.
 *
 * Ported from the network-lenses desktop handoff (§3, §6, §9). The rules are the
 * spec; the prototype's code was not copied. Pure functions over ids and counts, so
 * they are testable without a renderer — the pages hand the result to React Flow.
 *
 * WHAT IT REPLACES. Both column pages split every class at a fixed 20 nodes per
 * sub-column with a fixed 60px row gap, whatever the canvas. A class of 9 products
 * spread over 480px and a class of 260 materials ran thirteen sub-columns wide while
 * the canvas height went unused. Here each class decides its own sub-columns from
 * its count and the height it actually has, and `fitView` does the rest.
 */

/** Space kept clear of the legend bar and the bottom overlays, in canvas px. */
export const LENS_LAYOUT = {
  top: 56,
  bottom: 70,
  subColumnGap: 12,
  rowGapSlack: 5,
  maxRowGapFactor: 1.6,
  sidePadding: 80,
  classGap: { min: 70, max: 200 },
} as const;

/**
 * The product-level node size, now the standard for product AND process (§3).
 * A function of the graph's node count, deliberately unchanged from the product
 * page so that page renders exactly as before.
 */
export function lensNodeSize(nodeCount: number): { width: number; height: number } {
  const n = Math.max(1, nodeCount);
  const width = Math.max(50 - Math.log(n) * 3, 30) * 1.05;
  return { width, height: width * 0.62 };
}

export interface LayoutColumn {
  /** Ids in the order they should be placed, top to bottom, left sub-column first. */
  ids: readonly string[];
  /** Offset alternate sub-columns by half a row — suppliers and materials only. */
  stagger?: boolean;
}

export interface LayoutOptions {
  canvasWidth: number;
  canvasHeight: number;
  nodeWidth: number;
  nodeHeight: number;
}

export interface ColumnPlan {
  subColumns: number;
  rows: number;
  rowGap: number;
  footprint: number;
}

/** How one class folds, from its count and the usable height (§6). */
export function planColumn(count: number, stagger: boolean, opts: LayoutOptions): ColumnPlan {
  const usableH = Math.max(opts.nodeHeight * 2, opts.canvasHeight - LENS_LAYOUT.top - LENS_LAYOUT.bottom);
  const minRowGap = opts.nodeHeight + LENS_LAYOUT.rowGapSlack;
  const maxRowGap = Math.max(minRowGap, opts.nodeHeight * LENS_LAYOUT.maxRowGapFactor);
  const maxRows = Math.floor(usableH / minRowGap) + 1;
  const subColumns = Math.max(1, Math.ceil(count / maxRows));
  const rows = Math.ceil(count / subColumns);
  const staggered = stagger && subColumns > 1;
  const rowGap = rows > 1 ? Math.min(maxRowGap, usableH / (rows - 1 + (staggered ? 0.5 : 0))) : 0;
  const footprint = (subColumns - 1) * (opts.nodeWidth + LENS_LAYOUT.subColumnGap) + opts.nodeWidth;
  return { subColumns, rows, rowGap, footprint };
}

/**
 * Top-left positions for every id in `columns`, left to right.
 *
 * Empty classes take no width. Each sub-column is centred vertically on its own
 * count, the whole block is centred horizontally, and the gap between classes
 * shares whatever width is left, clamped to 70–200px.
 */
export function adaptiveColumnLayout(
  columns: readonly LayoutColumn[],
  opts: LayoutOptions,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const present = columns.filter((c) => c.ids.length > 0);
  if (present.length === 0) return out;

  const plans = present.map((c) => planColumn(c.ids.length, !!c.stagger, opts));
  const sumFootprint = plans.reduce((a, p) => a + p.footprint, 0);
  const classGap =
    present.length > 1
      ? Math.max(
          LENS_LAYOUT.classGap.min,
          Math.min(
            LENS_LAYOUT.classGap.max,
            (opts.canvasWidth - LENS_LAYOUT.sidePadding - sumFootprint) / (present.length - 1),
          ),
        )
      : 0;
  const usableH = Math.max(opts.nodeHeight * 2, opts.canvasHeight - LENS_LAYOUT.top - LENS_LAYOUT.bottom);
  const midY = LENS_LAYOUT.top + usableH / 2;

  let x = (opts.canvasWidth - (sumFootprint + classGap * (present.length - 1))) / 2;
  present.forEach((col, ci) => {
    const { subColumns, rows, rowGap, footprint } = plans[ci];
    const cx = x + footprint / 2;
    const count = col.ids.length;
    const staggered = !!col.stagger && subColumns > 1;
    col.ids.forEach((id, i) => {
      const si = i % subColumns;
      const row = Math.floor(i / subColumns);
      const nx = cx + (si - (subColumns - 1) / 2) * (opts.nodeWidth + LENS_LAYOUT.subColumnGap);
      // A staggered class is centred as ONE block, so alternate sub-columns sit
      // exactly half a row apart. Centring each on its own count would add another
      // half row whenever the counts differ by one and undo the stagger.
      const ny = staggered
        ? midY - ((rows - 1) * rowGap + rowGap / 2) / 2 + row * rowGap + (si % 2 === 1 ? rowGap / 2 : 0)
        : midY - ((Math.ceil((count - si) / subColumns) - 1) * rowGap) / 2 + row * rowGap;
      out.set(id, { x: nx - opts.nodeWidth / 2, y: ny - opts.nodeHeight / 2 });
    });
    x += footprint + classGap;
  });
  return out;
}

export interface SuggestionCandidate {
  id: string;
  /** What the user types against: the node id, or a firm's name. */
  label: string;
}

/**
 * The search dropdown (§9): case-insensitive CONTAINS on the label, over the set
 * passed in (the caller passes the VISIBLE set, so it works inside a focus), at
 * most `max` rows, in the order given.
 */
export function nodeSuggestions<T extends SuggestionCandidate>(
  candidates: readonly T[],
  term: string,
  max = 8,
): T[] {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const out: T[] = [];
  for (const c of candidates) {
    if (c.label.toLowerCase().includes(q)) {
      out.push(c);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** True when the term already names a candidate exactly — the list then hides. */
export function isExactHit(candidates: readonly SuggestionCandidate[], term: string): boolean {
  const t = term.trim();
  return t !== '' && candidates.some((c) => c.label === t);
}
