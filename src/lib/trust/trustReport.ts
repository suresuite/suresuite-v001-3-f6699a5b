/**
 * WP 4.4 · A3 — THE PROJECT DATA TRUST REPORT, ASSEMBLED.
 *
 * §5.4 says A3 is "mostly assembly of what `grading.ts` already computes", and
 * the word doing the work is MOSTLY. Assembly is the easy half; the half the
 * section calls non-optional is the last one:
 *
 *     "a trust report that does not state its own limits is marketing."
 *
 * So `knownLimits()` is not a footnote generated from a template — every entry
 * is a limit this codebase actually has, each one traceable to a defect number
 * or an invariant that is not yet met, and the list is assembled from the
 * report's own inputs so it cannot claim a clean bill for a project whose data
 * says otherwise.
 *
 * WHY THIS IS A PURE MODULE. It takes numbers and returns numbers, so the
 * report can be unit-tested, rendered by a component, and — in WP 6.3 — emitted
 * as the A3 PDF/JSON through `report-render` without a second implementation.
 * Two implementations of one report is how `columnSpecs.defaultWhenMissing`
 * came to disagree with the Zod bundle (WP 6.2).
 */

import type { GradedField, GradedFinding } from "./gradingTypes";

/** One table's classification, straight from `public.project_freshness`. */
export interface TableFreshness {
  rows: number;
  fresh: number;
  stale: number;
  unknown: number;
  /** `policy_overrides` only — an override a person typed has no provenance to miss. */
  typed?: number;
  computed_at: string | null;
}

/** The payload `public.project_freshness(project)` returns. */
export interface FreshnessPayload {
  project_id: string;
  graph_hash: string | null;
  graph_hash_short: string;
  dataset_version: Record<string, unknown> | null;
  tables: Record<string, TableFreshness>;
  latest_runs: Array<{
    analysis_kind: string;
    run_id: string;
    status: string;
    code_version: string;
    finished_at: string | null;
    freshness: "fresh" | "stale" | "unknown";
    warnings: unknown[];
  }>;
  measured_at: string;
}

export interface IngestEvent {
  run_id: string;
  fact_class: string | null;
  landed_at: string | null;
  uploaded_by: string | null;
  rows: number | null;
}

export interface TrustReportInput {
  projectName: string;
  freshness: FreshnessPayload;
  /**
   * NULL when the caller could not compute coverage — the /policies surface has
   * `Finding[]` but not the graded manifest behind it. A null here produces a
   * DECLARED limit rather than an empty section: a coverage table silently
   * rendering zero rows reads as "nothing is missing", which is the exact
   * over-claim T1 forbids.
   */
  graded: GradedField[] | null;
  findings: GradedFinding[];
  ingestHistory: IngestEvent[];
}

export interface CoverageLine {
  field: string;
  policyRef: string;
  level: string;
  /** Entities whose value came from uploaded data. */
  fromData: number;
  /** Entities resolved by a NAMED substitution rule. */
  substituted: number;
  /** Entities nothing resolves. */
  missing: number;
  /** The rule's own prose, or null when the field has no declared fallback. */
  fallback: string | null;
}

export interface KnownLimit {
  /** The defect or invariant this limit comes from, so it can be looked up. */
  ref: string;
  limit: string;
  /** What it means for a number in this report. */
  consequence: string;
}

export interface TrustReport {
  projectName: string;
  graphHash: string | null;
  graphHashShort: string;
  datasetVersion: Record<string, unknown> | null;
  measuredAt: string;
  coverage: CoverageLine[];
  blocking: GradedFinding[];
  substitutions: CoverageLine[];
  freshness: FreshnessPayload["tables"];
  latestRuns: FreshnessPayload["latest_runs"];
  ingestHistory: IngestEvent[];
  knownLimits: KnownLimit[];
  /** A one-line verdict, and it is never better than the limits allow. */
  headline: string;
}

/** Coverage per engine-read field — data, named substitution, or nothing. */
export function coverageOf(graded: GradedField[]): CoverageLine[] {
  return graded
    .filter((g) => g.evaluable)
    .map((g) => ({
      field: g.field,
      policyRef: g.policyRef,
      level: String(g.level),
      fromData: g.set.length,
      substituted: g.resolved.length,
      missing: g.missing.length,
      fallback: g.fallbackProse,
    }))
    .sort((a, b) => b.missing - a.missing || a.field.localeCompare(b.field));
}

/**
 * The limits, assembled from the report's own inputs.
 *
 * Every entry is either ALWAYS true of this system today — in which case it
 * names the defect or the unmet invariant — or true of THIS project's numbers,
 * in which case the count is in the text. A limits block that is identical for
 * every project is a disclaimer; one that changes with the data is a finding.
 */
export function knownLimits(input: TrustReportInput): KnownLimit[] {
  const out: KnownLimit[] = [];
  const t = input.freshness.tables;

  const unknownRows = Object.entries(t).reduce((n, [, v]) => n + (v.unknown ?? 0), 0);
  if (unknownRows > 0) {
    out.push({
      ref: "I5 · input-hash",
      limit: `${unknownRows} computed row(s) in this project carry no input hash.`,
      consequence:
        "They were written before provenance existed, so nothing can say which " +
        "data produced them. They are reported as UNKNOWN rather than as stale: " +
        "we cannot tell, and saying otherwise would be a guess.",
    });
  }

  const staleRows = Object.entries(t).reduce((n, [, v]) => n + (v.stale ?? 0), 0);
  if (staleRows > 0) {
    out.push({
      ref: "WP 4.4",
      limit: `${staleRows} computed row(s) were produced from a different dataset than the one loaded now.`,
      consequence:
        "Any figure derived from them describes a version of this project that " +
        "no longer exists. Re-run the affected analyses before quoting them.",
    });
  }

  const staleOverrides = t.policy_overrides?.stale ?? 0;
  if (staleOverrides > 0) {
    out.push({
      ref: "WP 4.4 · engine input",
      limit: `${staleOverrides} policy override(s) were seeded from data this project no longer holds.`,
      consequence:
        "THE ENGINE READS OVERRIDES, NOT THE GRID. This is a simulation " +
        "correctness problem and not a display one: a run will use the seeded " +
        "number, not the number now on screen.",
    });
  }

  // ── THE ALWAYS-TRUE HALF, AND WHY IT IS THE DANGEROUS HALF ────────────────
  //
  // Stating these is the whole difference between a trust report and a marketing
  // page. It is also the half NOTHING RECOMPUTES, and §4 D103 is what that cost:
  // two entries here outlived the defects they described and went on being
  // published to users on every project, more pessimistic than the software.
  //
  //   · "the dataset hash does not cover the deep-tier network" cited §4 D75,
  //     which `20260917000009` CLOSED by folding exactly the six deep-tier
  //     topology columns into `hash_network` at `schema_version` 3;
  //   · "sixteen database functions write data without naming the person who ran
  //     them" was §4 D71/D78's figure, and WP 6.2 slices 11 and 12 closed that
  //     list to four names, none of which is debt — three attribute through
  //     `assert_writer_may_act` and the fourth `RETURNS trigger`, which
  //     PostgreSQL forbids from declaring arguments.
  //
  // Both are gone. What replaces the second is the limit that IS still true, and
  // it is at the edge rather than in the database. And `ref` is now GATED: a
  // `§4 D<n>` reference is checked against §4's own "Closed by" column by
  // `trustReportLimits.test.ts`, so an entry citing a closed defect fails CI
  // instead of reaching a reader. That gate is the actual fix — the two
  // corrections above are what it would have caught.
  out.push({
    ref: "§4 D28",
    limit:
      "Three calls in the public API write data without naming a person.",
    consequence:
      "The API's principal is a key, not a user, so those writes record that a " +
      "change happened and cannot name who asked for it. A fabricated user id " +
      "would be worse: the trail would read as though somebody acted when " +
      "nobody did.",
  });
  out.push({
    ref: "§4 D28",
    limit: "User identity is asserted by the client, not proved by the database.",
    consequence:
      "This application authenticates against its own user table rather than " +
      "Supabase Auth. An uploader's name is a real constraint — the database " +
      "refuses a landing into a project that user cannot reach — but it is not " +
      "proof of identity.",
  });

  if (input.graded === null) {
    out.push({
      ref: "T3",
      limit: "Per-field coverage could not be computed for this report.",
      consequence:
        "The surface that produced it has the findings but not the graded " +
        "manifest behind them, so this report does not say how many entities " +
        "each engine-read field covers. Absence of a coverage table here is not " +
        "evidence that coverage is complete.",
    });
  }

  // §4 D119 — a requirement the grader has no binding for is `evaluable: false`,
  // and every surface DROPPED it in silence until WP 6.2. Reporting it here is
  // T3 applied to the report's own inputs: the engine reads this field, and this
  // report cannot tell you how well it is covered.
  const unevaluable = (input.graded ?? []).filter((g) => !g.evaluable);
  if (unevaluable.length > 0) {
    out.push({
      ref: "§4 D119 (closed — this is the measurement it made visible)",
      limit:
        `${unevaluable.length} field(s) the engine reads are not measurable on ` +
        `this report: ${unevaluable.map((g) => g.field).join(", ")}.`,
      consequence:
        "The engine consumes them and the grader has no binding for their " +
        "table, so the coverage table above does not count them. Absence from " +
        "that table is not evidence that they are covered — for these fields " +
        "the engine is using its own defaults and nothing here can say for how " +
        "many entities.",
    });
  }

  if (input.ingestHistory.length === 0) {
    out.push({
      ref: "T3",
      limit: "No ingestion history is recorded for this project.",
      consequence:
        "Rows may predate server-side landing, in which case the file, the row " +
        "and the uploader behind them cannot be traced.",
    });
  }

  return out;
}

/**
 * The headline, which is NEVER better than the limits allow.
 *
 * A trust report whose summary line says "good" over a blocking finding is the
 * failure mode the whole standard exists to prevent, so the verdict is derived
 * from the findings and the counts rather than written by a caller.
 */
export function headlineOf(
  blocking: GradedFinding[],
  freshness: FreshnessPayload,
): string {
  const t = freshness.tables;
  const stale = Object.values(t).reduce((n, v) => n + (v.stale ?? 0), 0);
  const unknown = Object.values(t).reduce((n, v) => n + (v.unknown ?? 0), 0);

  if (blocking.length > 0) {
    return `${blocking.length} blocking finding(s): this project is not ready to run.`;
  }
  if (stale > 0) {
    return `No blocking findings, but ${stale} computed row(s) describe an older version of this dataset.`;
  }
  if (unknown > 0) {
    return `No blocking findings. ${unknown} computed row(s) cannot say which data produced them.`;
  }
  if (!freshness.graph_hash) {
    return "This project has no dataset hash, so nothing here can be reproduced.";
  }
  return "No blocking findings, and every computed row names the dataset now loaded.";
}

export function buildTrustReport(input: TrustReportInput): TrustReport {
  const coverage = input.graded === null ? [] : coverageOf(input.graded);
  const blocking = input.findings.filter((f) => f.severity === "block");
  return {
    projectName: input.projectName,
    graphHash: input.freshness.graph_hash,
    graphHashShort: input.freshness.graph_hash_short,
    datasetVersion: input.freshness.dataset_version,
    measuredAt: input.freshness.measured_at,
    coverage,
    blocking,
    // A substitution is a value the product SHOWS that no upload contained. T2
    // says it is visible at the point of display; this section is where the
    // report says how many there are and which rule produced each.
    substitutions: coverage.filter((c) => c.substituted > 0),
    freshness: input.freshness.tables,
    latestRuns: input.freshness.latest_runs,
    ingestHistory: input.ingestHistory,
    knownLimits: knownLimits(input),
    headline: headlineOf(blocking, input.freshness),
  };
}
