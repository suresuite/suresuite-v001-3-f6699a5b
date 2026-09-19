/**
 * A5 — the Reproducibility Record. §5.4, and `result-binding` (I8) as a deliverable.
 *
 * ── THE QUESTION IT ANSWERS ────────────────────────────────────────────────
 *
 * §5.4's five artifacts escalate, and A5 is the last: *"Can I reproduce this in two
 * years?"* Not "is the data good" (A3) and not "where did this number come from"
 * (A2) — whether somebody who has this record and nothing else can put the system
 * back into the state that produced a figure.
 *
 * I8 states the same thing as an invariant: **every result binds dataset + policy +
 * scenario + engine version.** §2.1 has listed it as NOT MET since it was written.
 *
 * ── WHAT WAS ALREADY THERE, AND WHAT WAS NOT ──────────────────────────────
 *
 * `verifiableExports.ts::buildRunResultsWorkbook` (A4) already binds four of the
 * five for a SIMULATION run: `dataset_version_id` + `graph_hash`,
 * `policy_version_id` + `policy_hash`, the scenario with its full disruption
 * schedule and root seed, and `code_version`. A4 is strong and this module does not
 * replace it.
 *
 * Two things were missing, and they are what A5 adds:
 *
 * 1. **THE ANALYSIS VERSIONS.** A figure on a network page does not come from a
 *    simulation run at all — it comes from an `analysis_runs` row, with its own
 *    `input_hash`, `params_hash` and `code_version`. Nothing bound those to
 *    anything a user could keep. So the half of the product that computes
 *    centralities, prominence and critical nodes had no reproducibility story,
 *    while the half that simulates had a strong one.
 * 2. **THE DECLARED LIMITS.** T4 says any figure leaving the system carries the
 *    versions that produced it; T3 says every report states the limits of its own
 *    computation. A record that listed hashes and stopped would satisfy the first
 *    and quietly fail the second — and the limits are exactly what a reader in two
 *    years needs, because they say which parts of the record cannot be trusted to
 *    reproduce.
 *
 * ── THE RULE THIS MODULE IS BUILT ON ──────────────────────────────────────
 *
 * **A MISSING BINDING IS RECORDED, NEVER OMITTED.** Every part is a
 * `Binding`: either a value with the field it came from, or `null` with a stated
 * reason. A record that silently drops the policy hash because the run had none
 * reads as a complete record — which is the over-claim T1 forbids, and it is worse
 * here than anywhere else, because the whole artifact is a claim about
 * completeness.
 *
 * That is why `reproducible` is computed rather than asserted: it is true only when
 * every REQUIRED binding is present, and the record says which ones are not.
 */
import type { KnownLimit } from "./trustReport";

/** One bound fact, or the stated absence of one. */
export interface Binding {
  /** What this binds — the vocabulary a reader matches against an export. */
  key: string;
  /** Human label for the record. */
  label: string;
  /** The value, or null when nothing bound it. */
  value: string | null;
  /**
   * WHERE the value came from — a table.column, an RPC, or a file. A value with no
   * source is a number with no provenance, which is T1's whole subject, so this is
   * required even when `value` is null (it then says where it WOULD come from).
   */
  source: string;
  /**
   * Whether reproduction is impossible without it. A `recommended` binding missing
   * is a caveat; a `required` one missing means the record cannot reproduce the
   * figure and must say so.
   */
  level: "required" | "recommended";
  /** Why it is absent. Required when `value` is null, forbidden when it is not. */
  absentBecause?: string;
}

export interface AnalysisBinding {
  kind: string;
  runId: string | null;
  codeVersion: string | null;
  inputHash: string | null;
  paramsHash: string | null;
  /** When the run finished; null for a run that never did. */
  finishedAt: string | null;
  /**
   * Whether `inputHash` is the project's dataset hash NOW. NULL when either side
   * is unknown — unknown is not stale (D70).
   */
  inputHashIsCurrent: boolean | null;
}

export interface ReproducibilityRecordInput {
  projectId: string;
  projectName: string;
  /** The dataset anchor as the project holds it now. */
  graphHash: string | null;
  datasetVersionId: string | null;
  /** `dataset_versions.schema_version` — which hash ALGORITHM produced it. */
  hashSchemaVersion: number | null;
  policyVersionId: string | null;
  policyHash: string | null;
  scenarioId: string | null;
  scenarioSeed: number | null;
  /** The engine the WORKER ran, from `simulation_runs.code_version`. */
  engineCodeVersion: string | null;
  /**
   * The engine the BROWSER ran, from `public/engine/manifest.json`.
   *
   * A SEPARATE BINDING ON PURPOSE (§4 D87). The wheels are committed so the Vercel
   * build stays pure-Vite, so the browser and the worker can run different engine
   * code — `single-source` (I1) across a boundary no test crosses. A record that
   * bound one version would be silently wrong for whichever surface produced the
   * figure, and "unknown" is a real answer here: the manifest carried exactly that
   * string until WP 6.2 made a failed version lookup fatal.
   */
  browserEngineVersion: string | null;
  /** Every analysis whose output this project's screens display. */
  analyses: AnalysisBinding[];
  /** The Trust Report's own limits, verbatim — T3 rather than a second list. */
  limits: KnownLimit[];
  measuredAt: string;
}

export interface ReproducibilityRecord {
  projectId: string;
  projectName: string;
  measuredAt: string;
  bindings: Binding[];
  analyses: AnalysisBinding[];
  limits: KnownLimit[];
  /** True only when every `required` binding has a value. */
  reproducible: boolean;
  /** The required bindings that are missing, by key. */
  missing: string[];
  /** One line, and it is never better than the bindings allow. */
  headline: string;
}

const bind = (
  key: string,
  label: string,
  value: string | null,
  source: string,
  level: Binding["level"],
  absentBecause: string,
): Binding =>
  value === null || value === ""
    ? { key, label, value: null, source, level, absentBecause }
    : { key, label, value, source, level };

/**
 * The five bindings I8 names, plus the two this product needs and I8 does not
 * mention: the hash's own ALGORITHM version, and the browser engine.
 *
 * `hash_schema_version` is required and it is the binding most likely to be
 * overlooked. `graph_hash` is a SHA-256 over a snapshot whose SHAPE has changed
 * three times (`schema_version` 1 → 2 → 3, most recently when WP 5.3 folded the
 * deep-tier topology in). Two runs can carry different hashes over identical data,
 * or — worse — the same hash cannot be recomputed in two years without knowing
 * which snapshot builder produced it. A record with the hash and not the version
 * says "here is a number you cannot check".
 */
export function bindingsOf(input: ReproducibilityRecordInput): Binding[] {
  return [
    bind(
      "dataset.graph_hash",
      "Dataset hash",
      input.graphHash,
      "dataset_versions.graph_hash (via current_graph_hash)",
      "required",
      "this project has no dataset version, so there is no anchor to reproduce against — " +
        "nothing here can be checked",
    ),
    bind(
      "dataset.version_id",
      "Dataset version",
      input.datasetVersionId,
      "dataset_versions.id",
      "recommended",
      "the hash is present without a version row, so the data can be checked but not named",
    ),
    bind(
      "dataset.hash_schema_version",
      "Hash algorithm version",
      input.hashSchemaVersion === null ? null : String(input.hashSchemaVersion),
      "dataset_versions.schema_version",
      "required",
      "without it the hash cannot be RECOMPUTED — the snapshot's shape has changed " +
        "three times, and the same data produces a different hash under each",
    ),
    bind(
      "policy.version_id",
      "Policy version",
      input.policyVersionId,
      "simulation_runs.policy_version_id",
      "required",
      "no policy version is bound, so the decisions behind the figure are not recorded",
    ),
    bind(
      "policy.hash",
      "Policy hash",
      input.policyHash,
      "simulation_runs.policy_hash",
      "required",
      "the policy version is not fingerprinted, so a later edit to it cannot be detected",
    ),
    bind(
      "scenario.id",
      "Scenario",
      input.scenarioId,
      "simulation_runs.scenario_id",
      "required",
      "no scenario is bound — the disruption schedule, horizon and warm-up are unrecorded",
    ),
    bind(
      "scenario.seed",
      "Root seed",
      input.scenarioSeed === null ? null : String(input.scenarioSeed),
      "sim_scenarios.seed",
      "required",
      "without the seed the run is not repeatable even with identical inputs",
    ),
    bind(
      "engine.worker_code_version",
      "Engine version (worker)",
      input.engineCodeVersion,
      "simulation_runs.code_version",
      "required",
      "the engine that produced the figure is unrecorded, so a later engine cannot be " +
        "compared against it",
    ),
    bind(
      "engine.browser_version",
      "Engine version (browser)",
      input.browserEngineVersion,
      "public/engine/manifest.json",
      "recommended",
      "the browser engine's version is unknown — a figure computed in the browser " +
        "cannot be attributed to a specific engine build (§4 D87)",
    ),
  ];
}

/**
 * The record. `reproducible` is DERIVED, and the headline is never better than it.
 *
 * The failure mode this guards against is the one A3's headline guards against:
 * a summary line that says "reproducible" over a missing seed. The verdict comes
 * from the bindings, not from a caller.
 */
export function buildReproducibilityRecord(
  input: ReproducibilityRecordInput,
): ReproducibilityRecord {
  const bindings = bindingsOf(input);
  const missing = bindings
    .filter((b) => b.level === "required" && b.value === null)
    .map((b) => b.key);
  const reproducible = missing.length === 0;

  // An analysis whose `input_hash` is not the project's current hash reproduces
  // ITSELF perfectly and does not describe the data now loaded. Both facts matter
  // and they are different, so the headline says which.
  const staleAnalyses = input.analyses.filter((a) => a.inputHashIsCurrent === false);
  const unhashedAnalyses = input.analyses.filter((a) => a.inputHash === null);

  let headline: string;
  if (!reproducible) {
    headline =
      `NOT reproducible: ${missing.length} required binding(s) missing ` +
      `(${missing.join(", ")}).`;
  } else if (unhashedAnalyses.length > 0) {
    headline =
      `Reproducible, except ${unhashedAnalyses.length} analysis result(s) that record ` +
      `no input hash — nothing can say which data produced them.`;
  } else if (staleAnalyses.length > 0) {
    headline =
      `Reproducible as recorded. ${staleAnalyses.length} analysis result(s) describe an ` +
      `earlier version of this dataset — they reproduce themselves, not the data now loaded.`;
  } else if (input.analyses.length === 0) {
    headline =
      "Reproducible as recorded. No analysis has been run for this project, so this " +
      "record binds the simulation inputs only.";
  } else {
    headline = "Reproducible: every required binding is recorded and every analysis names its inputs.";
  }

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    measuredAt: input.measuredAt,
    bindings,
    analyses: input.analyses,
    limits: input.limits,
    reproducible,
    missing,
    headline,
  };
}

/**
 * The record as flat rows — the shape a workbook sheet or a JSON export takes.
 *
 * Kept here rather than in `verifiableExports.ts` so the record has ONE
 * definition: A4's workbook can render these rows, `report-render` can serialise
 * them, and neither owns the vocabulary. A second flattener is how two exports
 * come to disagree about what "bound" means.
 */
export function recordRows(record: ReproducibilityRecord): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [
    ["SuReSuite — REPRODUCIBILITY RECORD (A5)"],
    [
      "Scope",
      "Everything needed to put this project back into the state that produced its " +
        "figures: the dataset anchor and the algorithm that computed it, the policy " +
        "version and its fingerprint, the scenario and seed, both engine versions, every " +
        "analysis run behind a displayed metric, and the known limits of all of it. A " +
        "binding that is MISSING is listed with the reason — an omitted line would read " +
        "as a complete record.",
    ],
    [],
    ["project_id", record.projectId],
    ["project_name", record.projectName],
    ["measured_at", record.measuredAt],
    ["reproducible", String(record.reproducible)],
    ["verdict", record.headline],
    [],
    ["BINDINGS", "", "", "", ""],
    ["key", "what it binds", "value", "source", "if absent, why"],
  ];
  for (const b of record.bindings) {
    rows.push([
      b.key,
      b.label,
      b.value ?? `MISSING (${b.level})`,
      b.source,
      b.value === null ? (b.absentBecause ?? "") : "",
    ]);
  }
  rows.push([], ["ANALYSIS RUNS", "", "", "", ""]);
  if (record.analyses.length === 0) {
    rows.push([
      "(none)",
      "No analysis has been run for this project.",
      "",
      "analysis_runs",
      "Network metrics shown on screen, if any, come from values stored before the " +
        "analysis store existed and cannot be attributed to a run (§4 D88).",
    ]);
  } else {
    rows.push(["analysis_kind", "run_id", "code_version", "input_hash", "params_hash", "input hash is current"]);
    for (const a of record.analyses) {
      rows.push([
        a.kind,
        a.runId ?? "",
        a.codeVersion ?? "",
        a.inputHash ?? "MISSING — nothing can say which data produced this",
        a.paramsHash ?? "",
        a.inputHashIsCurrent === null ? "unknown" : String(a.inputHashIsCurrent),
      ]);
    }
  }
  rows.push([], ["KNOWN LIMITS", "", "", "", ""]);
  if (record.limits.length === 0) {
    // T3 — and an empty limits block is itself a limit. A report claiming none is
    // making the strongest claim in the document, so it says so out loud.
    rows.push([
      "(none reported)",
      "No limits were supplied to this record. That is not evidence there are none — " +
        "the caller did not compute them.",
      "",
      "",
      "",
    ]);
  } else {
    rows.push(["ref", "limit", "what it means for a figure here"]);
    for (const l of record.limits) rows.push([l.ref, l.limit, l.consequence]);
  }
  return rows;
}
