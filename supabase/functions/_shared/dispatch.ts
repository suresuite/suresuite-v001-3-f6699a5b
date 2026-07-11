// Shared run-dispatch path — API Phase 2 / G15 / §4.
//
// Extracted verbatim from sim-command so the browser dispatcher (sim-command)
// and the public /v1 gateway (functions/api) drive the exact same pipeline to
// the Fly worker: policy-version binding → validation gate → dataset snapshot
// → credibility stamp → queued run row → Upstash enqueue. One code path, two
// authenticated front doors (docs/design/public-api-and-access-control.md §3.1).
//
// Callers own authentication/authorization/quotas; this module assumes the
// command has already been authorized for its project.

import {
  loadGateDataset,
  runValidationGate,
  type GateResult,
} from "./validationGate.ts";

// Matches sim-command's Zod CommandSchema output; the API gateway constructs
// these directly from its own validated request bodies.
export interface DispatchCommand {
  project_id: string;
  scenario_id?: string;
  kind: string;
  payload: Record<string, unknown>;
  client_ts?: number;
}

export interface DispatchDeps {
  /** Client for scenario/policy reads. sim-command passes its RLS-aware
   * client (anon reads are granted on these tables); the API gateway passes
   * the service client scoped by its own tenancy check. */
  // deno-lint-ignore no-explicit-any
  reader: any;
  /** Service-role client: authoritative creator of the queued run row. */
  // deno-lint-ignore no-explicit-any
  svc: any;
  /** Upstash REST command runner (owned by the caller, which holds the env). */
  upstash: (args: (string | number)[]) => Promise<unknown>;
}

export interface ResolvedRecovery {
  enabled: boolean;
  response: string[];
  detection_lag_days: number;
  trigger_magnitude_pct: number;
  trigger_duration_days: number;
  recovery_target_days: number;
  cost_cap: number;
}

export const DEFAULT_RECOVERY: ResolvedRecovery = {
  enabled: true,
  response: [],
  detection_lag_days: 1,
  trigger_magnitude_pct: 25,
  trigger_duration_days: 2,
  recovery_target_days: 21,
  cost_cap: 25000,
};

export function resolveRecovery(
  defaults: Record<string, unknown> | null,
  overrides: Record<string, unknown> | null,
): ResolvedRecovery {
  const base: Record<string, unknown> = { ...DEFAULT_RECOVERY, ...(defaults ?? {}) };
  if (overrides && typeof overrides === "object") {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === null) continue;
      base[k] = v;
    }
  }
  return base as unknown as ResolvedRecovery;
}

/** Recursively key-sorted JSON, approximating Postgres jsonb::text ordering.
 * Only used as a fallback hash for legacy versions without a stored policy_hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}: ${canonicalJson(v)}`);
    return `{${entries.join(", ")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Carries a §8.1 gate result out of dispatchExperimentRun as a 422 response. */
export class ValidationRejection extends Error {
  constructor(public gate: GateResult) {
    super(`run rejected by the required-data manifest (${gate.status})`);
  }
}

export async function dispatchExperimentRun(
  deps: DispatchDeps,
  cmd: DispatchCommand,
  userId: string | null,
): Promise<{ run_id: string }> {
  const { reader: sb, svc, upstash } = deps;
  if (!cmd.scenario_id) throw new Error("experiment.run requires scenario_id");

  const policyVersionId = String(
    (cmd.payload as Record<string, unknown>).policy_version_id ?? "",
  );
  if (!policyVersionId) {
    throw new Error("experiment.run requires a saved policy version (policy_version_id)");
  }

  // Load scenario
  // deno-lint-ignore no-explicit-any
  const { data: scenario, error: scErr } = await (sb as any)
    .from("scenarios")
    .select("*")
    .eq("id", cmd.scenario_id)
    .maybeSingle();
  if (scErr || !scenario) throw new Error("scenario not found");
  if (scenario.project_id !== cmd.project_id) {
    throw new Error("scenario does not belong to this project");
  }

  // Load the immutable policy version. Policies come from the saved version,
  // never from the live tables, so a run is fully reproducible against its
  // version (the graph itself is not versioned).
  // deno-lint-ignore no-explicit-any
  const { data: version, error: verErr } = await (sb as any)
    .from("policy_versions")
    .select("id,project_id,snapshot,policy_hash")
    .eq("id", policyVersionId)
    .maybeSingle();
  if (verErr || !version) throw new Error("policy version not found");
  if (version.project_id !== scenario.project_id) {
    throw new Error("policy version does not belong to this project");
  }

  const snapshot = (version.snapshot ?? {}) as Record<string, unknown>;
  // v2 snapshots nest families under "defaults"; v1 snapshots are flat.
  const snapshotDefaults = (
    "defaults" in snapshot ? snapshot.defaults : snapshot
  ) as Record<string, unknown>;
  const policyHash: string =
    (version.policy_hash as string | null) ?? (await sha256Hex(canonicalJson(snapshot)));

  const recovery = resolveRecovery(
    (snapshotDefaults?.recovery as Record<string, unknown> | null) ?? null,
    (scenario.recovery_overrides as Record<string, unknown> | null) ?? null,
  );

  // Pre-dispatch validation gate (§8.1–8.2): grade the required-data manifest
  // — compiled from the engine registry for THIS policy configuration —
  // against the live project tables, read with the SERVICE ROLE (grading is a
  // read-only completeness check; anon-context reads silently miss rows and
  // once produced false blocks). `block` findings reject the run; `warn`
  // findings reject unless the caller acknowledged them after seeing the
  // findings (the /policies verification stage does; the Lab offers a
  // "Run anyway"). Fail-open on read errors — a gate that cannot load data
  // must not take run dispatch down with it — but the skip is recorded on
  // the run row (gate_skipped) instead of vanishing into the logs.
  let gateSkipped = false;
  try {
    const gateDataset = await loadGateDataset(svc, scenario.project_id as string);
    const gate = runValidationGate({
      dataset: gateDataset,
      snapshotDefaults: snapshotDefaults ?? {},
      disruptionSchedule:
        (scenario.disruption_schedule as Array<Record<string, unknown>>) ?? [],
      acknowledgeWarnings:
        (cmd.payload as Record<string, unknown>).acknowledge_warnings === true,
    });
    if (gate) throw new ValidationRejection(gate);
  } catch (e) {
    if (e instanceof ValidationRejection) throw e;
    gateSkipped = true;
    console.error("validation gate skipped (data load failed)", e);
  }

  const replications = Math.max(1, Math.min(200, Number(scenario.replications) || 10));

  // Snapshot the dataset (graph + economics) and bind this run to it, so a
  // later CSV re-upload is detectable rather than silently changing history
  // (Phase A / G5 / §8.4). Deduped server-side: an unchanged dataset reuses
  // its latest version. Best-effort: if the migration hasn't reached the DB
  // yet the run still dispatches, just without a dataset binding.
  let datasetVersionId: string | null = null;
  let graphHash: string | null = null;
  try {
    // deno-lint-ignore no-explicit-any
    const { data: dsId, error: dsErr } = await (sb as any).rpc("snapshot_dataset", {
      p_project_id: scenario.project_id,
    });
    if (dsErr) throw dsErr;
    datasetVersionId = (dsId as string | null) ?? null;
    if (datasetVersionId) {
      // deno-lint-ignore no-explicit-any
      const { data: dv } = await (sb as any)
        .from("dataset_versions")
        .select("graph_hash")
        .eq("id", datasetVersionId)
        .maybeSingle();
      graphHash = (dv?.graph_hash as string | null) ?? null;
    }
  } catch (e) {
    console.error("snapshot_dataset failed (run continues unbound)", e);
  }

  // Stamp the credibility provenance (Phase B0 / G13 / §9.5): the scenario's
  // baseline fingerprint hash and — when the exact triple has an active card —
  // the model_validation in force at dispatch. Best-effort like the dataset
  // binding above: a missing card (or a DB without the migration) never
  // blocks a run; it just runs labeled unvalidated (§9.5 labels, not gates).
  let scenarioHash: string | null = null;
  let modelValidationId: string | null = null;
  try {
    // deno-lint-ignore no-explicit-any
    const { data: sh, error: shErr } = await (sb as any).rpc("scenario_fingerprint_hash", {
      p_scenario_id: scenario.id,
    });
    if (shErr) throw shErr;
    scenarioHash = (sh as string | null) ?? null;
    if (scenarioHash && graphHash) {
      // deno-lint-ignore no-explicit-any
      const { data: card, error: cardErr } = await (sb as any).rpc("active_model_validation", {
        p_policy_version_id: policyVersionId,
        p_graph_hash: graphHash,
        p_scenario_hash: scenarioHash,
      });
      if (cardErr) throw cardErr;
      const row = Array.isArray(card) ? card[0] : card;
      modelValidationId = (row?.id as string | null) ?? null;
    }
  } catch (e) {
    console.error("model-validation stamp failed (run continues unstamped)", e);
  }

  // Insert run row (queued) with the SERVICE ROLE: the dispatcher is the
  // authoritative creator of the queued row (as the worker is of results),
  // and an RLS/migration-ordering gap must never 500 a dispatch. The anon
  // grants migration (20260706000001) remains required for the FRONTEND to
  // read runs/replications + receive their realtime events.
  // deno-lint-ignore no-explicit-any
  const { data: run, error: runErr } = await (svc as any)
    .from("simulation_runs")
    .insert({
      scenario_id: scenario.id,
      project_id: scenario.project_id,
      status: "queued",
      rep_count_target: replications,
      rep_count_done: 0,
      code_version: "",
      policy_version_id: policyVersionId,
      policy_hash: policyHash,
      dataset_version_id: datasetVersionId,
      graph_hash: graphHash,
      created_by: userId,
      // Spread-guarded so a database without the B0 migration still inserts.
      ...(scenarioHash ? { scenario_hash: scenarioHash } : {}),
      ...(modelValidationId ? { model_validation_id: modelValidationId } : {}),
      ...(gateSkipped ? { gate_skipped: true } : {}),
    })
    .select()
    .single();
  if (runErr || !run) throw new Error(`run insert failed: ${runErr?.message}`);

  // Browser/offline runs (payload.compute === "client") go through the same
  // gate + version binding + queued row, but the CLIENT computes and persists
  // the results itself — so don't wake the worker, or two writers would race
  // on the same run. Server runs (the default) enqueue for the Fly worker.
  const clientCompute =
    (cmd.payload as Record<string, unknown>).compute === "client";

  // Push command to worker queue for the real engine. The policy snapshot is
  // embedded so the worker runs the saved version, not the live tables; if the
  // envelope would exceed Upstash limits, the worker fetches it by version id.
  if (!clientCompute) {
    const workerEnvelope: Record<string, unknown> = {
      ...cmd,
      run_id: run.id,
      scenario,
      recovery,
      policy_version_id: policyVersionId,
      policy_hash: policyHash,
      policy_snapshot: snapshot,
      server_ts: Date.now(),
    };
    if (JSON.stringify(workerEnvelope).length > 700_000) {
      delete workerEnvelope.policy_snapshot;
    }
    const stream = `sim.cmd.${cmd.project_id}`;
    try {
      // Ensure the consumer group exists BEFORE the XADD: the worker creates
      // it at "$" when it first discovers a stream, so a message added before
      // that moment would never be delivered (the first command on any fresh
      // stream — the classic lost-first-run). BUSYGROUP means it's already
      // there, which is fine.
      await upstash([
        "XGROUP", "CREATE", stream, "sim-workers", "$", "MKSTREAM",
      ]).catch((e) => {
        if (!String(e).includes("BUSYGROUP")) throw e;
      });
      await upstash([
        "XADD", stream, "MAXLEN", "~", "1000", "*",
        "data", JSON.stringify(workerEnvelope),
      ]);
    } catch (e) {
      // A run that never reached the queue must not sit "queued" forever —
      // that black hole is indistinguishable from a dead worker. Fail loudly.
      console.error("enqueue failed", e);
      await (svc as any)
        .from("simulation_runs")
        .update({
          status: "failed",
          error_message: `enqueue to worker queue failed: ${String(e).slice(0, 300)}`,
          ended_at: new Date().toISOString(),
        })
        .eq("id", run.id);
      throw new Error(`enqueue to worker queue failed: ${String(e).slice(0, 300)}`);
    }
  }

  // The worker is the SOLE authoritative writer of results: it sets the run to
  // running, upserts per-replication rows, and writes the aggregates + mapping
  // warnings. The dispatcher only creates the queued row and enqueues the
  // command — no stub KPIs (which previously masked bad data with fake numbers).
  return { run_id: run.id };
}

export async function dispatchExperimentCancel(
  deps: DispatchDeps,
  cmd: DispatchCommand,
): Promise<void> {
  const { svc, upstash } = deps;
  const runId = String((cmd.payload as Record<string, unknown>).run_id ?? "");
  if (!runId) throw new Error("run_id required");
  // Service role for the same reason as the run insert: the status flip must
  // not silently no-op on a database missing the anon-grants migration.
  // deno-lint-ignore no-explicit-any
  await (svc as any)
    .from("simulation_runs")
    .update({ status: "cancelled", ended_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["queued", "running"]);
  await upstash([
    "XADD",
    `sim.cmd.${cmd.project_id}`,
    "*",
    "data",
    JSON.stringify({ ...cmd, server_ts: Date.now() }),
  ]).catch((e) => console.error("xadd cancel failed", e));
}

/** Enqueue a raw command envelope (add-reps and echo-style commands). */
export async function enqueueEnvelope(
  deps: Pick<DispatchDeps, "upstash">,
  projectId: string,
  envelope: Record<string, unknown>,
): Promise<void> {
  await deps.upstash([
    "XADD",
    `sim.cmd.${projectId}`,
    "MAXLEN", "~", "1000",
    "*",
    "data",
    JSON.stringify(envelope),
  ]);
}
