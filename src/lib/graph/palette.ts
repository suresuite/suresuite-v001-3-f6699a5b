/**
 * ONE palette — Phase 8 / WP 8.3 / §4 D119.
 *
 * There were FIVE before this file, and they disagreed about every colour:
 *
 *   ProductLevelNetwork   A/B/C/D  green / yellow / blue / orange
 *   ProcessLevelNetwork   by type  green / orange / blue, materials in HSL
 *   FirmLevelNetwork      by tier  its own four
 *   InteractiveNetwork    by level eight hex values keyed on the `level` column
 *   MapView               by type  HSL, deliberately different from the graph's hex
 *
 * So the same firm was four colours on four screens, and a user reasonably
 * concluded the four screens were about four different things. Colour encodes
 * CATEGORY, the category is the echelon, and there is one of each.
 *
 * `onePalette.test.ts` fails if a colour literal appears in a network page again.
 */
import type { Echelon } from './types';

/**
 * Category colours, one per echelon.
 *
 * Chosen so the chain reads left to right as it flows and so no two adjacent
 * echelons are confusable at 8px, which is the size a node renders at on a
 * 600-node graph. `unknown` is deliberately GREY and deliberately not pretty: a
 * node whose role the data does not carry should look like a gap, not like a
 * category (T1). Nothing here defaults — `colorForEchelon(null)` is the same grey
 * as `unknown`, because "never derived" and "unplaceable" both mean "we are not
 * telling you something we do not know".
 */
export const ECHELON_COLOR: Record<Echelon, string> = {
  supplier: '#22c55e',      // green   — upstream, where material enters
  material: '#facc15',      // yellow  — purchased input
  subassembly: '#f59e0b',   // amber   — built AND consumed; between the two above
  plant: '#8b5cf6',         // violet  — the focal firm, distinct from both sides
  product: '#3b82f6',       // blue    — what ships
  customer: '#fb923c',      // orange  — downstream demand
  unknown: '#9ca3af',       // grey    — a gap, not a category
};

/** The label a user reads. Never an engine name, never a level number. */
export const ECHELON_LABEL: Record<Echelon, string> = {
  supplier: 'Supplier',
  material: 'Material',
  subassembly: 'Sub-assembly',
  plant: 'Plant',
  product: 'Product',
  customer: 'Customer',
  unknown: 'Unknown',
};

/** Neutral greys, so a page never writes a hex value of its own. */
export const GRAPH_INK = {
  edge: '#8C8C8C',
  edgeHighlight: '#3b82f6',
  nodeBorder: '#ffffff',
  nodeText: '#111827',
  dimmed: '#d1d5db',
} as const;

/**
 * The colour for a node's role. `null` maps to the `unknown` grey rather than to
 * a default category — `ProductLevelNetwork` currently defaults an unrecognised
 * node to **Supplier**, which is a value displayed for data that does not carry
 * it (T1).
 */
export function colorForEchelon(echelon: Echelon | null): string {
  return echelon ? ECHELON_COLOR[echelon] : ECHELON_COLOR.unknown;
}

/** The label for a node's role, with the same rule for `null`. */
export function labelForEchelon(echelon: Echelon | null): string {
  return echelon ? ECHELON_LABEL[echelon] : ECHELON_LABEL.unknown;
}
