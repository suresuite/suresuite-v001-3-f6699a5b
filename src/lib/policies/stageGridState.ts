/**
 * The stage grid's "never blank, never silent" rules — §4 D178.
 *
 * Two decisions the grid used to make implicitly, extracted so they are
 * TESTABLE (the shape `laneTruncation.ts` set: the displayable half of a
 * D-fix lives in a pure module, because importing the component pulls in the
 * Supabase browser client and this repo has no DOM test tooling):
 *
 *   1. What the empty <tbody> SAYS. "no supplier lines for this project" is a
 *      statement about the project's data, and it is FALSE when the rows are
 *      empty because a read failed or because a filter hid them. A blank body
 *      with no message at all is §5.3 T2 broken outright — the 2026-09-24
 *      Test_Simulation report ("completely blank grid") is what it looks like.
 *
 *   2. Whether the D177 BOM tree may render at all. The tree's structure comes
 *      exclusively from the derived deep lanes + the uploaded BOM rows; when
 *      it has neither, or its build throws, rendering "the tree" would show
 *      nothing while flat rows exist. The grid must fall back to the flat
 *      lanes AND say why, never silently show less than it has.
 */

export interface StageEmptyInput {
  /** The stage's noun for the true-empty message ("supplier", "customer", …). */
  stageLabel: string;
  /** Rows still loading — the loading row renders instead, so no message. */
  loading: boolean;
  /** The reason `useStageRows`' catch fired, naming the read that failed. */
  loadError: string | null;
  /** The hook's flat row count, before column filters. */
  totalRows: number;
  /** The row count after column filters — what the body would render. */
  filteredRows: number;
}

/**
 * The sentence the empty grid body must show, or null when rows will render.
 * Never returns an empty string for an empty body: every branch states WHY
 * the body is empty (T2 — substitution/absence is visible at the point of
 * display, not in a console).
 */
export function stageEmptyMessage(i: StageEmptyInput): string | null {
  if (i.loading || i.filteredRows > 0) return null;
  if (i.loadError) {
    return `lines could not be loaded — ${i.loadError}`;
  }
  if (i.totalRows > 0) {
    return `all ${i.totalRows} line(s) are hidden by the active filters — clear filters to see them`;
  }
  return `no ${i.stageLabel} lines for this project`;
}

export interface TreeStateInput {
  /** Tree view is available, chosen, and no column sort overrides it. */
  wanted: boolean;
  /** `buildBomTreeView` threw — the message (no error boundary protects it). */
  buildError: string | null;
  /** The built entries contain at least one root or node (real structure). */
  hasStructure: boolean;
  /** Flat rows that exist and would render in flat mode. */
  flatRowCount: number;
  /** The deep-lane read failed with this reason (`useStageRows.deepError`). */
  deepError: string | null;
}

/**
 * Why the tree view is NOT rendering although the user chose it — or null
 * when the tree may render. A non-null reason means the grid renders the
 * flat lanes and shows this sentence; the tree is never allowed to render
 * fewer materials than the flat set holds.
 */
export function treeFallbackReason(i: TreeStateInput): string | null {
  if (!i.wanted) return null;
  if (i.buildError) {
    return `the BOM tree failed to build (${i.buildError}) — showing the flat lanes instead`;
  }
  if (!i.hasStructure && i.flatRowCount > 0) {
    if (i.deepError) {
      return `the derived deep-tier lanes could not be read (${i.deepError}) — showing the flat lanes instead`;
    }
    return "the BOM tree has no derived structure yet (run Combine on the Data Manager) — showing the flat lanes instead";
  }
  return null;
}
