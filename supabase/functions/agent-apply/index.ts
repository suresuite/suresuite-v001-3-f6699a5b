// agent-apply — the ONLY writer of proposal apply outcomes (Stage 1;
// ai-agents.md §4.4, §13.2 checkpoint 5, §8 T9).
//
// Deliberately free of business logic: a fixed artifact_type → existing-gate
// dispatch table and the checkpoint-5 authorization sequence, nothing else.
// It holds the service role, calls exactly the RPCs the UI calls, and is the
// sole caller of mark_agent_proposal_applied / _apply_failed (single-writer
// discipline, asset A11). Apply is idempotent end-to-end: a re-POST for an
// already-applied proposal returns the stored applied_result without
// re-executing (§4.4).
//
// Checkpoint 5 (fail closed): proposal status = approved; project ownership;
// `agent_apply` + the artifact's own operation right (§13.3 — item_master_diff
// needs `data_editing`); quota (§13.4); THEN delegate to the gate. Rights
// failures return typed errors WITHOUT burning an apply attempt — attempts
// count real gate/RPC executions only.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { makeTelemetry, telemetryEnabled } from "../project-ai-chat/telemetry.ts";
import {
  ApplyFailure,
  applyItemMasterDiff,
  type ApplyErrorCode,
  type ItemMasterApplyResult,
} from "./itemMasterApply.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  // Errors ride HTTP 200 with {error, type} — supabase-js `invoke` discards
  // non-2xx bodies (same posture as project-ai-chat).
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** §4.2 DEFAULT: after 3 failed applies the card offers Reject only; the
 * server enforces the same cap fail-closed. */
const APPLY_RETRY_CAP = 3;

/** §13.3 operation-rights matrix: apply never demands less than the
 * equivalent manual action. Keys are capability feature keys, ALL required
 * (on top of agent_apply). */
const ARTIFACT_RIGHTS: Record<string, string[]> = {
  item_master_diff: ["data_editing"],
};

/** §13.4: compute quotas per artifact. item_master_diff dispatches no compute,
 * so no quota binds in Stage 1; experiment_spec (Stage 4) adds the
 * 3-concurrent / 10-per-day agent-applied-runs rule here. Returns the
 * human-readable violation, or null when within quota. */
// deno-lint-ignore no-explicit-any
function checkApplyQuota(_db: any, artifactType: string): Promise<string | null> {
  switch (artifactType) {
    case "item_master_diff":
      return Promise.resolve(null);
    default:
      return Promise.resolve(null);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body.", type: "BAD_REQUEST" });
  }
  const proposalId = typeof body.proposalId === "string" ? body.proposalId : null;
  const userId = typeof body.userId === "string" ? body.userId : null;
  const userEmail = typeof body.userEmail === "string" ? body.userEmail : null;
  if (!proposalId || !userId) {
    return jsonResponse({ error: "Missing required parameters: proposalId, userId", type: "BAD_REQUEST" });
  }

  const svc = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const { data: proposal, error: loadErr } = await svc
      .from("proposals")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle();
    if (loadErr) return jsonResponse({ error: `Proposal load failed: ${loadErr.message}`, type: "APPLY_ERROR" });
    if (!proposal) return jsonResponse({ error: "Proposal not found.", type: "NOT_FOUND" });

    // Idempotent re-POST (§4.4): applied is terminal — return the stored result.
    if (proposal.status === "applied") {
      return jsonResponse({ ok: true, applied_result: proposal.applied_result ?? null, already_applied: true });
    }
    if (proposal.status !== "approved") {
      return jsonResponse({
        error: `Apply requires an approved proposal (status is ${proposal.status}).`,
        type: "INVALID_STATUS",
      });
    }
    if (Number(proposal.apply_attempts ?? 0) >= APPLY_RETRY_CAP) {
      return jsonResponse({
        error: `Apply retry limit reached (${APPLY_RETRY_CAP}). Reject the card and ask for a fresh draft.`,
        type: "RETRY_LIMIT",
      });
    }

    // ── Checkpoint 5 authorization (fail closed; nothing mutated) ────────────
    const projectId = String(proposal.project_id);
    const { error: accessErr } = await svc.rpc("get_project_dataset_counts", {
      p_project_id: projectId,
      p_user_id: userId,
      p_user_email: userEmail,
    });
    if (accessErr) {
      const m = (accessErr.message || "").toLowerCase();
      const denied = m.includes("forbidden") || m.includes("project_not_found");
      return jsonResponse({
        error: denied
          ? "You don't have access to this proposal's project."
          : `Project access check failed: ${accessErr.message}`,
        type: "FORBIDDEN",
      });
    }

    const { data: caps, error: capsErr } = await svc.rpc("get_my_capabilities", { _user_id: userId });
    if (capsErr || !caps || typeof caps !== "object") {
      return jsonResponse({
        error: "Could not verify your permissions — try again.",
        type: "FORBIDDEN",
      });
    }
    const c = caps as Record<string, unknown>;
    const features = (c.features as Record<string, boolean>) ?? {};
    const isSuper = Boolean(c.is_super_admin);
    if (!isSuper) {
      if (features.agent_apply !== true) {
        return jsonResponse({
          error: "Applying agent proposals isn't enabled for your account (agent_apply). Contact an administrator.",
          type: "FORBIDDEN",
        });
      }
      for (const right of ARTIFACT_RIGHTS[String(proposal.artifact_type)] ?? []) {
        if (features[right] !== true) {
          return jsonResponse({
            error: `This apply also requires the "${right}" capability — the same right the manual edit needs.`,
            type: "FORBIDDEN",
          });
        }
      }
    }

    const quotaViolation = await checkApplyQuota(svc, String(proposal.artifact_type));
    if (quotaViolation) {
      await svc.rpc("mark_agent_proposal_apply_failed", {
        p_proposal_id: proposalId,
        p_error: `quota_exceeded: ${quotaViolation}`,
      });
      return jsonResponse({ error: quotaViolation, code: "quota_exceeded", type: "APPLY_FAILED" });
    }

    // ── Fixed artifact_type dispatch table (§4.4) — one row per GA'd stage ──
    const t0 = Date.now();
    let orgId: string | null = null;
    if (telemetryEnabled()) {
      try {
        const { data: u } = await svc.from("approved_users").select("organization_id").eq("id", userId).maybeSingle();
        orgId = (u as { organization_id?: string } | null)?.organization_id ?? null;
      } catch { /* attribution only */ }
    }
    const telemetry = makeTelemetry(svc, {
      user_id: userId,
      org_id: orgId,
      project_id: projectId,
      thread_id: (proposal.thread_id as string | null) ?? null,
      request_id: crypto.randomUUID(),
      agent_id: (proposal.agent_id as string | null) ?? null,
      model_code: (proposal.model_code as string | null) ?? null,
      provider_code: (proposal.provider_code as string | null) ?? null,
    });

    const fail = async (code: ApplyErrorCode, message: string) => {
      const { error: markErr } = await svc.rpc("mark_agent_proposal_apply_failed", {
        p_proposal_id: proposalId,
        p_error: `${code}: ${message}`,
      });
      if (markErr) console.error("mark_agent_proposal_apply_failed failed:", markErr.message);
      telemetry.emit("proposal.apply_failed", {
        artifact_type: proposal.artifact_type,
        provenance: proposal.provenance,
        status_reason: code,
        apply_attempts: Number(proposal.apply_attempts ?? 0) + 1,
      }, { proposal_id: proposalId, latency_ms: Date.now() - t0 });
      return jsonResponse({ error: message, code, type: "APPLY_FAILED" });
    };

    let result: ItemMasterApplyResult;
    switch (String(proposal.artifact_type)) {
      case "item_master_diff": {
        try {
          result = await applyItemMasterDiff(svc, {
            projectId,
            payload: (proposal.payload ?? {}) as Record<string, unknown>,
            grounding: (proposal.grounding ?? {}) as Record<string, unknown>,
          });
        } catch (e) {
          if (e instanceof ApplyFailure) return await fail(e.code, e.message);
          return await fail("rpc_error", e instanceof Error ? e.message : "apply failed");
        }
        break;
      }
      default:
        // Later stages add their §4.4 rows here; an artifact this deployment
        // cannot apply is a typed error, not an attempt.
        return jsonResponse({
          error: `No apply mapping is enabled for artifact type "${proposal.artifact_type}" in this deployment.`,
          type: "UNSUPPORTED_ARTIFACT",
        });
    }

    const { error: markErr } = await svc.rpc("mark_agent_proposal_applied", {
      p_proposal_id: proposalId,
      p_result: result,
    });
    if (markErr) {
      // The mutation went through the gates but the bookkeeping write failed;
      // surface loudly — a retry will no-op through the idempotent path.
      console.error("mark_agent_proposal_applied failed:", markErr.message);
      return jsonResponse({ error: `Applied, but recording the outcome failed: ${markErr.message}`, type: "APPLY_ERROR" });
    }
    telemetry.emit("proposal.applied", {
      artifact_type: proposal.artifact_type,
      provenance: proposal.provenance,
    }, { proposal_id: proposalId, latency_ms: Date.now() - t0 });

    return jsonResponse({ ok: true, applied_result: result });
  } catch (err) {
    console.error("agent-apply error:", err);
    return jsonResponse({
      error: err instanceof Error ? err.message : "Apply failed.",
      type: "APPLY_ERROR",
    });
  }
});
