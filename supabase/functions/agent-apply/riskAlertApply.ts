// risk_alert apply mapping — Phase 4d (ai-agents.md §18.3 hard gates 7–8,
// §4.4 risk_alert row, §13.3/§13.4 via the experiment row, §10 note 37).
//
// The §4.4 sequence, every step an interface that already exists:
//   (1) re-run the §18.3 draft gates 1–3 against the LIVE evidence store and
//       live tables (vanished evidence, a deregistered source, a dropped Q28
//       tally, vanished exposure ⇒ stale_values naming it);
//   (2) approve-and-apply the LINKED experiment_spec proposal — displayed on
//       the alert card — through applyExperimentSpec → dispatchExperimentRun:
//       the §4.4 experiment row exercised verbatim (same gates, same stamps,
//       same ReuseAvailable/gate_blocked semantics), NEVER a parallel
//       dispatch path. One informed human approval (the alert card's) covers
//       both records; the linked spec is marked applied via the same
//       mark_agent_proposal_applied single-writer RPC.
//   (3) the alert's applied_result carries impact {status: "pending"} — the
//       §18.3 impact law: an alert without a completed run shows "pending",
//       never an LLM estimate.
//
// fillRiskAlertImpact (below) is the ONLY writer of a complete impact block:
// it reads the linked run's persisted run_replications rows, computes
// min/max/mean of the primary KPI (computeAlertImpact — the same pure
// function get_risk_alerts reads with), and writes ONCE through the
// service-role-only update_risk_alert_impact RPC with the run citation.
// It is invoked on-demand (an agent-apply re-POST for the applied alert) —
// never by a scheduler or background job (§18.4 stays unmet).
//
// Pure orchestration over an injected supabase-like client + upstash runner:
// no Deno.env, no module-level clients — the deterministic eval tier drives
// it with the stateful stub, and index.ts drives it with the service role.

import {
  assertRegistered,
  UnregisteredSourceError,
} from "../_shared/sourceRegistry.ts";
import {
  normalizeEntityName,
  tallyEvidence,
  type EvidenceRow,
} from "../_shared/networkEvidence.ts";
import {
  computeAlertImpact,
  EVENT_RELATION,
  eventSubjectKey,
  IMPACT_PENDING,
  matchExposure,
  tallyEventEvidence,
  type AlertImpact,
} from "../_shared/riskEvents.ts";
import { applyExperimentSpec, type ExperimentApplyDeps } from "./experimentSpecApply.ts";
import { ApplyFailure } from "./itemMasterApply.ts";

/** §4.4 `applied_result` shape for risk_alert. */
export interface RiskAlertApplyResult {
  recorded: true;
  linked_proposal_id: string;
  run_id: string;
  scenario_id: string;
  policy_version_id: string;
  policy_hash: string | null;
  graph_hash: string | null;
  replications: number;
  /** true when the linked dispatch answered ReuseAvailable (G17). */
  reused?: boolean;
  /** Pending at apply, ALWAYS — filled later from run_replications only. */
  impact: AlertImpact;
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadEvidence(db: Db, projectId: string): Promise<EvidenceRow[]> {
  const { data, error } = await db.from("external_evidence").select("*").eq("project_id", projectId);
  if (error) throw new ApplyFailure("rpc_error", `external_evidence read failed: ${error.message}`);
  return (data ?? []) as EvidenceRow[];
}

/**
 * Apply one approved risk_alert proposal. Throws ApplyFailure with a §4.4
 * code (stale_values / gate_blocked / rpc_error). Top-level idempotency
 * rides the proposal (index.ts returns the stored applied_result for an
 * already-applied proposal without calling this).
 */
export async function applyRiskAlert(
  db: Db,
  deps: ExperimentApplyDeps,
  args: {
    projectId: string;
    payload: Record<string, unknown>;
    grounding: Record<string, unknown>;
    userId?: string | null;
    /** The approving human's card acknowledgment — forwarded to the linked
     * experiment apply, honored under its own §5.4 rule only. */
    acknowledgeWarnings?: boolean;
  },
): Promise<RiskAlertApplyResult> {
  const payload = args.payload ?? {};

  // (0) Re-validate the stored payload — a manually forged row must never
  // reach the dispatcher.
  const event = (payload.event ?? {}) as Record<string, unknown>;
  const subject = ((event.subject ?? {}) as Record<string, unknown>);
  const eventType = String(event.event_type ?? "");
  const subjectName = String(subject.name ?? "");
  const lei = typeof subject.lei === "string" && subject.lei ? String(subject.lei) : null;
  const linked = (payload.linked_experiment ?? {}) as Record<string, unknown>;
  const linkedProposalId = String(linked.proposal_id ?? "");
  if (!eventType || !subjectName || !uuidRe.test(linkedProposalId)) {
    throw new ApplyFailure("rpc_error", "stored payload failed validation: event/subject/linked_experiment missing");
  }

  // (1) §18.3 gates 1–3 re-run against the LIVE store (the §8 T8 twin).
  const evidence = await loadEvidence(db, args.projectId);
  const subjectKey = lei ?? normalizeEntityName(subjectName);
  const eventKey = `${subjectKey}|${EVENT_RELATION}|${eventType}`;
  const tally = tallyEventEvidence(evidence).find((t) => t.key === eventKey);
  if (!tally || tally.status !== "verified") {
    const n = tally?.sourceIds.length ?? 0;
    throw new ApplyFailure(
      "stale_values",
      `the ${eventType} event at "${subjectName}" no longer verifies against the live evidence store ` +
        `(now ${tally?.status ?? "absent"}, ${n} independent source(s)) — ask for a fresh assessment`,
    );
  }
  for (const sid of tally.sourceIds) {
    try {
      assertRegistered(sid, "sensing");
    } catch (e) {
      if (e instanceof UnregisteredSourceError) {
        throw new ApplyFailure("stale_values", `a corroborating source was deregistered since drafting: ${e.message}`);
      }
      throw e;
    }
  }
  const [s, m, l] = await Promise.all([
    db.from("suppliers").select("supplier_id,name").eq("project_id", args.projectId),
    db.from("materials").select("material_id,name").eq("project_id", args.projectId),
    db.from("inbound_logistics").select("supplier_id,material_id").eq("project_id", args.projectId),
  ]);
  const exposure = matchExposure({
    subjectName: subjectName,
    subjectLei: tally.lei ?? lei,
    suppliers: (s.data ?? []) as Array<Record<string, unknown>>,
    materials: (m.data ?? []) as Array<Record<string, unknown>>,
    lanes: (l.data ?? []) as Array<Record<string, unknown>>,
    mapTallies: tallyEvidence(evidence),
  });
  if (exposure.matches.length === 0) {
    throw new ApplyFailure(
      "stale_values",
      `the exposure this alert matched no longer exists in the project — ask for a fresh assessment`,
    );
  }

  // (2) The linked experiment_spec proposal — displayed on the alert card —
  // approved and applied through the ONE dispatch path. The alert card's
  // Approve is the single informed human approval covering both (§10 37h).
  const { data: linkedRow } = await db
    .from("proposals").select("*").eq("id", linkedProposalId).maybeSingle();
  if (!linkedRow || String(linkedRow.project_id) !== args.projectId ||
    String(linkedRow.artifact_type) !== "experiment_spec") {
    throw new ApplyFailure("stale_values", `the linked experiment proposal (${linkedProposalId}) no longer exists in this project`);
  }
  if (String(linkedRow.status) === "applied") {
    // Idempotent retry after a partial apply: the run already dispatched.
    const stored = (linkedRow.applied_result ?? {}) as Record<string, unknown>;
    return {
      recorded: true,
      linked_proposal_id: linkedProposalId,
      run_id: String(stored.run_id ?? ""),
      scenario_id: String(stored.scenario_id ?? ""),
      policy_version_id: String(stored.policy_version_id ?? ""),
      policy_hash: (stored.policy_hash as string | null) ?? null,
      graph_hash: (stored.graph_hash as string | null) ?? null,
      replications: Number(stored.replications ?? 0),
      ...(stored.reused === true ? { reused: true } : {}),
      impact: IMPACT_PENDING,
    };
  }
  if (!["proposed", "approved"].includes(String(linkedRow.status))) {
    throw new ApplyFailure(
      "stale_values",
      `the linked experiment proposal is ${linkedRow.status} — it can no longer dispatch; ask for a fresh alert`,
    );
  }
  if (String(linkedRow.status) === "proposed") {
    const { error } = await db
      .from("proposals")
      .update({ status: "approved", reviewed_by: args.userId ?? null })
      .eq("id", linkedProposalId);
    if (error) throw new ApplyFailure("rpc_error", `approving the linked proposal failed: ${error.message}`);
  }

  const runResult = await applyExperimentSpec(db, deps, {
    projectId: args.projectId,
    payload: (linkedRow.payload ?? {}) as Record<string, unknown>,
    grounding: (linkedRow.grounding ?? {}) as Record<string, unknown>,
    userId: args.userId ?? null,
    acknowledgeWarnings: args.acknowledgeWarnings === true,
  });
  const { error: markErr } = await db.rpc("mark_agent_proposal_applied", {
    p_proposal_id: linkedProposalId,
    p_result: runResult,
  });
  if (markErr) console.error("marking the linked experiment applied failed:", markErr.message);

  // (3) The alert's record: run stamps + impact PENDING (the §18.3 law).
  return {
    recorded: true,
    linked_proposal_id: linkedProposalId,
    run_id: runResult.run_id,
    scenario_id: runResult.scenario_id,
    policy_version_id: runResult.policy_version_id,
    policy_hash: runResult.policy_hash,
    graph_hash: runResult.graph_hash,
    replications: runResult.replications,
    ...(runResult.reused ? { reused: true } : {}),
    impact: IMPACT_PENDING,
  };
}

/**
 * Fill an applied alert's impact range FROM the linked run's persisted
 * run_replications rows — §18.3 hard gate 8. Idempotent: a complete impact
 * is returned unchanged; a run that is not done leaves the impact pending.
 * Writes exactly once, through the service-role-only update_risk_alert_impact
 * RPC, with the run citation. Never called by a scheduler (§18.4 unmet):
 * the trigger is an on-demand re-POST or the get_risk_alerts read.
 */
export async function fillRiskAlertImpact(
  db: Db,
  proposal: { id: string; applied_result: Record<string, unknown> | null },
): Promise<Record<string, unknown> | null> {
  const stored = proposal.applied_result ?? {};
  const impact = (stored.impact ?? {}) as Record<string, unknown>;
  if (String(impact.status ?? "") === "complete") return stored; // already filled
  const runId = String(stored.run_id ?? "");
  if (!runId) return null;

  const { data: run } = await db.from("simulation_runs").select("*").eq("id", runId).maybeSingle();
  const { data: reps } = await db
    .from("run_replications").select("rep_index,status,kpis").eq("run_id", runId);
  const computed = computeAlertImpact(
    (run as Record<string, unknown>) ?? null,
    (reps ?? []) as Array<Record<string, unknown>>,
  );
  if (!computed) return null; // run not done yet — the alert honestly stays pending

  const { data, error } = await db.rpc("update_risk_alert_impact", {
    p_proposal_id: proposal.id,
    p_impact: computed,
  });
  if (error) {
    console.error("update_risk_alert_impact failed:", error.message);
    return null;
  }
  return (data as Record<string, unknown>) ?? { ...stored, impact: computed };
}
