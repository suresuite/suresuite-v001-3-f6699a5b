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

export interface EngineResult {
  engineVersion: string;
  runUpdate: Record<string, unknown>;
  replications: Record<string, unknown>[];
}

/**
 * Compute a run on the serverless engine and return its result. The caller
 * renders it directly (so the run is visible even if the DB round-trip is
 * unavailable) — persistence is best-effort on top (persistEngineResult).
 */
export async function runOnServerless(args: RunOnServerlessArgs): Promise<EngineResult> {
  const { runId, projectId, snapshot, scenario, projectModel, dataset } = args;

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
  let reply: EngineReply;
  try {
    reply = (await res.json()) as EngineReply;
  } catch {
    throw new Error(`engine HTTP ${res.status} — the /api/run_simulation function did not return JSON (is it deployed?)`);
  }
  if (!res.ok || !reply.ok) {
    throw new Error(reply.error || `engine HTTP ${res.status}`);
  }

  return {
    engineVersion: reply.engine_version ?? "scsim",
    runUpdate: reply.run_update ?? {},
    replications: reply.replications ?? [],
  };
}

/**
 * Best-effort persistence of an engine result to Supabase (so the run joins
 * project history and the Lab). Requires the anon write grants (migrations
 * 20260706000001 / 20260707000002); if they are not yet applied the write
 * fails harmlessly — the caller already rendered the result from memory.
 * Returns true on success.
 */
export async function persistEngineResult(runId: string, result: EngineResult): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  try {
    if (result.replications.length > 0) {
      const { error: repErr } = await sb
        .from("run_replications")
        .upsert(result.replications, { onConflict: "run_id,rep_index" });
      if (repErr) throw repErr;
    }
    const { error: runErr } = await sb
      .from("simulation_runs")
      .update(result.runUpdate)
      .eq("id", runId);
    if (runErr) throw runErr;
    return true;
  } catch (err) {
    console.warn("[serverlessEngine] result rendered but not persisted:", err);
    return false;
  }
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
