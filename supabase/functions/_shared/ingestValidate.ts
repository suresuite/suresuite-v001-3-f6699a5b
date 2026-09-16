// Phase 3 / WP 3.2 — CONTRACT-DRIVEN VALIDATION.
//
// Every rule this file applies comes from `ingestSpec.generated.ts`, which is
// generated from supabase/contract/*.contract.yaml. There is no list of headers
// here, no list of numeric columns, and no list of unit tokens: `single-source`
// (I1) says a data fact is authored once, and "volume must be a number at least
// zero" is a data fact. For three phases it was authored twice — as English in
// `ingest.validate` and as a `numericHeaders` array in a React component — and
// they disagreed, which is D7.
//
// WHAT A FINDING IS FOR. A row that fails validation is STAGED with its reason
// attached, not dropped: `ingest_staged_rows` keeps `raw` beside `parsed` so
// that "row 42, volume, blank" is a thing a person can be shown and a thing WP
// 3.4 can click through. Only rows carrying an `error` are held back from tier 2.
//
// THE TRIM/EMPTY PATTERN IS `ingest-bom-multi-level`'s, as PLAN.md §10 requires:
// `(v ?? '').toString().trim() || null` — trim first, and an empty string after
// trimming is a missing value rather than a value that happens to be empty. That
// is what makes `" MAT-1 "` and `"MAT-1"` one identifier (D8). It is applied here
// once, from the spec, instead of a third time by hand.

import { unitDays } from "./grading.ts";
import type { Finding } from "./csvParse.ts";
import type { CsvParseResult, CsvRow } from "./csvParse.ts";
import type { IngestColumn, IngestDataset } from "./ingestSpec.generated.ts";

export interface StagedRow {
  source_row_number: number;
  /** The cells as received, keyed by the header the file carried. */
  raw: Record<string, string>;
  /** What validation established, keyed by tier-2 column name. */
  parsed: Record<string, string | number | null>;
  findings: Finding[];
}

export interface ValidationResult {
  ok: boolean;
  rows: StagedRow[];
  /** File-level findings — a missing required column, an unknown header. */
  fileFindings: Finding[];
  counts: {
    rows_fetched: Record<string, number>;
    fields_mapped: number;
    fields_defaulted: number;
    fields_failed: number;
    rows_rejected: number;
  };
}

/** The pattern from `ingest-bom-multi-level/index.ts`. Do not invent a third. */
function trimmedOrNull(value: string | undefined | null): string | null {
  return (value ?? "").toString().trim() || null;
}

function checkBounds(column: IngestColumn, n: number): string | null {
  const r = column.rule;
  if (r.min !== undefined && n < r.min) return `must be at least ${r.min}`;
  if (r.exclusive_min !== undefined && n <= r.exclusive_min) return `must be greater than ${r.exclusive_min}`;
  if (r.max !== undefined && n > r.max) return `must be at most ${r.max}`;
  return null;
}

/**
 * Apply one column's rule to one cell.
 *
 * Returns the value to put in `parsed`, or `undefined` to put NOTHING there.
 * The difference is load-bearing and it is D7: an ABSENT key says no value was
 * established; a key holding `null` says the file said empty and the contract
 * allows it. A validator that spells those the same way is how 376 null volumes
 * reached tier 2.
 */
function validateCell(
  column: IngestColumn,
  cell: string | undefined,
  line: number,
): { value?: string | number | null; finding?: Finding; defaulted?: boolean } {
  const rule = column.rule;
  const trimmed = trimmedOrNull(cell);
  const where = `Row ${line}, column "${column.csvHeader}"`;

  if (trimmed === null) {
    if (column.required || rule.blank === "reject") {
      return { finding: {
        level: "error", field: column.csvHeader, code: "required_blank", row: line,
        message: `${where}: required and blank. ` +
                 (column.validate ? `The contract says: ${column.validate}.` : "") +
                 " The row was not promoted; nothing was substituted for the missing value.",
      } };
    }
    // Blank and optional: land no value and SAY that a default will stand in.
    // §5 T2 — a substitution is visible, and this is the point at which it can
    // still be seen next to the row it is about.
    return { defaulted: true };
  }

  switch (rule.kind) {
    case "text":
      return { value: trimmed };

    case "unit": {
      if (unitDays(trimmed) === undefined) {
        return { finding: {
          level: "error", field: column.csvHeader, code: "unit_unrecognized", row: line,
          message: `${where}: "${trimmed}" is not a period this system knows. ` +
                   "Use day, week, month, quarter or year (or leave it blank, which means weeks). " +
                   "It was NOT read as weekly — an unrecognised unit that is quietly treated as " +
                   "weekly is how a lead time in days becomes a weekly volume (D46).",
        } };
      }
      return { value: trimmed };
    }

    case "integer": {
      if (!/^[+-]?\d+$/.test(trimmed)) {
        return { finding: {
          level: "error", field: column.csvHeader, code: "not_an_integer", row: line,
          message: `${where}: "${trimmed}" is not a whole number.`,
        } };
      }
      const n = Number.parseInt(trimmed, 10);
      const bound = checkBounds(column, n);
      if (bound) {
        return { finding: {
          level: "error", field: column.csvHeader, code: "out_of_range", row: line,
          message: `${where}: ${n} ${bound}.`,
        } };
      }
      return { value: n };
    }

    case "numeric": {
      // Number() accepts "", "0x10", "1e5" and " 12 ". The first two are not
      // numbers anybody typed into a spreadsheet; the last two are.
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
        return { finding: {
          level: "error", field: column.csvHeader, code: "not_numeric", row: line,
          message: `${where}: "${trimmed}" is not a number. ` +
                   "Thousands separators and currency symbols are not removed here — " +
                   "a value this system cannot read is reported rather than guessed at.",
        } };
      }
      const n = Number(trimmed);
      const bound = checkBounds(column, n);
      if (bound) {
        return { finding: {
          level: "error", field: column.csvHeader, code: "out_of_range", row: line,
          message: `${where}: ${n} ${bound}` +
                   (column.validate ? ` (the contract says: ${column.validate})` : "") + ".",
        } };
      }
      return { value: n };
    }

    case "enum": {
      const allowed = rule.values ?? [];
      if (!allowed.includes(trimmed.toLowerCase())) {
        return { finding: {
          level: "error", field: column.csvHeader, code: "not_allowed", row: line,
          message: `${where}: "${trimmed}" is not one of ${allowed.join(", ")}.`,
        } };
      }
      return { value: trimmed.toLowerCase() };
    }

    case "boolean": {
      const t = trimmed.toLowerCase();
      if (["true", "1", "yes", "y"].includes(t)) return { value: "true" };
      if (["false", "0", "no", "n"].includes(t)) return { value: "false" };
      return { finding: {
        level: "error", field: column.csvHeader, code: "not_boolean", row: line,
        message: `${where}: "${trimmed}" is not true or false.`,
      } };
    }
  }
}

/**
 * Validate a parsed file against one dataset's contract entry.
 *
 * A MISSING REQUIRED COLUMN REJECTS THE FILE; a bad cell rejects its row. The
 * asymmetry is deliberate: a file without `volume` is the wrong file, and a file
 * with one blank volume is the right file with one problem in it.
 */
export function validateRows(parse: CsvParseResult, spec: IngestDataset): ValidationResult {
  const fileFindings: Finding[] = [...parse.findings];
  const index = new Map<string, number>();
  parse.headers.forEach((h, i) => { if (h && !index.has(h)) index.set(h, i); });

  for (const column of spec.columns) {
    if (column.required && !index.has(column.csvHeader)) {
      fileFindings.push({
        level: "error", field: column.csvHeader, code: "missing_required_column",
        message: `The file has no "${column.csvHeader}" column, and ${spec.dataset} requires it. ` +
                 `Columns found: ${parse.headers.filter(Boolean).join(", ") || "none"}.`,
      });
    }
  }

  // A file that names a column the server supplies is refused rather than
  // half-honoured: `project_id` and `plant_name` come from the selected project
  // (G1 — a project is referenced by uuid, never by a name a user typed), and a
  // file carrying them is a file whose author expects them to be used.
  for (const name of spec.serverSet) {
    if (index.has(name)) {
      fileFindings.push({
        level: "error", field: name, code: "server_set_column_in_file",
        message: `The file has a "${name}" column. That value comes from the project you are ` +
                 "uploading into and may not be set from a file. Remove the column and upload again.",
      });
    }
  }

  const known = new Set(spec.columns.map((c) => c.csvHeader));
  for (const h of parse.headers) {
    if (h && !known.has(h)) {
      fileFindings.push({
        level: "info", field: h, code: "unmapped_column",
        message: `"${h}" is not a column of ${spec.target}. It was kept in the record of the file ` +
                 "and mapped to nothing.",
      });
    }
  }

  const rows: StagedRow[] = [];
  let mapped = 0;
  let defaulted = 0;
  let failed = 0;
  let rejected = 0;

  const fatalFile = fileFindings.some((f) => f.level === "error");

  for (const row of parse.rows as CsvRow[]) {
    const findings: Finding[] = [];
    const raw: Record<string, string> = {};
    const parsed: Record<string, string | number | null> = {};

    parse.headers.forEach((h, i) => { if (h) raw[h] = row.cells[i] ?? ""; });

    // A short or long row is a shape problem and it is reported BEFORE the cell
    // rules run, because every cell after the missing one is in the wrong place
    // and validating them would produce findings about columns the user did not
    // get wrong. This is D6's field shift, caught at the row instead of at the
    // far end of the pipeline six months later.
    if (row.cells.length !== parse.headers.length) {
      findings.push({
        level: "error", field: null, code: "field_count_mismatch", row: row.line,
        message: `Row ${row.line} has ${row.cells.length} field(s) and the header has ` +
                 `${parse.headers.length}. Every value after the difference would land in the ` +
                 "wrong column, so none of them were read.",
      });
    } else {
      for (const column of spec.columns) {
        const at = index.get(column.csvHeader);
        if (at === undefined) continue;  // already a file-level error
        const outcome = validateCell(column, row.cells[at], row.line);
        if (outcome.finding) { findings.push(outcome.finding); failed += 1; continue; }
        if (outcome.defaulted) { defaulted += 1; continue; }
        parsed[column.column] = outcome.value ?? null;
        mapped += 1;
      }
    }

    if (findings.some((f) => f.level === "error")) rejected += 1;
    rows.push({ source_row_number: row.line, raw, parsed, findings });
  }

  return {
    ok: !fatalFile,
    rows,
    fileFindings,
    counts: {
      rows_fetched: { [spec.target]: rows.length },
      fields_mapped: mapped,
      fields_defaulted: defaulted,
      fields_failed: failed,
      rows_rejected: rejected,
    },
  };
}
