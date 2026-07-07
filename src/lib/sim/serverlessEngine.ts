// Client for the serverless simulation engine (api/run_simulation.py).
//
// The Fly/Redis worker never deployed (no Fly token), so runs sat "queued"
// forever. Instead we run scsim in a Vercel Python function and persist the
// result it returns straight from the browser via the app's anon role
// (granted write on simulation_runs + run_replications by migrations
// 20260706000001 / 20260707000002). sim-command still creates the queued run
// row and runs the §8.1 validation gate; THIS drives the actual compute.

import { supabase } from "@/integrations/supabase/client";

export interface EngineDataset {
  suppliers: Record<string, unknown>[];
  materials: Record<string, unknown>[];
  products: Record<string, unknown>[];
  inbound: Record<string, unknown>[];
  bom: Record<string, unknown>[];
  outbound: Record<string, unknown>[];
}

interface EngineReply {
  ok: boolean;
  error?: string;
  trace?: string;
  run_update?: Record<string, unknown>;
  replications?: Record<string, unknown>[];
  engine_version?: string;
}

export interface RunOnServerlessArgs {
  runId: string;
  projectId: string;
  /** v2 policy snapshot (policy_versions.snapshot) — the reproducible source. */
  snapshot: Record<string, unknown>;
  scenario: { seed: number; horizon_days: number; replications: number; crn?: boolean };
  projectModel: string | null;
  dataset: EngineDataset;
}

/**
 * Compute a run on the serverless engine and persist its result. Marks the
 * run failed (so the UI shows the reason) if the engine errors. Returns the
 * engine version on success.
 */
export async function runOnServerless(args: RunOnServerlessArgs): Promise<string> {
  const { runId, projectId, snapshot, scenario, projectModel, dataset } = args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  let reply: EngineReply;
  try {
    const res = await fetch("/api/run_simulation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        project_id: projectId,
        snapshot,
        scenario,
        project_model: projectModel,
        dataset,
      }),
    });
    reply = (await res.json()) as EngineReply;
    if (!res.ok || !reply.ok) {
      throw new Error(reply.error || `engine HTTP ${res.status}`);
    }
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    await sb.from("simulation_runs")
      .update({ status: "failed", error_message: message.slice(0, 500), ended_at: new Date().toISOString() })
      .eq("id", runId);
    throw new Error(message);
  }

  // Persist per-replication rows first (idempotent on run_id,rep_index), then
  // flip the run to done with aggregates — so a reader never sees "done" with
  // no replications behind it.
  const reps = reply.replications ?? [];
  if (reps.length > 0) {
    const { error: repErr } = await sb
      .from("run_replications")
      .upsert(reps, { onConflict: "run_id,rep_index" });
    if (repErr) throw new Error(`replication write failed: ${repErr.message ?? repErr}`);
  }
  const { error: runErr } = await sb
    .from("simulation_runs")
    .update(reply.run_update ?? {})
    .eq("id", runId);
  if (runErr) throw new Error(`run update failed: ${runErr.message ?? runErr}`);

  return reply.engine_version ?? "scsim";
}

/** Fetch the immutable saved snapshot to run (reproducible source of truth). */
export async function fetchPolicySnapshot(versionId: string): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("policy_versions")
    .select("snapshot")
    .eq("id", versionId)
    .maybeSingle();
  if (error || !data?.snapshot) {
    throw new Error(`could not load policy snapshot ${versionId}: ${error?.message ?? "not found"}`);
  }
  return data.snapshot as Record<string, unknown>;
}
