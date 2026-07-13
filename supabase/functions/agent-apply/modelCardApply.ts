// model_card_draft apply mapping — Stage 3 (ai-agents.md §4.4 row 3, §9.4).
//
// The exact §4.4 sequence:
//   (1) verify the evidence run cited in the payload exists in this project
//       and is completed (with the provenance stamps record_model_validation
//       requires: policy_version_id, scenario_id, dataset_version_id);
//   (2) record_model_validation(...) with ALL numeric arguments read from the
//       payload's `computed` block, which the draft tool filled from
//       persisted run output — never from LLM text (§5.3). The narrative goes
//       nowhere except the card and, optionally,
//       model_validations.replication_basis.note (a short attribution note is
//       added here). The RPC itself enforces project-consistency of the
//       triple and supersede-not-edit (vv-08).
//
// Revert = revoke_model_validation(id) (existing RPC), offered on the card.
//
// Pure orchestration over an injected supabase-like client — the
// deterministic eval tier drives it with a stateful stub.

import { ApplyFailure } from "./itemMasterApply.ts";

/** §4.4 `applied_result` shape for model_card_draft. */
export interface ModelCardApplyResult {
  model_validation_id: string;
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

interface ComputedPayload {
  adopted_warmup_days: number;
  warmup_method: string;
  recommended_replications: number;
  replication_basis: Record<string, unknown>;
  validation_tests: unknown[];
  findings: unknown[];
}

export async function applyModelCard(
  db: Db,
  args: {
    projectId: string;
    payload: Record<string, unknown>;
    userId?: string | null;
    userEmail?: string | null;
  },
): Promise<ModelCardApplyResult> {
  const evidenceRunId = String(args.payload?.evidence_run_id ?? "");
  const verdict = String(args.payload?.verdict ?? "");
  const basis = String(args.payload?.basis ?? "");
  const computed = (args.payload?.computed ?? null) as ComputedPayload | null;
  if (!evidenceRunId || !computed ||
      (verdict !== "validated" && verdict !== "rejected") ||
      (basis !== "statistical" && basis !== "face")) {
    throw new ApplyFailure("rpc_error", "stored payload is not a valid model_card_draft");
  }

  // (1) the evidence run must exist here, be completed, and carry the
  // provenance stamps the card's triple needs.
  const { data: run, error: runErr } = await db
    .from("simulation_runs")
    .select("id,project_id,status,policy_version_id,scenario_id,dataset_version_id")
    .eq("id", evidenceRunId)
    .eq("project_id", args.projectId)
    .maybeSingle();
  if (runErr) throw new ApplyFailure("rpc_error", `evidence-run read failed (${runErr.message})`);
  if (!run) {
    throw new ApplyFailure("gate_blocked", `evidence run ${evidenceRunId} no longer exists in this project`);
  }
  if (String(run.status) !== "done") {
    throw new ApplyFailure("gate_blocked", `evidence run ${evidenceRunId} is ${run.status} — a card needs a completed run`);
  }
  const missing: string[] = [];
  if (!run.policy_version_id) missing.push("policy_version_id");
  if (!run.scenario_id) missing.push("scenario_id");
  if (!run.dataset_version_id) missing.push("dataset_version_id");
  if (missing.length > 0) {
    throw new ApplyFailure(
      "gate_blocked",
      `evidence run ${evidenceRunId} lacks the provenance stamps a card requires: ${missing.join(", ")}`,
    );
  }

  // (2) record_model_validation — numeric arguments verbatim from `computed`.
  const narrative = typeof args.payload?.narrative_md === "string"
    ? String(args.payload.narrative_md)
    : "";
  const replicationBasis = {
    ...computed.replication_basis,
    // §4.4: optionally the narrative's trace lands in replication_basis.note.
    note: `agent-drafted adoption${narrative ? `: ${narrative.slice(0, 300)}` : ""}`,
  };
  const { data: cardId, error: recErr } = await db.rpc("record_model_validation", {
    p_project_id: args.projectId,
    p_policy_version_id: run.policy_version_id,
    p_dataset_version_id: run.dataset_version_id,
    p_scenario_id: run.scenario_id,
    p_adopted_warmup_days: computed.adopted_warmup_days,
    p_warmup_method: computed.warmup_method,
    p_recommended_replications: computed.recommended_replications,
    p_replication_basis: replicationBasis,
    p_validation_tests: computed.validation_tests ?? [],
    p_findings: computed.findings ?? [],
    p_verdict: verdict,
    p_basis: basis,
    p_evidence_run_id: evidenceRunId,
    p_user_id: args.userId ?? null,
    p_user_email: args.userEmail ?? null,
  });
  if (recErr) {
    throw new ApplyFailure("rpc_error", `record_model_validation failed: ${recErr.message}`);
  }
  const id = String(cardId ?? "");
  if (!id) throw new ApplyFailure("rpc_error", "record_model_validation returned no id");
  return { model_validation_id: id };
}
