// sim-command: low-latency entry point for scenario simulation + experiment commands.
// - Validates the incoming command (RLS-aware via the caller's JWT)
// - Publishes it to an Upstash Redis Stream for the Fly.io sim-worker
// - Emits an immediate "echo" delta over Supabase Realtime so the UI loop
//   works end-to-end before the worker is deployed.
//
// The run-dispatch pipeline itself (gate → version binding → queued row →
// enqueue) lives in _shared/dispatch.ts and is shared with the public /v1
// gateway (functions/api) — one code path to the worker, two authenticated
// front doors (API Phase 2 / G15 / §4 of the API design doc).

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import {
  dispatchExperimentCancel,
  dispatchExperimentRun,
  enqueueEnvelope,
  ReuseAvailable,
  ValidationRejection,
} from "../_shared/dispatch.ts";
import { cleanEnv } from "../_shared/env.ts";
import { fireWakeWorker } from "../_shared/wakeWorker.ts";

// Inline like every other function in this repo — supabase-js has no "/cors"
// subpath export; importing one fails at boot, which breaks even the OPTIONS
// preflight and surfaces in the client as "Failed to send a request to the
// Edge Function".
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// All secrets go through cleanEnv: a value pasted into a dashboard with
// wrapping quotes must not take the dispatcher down (see _shared/env.ts).
const SUPABASE_URL = cleanEnv("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = cleanEnv("SUPABASE_PUBLISHABLE_KEY") ?? cleanEnv("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv("SUPABASE_SERVICE_ROLE_KEY")!;
const UPSTASH_URL = cleanEnv("UPSTASH_REDIS_REST_URL")!;
const UPSTASH_TOKEN = cleanEnv("UPSTASH_REDIS_REST_TOKEN")!;

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
    // This app authenticates through the approved_users RPC flow and always
    // invokes functions with the platform-verified anon JWT — there is no
    // Supabase Auth session (see migration 20260610000002). Use the auth
    // user when one exists (future Supabase Auth migration keeps working),
    // otherwise proceed with the anon identity, matching the RLS posture of
    // the rest of the data layer. created_by stays an auth.users id (FK),
    // so it is null for app users.
    const { data: userData } = await sb.auth.getUser();
    const authUserId: string | null = userData?.user?.id ?? null;

    const parsed = CommandSchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const cmd = parsed.data;

    // Existence check via service role: projects RLS is scoped to the
    // custom approved_users context, which a pooled PostgREST connection
    // never carries — an anon-context select returns zero rows even for
    // valid projects (the frontend reads projects through the
    // list_projects SECURITY DEFINER RPC for the same reason). In this
    // app access control lives in that RPC layer, not here. The public
    // /v1 gateway adds the per-caller tenancy check the browser path
    // gets from the RPC layer (API design doc §6.2).
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: project, error: projErr } = await svc
      .from("projects")
      .select("id")
      .eq("id", cmd.project_id)
      .maybeSingle();
    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const channel = `sim:${cmd.project_id}`;
    const envelope = { ...cmd, user_id: authUserId, server_ts: Date.now() };
    const deps = { reader: sb, svc, upstash };

    if (cmd.kind === "experiment.run") {
      let result: { run_id: string };
      try {
        result = await dispatchExperimentRun(deps, cmd, authUserId);
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
        // Reuse-or-rerun (G17 / §9.2 read-path slice): identical completed
        // results exist. Reuse is a USER choice — the client either surfaces
        // the candidate run or re-dispatches with payload.force_rerun=true.
        if (e instanceof ReuseAvailable) {
          return new Response(
            JSON.stringify({
              error: "identical completed run exists — reuse or re-run",
              reuse_available: true,
              reuse_candidate: e.candidate,
            }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw e;
      }
      // (dispatchExperimentRun wakes a scaled-to-zero worker after it enqueues,
      // so both the browser and the /v1 API front doors get it for free.)
      await broadcast(channel, "run.queued", { ...envelope, ...result });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (cmd.kind === "experiment.cancel") {
      await dispatchExperimentCancel(deps, cmd);  // wakes the worker internally
      return new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (cmd.kind === "experiment.add_reps") {
      await enqueueEnvelope(deps, cmd.project_id, envelope).catch((e) =>
        console.error("xadd add_reps failed", e)
      );
      fireWakeWorker();
      return new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default: enqueue + broadcast echoes (existing behavior).
    await Promise.all([
      enqueueEnvelope(deps, cmd.project_id, envelope).catch((e) =>
        console.error("xadd failed", e)
      ),
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
    fireWakeWorker();  // scenario/policy commands also feed the Fly worker

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
