// Phase 3 / WP 3.2 — THE CSV PARSER. One, on the server, for every upload.
//
// WHAT IT REPLACES. `UploadWizard` split the file on "\n" and every line on ","
// (D6). Four things follow from that and all four are in production data:
//
//   · a quoted comma splits a field in half, and every column after it shifts
//     left by one. D46 is what that looks like from the far end — 27 `time_unit`
//     values that are integers, which are lead-time day counts sitting one
//     column out of place, each then read as "weekly" without a word.
//   · a CRLF file leaves "\r" on the last field of every row, so `week\r` is not
//     `week` and `12\r` is not 12.
//   · a UTF-8 BOM makes the first header `<BOM>supplier_id`, which matches no
//     expected header, so the whole file is rejected with a message naming a
//     column that is plainly there.
//   · a row with fewer fields than the header binds `undefined` to the tail
//     columns and a row with more silently drops them.
//
// This is RFC 4180 with the three concessions real files need: a trailing
// newline is not a row, a lone CR is a line break, and a BOM is consumed. It
// takes a string and returns data — no Deno, no fetch, no Supabase — so the
// vitest suite runs it directly and so does the edge function.

export type FindingLevel = "error" | "warn" | "info";

/** The shape `ingest_runs.mapping_warnings` and scsim's MappingWarning share. */
export interface Finding {
  level: FindingLevel;
  /** The CSV header or tier-2 column the finding is about, or null for the file. */
  field: string | null;
  /** A stable token a UI may branch on; the message is for a person. */
  code: string;
  message: string;
  /** The physical line in the file, 1-based, header = 1. Absent for file-level. */
  row?: number;
}

export interface CsvRow {
  /** Physical line in the file, 1-based; the header is line 1. */
  line: number;
  cells: string[];
}

export interface CsvParseResult {
  headers: string[];
  rows: CsvRow[];
  findings: Finding[];
  /** False when the file cannot be read as comma-separated at all. */
  ok: boolean;
}

const BOM = "﻿";

/**
 * Delimiters we can RECOGNISE in order to refuse them. Deliberately not a list
 * of delimiters we accept: the templates this product ships are comma-separated,
 * and guessing the separator is how a semicolon file becomes one column named
 * `supplier_id;material_id;volume` and a run of 1 787 rows with one field each.
 */
const RIVALS: Record<string, string> = {
  ";": "semicolon",
  "\t": "tab",
  "|": "pipe",
};

/** Count a character in the header line, ignoring anything inside quotes. */
function countOutsideQuotes(line: string, ch: string): number {
  let n = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { i += 1; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ch) n += 1;
  }
  return n;
}

/**
 * Split a whole CSV document into physical records.
 *
 * Quoted fields may contain the delimiter, CR, LF and doubled quotes. A record
 * therefore spans however many physical lines its quoting says it does, and
 * `line` counts the PHYSICAL line the record started on — which is the number a
 * spreadsheet shows the person who made the file.
 */
function splitRecords(text: string): { records: CsvRow[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const records: CsvRow[] = [];

  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let sawAnyChar = false;

  const endField = () => { cells.push(field); field = ""; };
  const endRecord = () => {
    endField();
    // A record of one empty field is a blank line, not a row of one blank cell.
    if (!(cells.length === 1 && cells[0] === "")) {
      records.push({ line: recordLine, cells });
    }
    cells = [];
    sawAnyChar = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; continue; }
        inQuotes = false;
        continue;
      }
      if (c === "\n") line += 1;
      field += c;
      continue;
    }

    if (c === '"') {
      if (!sawAnyChar || field === "") { inQuotes = true; sawAnyChar = true; continue; }
      // A quote in the middle of an unquoted field is malformed CSV. Kept
      // verbatim rather than guessed at, and said out loud: `3" pipe` is a real
      // product name and not an error, so this is `warn` and not `error`.
      findings.push({
        level: "warn", field: null, code: "quote_inside_unquoted_field", row: recordLine,
        message: `Line ${recordLine}: a double quote appears inside an unquoted field; it was kept as a literal character.`,
      });
      field += c;
      continue;
    }

    if (c === ",") { endField(); sawAnyChar = true; continue; }

    if (c === "\r") {
      // CRLF and a lone CR are both record separators. Neither leaves a
      // character behind, which is the whole of the `week\r` defect.
      if (text[i + 1] === "\n") i += 1;
      endRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    if (c === "\n") { endRecord(); line += 1; recordLine = line; continue; }

    field += c;
    sawAnyChar = true;
  }

  if (inQuotes) {
    findings.push({
      level: "error", field: null, code: "unterminated_quote",
      message: "The file ends inside a quoted field — a closing double quote is missing. " +
               "Everything after the unmatched quote was read as one value.",
    });
  }
  // Whatever is left is a final record only if the file did not end on a newline.
  if (field !== "" || cells.length > 0) endRecord();

  return { records, findings };
}

/**
 * Parse a CSV document.
 *
 * `ok: false` means the file is not usable at all — no delimiter we accept, no
 * header, or nothing after the header. Anything else is a per-row question and
 * is left to the validator, because one bad row must never reject 1 786 good
 * ones (D7 is what the other answer cost).
 */
export function parseCsv(input: string): CsvParseResult {
  const text = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  const findings: Finding[] = [];

  if (!text.trim()) {
    return { headers: [], rows: [], ok: false, findings: [
      { level: "error", field: null, code: "empty_file", message: "The file is empty." },
    ] };
  }

  // The delimiter question is asked of the HEADER line and only of it: a header
  // is the one line whose shape we know something about.
  const headerLine = text.split(/\r\n|\r|\n/, 1)[0] ?? "";
  const commas = countOutsideQuotes(headerLine, ",");
  if (commas === 0) {
    for (const [ch, name] of Object.entries(RIVALS)) {
      if (countOutsideQuotes(headerLine, ch) > 0) {
        return { headers: [], rows: [], ok: false, findings: [{
          level: "error", field: null, code: "delimiter_not_comma",
          message: `This file is ${name}-separated, not comma-separated. ` +
                   "Re-export it as CSV with commas — in Excel, “Save As” → " +
                   "“CSV UTF-8 (Comma delimited)”. No rows were read.",
        }] };
      }
    }
  }

  const { records, findings: shape } = splitRecords(text);
  findings.push(...shape);
  if (shape.some((f) => f.level === "error")) {
    return { headers: [], rows: [], ok: false, findings };
  }
  if (!records.length) {
    return { headers: [], rows: [], ok: false, findings: [
      { level: "error", field: null, code: "no_header", message: "The file has no header row." },
    ] };
  }

  const headers = records[0].cells.map((h) => h.trim());
  const rows = records.slice(1);

  const blank = headers.filter((h) => h === "").length;
  if (blank) {
    findings.push({
      level: "warn", field: null, code: "blank_header",
      message: `${blank} column${blank === 1 ? " has" : "s have"} no name in the header row; ` +
               "any values under them were kept in the run's record of the file but mapped to nothing.",
    });
  }
  const seen = new Set<string>();
  for (const h of headers) {
    if (h && seen.has(h)) {
      findings.push({
        level: "error", field: h, code: "duplicate_header",
        message: `The header row names "${h}" more than once. Which column is meant cannot be decided here.`,
      });
    }
    seen.add(h);
  }

  if (!rows.length) {
    findings.push({
      level: "error", field: null, code: "no_rows",
      message: "The file has a header row and no data rows.",
    });
  }

  return { headers, rows, findings, ok: !findings.some((f) => f.level === "error") };
}

/** Lowercase hex SHA-256 of a byte sequence — the shape `ingest_files` CHECKs. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
