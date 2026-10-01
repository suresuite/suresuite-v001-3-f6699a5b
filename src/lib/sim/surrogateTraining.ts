/**
 * What the surrogate's training set holds — Phase 10 / WP 10.8 · §4 D249.
 *
 * `surrogate_training_runs` is the one statement of which replications may train
 * a surrogate (done, following a validated model — its evidence run included —
 * not exploratory, faithful to the protocol, gate not skipped);
 * `surrogate_training_summary` groups it by Validated Model and Graph Version.
 * This turns that answer into the Lab's line. No model is trained (T1: the line
 * counts what exists; it predicts nothing).
 */
export interface TrainingGroup {
  validated_model_id: string;
  model_name: string | null;
  model_version_no: number | null;
  graph_version_id: string | null;
  graph_version_no: number | null;
  runs: number;
  replications: number;
  includes_evidence_run: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** null = unknown (not read yet, or the database predates the view): say nothing. */
export function trainingSetLine(groups: TrainingGroup[] | null): string | null {
  if (groups === null) return null;
  if (groups.length === 0) {
    return "Training set: empty — only faithful runs of a Validated Model count; exploratory runs never do";
  }
  const replications = groups.reduce((a, g) => a + Number(g.replications), 0);
  const runs = groups.reduce((a, g) => a + Number(g.runs), 0);
  const models = new Set(groups.map((g) => g.validated_model_id)).size;
  const graphs = new Set(groups.map((g) => g.graph_version_id ?? "none")).size;
  return (
    `Training set: ${plural(replications, "replication")} · ${plural(runs, "run")} · ` +
    `${plural(models, "Validated Model")} · ${plural(graphs, "graph version")}`
  );
}
