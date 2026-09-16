/**
 * THE PARSE TRACE (Phase 3 / WP 3.2, D6).
 *
 * `UploadWizard` split the file on "\n" and every line on "," for three years.
 * PLAN.md §10 asks this package to re-run the full parse trace and record the new
 * behaviour as the regression baseline, so each case below is one of the inputs
 * the old parser got wrong, written down with what the new one does instead.
 *
 * THE BASELINE, in one table. Each row is a test in this file:
 *
 *   input                          old (split)                  new (parseCsv)
 *   ─────────────────────────────  ───────────────────────────  ─────────────────
 *   "Acme, Inc.",MAT-1,10          4 fields; every column        3 fields, intact
 *                                  after it shifts left
 *   UTF-8 BOM                      first header is <BOM>id,   consumed
 *                                  so the file is "missing" it
 *   CRLF                           last field of every row        clean
 *                                  ends "\r"
 *   lone CR (classic Mac)          the whole file is ONE line     rows
 *   trailing comma                 a trailing empty field,        an empty last
 *                                  same as new                    field, named
 *   short row                      undefined bound to the tail    one finding,
 *                                  columns, silently              row not read
 *   long row                       extra values dropped           one finding
 *   "" inside a quoted field       splits the field               one quote
 *   newline inside a quoted field  two rows out of one            one row
 *   semicolon-separated            one column named               refused, with
 *                                  "a;b;c"                        what to do
 *   trailing newline               an empty final row             no row
 */
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../../../supabase/functions/_shared/csvParse";

const HEADER = "supplier_id,material_id,volume";
const codes = (r: ReturnType<typeof parseCsv>) => r.findings.map((f) => f.code);

describe("parseCsv — the cases the old parser got wrong", () => {
  it("keeps a quoted comma inside one field", () => {
    const r = parseCsv(`${HEADER}\n"Acme, Inc.",MAT-1,10\n`);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].cells).toEqual(["Acme, Inc.", "MAT-1", "10"]);
  });

  it("does not shift the columns after a quoted comma", () => {
    // The defect this is really about: `volume` must still be volume.
    const r = parseCsv(`${HEADER}\n"Acme, Inc.",MAT-1,10`);
    expect(r.rows[0].cells[2]).toBe("10");
  });

  it("consumes a UTF-8 BOM so the first header is still readable", () => {
    const r = parseCsv(`\uFEFF${HEADER}\nSUP-1,MAT-1,10`);
    expect(r.headers).toEqual(["supplier_id", "material_id", "volume"]);
  });

  it("leaves no carriage return on the last field of a CRLF file", () => {
    const r = parseCsv(`${HEADER}\r\nSUP-1,MAT-1,10\r\nSUP-2,MAT-2,20\r\n`);
    expect(r.rows.map((x) => x.cells)).toEqual([
      ["SUP-1", "MAT-1", "10"],
      ["SUP-2", "MAT-2", "20"],
    ]);
  });

  it("treats a lone CR as a line break", () => {
    const r = parseCsv(`${HEADER}\rSUP-1,MAT-1,10`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].cells).toEqual(["SUP-1", "MAT-1", "10"]);
  });

  it("reads a trailing comma as an empty final field, not a missing one", () => {
    const r = parseCsv(`${HEADER}\nSUP-1,MAT-1,`);
    expect(r.rows[0].cells).toEqual(["SUP-1", "MAT-1", ""]);
  });

  it("does not emit a row for the newline that ends the file", () => {
    const r = parseCsv(`${HEADER}\nSUP-1,MAT-1,10\n`);
    expect(r.rows).toHaveLength(1);
  });

  it("ignores a blank line in the middle of a file", () => {
    const r = parseCsv(`${HEADER}\nSUP-1,MAT-1,10\n\nSUP-2,MAT-2,20\n`);
    expect(r.rows).toHaveLength(2);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    const r = parseCsv(`${HEADER}\n"She said ""go""",MAT-1,10`);
    expect(r.rows[0].cells[0]).toBe('She said "go"');
  });

  it("keeps a quoted newline inside one field and one row", () => {
    const r = parseCsv(`${HEADER}\n"Acme\nHoldings",MAT-1,10`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].cells[0]).toBe("Acme\nHoldings");
  });

  it("numbers rows by their physical line, counting the header as line 1", () => {
    const r = parseCsv(`${HEADER}\nSUP-1,MAT-1,10\nSUP-2,MAT-2,20`);
    expect(r.rows.map((x) => x.line)).toEqual([2, 3]);
  });

  it("counts a quoted newline against the NEXT row's line number", () => {
    // So that "row 4" in a finding is the line the user's spreadsheet shows.
    const r = parseCsv(`${HEADER}\n"Acme\nHoldings",MAT-1,10\nSUP-2,MAT-2,20`);
    expect(r.rows[1].line).toBe(4);
  });

  it("keeps a short row's cells rather than binding undefined to the tail", () => {
    const r = parseCsv(`${HEADER}\nSUP-1,MAT-1`);
    expect(r.rows[0].cells).toEqual(["SUP-1", "MAT-1"]);
    expect(r.rows[0].cells).toHaveLength(2);
  });

  it("keeps a long row's extra cells rather than dropping them", () => {
    const r = parseCsv(`${HEADER}\nSUP-1,MAT-1,10,surprise`);
    expect(r.rows[0].cells).toHaveLength(4);
  });
});

describe("parseCsv — files it refuses, and says why", () => {
  it("refuses a semicolon-separated file and names the separator", () => {
    const r = parseCsv("supplier_id;material_id;volume\nSUP-1;MAT-1;10");
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(["delimiter_not_comma"]);
    expect(r.findings[0].message).toMatch(/semicolon/);
    expect(r.rows).toHaveLength(0);
  });

  it("refuses a tab-separated file the same way", () => {
    const r = parseCsv("supplier_id\tmaterial_id\nSUP-1\tMAT-1");
    expect(r.ok).toBe(false);
    expect(r.findings[0].message).toMatch(/tab/);
  });

  it("does not mistake a one-column CSV for a rival delimiter", () => {
    const r = parseCsv("supplier_id\nSUP-1\nSUP-2");
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
  });

  it("refuses an empty file", () => {
    expect(codes(parseCsv("   \n  "))).toEqual(["empty_file"]);
  });

  it("refuses a header with no data rows", () => {
    const r = parseCsv(HEADER);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("no_rows");
  });

  it("refuses a file that ends inside a quoted field", () => {
    const r = parseCsv(`${HEADER}\n"Acme,MAT-1,10`);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("unterminated_quote");
  });

  it("refuses a header that names the same column twice", () => {
    const r = parseCsv("supplier_id,volume,volume\nSUP-1,1,2");
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("duplicate_header");
  });

  it("warns about an unnamed column without rejecting the file", () => {
    const r = parseCsv("supplier_id,,volume\nSUP-1,x,10");
    expect(r.ok).toBe(true);
    expect(codes(r)).toContain("blank_header");
  });
});
