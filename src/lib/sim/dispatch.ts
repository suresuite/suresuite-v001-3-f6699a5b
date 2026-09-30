/**
 * The one `sim-command` client for dispatching a run (WP 9.4 slice 8).
 *
 * Run & Validate (/policies) and the Simulation Lab each carried their own copy
 * of this call — the payload, the 422 gate parse, the 409 reuse-or-rerun parse
 * and the reuse prompt's wording — and the two had already drifted (one threw a
 * descriptive error, the other the SDK's generic "non-2xx"). The dispatch is one
 * operation with one gate behind it, so it has one client. Each caller keeps its
 * own decisions: whether warnings are acknowledged, whether to compute in the
 * browser, what to do with a reuse candidate.
 */
import { supabase } from "@/integrations/supabase/client";

/** One finding of a sim-command 422 — the §8.1 gate's typed shape. */
export interface GateResponseFinding {
  severity: "block" | "warn" | "info";
  field: string;
  policy: string;
  rows: string[];
  message: string;
}

/** A completed run identical to the requested one (reuse-or-rerun, §9.2). */
export interface ReuseCandidate {
  run_id: string;
  ended_at: string | null;
  created_at: string;
  code_version: string | null;
  rep_count_done: number | null;
}

/** Typed dispatch outcome: queued, or rejected with the gate's findings so
 *  the caller renders them structurally instead of concatenating a toast. */
export interface RunDispatchResult {
  queued: boolean;
  /** Set when queued — the run row sim-command created. */
  runId?: string;
  /** Set when queued=false — the rejection class. */
  status?: "blocked" | "ack_required" | "reuse_available";
  /** Set when queued=false — the gate's typed findings. */
  findings?: GateResponseFinding[];
  /** Set when status="reuse_available" — the identical completed run
   *  (reuse is a USER choice: surface it, or re-dispatch with forceRerun). */
  reuseCandidate?: ReuseCandidate;
}

interface ErrorBody {
  error?: unknown;
  validation?: "blocked" | "ack_required";
  findings?: GateResponseFinding[];
  reuse_available?: boolean;
  reuse_candidate?: ReuseCandidate;
}

export interface DispatchArgs {
  projectId: string;
  scenarioId: string;
  policyVersionId: string;
  /** the §8.1 acknowledgement for warn-level findings — the CALLER's decision */
  acknowledgeWarnings: boolean;
  forceRerun?: boolean;
  /** Run & Validate's browser engine: sim-command gates and records, does not enqueue */
  compute?: "client";
  /** one replication with per-item evidence (G17) */
  inspection?: boolean;
}

export async function dispatchExperiment(a: DispatchArgs): Promise<RunDispatchResult> {
  const { data, error } = await supabase.functions.invoke("sim-command", {
    body: {
      project_id: a.projectId,
      scenario_id: a.scenarioId,
      kind: "experiment.run",
      payload: {
        policy_version_id: a.policyVersionId,
        acknowledge_warnings: a.acknowledgeWarnings,
        ...(a.compute ? { compute: a.compute } : {}),
        ...(a.inspection ? { inspection: true } : {}),
        ...(a.forceRerun ? { force_rerun: true } : {}),
      },
      client_ts: Date.now(),
    },
  });
  if (!error) {
    return { queued: true, runId: (data as { run_id?: string } | null)?.run_id };
  }

  const ctx = (error as { context?: Response }).context;
  let body: ErrorBody | null = null;
  if (ctx && typeof ctx.json === "function") {
    try {
      body = (await ctx.clone().json()) as ErrorBody;
    } catch {
      body = null; // non-JSON body — the status line below
    }
  }
  // §8.1 required-data gate: a 422 with typed findings instead of a run on
  // silently-defaulted data.
  if (body?.validation) {
    return { queued: false, status: body.validation, findings: body.findings ?? [] };
  }
  // §9.2 reuse-or-rerun (409): identical completed results exist.
  if (body?.reuse_available && body.reuse_candidate) {
    return { queued: false, status: "reuse_available", reuseCandidate: body.reuse_candidate };
  }
  // An operational failure: the server's own words, not the SDK's "non-2xx".
  if (ctx) {
    if (body?.error) {
      const msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
      throw new Error(`sim-command HTTP ${ctx.status}: ${msg.slice(0, 300)}`);
    }
    throw new Error(
      `sim-command HTTP ${ctx.status} — check the function logs in the Supabase dashboard ` +
        `(a 503 boot error means a stale/broken function version is deployed)`,
    );
  }
  throw error;
}

/** The reuse-or-rerun question, worded once. OK reuses; Cancel re-runs. */
export function reusePromptText(c: Pick<ReuseCandidate, "ended_at" | "rep_count_done" | "code_version">): string {
  const when = c.ended_at ? new Date(c.ended_at).toLocaleString() : "earlier";
  return (
    `Identical results already exist from ${when} ` +
    `(${c.rep_count_done ?? "?"} replication(s), engine ${c.code_version || "unknown"}).\n\n` +
    `OK — reuse the stored results (no recompute).\n` +
    `Cancel — re-run the simulation from scratch.`
  );
}
