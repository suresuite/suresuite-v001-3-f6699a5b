import { describe, expect, it } from "vitest";
import { analysesAtRun, exportTrustInput, ingestHistoryFrom } from "@/lib/trust/exportTrustInputs";
import { buildTrustReport, knownLimits } from "@/lib/trust/trustReport";

const FRESH = {
  project_id: "p", graph_hash: "h".repeat(64), graph_hash_short: "hhhhhhhhhhhh",
  dataset_version: null, measured_at: "2026-09-22T12:00:00Z", latest_runs: [],
  tables: { network_nodes: { rows: 10, fresh: 2, stale: 3, unknown: 5 },
            policy_overrides: { rows: 4, fresh: 3, stale: 1, unknown: 0 } },
} as never;

// Audit F-12 / D-6. The workbook called `knownLimits` with `tables: {}` and
// `latest_runs: []`, so the two COUNTED limits — rows with no input hash, rows
// from a different dataset — were never emitted, while a comment said the list
// was "VERBATIM from the Trust Report's own computation". The function was
// shared; the inputs were not.
describe("the workbook's limits are never more optimistic than the Trust Report's", () => {
  it("every limit the report states for a project, the export states too", () => {
    const ingest = ingestHistoryFrom([]);
    const report = buildTrustReport({ projectName: "P", freshness: FRESH, graded: null,
                                      findings: [], ingestHistory: ingest }).knownLimits;
    const exported = knownLimits(exportTrustInput("P", FRESH, ingest));
    const key = (l: { ref: string; limit: string }) => `${l.ref}|${l.limit}`;
    const have = new Set(exported.map(key));
    expect(report.map(key).filter((k) => !have.has(k))).toEqual([]);
    // and the counted ones are there — the two the empty payload suppressed
    expect(exported.some((l) => /5 computed row\(s\).*no input hash/.test(l.limit))).toBe(true);
    expect(exported.some((l) => /4 computed row\(s\) were produced from a different dataset/.test(l.limit))).toBe(true);
  });

  it("the ingest history is mapped once, for both surfaces", () => {
    expect(ingestHistoryFrom([{ id: "r1", source_kind: "csv", applied_at: "t", applied_by_user_id: "u", rows_fetched: 3 }]))
      .toEqual([{ run_id: "r1", fact_class: "csv", landed_at: "t", uploaded_by: "u", rows: 3 }]);
  });
});

// Audit F-29. The workbook bound the latest succeeded analysis PER KIND,
// PROJECT-WIDE — which may have finished after the run being exported.
describe("the analyses bound are the ones that existed when the run was dispatched", () => {
  const rows = [
    { id: "late", analysis_kind: "network_metrics", status: "succeeded", finished_at: "2026-09-22T12:00:00Z", input_hash: "h", code_version: "c", params_hash: "p" },
    { id: "early", analysis_kind: "network_metrics", status: "succeeded", finished_at: "2026-09-22T08:00:00Z", input_hash: "h", code_version: "c", params_hash: "p" },
    { id: "only-later", analysis_kind: "prominence", status: "succeeded", finished_at: "2026-09-22T13:00:00Z", input_hash: "h", code_version: "c", params_hash: "p" },
  ];
  const bound = analysesAtRun(rows, "2026-09-22T10:00:00Z", "h");
  it("picks the latest one finished BEFORE the run, not the latest overall", () => {
    expect(bound.find((a) => a.kind === "network_metrics")?.runId).toBe("early");
  });
  it("binds nothing for a kind that only ran after", () => {
    expect(bound.find((a) => a.kind === "prominence")).toBeUndefined();
  });
});
