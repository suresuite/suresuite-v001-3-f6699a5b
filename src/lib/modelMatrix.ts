// Phase H4 — the §23 capability matrix, client side (ai-agents.md §23.3).
// Pure helpers only, zero imports: the deno eval tier imports this exact
// module (matrix_test.ts) so the staleness clock and the summary grammar the
// UI renders are pinned by the same deterministic tests as the server rules.
// The flag mirror + capability names track their server counterparts in
// supabase/functions/project-ai-chat/matrix.ts — keep in sync.
//
// The §23.3 law, restated where it renders: the picker NEVER hides a model
// (the org allowlist owns that); the matrix informs the choice.

/** Client visibility flag mirroring the server flag MODEL_MATRIX_ENABLED
 * (the VITE_FILE_WORKSPACE_ENABLED precedent). Guarded so the module also
 * loads under deno, where import.meta.env is undefined. */
export function modelMatrixEnabled(): boolean {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_MODEL_MATRIX_ENABLED ?? "") === "true";
}

/** §7.6: a matrix older than 7 days (DEFAULT) renders as stale wherever it
 * is displayed (and, server-side, stops gating the §23.4 template). */
export const MATRIX_STALE_DAYS = 7;

/** Plain-language capability names (mirror of matrix.ts CAPABILITY_NAMES —
 * the §22.5 template and these hints must speak the same vocabulary). */
export const CAPABILITY_NAMES: Record<string, string> = {
  "router": "intent routing",
  "router.needs_run": "run-need detection",
  "router.cache_checkable": "cache-answer detection",
  "agent:data-steward": "the Data Steward agent",
  "agent:policy-configurator": "the Policy Configurator agent",
  "agent:vv-analyst": "the V&V Analyst agent",
  "agent:experiment-designer": "the Experiment Designer agent",
  "agent:report-builder": "the Report Builder agent",
  "loop:cache_hit": "the cache-first decision loop",
  "loop:run_needed": "the decision loop",
  "plan:integrity": "plan tracking",
  "coverage:relations": "relationship lookups",
  "coverage:policy_reads": "policy reads",
  "coverage:run_reads": "run-result reads",
  "fabrication": "grounded answers",
  "faithfulness": "faithful reporting",
};

export function capabilityName(id: string): string {
  return CAPABILITY_NAMES[id] ?? id;
}

/** One row as get_model_capability_matrix() returns it. */
export interface ModelCapabilityRow {
  model_code: string;
  capability_id: string;
  score: number;
  target: number;
  pass: boolean;
  eval_run_id: string;
  measured_at: string;
}

export interface ModelMatrixSummary {
  /** "passes all checks" or "below target: <plain names>" (§23.3). */
  summary: string;
  /** True when the model's newest row is > 7 days old — the picker renders
   * the stale marker and the server stops gating (§7.6). */
  stale: boolean;
  belowTarget: string[];
  measuredAt: string;
}

/** The §23.3 one-line picker hint for one model. Returns null when the
 * matrix holds no rows for it — the picker then renders exactly as it did
 * before H4 (no hint beats an invented one). `now` is injectable for the
 * clock-mocked staleness tests. */
export function summarizeModelMatrix(
  rows: ModelCapabilityRow[],
  modelId: string,
  now: Date = new Date(),
): ModelMatrixSummary | null {
  const mine = rows.filter((r) => r.model_code === modelId);
  if (mine.length === 0) return null;
  const newest = mine.reduce(
    (max, r) => {
      const t = Date.parse(r.measured_at);
      return Number.isNaN(t) ? max : Math.max(max, t);
    },
    Number.NEGATIVE_INFINITY,
  );
  const stale = !Number.isFinite(newest) ||
    now.getTime() - newest > MATRIX_STALE_DAYS * 24 * 60 * 60 * 1000;
  const belowTarget = mine.filter((r) => !r.pass).map((r) => capabilityName(r.capability_id));
  return {
    summary: belowTarget.length === 0
      ? "passes all checks"
      : `below target: ${belowTarget.join(", ")}`,
    stale,
    belowTarget,
    measuredAt: Number.isFinite(newest) ? new Date(newest).toISOString() : "",
  };
}

export interface ModelMatrixAggregate {
  model_code: string;
  total: number;
  passing: number;
  belowTarget: string[];
  measuredAt: string;
  stale: boolean;
}

/** The §23.3 admin rollup: one aggregate line per model (counts and names
 * only — the §16.2 rollup posture). Deterministic order by model_code. */
export function aggregateMatrixByModel(
  rows: ModelCapabilityRow[],
  now: Date = new Date(),
): ModelMatrixAggregate[] {
  const codes = Array.from(new Set(rows.map((r) => r.model_code))).sort();
  return codes.map((code) => {
    const mine = rows.filter((r) => r.model_code === code);
    const s = summarizeModelMatrix(rows, code, now)!;
    return {
      model_code: code,
      total: mine.length,
      passing: mine.filter((r) => r.pass).length,
      belowTarget: s.belowTarget,
      measuredAt: s.measuredAt,
      stale: s.stale,
    };
  });
}
