// decision_report apply mapping — v1.2 Phase 3 (ai-agents.md §16.1 apply
// row, §13.3 rights row, §10 Q24/Q25).
//
// The §16.1 sequence: resolve the approved spec's sections against LIVE data
// (registered read tools / persisted runs only — a report can never disagree
// with the database it cites) → render XLSX/PDF → upload to the private
// 'workspace' bucket under the §16.2 path law → insert user_files rows →
// applied_result = {file_ids, paths}. The card flips to a file card.
//
// The render pipeline is report-render/render.ts — the SAME module the
// report-render edge function serves — executed in-process here (the
// dispatch.ts precedent: apply calls the shared module, never a parallel
// implementation). Rendering mutates no project state: no policy, data or
// run row is touched, which is why the §13.3 row demands agent_proposals +
// reports and NOT agent_apply.
//
// Pure orchestration over an injected supabase-like client + storage/writer
// deps: no Deno.env beyond the §16.2 flag, no module-level clients — the
// deterministic eval tier drives it with the stateful stub (rb-07), and
// index.ts drives it with the service role + the real writers.

import {
  renderDecisionReport,
  RenderFailure,
  type DecisionReportRenderResult,
  type RenderDeps,
} from "../report-render/render.ts";
import { ApplyFailure } from "./itemMasterApply.ts";

export type DecisionReportApplyResult = DecisionReportRenderResult;

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

/** §16.2 server flag — either kill switch off ⇒ clean regression to Phase 2
 * behavior (§9): the draft tool already refuses, and a stale approved card
 * fails typed here without touching storage. */
export function fileWorkspaceEnabled(): boolean {
  return (Deno.env.get("FILE_WORKSPACE_ENABLED") ?? "").trim().toLowerCase() === "true";
}

/**
 * Apply one approved decision_report proposal. Throws ApplyFailure with a
 * §4.4 code (stale_values when a cited run vanished / rpc_error otherwise).
 * Top-level idempotency rides the proposal (index.ts returns the stored
 * applied_result for an already-applied proposal without re-rendering).
 */
export async function applyDecisionReport(
  db: Db,
  deps: RenderDeps,
  args: {
    projectId: string;
    proposalId: string;
    payload: Record<string, unknown>;
    userId: string;
  },
): Promise<DecisionReportApplyResult> {
  if (!fileWorkspaceEnabled()) {
    throw new ApplyFailure(
      "rpc_error",
      "the file workspace is not enabled in this deployment (FILE_WORKSPACE_ENABLED)",
    );
  }

  // Attribution for the §16.2 path law (org/<org_id>/user/<user_id>/…).
  let orgId: string | null = null;
  try {
    const { data } = await db
      .from("approved_users")
      .select("organization_id")
      .eq("id", args.userId)
      .maybeSingle();
    orgId = (data as { organization_id?: string } | null)?.organization_id ?? null;
  } catch { /* path law falls back to org 'none' */ }

  try {
    return await renderDecisionReport(db, deps, {
      projectId: args.projectId,
      userId: args.userId,
      orgId,
      proposalId: args.proposalId,
      payload: args.payload ?? {},
    });
  } catch (e) {
    if (e instanceof RenderFailure) throw new ApplyFailure(e.code, e.message);
    if (e instanceof ApplyFailure) throw e;
    throw new ApplyFailure("rpc_error", e instanceof Error ? e.message : "report render failed");
  }
}
