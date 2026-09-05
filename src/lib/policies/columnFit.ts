/**
 * Column-fit algorithm for StagePolicyTable — pure, no React, unit-testable.
 *
 * The grid folds low-priority columns as its box narrows, states what it
 * folded, and always meets its right edge. See
 * docs' design handoff (Table_and_column_alignment) for the five invariants
 * this holds:
 *  1. A <colgroup> is the only source of column width.
 *  2. Frozen-column `left` offsets must equal the rendered widths of the
 *     columns before them.
 *  3. The table fills its box without arithmetic (width:100% + min-width +
 *     the last <col> at width:auto).
 *  4. The outermost column carries no right rule; inputs are
 *     box-sizing:border-box with size={1} and min-width:0.
 *  5. Nothing is hidden silently — every fold is named and reversible.
 */
import type { PolicyFamily } from "./schemas";

/** Rendering + fit metadata attached to a stage column. */
export type FitKind =
  | "int" // integer, right-aligned, thousands-separated
  | "num" // decimal, right-aligned, fixed to `dec`
  | "toggle" // the one centred control column
  | "type" // inventory policy-type segmented control
  | "vector" // the "Replenishment parameters" cell
  | "chip" // enum shown as a chip (e.g. fg_safety_stock)
  | "text"; // id / enum as plain mono text, left-aligned

export interface FitCol {
  key: string;
  family: PolicyFamily;
  label: string;
  /** Second header line: unit, range, provenance note. Never part of `label`. */
  sub: string;
  /** Design width in px. The fit never scales it — it either fits or folds. */
  w: number;
  kind: FitKind;
  /** Decision fields. Folded only as a last resort (§1.4). */
  keep?: boolean;
  /** Fold order for non-keep columns, lowest first. Required unless `keep`. */
  prio?: number;
  align?: "left" | "right" | "center";
  /** Unit glyph rendered in a fixed gutter right of the number. */
  unit?: string;
  /** Decimal places for `kind: "num"`. */
  dec?: number;
  /** Engine-pending: rendered in the quiet ink. */
  quiet?: boolean;
  /** Default true. False for controls (a filter input over a toggle is noise). */
  filterable?: boolean;

  // set by the fit, read by the renderer
  compact?: boolean; // type control shows only its active option
  paramW?: number; // vector cell value width
  shortChip?: boolean; // chip shows its short code, full value on hover
  foldedFamily?: number; // this is a collapsed-family summary column
  wasKeep?: boolean; // folded despite keep (last resort)
}

export interface FitInput {
  cols: FitCol[];
  /** Width available to value columns = container width − 24 − keyAW − keyBW. */
  avail: number;
  collapsedFamilies: Record<string, boolean>;
  /** false = "show all columns", scroll horizontally. */
  enabled: boolean;
  /** viewport < 860px — shrinks the family summary column. */
  narrow: boolean;
}

export interface FitResult {
  visible: FitCol[];
  folded: FitCol[];
  /** true → last <col> gets width:auto so the table meets its right edge. */
  fills: boolean;
  /** Sum of key columns is added by the caller; this is the value columns only. */
  valueWidth: number;
}

const SHORT_SUB: Record<string, string> = {
  primary_source: "1 / mat.",
  material_price: "€ / u",
  sell_price: "€ / u",
  safety_stock_days: "days",
};

/** Family collapse: a collapsed family contributes exactly one summary column. */
function applyFamilyCollapse(
  cols: FitCol[],
  collapsed: Record<string, boolean>,
  narrow: boolean,
): FitCol[] {
  const order: PolicyFamily[] = [];
  for (const c of cols) if (!order.includes(c.family)) order.push(c.family);

  const out: FitCol[] = [];
  for (const family of order) {
    const own = cols.filter((c) => c.family === family);
    if (collapsed[family]) {
      out.push({
        key: `__fold_${family}`,
        family,
        label: family,
        sub: `${own.length} fields folded`,
        w: narrow ? 104 : 132,
        kind: "chip",
        keep: true,
        filterable: false,
        align: "left",
        foldedFamily: own.length,
      });
    } else {
      out.push(...own);
    }
  }
  return out;
}

const sum = (cs: FitCol[]) => cs.reduce((s, c) => s + c.w, 0);

export function fitColumns({
  cols,
  avail,
  collapsedFamilies,
  enabled,
  narrow,
}: FitInput): FitResult {
  const modelled = applyFamilyCollapse(cols, collapsedFamilies, narrow);

  if (!enabled) {
    return { visible: modelled, folded: [], fills: false, valueWidth: sum(modelled) };
  }

  let visible = modelled.slice();
  const folded: FitCol[] = [];

  // 1.1 — fold non-keep columns, lowest priority first.
  const byPrio = modelled
    .filter((c) => !c.keep)
    .sort((a, b) => (a.prio ?? 99) - (b.prio ?? 99));
  let i = 0;
  while (sum(visible) > avail && i < byPrio.length) {
    const drop = byPrio[i++];
    visible = visible.filter((c) => c.key !== drop.key);
    folded.push(drop);
  }

  // 1.2 — compact the protected controls before clipping anything.
  //       keepWidth is measured on `modelled` (pre-compaction) on purpose: the
  //       trigger is "this box is tight for this stage", not "it is tight now".
  const keepWidth = sum(modelled.filter((c) => c.keep));
  if (avail < keepWidth + 40) {
    visible = visible.map((c) => {
      if (c.key === "type") return { ...c, sub: "active ▾", w: 74, compact: true };
      if (c.key === "params" || c.key === "__inv_params")
        return { ...c, sub: "levels", w: 148, paramW: 42 };
      if (c.kind === "chip" && !c.foldedFamily) {
        return { ...c, sub: "sizing", w: 84, shortChip: true };
      }
      return { ...c, sub: SHORT_SUB[c.key] ?? c.sub };
    });
  }

  // 1.3 — last resort: no stage may be unfittable by construction. Protected
  //       columns fold too — widest first, then rightmost — but never the
  //       identity toggle, and never below three value columns.
  const byWidth = visible
    .filter((c) => c.keep && c.kind !== "toggle")
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => b.c.w - a.c.w || b.idx - a.idx);
  let k = 0;
  while (sum(visible) > avail && k < byWidth.length && visible.length > 3) {
    const drop = byWidth[k++].c;
    visible = visible.filter((c) => c.key !== drop.key);
    folded.push({ ...drop, wasKeep: true });
  }

  return { visible, folded, fills: sum(visible) < avail, valueWidth: sum(visible) };
}

/** Drawer copy. Keep the wording — it is what makes the fold non-silent. */
export function foldNote(folded: FitCol[]): string {
  const more = folded.length > 4 ? `+${folded.length - 4} more · ` : "";
  const keepWarning = folded.some((c) => c.wasKeep)
    ? "decision fields folded too — this box is narrower than the stage needs; "
    : "";
  return `${more}${keepWarning}widen the window, collapse a family, or show all columns`;
}
