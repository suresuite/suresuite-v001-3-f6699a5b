/**
 * What the surrogate's training set holds — Phase 10 / WP 10.8 · §4 D249.
 *
 * `surrogate_training_runs` is the one statement of which replications may train
 * a surrogate (done, following a validated model — its evidence run included —
 * not exploratory, faithful to the protocol, gate not skipped);
 * `surrogate_training_summary` groups it by Validated Model and SIMULATION-input
 * version (WP 11.4 · §4 D262) — the world the KPIs came from; two snapshots that
 * differ only in the deep tier, which the engine does not read, are one group.
 * This turns that answer into the Lab's line. No model is trained (T1: the line
 * counts what exists; it predicts nothing).
 */
export interface TrainingGroup {
  validated_model_id: string;
  model_name: string | null;
  model_version_no: number | null;
  /** The simulation inputs the group's KPIs came from (WP 11.4). */
  simulation_version_id: string | null;
  simulation_version_no: number | null;
  runs: number;
  /** Composite snapshots inside the group — counted, never grouped on. */
  graph_versions: number;
  replications: number;
  includes_evidence_run: boolean;
}

/** The set's size as a set (`surrogate_training_totals`, WP 10.9 · §4 D254): a
 *  run several models cite — a shared evidence run — counts once. Summing the
 *  per-model groups above counts it once per model, which is right for lineage
 *  and wrong for a size. */
export interface TrainingTotals {
  runs: number;
  replications: number;
  models: number;
  graph_versions: number;
  /** WP 11.4 · §4 D262 — the distinct worlds the KPIs came from. Absent on a database
   *  before `20261001000022`, when the line falls back to the composite count. */
  simulation_versions?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** null = unknown (not read yet, or the database predates the function): say nothing. */
export function trainingSetLine(t: TrainingTotals | null): string | null {
  if (t === null) return null;
  if (Number(t.runs) === 0) {
    return "Training set: empty — only faithful runs of a Validated Model count; exploratory runs never do";
  }
  return (
    `Training set: ${plural(Number(t.replications), "replication")} · ${plural(Number(t.runs), "run")} · ` +
    `${plural(Number(t.models), "Validated Model")} · ` +
    (t.simulation_versions !== undefined && t.simulation_versions !== null
      ? plural(Number(t.simulation_versions), "simulation-input version")
      : plural(Number(t.graph_versions), "graph version"))
  );
}
