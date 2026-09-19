/**
 * A3 — the Trust Report's sections, and the part that cannot be dropped. §5.4, WP 6.3.
 *
 * §5.4 on the limits block: *"a trust report that does not state its own limits is
 * marketing."* That sentence is the reason this file exists. Everything else in the
 * report is a number; the limits section is the report's account of which numbers a
 * reader may not trust, and it is the one section a refactor would never notice
 * losing — an empty grid and an absent section look identical in a PDF.
 *
 * The other rule under test is the empty state. A coverage table with no rows reads
 * as "nothing is missing" and a findings table with no rows reads as "nothing is
 * wrong"; one is usually true and the other usually is not, and a grid cannot tell
 * them apart. So every section carries the sentence it prints INSTEAD of a blank
 * table, and the renderers print it.
 *
 * `reportTemplates.ts` is read as TEXT rather than imported: it pulls the Deno tool
 * registry (`Deno.env`, `https://` imports) and would not load under vitest. The
 * assertions are about which tool the template names and which sections it builds,
 * both of which are visible in the source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trustReportSections, trustReportJson } from "../../../../supabase/functions/_shared/trustReportSections";
import type { TrustReport } from "../../../../supabase/functions/_shared/trustReport";

const ROOT = join(__dirname, "..", "..", "..", "..");
const TEMPLATES = readFileSync(
  join(ROOT, "supabase", "functions", "_shared", "reportTemplates.ts"), "utf8",
);
const TOOL = readFileSync(
  join(ROOT, "supabase", "functions", "_shared", "trustReportTool.ts"), "utf8",
);

const empty: TrustReport = {
  projectName: "Acme", graphHash: null, graphHashShort: "—", datasetVersion: null,
  measuredAt: "2026-09-19T00:00:00Z",
  coverage: [], blocking: [], substitutions: [], freshness: {}, latestRuns: [],
  ingestHistory: [], knownLimits: [],
  headline: "This project has no dataset hash, so nothing here can be reproduced.",
};

const filled: TrustReport = {
  ...empty,
  graphHash: "f".repeat(64), graphHashShort: "ffffffff",
  coverage: [{
    field: "materials.cost", policyRef: "P-S.1", level: "required",
    fromData: 3, substituted: 1, missing: 0, fallback: "project average",
  }],
  substitutions: [{
    field: "materials.cost", policyRef: "P-S.1", level: "required",
    fromData: 3, substituted: 1, missing: 0, fallback: "project average",
  }],
  blocking: [{
    severity: "block", field: "products.demand_mean", policy: "P-F.1",
    rows: ["P-1"], message: "no demand for P-1", reason: "required",
  }],
  freshness: { network_nodes: { rows: 10, fresh: 4, stale: 6, unknown: 0, computed_at: null } },
  latestRuns: [{
    analysis_kind: "network_science", run_id: "r1", status: "succeeded",
    code_version: "1.2.3", finished_at: null, freshness: "stale", warnings: [],
  }],
  ingestHistory: [{ run_id: "i1", fact_class: "csv", landed_at: null, uploaded_by: null, rows: 3 }],
  knownLimits: [{ ref: "§4 D88", limit: "derived rows predate provenance", consequence: "cannot be traced" }],
};

describe("§5.4 A3 · the Trust Report's sections", () => {
  it("every section states what an EMPTY table would have implied", () => {
    for (const s of trustReportSections(empty)) {
      expect(s.emptyNote, `${s.id} has no empty-state sentence`).toBeTruthy();
      expect(s.emptyNote.length, `${s.id}'s empty note is a placeholder`).toBeGreaterThan(25);
      expect(s.columns.length, `${s.id} has no columns`).toBeGreaterThan(0);
    }
  });

  it("an empty coverage table does not say nothing is missing", () => {
    const cov = trustReportSections(empty).find((s) => s.id === "coverage")!;
    expect(cov.rows).toHaveLength(0);
    expect(cov.emptyNote).toMatch(/does not mean nothing is missing/);
  });

  it("an empty run list is not reported as a clean bill", () => {
    // D88's whole lesson: 0 runs meant the code was never deployed, and three §15
    // sections had read the emptiness as user behaviour.
    const runs = trustReportSections(empty).find((s) => s.id === "runs")!;
    expect(runs.emptyNote).toMatch(/predates the run store/);
  });

  it("the limits section exists even when there are no limits, and is LAST", () => {
    const ids = trustReportSections(empty).map((s) => s.id);
    expect(ids).toContain("limits");
    expect(ids[ids.length - 1]).toBe("limits");
    const limits = trustReportSections(empty).find((s) => s.id === "limits")!;
    expect(limits.rows).toHaveLength(0);
    // And an empty list is called what it is for THIS codebase: a defect in the
    // report, not a clean bill.
    expect(limits.emptyNote).toMatch(/defect in the report/);
  });

  it("a filled report renders each part with its own columns", () => {
    const by = new Map(trustReportSections(filled).map((s) => [s.id, s]));
    expect(by.get("headline")!.rows.find((r) => r[0] === "Dataset hash")![1]).toBe("f".repeat(64));
    expect(by.get("coverage")!.rows[0]).toEqual(
      ["materials.cost", "P-S.1", "required", 3, 1, 0, "project average"],
    );
    // The finding's POLICY, not an empty column: `GradedFinding` carries `policy`
    // and the graded FIELD carries `policyRef`, and reading the wrong one would
    // print a blank on every row and look like a data gap.
    expect(by.get("blocking")!.rows[0]).toEqual(["block", "products.demand_mean", "P-F.1", "no demand for P-1"]);
    expect(by.get("freshness")!.rows[0]).toEqual(["network_nodes", 10, 4, 6, 0, null, "never"]);
    expect(by.get("runs")!.rows[0]![5]).toBe("stale");
    expect(by.get("ingest")!.rows[0]![3]).toBe("unrecorded");
    expect(by.get("limits")!.rows[0]![0]).toBe("§4 D88");
  });

  it("a missing dataset hash is stated, not blanked", () => {
    const head = trustReportSections(empty).find((s) => s.id === "headline")!;
    const hash = head.rows.find((r) => r[0] === "Dataset hash")![1];
    expect(hash).toMatch(/nothing here can be reproduced/);
    const ver = head.rows.find((r) => r[0] === "Dataset version")![1];
    expect(ver).toMatch(/unversioned/);
  });

  it("the JSON artifact restates the limits and admits an incomplete report", () => {
    // T3 at the top of the file: a reader who opens the JSON sees the limits
    // before the numbers, and `complete` is computed rather than asserted.
    const j = trustReportJson(empty);
    expect(j.artifact).toBe("suresuite.data-trust-report");
    expect(j.complete).toBe(false);
    expect(j.known_limits).toEqual([]);
    expect(trustReportJson(filled).complete).toBe(true);
    expect((trustReportJson(filled).known_limits as unknown[])).toHaveLength(1);
  });
});

describe("§5.4 A3 · the template carries every section", () => {
  it("the document's titles cover exactly the report's section ids", () => {
    // Different wording is allowed — a PDF heading may be longer than a screen
    // label — but a section that exists in one and not the other means the
    // document silently omits a part of the report.
    const ids = trustReportSections(empty).map((s) => s.id).sort();
    const titled = [...TEMPLATES.matchAll(/^\s{2}(\w+): "/gm)]
      .map((m) => m[1])
      .filter((k) => ids.includes(k))
      .sort();
    expect(titled).toEqual(ids);
  });

  it("the template builds its sections FROM the id list, not by hand", () => {
    // A hand-written list is how a report comes to omit the section that admits
    // its own gaps: adding a section to the report would leave the document
    // unchanged and nothing would fail.
    expect(TEMPLATES).toMatch(/build: \(\) =>\s*\n?\s*TRUST_REPORT_SECTION_IDS\.map/);
    expect(TEMPLATES).toMatch(/"data-trust"/);
  });

  it("the tool is in the closed set the render path will accept", () => {
    // `resolveToolTable` refuses anything outside `REPORT_SOURCE_TOOLS`, so a
    // template naming an unregistered tool renders nothing and says rpc_error.
    const closed = TEMPLATES.slice(
      TEMPLATES.indexOf("REPORT_SOURCE_TOOLS"),
      TEMPLATES.indexOf("];", TEMPLATES.indexOf("REPORT_SOURCE_TOOLS")),
    );
    expect(closed).toMatch(/"get_data_trust_report"/);
  });

  it("the report is computed server-side, from the grader and not from a client", () => {
    // T4. A PDF built from numbers the browser asserted is a claim about a client.
    expect(TOOL).toMatch(/loadGateDataset/);
    expect(TOOL).toMatch(/gradeDataset/);
    expect(TOOL).toMatch(/project_freshness/);
    expect(TOOL).not.toMatch(/args\.(graded|findings|freshness)/);
  });

  it("an unreadable freshness produces NO verdict rather than a clean one", () => {
    expect(TOOL).toMatch(/no verdict can be assembled/);
    expect(TOOL).toMatch(/absence of findings is not evidence that there are none/);
  });

  it("a grading failure degrades to a DECLARED limit, not an empty coverage table", () => {
    expect(TOOL).toMatch(/DECLARED limit rather than an empty coverage table/);
    expect(TOOL).toMatch(/graded = null;/);
  });
});
