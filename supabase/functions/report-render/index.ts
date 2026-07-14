// report-render — the §16 file-workspace edge function (ai-agents.md §16.1
// apply mapping, §16.2 retention law, §16.3 telemetry; v1.2 Phase 3).
//
// Actions:
//   * download — the ONLY client download path: verifies file ownership for
//     the asserted user (Layer A trust model, §8 S1), mints a 60-minute
//     signed URL (no public bucket, no unsigned URLs), emits
//     report.downloaded.
//   * sweep — the scheduled-cleanup entry point beside the lazy on-list
//     sweep: sweep_expired_files deletes rows + storage.objects rows in one
//     transaction; the storage API remove here is belt-and-braces for the
//     physical objects. Deletes ONLY unretained files past expires_at.
//   * render — the §16.1 render path over an APPROVED decision_report
//     proposal. Internal-only (service-key bearer): agent-apply normally
//     executes the same module in-process after its checkpoint-5 sequence;
//     this endpoint exists for deployments that want the HTTP hop and for
//     ops re-renders. Idempotent: an applied proposal returns its stored
//     applied_result without re-rendering.
//
// Flag: FILE_WORKSPACE_ENABLED (server, §9 conventions). Off ⇒ every action
// returns a typed error and nothing is stored or signed.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { makeTelemetry } from "../project-ai-chat/telemetry.ts";
import { renderDecisionReport, RenderFailure, SIGNED_URL_TTL_SECONDS } from "./render.ts";
import { makeWriters } from "./writers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  // Errors ride HTTP 200 with {error, type} — supabase-js `invoke` discards
  // non-2xx bodies (same posture as project-ai-chat / agent-apply).
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fileWorkspaceEnabled(): boolean {
  return (Deno.env.get("FILE_WORKSPACE_ENABLED") ?? "").trim().toLowerCase() === "true";
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
  const action = typeof body.action === "string" ? body.action : "download";

  if (!fileWorkspaceEnabled()) {
    return jsonResponse({
      error: "The file workspace is not enabled in this deployment (FILE_WORKSPACE_ENABLED).",
      type: "SERVICE_UNAVAILABLE",
    });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const svc = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey || Deno.env.get("SUPABASE_ANON_KEY") || "",
    { auth: { persistSession: false } },
  );
  // deno-lint-ignore no-explicit-any
  const storage = (svc as any).storage;

  try {
    // ── download: ownership check → 60-minute signed URL (§16.2) ────────────
    if (action === "download") {
      const fileId = typeof body.fileId === "string" ? body.fileId : null;
      const userId = typeof body.userId === "string" ? body.userId : null;
      if (!fileId || !userId) {
        return jsonResponse({ error: "Missing required parameters: fileId, userId", type: "BAD_REQUEST" });
      }
      const { data: file, error: loadErr } = await svc
        .from("user_files")
        .select("*")
        .eq("id", fileId)
        .maybeSingle();
      if (loadErr) return jsonResponse({ error: `File lookup failed: ${loadErr.message}`, type: "AI_ERROR" });
      if (!file || String(file.user_id) !== userId) {
        // Not-found and not-owned collapse into one answer — no existence oracle.
        return jsonResponse({ error: "File not found.", type: "NOT_FOUND" });
      }
      const { data: signed, error: signErr } = await storage
        .from("workspace")
        .createSignedUrl(String(file.path), SIGNED_URL_TTL_SECONDS);
      if (signErr || !signed?.signedUrl) {
        return jsonResponse({
          error: `Could not sign the download URL: ${signErr?.message ?? "no URL returned"}`,
          type: "AI_ERROR",
        });
      }
      makeTelemetry(svc, { user_id: userId, project_id: (file.project_id as string | null) ?? null })
        .emit("report.downloaded", {
          file_id: fileId,
          kind: file.kind,
          size_bytes: file.size_bytes,
        });
      return jsonResponse({
        url: signed.signedUrl,
        name: file.name,
        kind: file.kind,
        size_bytes: file.size_bytes,
        expires_in: SIGNED_URL_TTL_SECONDS,
      });
    }

    // ── sweep: scheduled cleanup (row + object; retained files never) ───────
    if (action === "sweep") {
      const { data, error } = await svc.rpc("sweep_expired_files");
      if (error) return jsonResponse({ error: `Sweep failed: ${error.message}`, type: "AI_ERROR" });
      const result = (data ?? {}) as { deleted?: number; paths?: string[] };
      const paths = Array.isArray(result.paths) ? result.paths.map(String) : [];
      if (paths.length > 0) {
        // Belt-and-braces: the RPC already deleted the object rows; this
        // clears the physical objects through the storage API as well.
        await storage.from("workspace").remove(paths).catch(() => {});
      }
      return jsonResponse({ ok: true, deleted: Number(result.deleted ?? 0) });
    }

    // ── render: internal-only (service bearer) render of an approved spec ───
    if (action === "render") {
      const auth = req.headers.get("authorization") ?? "";
      if (!serviceKey || auth !== `Bearer ${serviceKey}`) {
        return jsonResponse({ error: "render is an internal action (service role required).", type: "FORBIDDEN" });
      }
      const proposalId = typeof body.proposalId === "string" ? body.proposalId : null;
      if (!proposalId) {
        return jsonResponse({ error: "Missing required parameter: proposalId", type: "BAD_REQUEST" });
      }
      const { data: proposal, error: loadErr } = await svc
        .from("proposals")
        .select("*")
        .eq("id", proposalId)
        .maybeSingle();
      if (loadErr) return jsonResponse({ error: `Proposal load failed: ${loadErr.message}`, type: "APPLY_ERROR" });
      if (!proposal) return jsonResponse({ error: "Proposal not found.", type: "NOT_FOUND" });
      if (proposal.artifact_type !== "decision_report") {
        return jsonResponse({ error: "render only handles decision_report proposals.", type: "BAD_REQUEST" });
      }
      if (proposal.status === "applied") {
        return jsonResponse({ ok: true, applied_result: proposal.applied_result ?? null, already_applied: true });
      }
      if (proposal.status !== "approved") {
        return jsonResponse({
          error: `render requires an approved proposal (status is ${proposal.status}).`,
          type: "INVALID_STATUS",
        });
      }

      const userId = String(proposal.reviewed_by ?? proposal.created_by ?? "");
      let orgId: string | null = null;
      try {
        const { data: u } = await svc.from("approved_users").select("organization_id").eq("id", userId).maybeSingle();
        orgId = (u as { organization_id?: string } | null)?.organization_id ?? null;
      } catch { /* path law falls back to org 'none' */ }

      try {
        const result = await renderDecisionReport(svc, {
          writers: makeWriters(),
          upload: async (path, bytes, contentType) => {
            const { error } = await storage.from("workspace").upload(path, bytes, { contentType, upsert: false });
            return { error: error ? { message: error.message } : null };
          },
          remove: async (paths) => {
            await storage.from("workspace").remove(paths);
          },
        }, {
          projectId: String(proposal.project_id),
          userId,
          orgId,
          proposalId,
          payload: (proposal.payload ?? {}) as Record<string, unknown>,
        });
        const { error: markErr } = await svc.rpc("mark_agent_proposal_applied", {
          p_proposal_id: proposalId,
          p_result: result,
        });
        if (markErr) {
          return jsonResponse({ error: `Rendered, but recording the outcome failed: ${markErr.message}`, type: "APPLY_ERROR" });
        }
        makeTelemetry(svc, { user_id: userId, project_id: String(proposal.project_id) })
          .emit("report.rendered", {
            template_id: result.template_id,
            format: result.format,
            files: result.file_ids.length,
            total_bytes: result.total_bytes,
          }, { proposal_id: proposalId });
        return jsonResponse({ ok: true, applied_result: result });
      } catch (e) {
        if (e instanceof RenderFailure) {
          const { error: markErr } = await svc.rpc("mark_agent_proposal_apply_failed", {
            p_proposal_id: proposalId,
            p_error: `${e.code}: ${e.message}`,
          });
          if (markErr) console.error("mark_agent_proposal_apply_failed failed:", markErr.message);
          return jsonResponse({ error: e.message, code: e.code, type: "APPLY_FAILED" });
        }
        throw e;
      }
    }

    return jsonResponse({ error: `Unknown action "${action}".`, type: "BAD_REQUEST" });
  } catch (err) {
    console.error("report-render error:", err);
    return jsonResponse({
      error: err instanceof Error ? err.message : "report-render failed.",
      type: "AI_ERROR",
    });
  }
});
