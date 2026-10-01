// Compute once — WP 10.1 · PLAN.md §4 D235–D239.
//
// The network pages READ stored metrics and invoke an analyzer only when no
// stored run is current. "Current" is the database's answer, per row
// (`hash_is_current`, from `analysis_run_is_current`: the run's level hash equals
// the project's hash of that level NOW), never a timestamp and never a guess the
// browser makes. So a reload with unchanged data invokes nothing, and a price edit
// — which no network level reads — invokes nothing either.
//
// T1/T2: a number shown here always says where it came from. `metrics_source` is
// `store` (a run's stored answer), `column` (a legacy mirror with no run behind
// it) or `none`; a stale stored answer is SHOWN and SAID to be stale — it is never
// silently replaced by a number computed in the browser and never saved.

export type MetricsSource = "store" | "column" | "none";

export interface StoredMetricRow {
  metrics_source?: MetricsSource | null;
  hash_is_current?: boolean | null;
  run_id?: string | null;
  computed_at?: string | null;
  metrics_computed_at?: string | null;
  metrics_run_id?: string | null;
}

export type StoredState =
  /** a stored run answers and it is about the data loaded now */
  | "current"
  /** a stored run answers but the level it read has moved since */
  | "stale"
  /** only legacy mirror values with no run — nothing can say if they are current */
  | "unknown"
  /** nothing stored */
  | "missing";

export interface StoredDecision {
  state: StoredState;
  /** Invoke the analyzer? Only when no CURRENT stored run exists. */
  invoke: boolean;
  runId: string | null;
  computedAt: string | null;
}

export function storedMetricsDecision(rows: readonly StoredMetricRow[]): StoredDecision {
  const store = rows.filter((r) => r.metrics_source === "store");
  const runId = store.map((r) => r.run_id ?? r.metrics_run_id ?? null).find(Boolean) ?? null;
  const computedAt =
    store.map((r) => r.computed_at ?? r.metrics_computed_at ?? null).filter(Boolean).sort().pop() ?? null;
  if (store.length > 0 && store.every((r) => r.hash_is_current === true)) {
    return { state: "current", invoke: false, runId, computedAt };
  }
  if (store.length > 0) return { state: "stale", invoke: true, runId, computedAt };
  if (rows.some((r) => r.metrics_source === "column")) {
    return { state: "unknown", invoke: true, runId: null, computedAt: null };
  }
  return { state: "missing", invoke: true, runId: null, computedAt: null };
}

/** The words a row's freshness is said in, beside the number. */
export function rowFreshnessLabel(r: StoredMetricRow): string {
  if (r.metrics_source === "store") {
    return r.hash_is_current === true ? "current" : r.hash_is_current === false ? "stale" : "unknown";
  }
  if (r.metrics_source === "column") return "no provenance";
  return "not computed";
}

/** What an analyzer's answer says about the work it did: reused or computed. */
export function analyzerOutcome(resp: { cache_hit?: boolean; in_progress?: boolean } | null | undefined): "reused" | "computed" | "in progress" | "unknown" {
  if (!resp) return "unknown";
  if (resp.in_progress) return "in progress";
  return resp.cache_hit ? "reused" : "computed";
}
