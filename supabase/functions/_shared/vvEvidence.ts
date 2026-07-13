// B3 V&V Analyst deterministic surface — Phase B / §12 / AI agents
// (design: docs/design/ai-agents.md §5.3 hard gates, §4.4 model_card_draft).
//
// The ONE computed-block module consumed by BOTH agent surfaces:
//   * the draft tool handler (project-ai-chat/vvTools.ts) — assembles
//     payload.computed by READING the evidence run's persisted output; the
//     LLM contributes only verdict/basis/narrative (§5.3: "card content is
//     computed, never asserted")
//   * the apply function (agent-apply/modelCardApply.ts) — passes the stored
//     computed block verbatim into record_model_validation
//
// The statistics are server-side equivalents of the Run & Validate stage's
// client math (src/lib/sim/validationStats.ts::welchWarmup/mser5 and
// RunValidateStage.tsx's adequacy/meanCI/n* formulas) over FULL persisted
// series — ported verbatim so the two surfaces cannot disagree. Constants are
// the §5.3 adequacy defaults: confidence 0.95, target precision ε = 0.10.
//
// Persisted-statistics law (§5.3 refusal rules): validation tests (KS/t) need
// user-uploaded empirical series, which the platform does NOT persist at run
// level — so `validation_tests` here can only come from an already-persisted
// model_validations card recorded from the SAME evidence run (re-adoption).
// Absent that, tests are empty and the honest basis is "face" — enforced by
// applyVerdictDowngrade (§5.3 hard gate 3), never by prompt quality.
//
// Like grading.ts, dependency-free pure TypeScript over injected rows.

export const VV_CONFIDENCE = 0.95; // §5.3 DEFAULT
export const VV_TARGET_PRECISION = 0.10; // §5.3 DEFAULT (ε)

/** Focal KPIs (the shipped Run & Validate default selection), intersected at
 * runtime with the KPIs the replications actually persisted. */
export const VV_FOCAL_KPIS = ["fill_rate", "max_backlog"] as const;

export interface EvidenceRunRow {
  id: string;
  project_id: string;
  status: string;
  warmup_detected_at: number | null; // weeks (engine-adopted cut)
  rep_count_done: number;
  gate_skipped?: boolean | null;
  policy_version_id: string | null;
  policy_hash: string | null;
  scenario_id?: string | null;
  scenario_hash?: string | null;
  dataset_version_id?: string | null;
  code_version?: string | null;
  aggregate_kpis?: Record<string, number> | null;
}

export interface EvidenceRepRow {
  rep_index: number;
  status: string;
  kpis: Record<string, number>;
  time_series: Record<string, number[]> | null;
}

export interface ValidationTest {
  kpi: string;
  ks: number;
  ks_p: number;
  t: number;
  t_p: number;
  n: number;
  source: string;
  pass: boolean;
}

export interface PerKpiAdequacy {
  mean: number;
  half: number;
  rel: number;
  n: number;
  n_star: number;
}

/** The shapes record_model_validation accepts (20260710000001:157-173). */
export interface ComputedBlock {
  adopted_warmup_days: number;
  warmup_method: "engine" | "welch" | "mser5";
  recommended_replications: number;
  replication_basis: {
    confidence: number;
    target_precision: number;
    per_kpi: Record<string, PerKpiAdequacy>;
  };
  validation_tests: ValidationTest[];
  findings: Array<Record<string, unknown>>;
  /** true when every focal KPI's completed n ≥ its n* (adequacy met). */
  adequacy_met: boolean;
}

// ── statistics (ports of src/lib/sim/validationStats.ts — keep in lockstep) ──

const avg = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const sampleStd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** z for the §5.3 confidence vocabulary (RunValidateStage.tsx adequacy memo). */
export const zFor = (confidence: number): number =>
  confidence >= 0.99 ? 2.576 : confidence >= 0.95 ? 1.96 : 1.645;

/** Element-wise mean across replications: series[rep][week] → mean[week]. */
export function crossRepMean(series: number[][]): number[] {
  const n = Math.min(...series.map((s) => s.length));
  if (!Number.isFinite(n) || n <= 0) return [];
  const out = new Array<number>(n);
  for (let t = 0; t < n; t++) {
    let s = 0;
    for (const rep of series) s += rep[t];
    out[t] = s / series.length;
  }
  return out;
}

/** Welch's moving-average warm-up estimator (validationStats.ts::welchWarmup). */
export function welchWarmup(series: number[][], window = 5, tol = 0.02): number {
  const m = crossRepMean(series);
  if (m.length < window * 2 + 2) return 0;
  const half = Math.floor(window / 2);
  const smooth: number[] = [];
  for (let t = 0; t < m.length; t++) {
    const lo = Math.max(0, t - half);
    const hi = Math.min(m.length - 1, t + half);
    smooth.push(avg(m.slice(lo, hi + 1)));
  }
  const tailStart = Math.floor(smooth.length * (2 / 3));
  const steady = avg(smooth.slice(tailStart));
  const scale = Math.abs(steady) > 1e-12 ? Math.abs(steady) : 1;
  for (let t = 0; t < tailStart; t++) {
    const rest = smooth.slice(t, tailStart);
    if (rest.every((v) => Math.abs(v - steady) / scale <= tol)) return t;
  }
  return tailStart;
}

/** MSER-5 truncation point in weeks (validationStats.ts::mser5). */
export function mser5(series: number[][]): number {
  const m = crossRepMean(series);
  const batch = 5;
  const nBatches = Math.floor(m.length / batch);
  if (nBatches < 4) return 0;
  const means: number[] = [];
  for (let b = 0; b < nBatches; b++) means.push(avg(m.slice(b * batch, (b + 1) * batch)));
  let bestD = 0;
  let bestStat = Number.POSITIVE_INFINITY;
  for (let d = 0; d <= Math.floor(nBatches / 2); d++) {
    const rest = means.slice(d);
    const mRest = avg(rest);
    const variance = rest.length < 2
      ? 0
      : rest.reduce((a, b) => a + (b - mRest) ** 2, 0) / (rest.length - 1);
    const stat = variance / (rest.length * rest.length);
    if (stat < bestStat) {
      bestStat = stat;
      bestD = d;
    }
  }
  return bestD * batch;
}

/** Per-KPI adequacy: mean ± CI at the confidence, n* = (z·s/(ε·x̄))² —
 * RunValidateStage.tsx's adequacy memo, verbatim math. */
export function adequacyForKpi(
  values: number[],
  confidence = VV_CONFIDENCE,
  targetPrecision = VV_TARGET_PRECISION,
): PerKpiAdequacy | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return null;
  const z = zFor(confidence);
  const mean = avg(xs);
  const std = sampleStd(xs);
  const half = xs.length > 1 ? (z * std) / Math.sqrt(xs.length) : 0;
  const rel = mean !== 0 ? half / Math.abs(mean) : 0;
  const nStar = mean !== 0 && targetPrecision > 0
    ? Math.max(1, Math.ceil(((z * std) / (targetPrecision * Math.abs(mean))) ** 2))
    : xs.length;
  return { mean, half, rel, n: xs.length, n_star: nStar };
}

// ── the handler-read computed block (§5.3) ───────────────────────────────────

export interface BuildComputedArgs {
  run: EvidenceRunRow;
  reps: EvidenceRepRow[];
  /** Verifier findings for the project at draft time (shared grader output). */
  findings: Array<Record<string, unknown>>;
  /** Tests from an already-persisted card recorded from THIS evidence run
   * (the only persisted source of statistical tests — see header). */
  persistedTests?: ValidationTest[] | null;
  confidence?: number;
  targetPrecision?: number;
}

/**
 * Assemble payload.computed by reading the evidence run — the tool handler
 * (never the model) calls this, so a hallucinated number cannot exist in the
 * payload by construction (§5.3 hard gate 2).
 */
export function buildComputedBlock(args: BuildComputedArgs): ComputedBlock {
  const { run } = args;
  const confidence = args.confidence ?? VV_CONFIDENCE;
  const targetPrecision = args.targetPrecision ?? VV_TARGET_PRECISION;
  const doneReps = args.reps.filter((r) => r.status === "done" || r.status === "completed");

  // Warm-up: the engine's detected week when recorded, else Welch over the
  // persisted weekly fill-rate series (RunValidateStage.tsx::detectWarmup).
  let warmupMethod: ComputedBlock["warmup_method"] = "engine";
  let warmupWeeks = run.warmup_detected_at;
  if (warmupWeeks == null) {
    const frSeries = doneReps
      .map((r) => r.time_series?.fill_rate)
      .filter((s): s is number[] => Array.isArray(s) && s.length > 0);
    warmupWeeks = frSeries.length > 0 ? welchWarmup(frSeries) : 0;
    warmupMethod = frSeries.length > 0 ? "welch" : "engine";
  }
  const adoptedWarmupDays = Math.max(0, Math.round((warmupWeeks ?? 0) * 7));

  // Replication adequacy per focal KPI, from persisted per-rep scalars.
  const perKpi: Record<string, PerKpiAdequacy> = {};
  for (const kpi of VV_FOCAL_KPIS) {
    const values = doneReps.map((r) => Number(r.kpis?.[kpi]));
    const a = adequacyForKpi(values, confidence, targetPrecision);
    if (a) perKpi[kpi] = a;
  }
  // §5.3 failure modes: the recommendation quotes the MAX n* across focal
  // KPIs (pinned by vv-07).
  const recommended = Object.keys(perKpi).length > 0
    ? Math.max(1, ...Object.values(perKpi).map((s) => s.n_star))
    : Math.max(1, doneReps.length);
  const adequacyMet = Object.keys(perKpi).length > 0 &&
    Object.values(perKpi).every((s) => s.n >= s.n_star);

  const findings = [...args.findings];
  if (run.gate_skipped) {
    // vv-05: a gate-skipped evidence run is flagged on the card itself.
    findings.push({
      severity: "warn",
      field: "run.gate_skipped",
      policy: "engine",
      rows: [run.id],
      message:
        "The evidence run was dispatched with the required-data gate skipped — its inputs were not verified.",
    });
  }

  return {
    adopted_warmup_days: adoptedWarmupDays,
    warmup_method: warmupMethod,
    recommended_replications: recommended,
    replication_basis: {
      confidence,
      target_precision: targetPrecision,
      per_kpi: perKpi,
    },
    validation_tests: args.persistedTests ?? [],
    findings,
    adequacy_met: adequacyMet,
  };
}

export interface VerdictBasis {
  verdict: "validated" | "rejected";
  basis: "statistical" | "face";
  /** Non-null when the handler downgraded the model's claim (§5.3 gate 3);
   * recorded on the proposal's status_reason. */
  downgrade_note: string | null;
}

/**
 * §5.3 hard gate 3 — verdict/basis consistency, enforced mechanically:
 *   * basis "statistical" requires persisted tests to EXIST (mirrors
 *     RunValidateStage's adoptBasis: no tests ⇒ face);
 *   * verdict "validated" + basis "statistical" additionally requires every
 *     test to pass AND adequacy met;
 *   * a failing persisted test forces verdict "rejected" under a statistical
 *     claim (vv-03).
 * The model's claim is downgraded to the honest combination and the note says
 * why — model-agnostic by construction (§12 pillar 02).
 */
export function applyVerdictDowngrade(
  claimed: { verdict: "validated" | "rejected"; basis: "statistical" | "face" },
  computed: ComputedBlock,
): VerdictBasis {
  let { verdict, basis } = claimed;
  const notes: string[] = [];

  const tests = computed.validation_tests.filter((t) => t.n > 0);
  if (basis === "statistical" && tests.length === 0) {
    basis = "face";
    notes.push("no persisted statistical tests exist for this run — basis downgraded to face");
  }
  if (basis === "statistical" && tests.some((t) => !t.pass)) {
    if (verdict === "validated") {
      verdict = "rejected";
      notes.push("a persisted validation test failed — verdict downgraded to rejected");
    }
  }
  if (verdict === "validated" && basis === "statistical" && !computed.adequacy_met) {
    verdict = "rejected";
    notes.push(
      `replication adequacy is not met (recommended n* = ${computed.recommended_replications}) — verdict downgraded to rejected`,
    );
  }

  return { verdict, basis, downgrade_note: notes.length > 0 ? notes.join("; ") : null };
}
