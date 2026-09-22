/**
 * The run-results workbook's trust inputs, assembled the way the Trust Report
 * assembles them — audit WP 8 (F-12, F-29, D-6).
 *
 * F-12: the workbook called `knownLimits` with `tables: {}` and `latest_runs: []`,
 * so the two COUNTED limits (rows with no input hash; rows from a different
 * dataset) were never emitted — exactly the limits §4 D88 says are true of every
 * project today — under a comment calling the list "VERBATIM from the Trust
 * Report's own computation". The function was shared; the inputs were not. The
 * workbook now passes the real `project_freshness` payload and the same ingest
 * history, and `exportTrustInputs.test.ts` fails if its limits are ever fewer
 * than the report's for the same project.
 *
 * F-29: the analyses bound were the latest succeeded run per kind PROJECT-WIDE,
 * which may postdate the run being exported. They are now the latest per kind
 * that FINISHED BEFORE the run was dispatched — what could have fed it.
 */
import type { AnalysisBinding } from "@/lib/trust/reproducibilityRecord";
import type { FreshnessPayload, IngestEvent, TrustReportInput } from "@/lib/trust/trustReport";

/** `ingest_runs` rows → the report's ingest history. One mapping, both surfaces. */
export function ingestHistoryFrom(rows: Array<Record<string, unknown>>): IngestEvent[] {
  return rows.map((r) => ({
    run_id: String(r.id),
    fact_class: (r.source_kind as string) ?? null,
    landed_at: (r.applied_at as string) ?? null,
    uploaded_by: (r.applied_by_user_id as string) ?? null,
    rows: (r.rows_fetched as number) ?? null,
  }));
}

/** The export has the run, not the graded manifest — `graded: null` makes that
 *  a DECLARED limit, as it is on the report's /policies surface. */
export function exportTrustInput(
  projectName: string, freshness: FreshnessPayload, ingestHistory: IngestEvent[],
): TrustReportInput {
  return { projectName, freshness, graded: null, findings: [], ingestHistory };
}

export function analysesAtRun(
  rows: Array<Record<string, unknown>>, runCreatedAt: string | null | undefined,
  runGraphHash: string | null | undefined,
): AnalysisBinding[] {
  const cutoff = runCreatedAt ? Date.parse(runCreatedAt) : NaN;
  const latest = new Map<string, AnalysisBinding & { t: number }>();
  for (const a of rows) {
    const kind = String(a.analysis_kind ?? "");
    const t = a.finished_at ? Date.parse(String(a.finished_at)) : NaN;
    if (!kind || a.status !== "succeeded" || !Number.isFinite(t)) continue;
    if (Number.isFinite(cutoff) && t > cutoff) continue; // finished after the run: could not feed it
    const prev = latest.get(kind);
    if (prev && prev.t >= t) continue;
    const inputHash = (a.input_hash as string | null) ?? null;
    latest.set(kind, {
      t,
      kind,
      runId: (a.id as string | null) ?? null,
      codeVersion: (a.code_version as string | null) ?? null,
      inputHash,
      paramsHash: (a.params_hash as string | null) ?? null,
      finishedAt: (a.finished_at as string | null) ?? null,
      // Compared against the dataset the RUN was taken over — a record of a run,
      // not of now. Unknown is not stale (D70).
      inputHashIsCurrent: inputHash == null || !runGraphHash ? null : inputHash === runGraphHash,
    });
  }
  return [...latest.values()].map(({ t: _t, ...a }) => a);
}
