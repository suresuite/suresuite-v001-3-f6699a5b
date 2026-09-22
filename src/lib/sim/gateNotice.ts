/**
 * The sentence a run carries when its pre-run data check did not run
 * (audit F-19a).
 *
 * `sim-command` fails OPEN when the gate cannot load its dataset — a gate that
 * cannot read must not take dispatch down with it — and records the skip as
 * `simulation_runs.gate_skipped`. Until this, only the `/v1` API and the AI
 * chat tool read that column, so a run nobody checked wore the same result
 * badge as one that passed. Shown beside the credibility badge (T2).
 */
export function gateNotice(run: { gate_skipped?: boolean | null }): string | null {
  return run.gate_skipped
    ? "Unchecked — the pre-run data check did not run (its data failed to load), " +
        "so missing or defaulted inputs were not flagged before this run."
    : null;
}
