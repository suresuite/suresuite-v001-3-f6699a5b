/**
 * §5.4's ACCEPTANCE TEST, and the sheet that finally answers it. WP 6.3.
 *
 *     "Hand a stakeholder a number from the Supplier grid and a laptop. With no help
 *      and no app access beyond the export, they trace it to a row in a named file
 *      uploaded by a named person on a named date — or find the named rule that
 *      produced it in the absence of data."
 *
 * A4 has carried the second half since WP 3.3: the substitution rules are in the
 * policy sheets. The first half was not answerable from the export AT ALL, and §5.4
 * says so in A4's own note — *"the dataset workbook starts at Tier 2 — it proves what
 * the engine ran on, not where those rows came from."*
 *
 * `supabase/rehearsal/270` proves `ingest_row_provenance` against a real database and
 * mutation-tests five ways of getting it wrong. This file asserts the half a SQL
 * assertion cannot reach: what the SHEET tells a person who has the file and nothing
 * else — above all, that a row it cannot trace is listed rather than omitted, since a
 * sheet of only the traced rows reads as a complete lineage and gives a reader no way
 * to discover what is missing from it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { provenanceSheet, type RowProvenance } from "@/lib/policies/verifiableExports";
import { INGEST_DATASETS } from "../../../../supabase/functions/_shared/ingestSpec.generated";

const ROOT = join(__dirname, "..", "..", "..", "..");
const HOOK = readFileSync(join(ROOT, "src", "hooks", "useVerifiableExports.tsx"), "utf8");
const EXPORTS = readFileSync(join(ROOT, "src", "lib", "policies", "verifiableExports.ts"), "utf8");
const MIGRATION = readFileSync(
  join(ROOT, "supabase", "migrations", "20260919000004_row_provenance.sql"), "utf8",
);

const traced: RowProvenance = {
  table: "customers",
  natural_key: { project_id: "p1", customer_id: "C-TRACED" },
  has_provenance: true,
  source_row_number: 5,
  original_filename: "customers-q3.csv",
  content_sha256: "d".repeat(64),
  uploaded_by_email: "ravi@example.invalid",
  received_at: "2026-09-19T08:00:00.000Z",
  promoted_by_email: "ravi@example.invalid",
  promoted_at: "2026-09-19T08:05:00.000Z",
};

const untraced: RowProvenance = {
  table: "customers",
  natural_key: { project_id: "p1", customer_id: "C-LEGACY" },
  has_provenance: false,
  source_row_number: null, original_filename: null, content_sha256: null,
  uploaded_by_email: null, received_at: null, promoted_by_email: null, promoted_at: null,
};

const cells = (sheet: XLSX.WorkSheet): string[][] =>
  (XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true, defval: "" }) as unknown[][])
    .map((r) => r.map((c) => String(c ?? "")));

describe("§5.4 acceptance test · the _provenance sheet", () => {
  it("a traced row names the file, the line, the hash and both people", () => {
    const rows = cells(provenanceSheet([traced], "2026-09-19T07:00:00.000Z"));
    const flat = rows.map((r) => r.join("|")).join("\n");
    expect(flat).toMatch(/customers-q3\.csv/);
    expect(flat).toMatch(/\|5\|/);
    expect(flat).toMatch(/d{64}/);
    expect(flat).toMatch(/ravi@example\.invalid/);
    // The key as the index defines it, minus project_id — a reader matching the
    // workbook's table sheets does not need the project uuid on every line.
    expect(flat).toMatch(/customer_id=C-TRACED/);
    expect(flat).not.toMatch(/project_id=p1/);
  });

  it("an UNTRACED row is listed, and says unknown rather than being dropped", () => {
    // The assertion this file exists for. A sheet of only traced rows reads as a
    // complete lineage.
    const rows = cells(provenanceSheet([traced, untraced], null));
    const body = rows.filter((r) => r[0] === "customers");
    expect(body).toHaveLength(2);
    const legacy = body.find((r) => r[1].includes("C-LEGACY"))!;
    expect(legacy[2]).toBe("no");
    expect(legacy[3]).toBe("");
    const flat = rows.map((r) => r.join(" ")).join("\n");
    expect(flat).toMatch(/provenance is UNKNOWN — not absent/);
    expect(flat).toMatch(/inventing one would be worse than this blank/);
  });

  it("the header counts what can and cannot be traced", () => {
    const flat = cells(provenanceSheet([traced, untraced], null)).map((r) => r.join(" ")).join("\n");
    expect(flat).toMatch(/Rows listed: 2 · traceable to a file: 1 · not traceable: 1/);
  });

  it("the sheet states that it is read LIVE and how to spot a disagreement", () => {
    // The one real limit of this sheet, declared where it is read (T3). Provenance
    // cannot go inside the snapshot: graph_hash hashes the snapshot, so a re-upload
    // that changed no value would move the hash if the run id were in it.
    const flat = cells(provenanceSheet([traced], "2026-09-19T07:00:00.000Z"))
      .map((r) => r.join(" ")).join("\n");
    expect(flat).toMatch(/Read LIVE at export time/);
    expect(flat).toMatch(/would move the hash if the run id were inside it/);
    expect(flat).toMatch(/Dataset version frozen at 2026-09-19T07:00:00\.000Z/);
    expect(flat).toMatch(/the file named here is the NEWER one/);
  });

  it("an empty read still produces the sheet, because that answer is the useful one", () => {
    // Most projects today can trace nothing (§4 D88). "No row in this project can be
    // traced to a file" is what a stakeholder needs to hear, and a missing sheet
    // says nothing at all.
    const rows = cells(provenanceSheet([], null));
    expect(rows.length).toBeGreaterThan(4);
    expect(rows.map((r) => r.join(" ")).join("\n")).toMatch(/Rows listed: 0/);
    expect(EXPORTS).toMatch(/if \(provenance\) \{/);
  });

  it("the tables asked about are DERIVED from the contract, not listed", () => {
    // An eleventh dataset must be covered the day it lands. A hand-written list is
    // the second copy `single-source` (I1) refuses.
    expect(HOOK).toMatch(/new Set\(Object\.values\(INGEST_DATASETS\)\.map\(\(d\) => d\.target\)\)/);
    const targets = new Set(Object.values(INGEST_DATASETS).map((d) => d.target));
    expect(targets.size).toBeGreaterThanOrEqual(10);
  });

  it("a failed read and an empty read are different facts", () => {
    // `undefined` means nothing could be read; `[]` means the reads returned nothing.
    // Conflating them would publish "nothing can be traced" after an outage.
    expect(HOOK).toMatch(/if \(anyRead\) provenance = gathered;/);
    expect(HOOK).toMatch(/if \(error\) continue;/);
  });

  it("the RPC lists every row and refuses a table outside the landing path", () => {
    expect(MIGRATION).toMatch(/\(t\.source_row_id IS NOT NULL\)/);
    expect(MIGRATION).toMatch(/LEFT JOIN public\.ingest_staged_rows/);
    expect(MIGRATION).toMatch(/ingest_target_is_promotable/);
    // The key is READ, never restated.
    expect(MIGRATION).toMatch(/v_key := public\.ingest_target_natural_key\(p_target_table\);/);
    expect(MIGRATION).not.toMatch(/v_key := ARRAY\[/);
  });
});
