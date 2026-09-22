/**
 * How a replication is named on screen — audit F-23.
 *
 * `run_replications.seed_used` is `project_seed * 1000 + model_rep`, computed by
 * the bridge as a display key. It is NOT a seed: the engine draws from
 * `SeedSequence(entropy=project_seed, spawn_key=(realm, model_rep, stream))`, so
 * typing "42003" in as a project seed reproduces nothing. And it collides: every
 * event draw of one model replication shares it. A replication is identified by
 * its index in the run and by its CRN cell — the world (`model_rep`) and, when a
 * disruption is stochastic, the event draw (`event_rep`) — both of which the
 * engine writes on every KPI row. To reproduce one, re-run the scenario with the
 * same project seed; the replication is then the same cell.
 */
export function replicationLabel(r: {
  rep_index: number;
  seed_used?: number | null;
  kpis?: Record<string, number | null | undefined> | null;
}): string {
  const world = r.kpis?.model_rep;
  const draw = r.kpis?.event_rep;
  const parts = [`rep ${r.rep_index}`];
  if (typeof world === "number") parts.push(`world ${world}`);
  if (typeof draw === "number" && draw > 0) parts.push(`event draw ${draw}`);
  return parts.join(" · ");
}
