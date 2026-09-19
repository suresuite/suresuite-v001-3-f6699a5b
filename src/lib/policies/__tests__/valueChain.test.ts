/**
 * A2 — the value chain never leaves a hop blank. §5.4, WP 6.3.
 *
 * ── WHY THESE ARE THE ASSERTIONS ───────────────────────────────────────────
 *
 * `supabase/rehearsal/260` proves the RPC against a real database and
 * mutation-tests five ways of getting it wrong, including the one that returned
 * `parsed` where `raw` belonged. That is the half SQL can reach.
 *
 * What it cannot reach is whether a PERSON is told. The chain's whole subject is
 * where a number came from, so a hop rendered as an empty line reads as a complete
 * chain that happens to be short — the over-claim T1 forbids, in the one artifact
 * whose entire content is a claim about completeness. 8 577 rows in this database
 * predate the ingestion path (§4 D88) and can never be backfilled, so the short
 * chain is the COMMON case and not the exception.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildValueChain, sourceFor, type ValueChainRow } from "@/lib/trust/valueChain";
import { PROVENANCE, type Provenance } from "@/components/policies/policyGridUi";

const ROOT = join(__dirname, "..", "..", "..", "..");

const base = {
  dataset: "materials",
  column: "cost",
  stage: "supplier",
  field: "material_cost",
  provenance: "master" as Provenance,
  displayed: "12.50",
  uploadable: true,
};

const full: ValueChainRow = {
  has_provenance: true,
  project_id: "p1",
  target_table: "materials",
  source_kind: "csv",
  original_filename: "materials-may.csv",
  content_sha256: "a".repeat(64),
  byte_size: 400,
  source_row_number: 7,
  raw: { material_id: "M-1", cost: "12.50", moq: "" },
  parsed: { material_id: "M-1", cost: 12.5 },
  findings: [],
  diff_state: "new",
  uploaded_by_name: "Dana Uploader",
  uploaded_by_email: "dana@example.invalid",
  received_at: "2026-09-19T08:00:00.000Z",
  promoted_by_name: "Dana Uploader",
  promoted_by_email: "dana@example.invalid",
  promoted_at: "2026-09-19T08:05:00.000Z",
  run_status: "succeeded",
  later_uploads: 0,
  latest_upload_at: "2026-09-19T08:05:00.000Z",
};

const legacy: ValueChainRow = {
  ...full,
  has_provenance: false,
  source_kind: null, original_filename: null, content_sha256: null, byte_size: null,
  source_row_number: null, raw: null, parsed: null, findings: null, diff_state: null,
  uploaded_by_name: null, uploaded_by_email: null, received_at: null,
  promoted_by_name: null, promoted_by_email: null, promoted_at: null, run_status: null,
  later_uploads: 2,
};

describe("§5.4 A2 · the value chain states every hop", () => {
  it("no step is blank without a reason", () => {
    for (const row of [full, legacy, null]) {
      const { steps } = buildValueChain({ ...base, row });
      expect(steps.length).toBeGreaterThan(5);
      for (const s of steps) {
        if (s.value === null) {
          expect(s.absentBecause, `${s.key} is null with no reason`).toBeTruthy();
          expect(s.absentBecause!.length, `${s.key}'s reason is a placeholder`).toBeGreaterThan(12);
        }
      }
    }
  });

  it("a legacy row is UNKNOWN, and the word `none` is refused", () => {
    // The distinction this artifact exists to make. Inventing an ingest_run_id is
    // the fabricated provenance `declared-fallback` (I6) forbids, so "unknown" is
    // the permanent answer for these rows — and it has to be said, not implied.
    const { steps, tracesToAFile, headline } = buildValueChain({ ...base, row: legacy });
    const file = steps.find((s) => s.key === "file")!;
    expect(file.value).toBeNull();
    expect(file.absentBecause).toMatch(/unknown, not none/);
    expect(tracesToAFile).toBe(false);
    expect(headline).toMatch(/unknown/i);
    expect(headline).not.toMatch(/\.csv/);
  });

  it("a full chain names the file, the line and both people", () => {
    const { steps, tracesToAFile, headline } = buildValueChain({ ...base, row: full });
    const by = (k: string) => steps.find((s) => s.key === k)!;
    expect(by("file").value).toMatch(/materials-may\.csv/);
    expect(by("file").value).toMatch(/sha256 aaaaaaaaaaaa…/);
    expect(by("row").value).toMatch(/line 7/);
    expect(by("uploader").value).toMatch(/Dana Uploader <dana@example\.invalid>/);
    expect(by("approver").value).toMatch(/Dana Uploader/);
    expect(tracesToAFile).toBe(true);
    expect(headline).toBe("Line 7 of materials-may.csv");
  });

  it("an empty cell and an absent cell are different sentences", () => {
    // §4 D7: absent says "no value was established", empty says "the file said
    // empty". A chain that spelled them the same way would be the defect it is
    // built to explain.
    const { steps } = buildValueChain({ ...base, column: "moq", field: "moq", row: full });
    const received = steps.find((s) => s.key === "as_received")!;
    expect(received.value).toBe("(empty)");
    const established = steps.find((s) => s.key === "established")!;
    expect(established.value).toBeNull();
    expect(established.absentBecause).toMatch(/absent is not the same as empty/);
  });

  it("a column the file did not carry says so, rather than saying empty", () => {
    const row: ValueChainRow = { ...full, raw: { material_id: "M-1" } };
    const { steps } = buildValueChain({ ...base, row });
    const received = steps.find((s) => s.key === "as_received")!;
    expect(received.value).toBeNull();
    expect(received.absentBecause).toMatch(/carried no `cost` column/);
  });

  it("a bundle-resolved column is not reported as missing provenance", () => {
    // The wrong answer here is "unknown". This cell has a correct, complete
    // chain — override → default — and calling it a gap would report the design
    // as a defect.
    const { steps, headline } = buildValueChain({
      ...base, uploadable: false, dataset: "", column: "safety_stock_days",
      field: "safety_stock_days", provenance: "default", row: null,
    });
    const file = steps.find((s) => s.key === "file")!;
    expect(file.absentBecause).toMatch(/not uploaded/);
    expect(file.absentBecause).not.toMatch(/unknown/);
    expect(steps.find((s) => s.key === "resolver")!.value).toMatch(/first matching branch/);
    expect(headline).not.toMatch(/predates/);
  });

  it("freshness counts later uploads and says when there are none", () => {
    expect(buildValueChain({ ...base, row: full }).steps.find((s) => s.key === "freshness")!.value)
      .toMatch(/no later upload/);
    const two = buildValueChain({ ...base, row: { ...full, later_uploads: 2 } });
    expect(two.steps.find((s) => s.key === "freshness")!.value).toMatch(/2 later uploads/);
    // A legacy row's later uploads are not attributed to it, and the sentence says so.
    const lg = buildValueChain({ ...base, row: legacy });
    expect(lg.steps.find((s) => s.key === "freshness")!.value).toMatch(/not attributed to any of them/);
  });

  it("every provenance state has its own remedy", () => {
    // The same rule `provenanceVocabulary.test.ts` holds over the dot's labels: a
    // state that fell through to a generic sentence would tell a reader to
    // re-upload a file for a value they typed.
    const seen = new Set<string>();
    for (const p of Object.keys(PROVENANCE) as Provenance[]) {
      const remedy = buildValueChain({ ...base, provenance: p, row: full })
        .steps.find((s) => s.key === "remedy")!.value!;
      expect(remedy, `${p} has no remedy`).toBeTruthy();
      seen.add(remedy);
    }
    expect(seen.size, "two states share a remedy sentence").toBe(Object.keys(PROVENANCE).length);
  });

  it("`sourceFor` names a dataset only when the contract does", () => {
    expect(sourceFor({ field: "material_cost", master: { table: "materials", field: "cost" } }))
      .toEqual({ dataset: "materials", column: "cost" });
    expect(sourceFor({ field: "safety_stock_days" })).toBeNull();
  });

  it("the popover distinguishes a failed read from absent provenance", () => {
    // Two different facts. Conflating them would make every outage look like
    // missing lineage, and missing lineage is the thing this product publishes
    // about itself (T3).
    const src = readFileSync(
      join(ROOT, "src", "components", "policies", "ValueChainPopover.tsx"), "utf8",
    );
    expect(src).toMatch(/failed read, not an absence of\s+provenance/);
    expect(src).toMatch(/not known — /);
  });

  it("the chain is read on open, not per render", () => {
    // The grid has hundreds of cells. A chain fetched per render would be a read
    // storm for a question a person asks about one number.
    const src = readFileSync(
      join(ROOT, "src", "components", "policies", "ValueChainPopover.tsx"), "utf8",
    );
    expect(src).toMatch(/if \(!open \|\| !target \|\| !userId \|\| !target\.dataset\) return;/);
  });
});
