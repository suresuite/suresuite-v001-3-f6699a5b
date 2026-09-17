/**
 * THE REVIEW SCREEN'S LOGIC, WITH NO REACT IN IT (Phase 3 / WP 3.4, PLAN.md §10).
 *
 * Everything here is a pure function of a run and its staged rows, because the
 * claims this package makes are claims a test has to be able to check: that the
 * five counts partition the file, that a row has exactly one of three states,
 * that a NULL `diff_state` is rendered as "not computed" and never as "new", and
 * that the ONE component serving both sources branches on `source_kind` for
 * labels and nothing else (§10's gap check for this package: any branch beyond
 * labels means WP 3.1 was incomplete).
 *
 * THE VOCABULARY IS NOT INVENTED HERE. `MappingWarningsCard`
 * (src/components/sim/RunProgressPanel.tsx) already renders a `[{level, ...}]`
 * findings list with error / warn / info badges, and `ingest_staged_rows.findings`
 * was given that exact shape by WP 3.2 so this screen could reuse it. What is
 * added is the DIFF vocabulary, which that card has no concept of.
 */

/** The four `ingest_staged_rows.diff_state` tokens, plus the honest fifth state. */
export type DiffState = "new" | "changed" | "unchanged" | "removed_upstream";

/**
 * A finding, exactly as `ingest_runs.mapping_warnings`, `ingest_staged_rows.findings`
 * and scsim's MappingWarning all spell it.
 */
export interface Finding {
  level: "error" | "warn" | "warning" | "info";
  field?: string | null;
  code?: string;
  message: string;
  row?: number;
}

export interface StagedRow {
  id: string;
  source_row_number: number;
  raw: Record<string, unknown>;
  parsed: Record<string, unknown>;
  findings: Finding[];
  diff_state: DiffState | null;
  target_table: string;
}

export interface IngestRun {
  id: string;
  project_id: string;
  source_kind: string;
  status: string;
  rows_new: number;
  rows_changed: number;
  rows_unchanged: number;
  rows_removed: number;
  rows_held: number;
  rows_superseded: number;
  mapping_warnings: Finding[] | null;
  applied_at: string | null;
}

export interface IngestFile {
  id: string;
  original_filename: string | null;
  content_sha256: string | null;
  byte_size: number | null;
  uploaded_by: string | null;
}

/**
 * THE THREE ROW STATES, and there are three rather than two because WP 3.3 added
 * the middle one: a file that repeats an arc promotes the LATER line and marks
 * the earlier one (§16 · WP 3.3 · F). So a row is promoted, held back with an
 * error, or promoted-but-superseded-by-a-later-line-of-the-same-file.
 */
export type RowState = "promoted" | "held" | "superseded";

export const SUPERSEDED_CODE = "superseded_by_later_line";

const isError = (f: Finding) => f.level === "error";
const isSuperseded = (f: Finding) => f.code === SUPERSEDED_CODE;

export function rowState(row: Pick<StagedRow, "findings">): RowState {
  const findings = row.findings ?? [];
  if (findings.some(isError)) return "held";
  if (findings.some(isSuperseded)) return "superseded";
  return "promoted";
}

/** The finding that explains a non-promoted row, so the screen never says "see findings". */
export function rowReason(row: Pick<StagedRow, "findings">): Finding | null {
  const findings = row.findings ?? [];
  return findings.find(isError) ?? findings.find(isSuperseded) ?? null;
}

/**
 * WHAT A `diff_state` MEANS ON SCREEN — and the NULL case is the point of this
 * whole package. Until WP 3.4 the column was `NOT NULL DEFAULT 'new'` and
 * nothing ever wrote it, so a screen reading it would have rendered "new" for
 * every row including the ones an upsert updated (PLAN.md §4 D62). A null now
 * means the diff has not been computed, and that is what it says.
 */
export const DIFF_LABEL: Record<DiffState, string> = {
  new: "new",
  changed: "changed",
  unchanged: "unchanged",
  removed_upstream: "removed upstream",
};

export const DIFF_HELP: Record<DiffState, string> = {
  new: "No row in this project carries this natural key yet — promoting inserts it.",
  changed: "A row with this natural key exists and at least one value differs — promoting overwrites it.",
  unchanged: "A row with this natural key exists and every value matches — promoting rewrites it identically.",
  removed_upstream:
    "Present in the project and absent from the source. Never promoted: a source dropping a row is not authority to delete it.",
};

export function diffLabel(state: DiffState | null | undefined): string {
  return state ? DIFF_LABEL[state] : "not compared";
}

export function diffHelp(state: DiffState | null | undefined): string {
  return state
    ? DIFF_HELP[state]
    : "This row has not been compared with the project's data. A row held back by an error " +
        "may have failed on one of the key fields, so there is nothing to compare it against. " +
        "Unknown, not new.";
}

/**
 * LABELS, AND NOTHING ELSE, KEYED BY `source_kind`. §10's gap check for this
 * package: "any branch on `source_kind` beyond labels means WP 3.1 was
 * incomplete." WP 3.1 made the tables source-agnostic and WP 3.2 and WP 3.3
 * added no branch; this map is the whole of what one costs here, and
 * `ingestDiffReview.test.ts` fails if a conditional on `source_kind` appears in
 * the component.
 */
export const SOURCE_LABEL: Record<string, string> = {
  csv: "uploaded file",
  "orbit-mrp": "Orbit MRP sync",
  api: "API push",
};

export function sourceLabel(kind: string | null | undefined): string {
  return (kind && SOURCE_LABEL[kind]) || kind || "unknown source";
}

export interface ReviewCounts {
  new: number;
  changed: number;
  unchanged: number;
  superseded: number;
  held: number;
  removed: number;
  /** new + changed + unchanged — what pressing Promote will write. */
  willPromote: number;
  /** The number the five buckets claim the file held. */
  accountedFor: number;
}

export function reviewCounts(run: IngestRun): ReviewCounts {
  const n = run.rows_new ?? 0;
  const c = run.rows_changed ?? 0;
  const u = run.rows_unchanged ?? 0;
  const s = run.rows_superseded ?? 0;
  const h = run.rows_held ?? 0;
  const r = run.rows_removed ?? 0;
  return {
    new: n, changed: c, unchanged: u, superseded: s, held: h, removed: r,
    willPromote: n + c + u,
    accountedFor: n + c + u + s + h,
  };
}

/**
 * THE PARTITION CHECK, RENDERED RATHER THAN ASSERTED IN A TEST. The five buckets
 * must account for every staged row; when they do not, the screen says so
 * instead of showing five numbers that quietly lose rows. §5 T3 — we publish our
 * own blind spots — applied to a counter.
 */
export function countsDisagree(run: IngestRun, stagedRowCount: number): string | null {
  const { accountedFor } = reviewCounts(run);
  if (accountedFor === stagedRowCount) return null;
  return (
    `This run staged ${stagedRowCount} row(s) and its counts account for ${accountedFor}. ` +
    `The difference is not shown anywhere below; re-run the comparison before promoting.`
  );
}

/**
 * A FILE CANNOT REMOVE ROWS, and the screen says that rather than rendering a
 * zero that looks like a measurement (§5 T1: no number without a source, which
 * includes a zero). A connector PULL speaks for the whole source and can
 * honestly report `removed_upstream`; an upload speaks only for the rows it
 * contains.
 */
export function removalNote(kind: string | null | undefined): string {
  return kind === "csv"
    ? "An upload cannot remove rows: a file is not a statement about the rows it omits."
    : "Rows the source no longer offers. Never promoted — they are marked, not deleted.";
}

export interface Provenance {
  filename: string | null;
  line: number | null;
  sha256: string | null;
  runId: string | null;
}

/**
 * tier-2 row → `source_row_id` → `ingest_staged_rows.source_row_number` (the
 * PHYSICAL line, header = line 1) → `ingest_run_id` → `ingest_files`. Four hops
 * and no invention: this formats what the join returned.
 *
 * BOTH FK COLUMNS ARE `ON DELETE SET NULL` (`20260916000019`), so a NULL is a row
 * whose run has been deleted OR a row that predates the ingestion path entirely
 * — and every tier-2 row in production is the second case today, because no run
 * has ever written one. A null means the provenance is UNKNOWN, never that there
 * was none, and the two sentences below are the difference.
 */
export function provenanceText(p: Provenance | null): { text: string; known: boolean } {
  if (!p || (!p.filename && p.line == null)) {
    return {
      known: false,
      text:
        "Source unknown. This row was written before uploads were traced, or the run that " +
        "wrote it has since been deleted — it is not a row that came from nowhere.",
    };
  }
  const where = p.line != null ? `line ${p.line}` : "an unrecorded line";
  return { known: true, text: `${p.filename ?? "an uploaded file"} · ${where}` };
}

export const shortSha = (sha: string | null | undefined): string | null =>
  sha ? `${sha.slice(0, 12)}…` : null;
