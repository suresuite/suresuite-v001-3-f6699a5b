/**
 * A3 — the Trust Report as REPORT SECTIONS. §5.4, WP 6.3.
 *
 * ── WHY A SEPARATE MODULE ──────────────────────────────────────────────────
 *
 * `trustReport.ts` computes the report; `report-render` renders `{columns, rows}`
 * tables. Between those sits one decision per section: which columns, in which
 * order, with which empty-state sentence. That decision is the part a reader sees,
 * and it must be the SAME whether the report is drawn on screen, written into a
 * PDF, or exported as JSON — three renderers over one section list, never three
 * opinions about what a Trust Report contains.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * **AN EMPTY SECTION SAYS WHY IT IS EMPTY.** A coverage table with no rows reads
 * as "nothing is missing"; a findings table with no rows reads as "nothing is
 * wrong". One of those is usually true and the other usually is not, and a table
 * cannot tell them apart. So every section carries a `note` for the empty case and
 * the renderers print it instead of a blank grid. `trustReport.ts` already applies
 * the same rule one level down — `graded: null` produces a DECLARED limit rather
 * than an empty coverage list.
 *
 * **AND `knownLimits` IS A SECTION LIKE ANY OTHER, WHICH IS WHY IT CANNOT BE
 * DROPPED.** §5.4: "a trust report that does not state its own limits is
 * marketing." `trustReportSections` emits it unconditionally and
 * `trustReportSections.test.ts` fails if the list does not contain it.
 */
import type { TrustReport } from "./trustReport.ts";

export interface TrustSection {
  /** Stable id — what a caller names to fetch one section. */
  id: string;
  title: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  /** Printed INSTEAD of an empty grid. Required: see the rule above. */
  emptyNote: string;
}

const yesNo = (v: unknown): string => (v ? "yes" : "no");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function trustReportSections(r: TrustReport): TrustSection[] {
  const sections: TrustSection[] = [];

  // ── the verdict, first, and it is one row on purpose ──────────────────────
  sections.push({
    id: "headline",
    title: "Verdict",
    columns: ["Question", "Answer"],
    rows: [
      ["Project", r.projectName],
      ["Verdict", r.headline],
      ["Dataset hash", r.graphHash ?? "none — nothing here can be reproduced"],
      ["Dataset hash (short)", r.graphHashShort],
      ["Measured at", r.measuredAt],
      [
        "Dataset version",
        r.datasetVersion
          ? String((r.datasetVersion as { id?: unknown }).id ?? JSON.stringify(r.datasetVersion))
          : "no version row — the dataset is unversioned",
      ],
    ],
    emptyNote: "no verdict could be computed, which is itself the verdict",
  });

  sections.push({
    id: "coverage",
    title: "Coverage per engine-read field",
    columns: ["Field", "Policy", "Level", "From data", "Substituted", "Missing", "Named fallback"],
    rows: r.coverage.map((c) => [
      c.field, c.policyRef, c.level, c.fromData, c.substituted, c.missing,
      c.fallback ?? "none declared",
    ]),
    // NOT "everything is covered". The report's own limits say when coverage
    // could not be computed, and an empty table must not answer the question the
    // limit says is unanswered.
    emptyNote:
      "coverage was not computed for this report — see Known limits; an empty table here does not mean nothing is missing",
  });

  sections.push({
    id: "blocking",
    title: "Blocking findings",
    columns: ["Severity", "Field", "Policy", "Message"],
    // `GradedFinding` carries `policy`, not `policyRef` — the graded FIELD carries
    // the ref. Reading the wrong one here would print an empty column on every row
    // and look like a data gap rather than a typo.
    rows: r.blocking.map((f) => [f.severity, f.field, f.policy, f.message]),
    emptyNote: "no blocking findings — the required-data manifest grades green",
  });

  sections.push({
    id: "substitutions",
    title: "Substituted values",
    columns: ["Field", "Policy", "Entities substituted", "The rule that supplied it"],
    rows: r.substitutions.map((c) => [c.field, c.policyRef, c.substituted, c.fallback ?? "none declared"]),
    // T2: a substitution is visible at the point of display. An empty list here is
    // a real, good answer and it is worth stating plainly.
    emptyNote: "no value in this project came from a substitution rule",
  });

  sections.push({
    id: "freshness",
    title: "Freshness per table",
    columns: ["Table", "Rows", "Fresh", "Stale", "Unknown", "Typed", "Computed at"],
    rows: Object.entries(r.freshness).map(([table, f]) => [
      table, num(f.rows), num(f.fresh), num(f.stale), num(f.unknown),
      f.typed == null ? null : num(f.typed),
      f.computed_at ?? "never",
    ]),
    emptyNote: "no table reported freshness — `project_freshness` returned nothing",
  });

  sections.push({
    id: "runs",
    title: "Latest analysis runs",
    columns: ["Analysis", "Run", "Status", "Engine version", "Finished", "Freshness", "Warnings"],
    rows: r.latestRuns.map((run) => [
      run.analysis_kind, run.run_id, run.status, run.code_version,
      run.finished_at ?? "never", run.freshness,
      (run.warnings ?? []).length,
    ]),
    // The sentence D88 spent two packages learning: an empty run store is not a
    // clean bill, it means nothing has been computed with provenance.
    emptyNote:
      "no analysis has been run with provenance recorded — every computed figure in this project predates the run store",
  });

  sections.push({
    id: "ingest",
    title: "Upload history",
    columns: ["Run", "Fact class", "Landed", "Uploaded by", "Rows"],
    rows: r.ingestHistory.map((e) => [
      e.run_id, e.fact_class ?? "", e.landed_at ?? "", e.uploaded_by ?? "unrecorded", num(e.rows),
    ]),
    emptyNote:
      "nothing has been uploaded through the ingestion path — rows in this project were written by another route and their file, line and uploader cannot be traced",
  });

  // LAST, and unconditional. §5.4: a trust report that does not state its own
  // limits is marketing.
  sections.push({
    id: "limits",
    title: "Known limits of this report",
    columns: ["Reference", "Limit", "What it means for a number here"],
    rows: r.knownLimits.map((l) => [l.ref, l.limit, l.consequence]),
    emptyNote:
      "no limits were declared, which for this codebase would be a defect in the report rather than a clean bill",
  });

  return sections;
}

/** The JSON artifact — the whole report plus its sections, one object. */
export function trustReportJson(r: TrustReport): Record<string, unknown> {
  return {
    artifact: "suresuite.data-trust-report",
    version: 1,
    /** Whether a reader may take the headline at face value. */
    complete: r.coverage.length > 0,
    report: r,
    sections: trustReportSections(r),
    /** Restated at the top level so a reader who opens the file sees it first. */
    known_limits: r.knownLimits,
    disclosed: yesNo(r.knownLimits.length > 0),
  };
}
