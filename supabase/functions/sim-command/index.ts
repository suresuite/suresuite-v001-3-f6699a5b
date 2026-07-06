// sim-command: low-latency entry point for scenario simulation + experiment commands.
// - Validates the incoming command (RLS-aware via the caller's JWT)
// - Publishes it to an Upstash Redis Stream for the Fly.io sim-worker
// - Emits an immediate "echo" delta over Supabase Realtime so the UI loop
//   works end-to-end before the worker is deployed.
//
// Experiment kinds also synthesize a stub simulation_run + replication rows so
// the Simulation Lab UI is fully alive before the worker is online.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import {
  loadGateDataset,
  runValidationGate,
  type GateResult,
} from "../_shared/validationGate.ts";

// Inline like every other function in this repo — supabase-js has no "/cors"
// subpath export; importing one fails at boot, which breaks even the OPTIONS
// preflight and surfaces in the client as "Failed to send a request to the
// Edge Function".
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UPSTASH_URL = Deno.env.get("UPSTASH_REDIS_REST_URL")!;
const UPSTASH_TOKEN = Deno.env.get("UPSTASH_REDIS_REST_TOKEN")!;

const CommandSchema = z.object({
  project_id: z.string().uuid(),
  scenario_id: z.string().uuid().optional(),
  kind: z.enum([
    "scenario.changed",
    "scenario.reset",
    "simulation.snapshot",
    "simulation.fork",
    "policy.changed",
    "experiment.run",
    "experiment.cancel",
    "experiment.add_reps",
  ]),
  payload: z.record(z.unknown()).default({}),
  client_ts: z.number().optional(),
});

type Command = z.infer<typeof CommandSchema>;

async function upstash(args: (string | number)[]): Promise<unknown> {
  const res = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}: ${await res.text()}`);
  return res.json();
}

async function broadcast(channel: string, event: string, payload: unknown) {
  const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ topic: channel, event, payload, private: false }],
    }),
  });
  if (!res.ok) {
    console.error("broadcast failed", res.status, await res.text());
  }
}

function stubKpiDelta(cmd: Command) {
  const magnitude = Number((cmd.payload as Record<string, unknown>).magnitude ?? 0);
  const base = { fill_rate: 0.94, otif: 0.91, revenue: 1_000_000, lead_time_days: 7.2 };
  const k = Math.tanh(magnitude / 100);
  return {
    fill_rate: +(base.fill_rate - 0.18 * k).toFixed(4),
    otif: +(base.otif - 0.22 * k).toFixed(4),
    revenue: Math.round(base.revenue * (1 - 0.27 * k)),
    lead_time_days: +(base.lead_time_days + 4.5 * k).toFixed(2),
    source: "stub",
  };
}

function stubPolicyKpiDelta(cmd: Command) {
  const family = String((cmd.payload as Record<string, unknown>).family ?? "");
  const base = { fill_rate: 0.94, otif: 0.91, revenue: 1_000_000, lead_time_days: 7.2, utilization: 0.78 };
  const bumps: Record<string, Partial<typeof base>> = {
    inventory: { fill_rate: 0.955, otif: 0.92, utilization: 0.74 },
    sourcing: { fill_rate: 0.948, revenue: 1_010_000 },
    transport: { lead_time_days: 6.8, utilization: 0.82 },
    fulfillment: { otif: 0.925, fill_rate: 0.95 },
    production: { revenue: 1_005_000, lead_time_days: 6.9, utilization: 0.86 },
    recovery: { fill_rate: 0.96, otif: 0.93 },
  };
  return { ...base, ...(bumps[family] ?? {}), source: "stub" };
}

// ---------- Recovery-aware stub scoring (mirrors src/lib/sim/recoveryScore.ts) ----------
const RESPONSE_WEIGHTS: Record<string, number> = {
  reroute: 0.2,
  dual_source_activate: 0.3,
  safety_stock_drawdown: 0.15,
  mode_shift: 0.2,
  expedite_freight: 0.2,   // alias for mode_shift; same engine effect
  capacity_flex: 0.25,
  demand_shaping: 0.15,
};

const RESPONSE_CLASS_DELTA: Record<string, Record<string, number>> = {
  capacity_flex: { production: 0.08 },
  mode_shift: { transport: 0.06 },
  reroute: { transport: 0.04 },
  safety_stock_drawdown: { warehouse: 0.05 },
  dual_source_activate: { suppliers: 0.07 },
  demand_shaping: { production: -0.02 },
};

const BASE_CLASS_UTIL: Record<string, number> = {
  suppliers: 0.72,
  production: 0.81,
  warehouse: 0.66,
  transport: 0.74,
};

interface ResolvedRecovery {
  enabled: boolean;
  response: string[];
  detection_lag_days: number;
  trigger_magnitude_pct: number;
  trigger_duration_days: number;
  recovery_target_days: number;
  cost_cap: number;
}

const DEFAULT_RECOVERY: ResolvedRecovery = {
  enabled: true,
  response: [],
  detection_lag_days: 1,
  trigger_magnitude_pct: 25,
  trigger_duration_days: 2,
  recovery_target_days: 21,
  cost_cap: 25000,
};

function resolveRecovery(
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

function baseLoss(disruptions: Array<Record<string, unknown>>): number {
  let total = 0;
  for (const d of disruptions ?? []) {
    total += (Number(d.magnitude_pct ?? 0) * Number(d.duration_days ?? 0)) / 100;
  }
  return total;
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

function toPerDay(volume: number, unit: string | null | undefined): number {
  if (unit === "week") return volume / 7;
  if (unit === "month") return volume / 30;
  return volume;
}

function stubReplicationKpis(
  scenario: Record<string, unknown>,
  repIndex: number,
  seed: number,
  recovery: ResolvedRecovery,
  projectDailyRevenue?: number,
  projectDailyCost?: number,
) {
  const rr = ((seed >>> 0) ^ (repIndex * 2654435761)) >>> 0;
  const noise = ((rr % 1000) / 1000 - 0.5) * 0.04;
  const noise2 = (((rr * 16807) % 1000) / 1000 - 0.5) * 0.06;
  const horizon = Number(scenario.horizon_days ?? 90);
  const horizonScale = horizon / 90;

  const disruptions = (scenario.disruption_schedule as Array<Record<string, unknown>>) ?? [];
  const loss = baseLoss(disruptions);
  const pressure = Math.tanh(loss / 30);
  const mit = (recovery.response ?? []).reduce(
    (s, r) => s + (RESPONSE_WEIGHTS[r] ?? 0),
    0,
  );
  const detection = Math.max(0, recovery.detection_lag_days);
  const active = !!recovery.enabled && disruptions.length > 0;
  const effect = active ? Math.max(0, Math.min(1.3, mit - detection * 0.05)) : 0;
  const reliefP = 1 - 0.7 * effect;
  const reliefL = 1 - 0.6 * effect;

  const fill_rate = clamp01(0.94 - 0.06 * pressure * reliefP + noise);
  const otif = clamp01(0.91 - 0.07 * pressure * reliefP + noise);
  const lead_time_days = +(7.0 + 2.5 * pressure * reliefL + noise2 * 4).toFixed(2);
  const utilization = active
    ? clamp01(0.78 + 0.02 + 0.06 * effect + noise2)
    : clamp01(0.78 + 0.05 * pressure + noise2);
  const backorder_days = +Math.max(0, 2.4 + 4 * pressure * reliefP + Math.abs(noise2) * 6).toFixed(1);
  const ttr_days = active
    ? +Math.max(2, 14 - 8 * effect + detection + Math.abs(noise) * 2).toFixed(1)
    : +(14 + loss / 4 + Math.abs(noise) * 4).toFixed(1);
  const resilience_index = active
    ? +Math.min(0.99, 0.82 + 0.15 * effect + noise).toFixed(3)
    : +Math.max(0.4, 0.85 - 0.2 * pressure + noise).toFixed(3);

  // Use real project financials when available, otherwise fall back to canonical stubs.
  const revenueBase = (projectDailyRevenue && projectDailyRevenue > 0)
    ? projectDailyRevenue * horizon
    : 1_000_000 * horizonScale;
  const costBase = (projectDailyCost && projectDailyCost > 0)
    ? projectDailyCost * horizon
    : 720_000 * horizonScale;
  const costUsed = Math.min(recovery.cost_cap, loss * 1000 * mit);
  const revenue = Math.round(revenueBase * (1 - 0.05 * pressure * reliefP) * (1 + noise));
  const cost = Math.round(costBase + (active ? costUsed : loss * 800));
  const profit = revenue - cost;

  return {
    fill_rate: +fill_rate.toFixed(4),
    fill_rate_beta: +Math.min(1, fill_rate + 0.02).toFixed(4),
    otif: +otif.toFixed(4),
    lead_time_days,
    lead_time_p95: +(lead_time_days * 1.6 + Math.abs(noise2) * 3).toFixed(2),
    revenue,
    cost,
    profit,
    utilization,
    inventory_turns: +(8 + noise2 * 4 - pressure * 1.5).toFixed(2),
    backorder_days,
    ttr_days,
    resilience_index,
  };
}

function stubUtilizationSeries(
  scenario: Record<string, unknown>,
  repIndex: number,
  seed: number,
  recovery: ResolvedRecovery,
) {
  const horizon = Math.min(120, Number(scenario.horizon_days ?? 90));
  const disruptions = (scenario.disruption_schedule as Array<Record<string, unknown>>) ?? [];
  const active = !!recovery.enabled && disruptions.length > 0;

  const classUtil: Record<string, number> = { ...BASE_CLASS_UTIL };
  if (active) {
    for (const r of recovery.response ?? []) {
      const delta = RESPONSE_CLASS_DELTA[r] ?? {};
      for (const [k, v] of Object.entries(delta)) {
        classUtil[k] = Math.max(0, Math.min(1, (classUtil[k] ?? 0.7) + v));
      }
    }
  }

  const nodes: Array<{ name: string; cls: string }> = [
    { name: "supplier_a", cls: "suppliers" },
    { name: "supplier_b", cls: "suppliers" },
    { name: "factory_1", cls: "production" },
    { name: "dc_east", cls: "warehouse" },
    { name: "dc_west", cls: "warehouse" },
    { name: "fleet_truck", cls: "transport" },
    { name: "fleet_air", cls: "transport" },
  ];

  const out: Record<string, number[]> = {};
  for (const node of nodes) {
    const base = classUtil[node.cls] ?? 0.7;
    const jitter = ((node.name.length * (repIndex + 1)) % 20) / 200;
    const series: number[] = [];
    for (let t = 0; t < horizon; t++) {
      let shock = 0;
      for (const d of disruptions) {
        const s = Number(d.start_day ?? 0);
        const dur = Number(d.duration_days ?? 0);
        const mag = Number(d.magnitude_pct ?? 0) / 100;
        if (t >= s && t < s + dur) {
          shock += active ? -0.05 * mag : -0.25 * mag;
        } else if (active && t >= s + dur && t < s + dur + recovery.recovery_target_days) {
          shock += 0.04;
        }
      }
      const x = Math.sin((t + seed % 10) / 6) * 0.08 + jitter + shock;
      series.push(+Math.max(0, Math.min(1, base + x)).toFixed(3));
    }
    out[node.name] = series;
  }
  return out;
}

/** Recursively key-sorted JSON, approximating Postgres jsonb::text ordering.
 * Only used as a fallback hash for legacy versions without a stored policy_hash. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}: ${canonicalJson(v)}`);
    return `{${entries.join(", ")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Carries a §8.1 gate result out of handleExperimentRun as a 422 response. */
class ValidationRejection extends Error {
  constructor(public gate: GateResult) {
    super(`run rejected by the required-data manifest (${gate.status})`);
  }
}

async function handleExperimentRun(
  sb: ReturnType<typeof createClient>,
  cmd: Command,
  userId: string,
) {
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

  // Load the immutable policy version + financial data in parallel.
  // Policies come from the saved version, never from the live tables, so a run
  // is fully reproducible against its version (the graph itself is not versioned).
  // deno-lint-ignore no-explicit-any
  const [{ data: version, error: verErr }, { data: inbound }, { data: outbound }] = await Promise.all([
    (sb as any).from("policy_versions").select("id,project_id,snapshot,policy_hash").eq("id", policyVersionId).maybeSingle(),
    (sb as any).from("inbound_logistics").select("unit_price,volume,time_unit").eq("project_id", scenario.project_id),
    (sb as any).from("outbound_logistics").select("unit_price,volume,time_unit").eq("project_id", scenario.project_id),
  ]);
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
  // against the live project tables. `required` gaps reject the run;
  // `recommended` gaps reject unless the caller acknowledged them after
  // seeing the findings (the /policies verification stage does; the Lab
  // offers a "Run anyway"). Best-effort on read errors: a gate that cannot
  // load data must not take run dispatch down with it.
  try {
    const gateDataset = await loadGateDataset(sb, scenario.project_id as string);
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
    console.error("validation gate skipped (data load failed)", e);
  }

  // Compute daily revenue and cost from actual project data (unit_price × volume_per_day).
  // These ground the stub KPIs in real numbers instead of hardcoded $1M/$720k.
  // deno-lint-ignore no-explicit-any
  const projectDailyRevenue = ((outbound ?? []) as any[]).reduce((sum: number, r: any) => {
    const vpd = toPerDay(Number(r.volume ?? 0), r.time_unit);
    return sum + vpd * Number(r.unit_price ?? 0);
  }, 0);
  // deno-lint-ignore no-explicit-any
  const projectDailyCost = ((inbound ?? []) as any[]).reduce((sum: number, r: any) => {
    const vpd = toPerDay(Number(r.volume ?? 0), r.time_unit);
    return sum + vpd * Number(r.unit_price ?? 0);
  }, 0);

  const meta = {
    recovery,
    disruption_count: ((scenario.disruption_schedule as unknown[]) ?? []).length,
    horizon_days: Number(scenario.horizon_days ?? 90),
  };

  const replications = Math.max(1, Math.min(200, Number(scenario.replications) || 10));
  const seed = Number(scenario.seed) || 42;

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

  // Insert run row (queued)
  // deno-lint-ignore no-explicit-any
  const { data: run, error: runErr } = await (sb as any)
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
    })
    .select()
    .single();
  if (runErr || !run) throw new Error(`run insert failed: ${runErr?.message}`);

  // Push command to worker queue for the real engine. The policy snapshot is
  // embedded so the worker runs the saved version, not the live tables; if the
  // envelope would exceed Upstash limits, the worker fetches it by version id.
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
  await upstash([
    "XADD",
    `sim.cmd.${cmd.project_id}`,
    "MAXLEN", "~", "1000",
    "*",
    "data",
    JSON.stringify(workerEnvelope),
  ]).catch((e) => console.error("xadd failed", e));

  // The worker is the SOLE authoritative writer of results: it sets the run to
  // running, upserts per-replication rows, and writes the aggregates + mapping
  // warnings. The edge function only creates the queued row and enqueues the
  // command — no stub KPIs (which previously masked bad data with fake numbers).
  return { run_id: run.id };
}

async function handleExperimentCancel(
  sb: ReturnType<typeof createClient>,
  cmd: Command,
) {
  const runId = String((cmd.payload as Record<string, unknown>).run_id ?? "");
  if (!runId) throw new Error("run_id required");
  // deno-lint-ignore no-explicit-any
  await (sb as any)
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = CommandSchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const cmd = parsed.data;

    const { data: project, error: projErr } = await sb
      .from("projects")
      .select("id")
      .eq("id", cmd.project_id)
      .maybeSingle();
    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "project not accessible" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const channel = `sim:${cmd.project_id}`;
    const envelope = { ...cmd, user_id: userData.user.id, server_ts: Date.now() };

    if (cmd.kind === "experiment.run") {
      let result: { run_id: string };
      try {
        result = await handleExperimentRun(sb, cmd, userData.user.id);
      } catch (e) {
        if (e instanceof ValidationRejection) {
          return new Response(
            JSON.stringify({
              error: "run rejected by the required-data manifest",
              validation: e.gate.status,
              ack_required: e.gate.status === "ack_required",
              findings: e.gate.findings,
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw e;
      }
      await broadcast(channel, "run.queued", { ...envelope, ...result });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (cmd.kind === "experiment.cancel") {
      await handleExperimentCancel(sb, cmd);
      return new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (cmd.kind === "experiment.add_reps") {
      await upstash([
        "XADD",
        `sim.cmd.${cmd.project_id}`,
        "*",
        "data",
        JSON.stringify(envelope),
      ]).catch((e) => console.error("xadd add_reps failed", e));
      return new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default: enqueue + broadcast echoes (existing behavior).
    await Promise.all([
      upstash([
        "XADD",
        `sim.cmd.${cmd.project_id}`,
        "MAXLEN", "~", "1000",
        "*",
        "data",
        JSON.stringify(envelope),
      ]).catch((e) => console.error("xadd failed", e)),
      broadcast(channel, "command", envelope),
      cmd.kind === "scenario.changed"
        ? broadcast(channel, "kpi.delta", { kpis: stubKpiDelta(cmd), ts: Date.now(), source: "stub" })
        : cmd.kind === "policy.changed"
        ? broadcast(channel, "kpi.delta", {
            kpis: stubPolicyKpiDelta(cmd),
            ts: Date.now(),
            source: "stub",
          })
        : Promise.resolve(),
    ]);

    return new Response(JSON.stringify({ ok: true, server_ts: envelope.server_ts }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sim-command error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
