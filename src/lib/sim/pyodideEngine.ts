// The simulation engine, running IN THE BROWSER via Pyodide — but OFF the main
// thread, inside a Web Worker (src/lib/sim/engine.worker.ts).
//
// Why: the Fly worker never deployed (no Fly token) and a Vercel Python
// function blows Vercel's 250 MB Lambda limit (scipy). Pyodide runs the REAL
// scsim Python engine client-side — no server, no new infra, no deploy
// coupling. Running it in a worker keeps the UI responsive during a (slow,
// WASM, multi-replication) run: the tab never freezes, per-replication
// progress streams in live, and the run can be cancelled by terminating the
// worker (the only way to interrupt a blocking WASM computation).
//
// This module is the thin MAIN-THREAD client: it owns the worker, translates
// its messages into callbacks, and keeps the Supabase persistence helpers
// (which must run on the main thread). The heavy lifting lives in the worker.

import { supabase } from "@/integrations/supabase/client";

export interface EngineResult {
  engineVersion: string;
  runUpdate: Record<string, unknown>;
  replications: Record<string, unknown>[];
}

export interface EngineDataset {
  suppliers: Record<string, unknown>[];
  materials: Record<string, unknown>[];
  products: Record<string, unknown>[];
  inbound: Record<string, unknown>[];
  bom: Record<string, unknown>[];
  outbound: Record<string, unknown>[];
}

export interface RunArgs {
  runId: string;
  projectId: string;
  snapshot: Record<string, unknown>;
  scenario: { seed: number; horizon_days: number; replications: number; crn?: boolean };
  projectModel: string | null;
  dataset: EngineDataset;
}

/** Coarse phases for the loud UI status. */
export type LoadPhase = "loading-runtime" | "loading-packages" | "loading-engine" | "ready";

/** One replication finished — streamed live so the grid/charts fill in. */
export type OnReplication = (rep: Record<string, unknown>, done: number, total: number) => void;

/** Thrown when a run is cancelled via cancelBrowserRun() — callers treat this
 *  as a benign stop (not a failure). */
export class EngineCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "EngineCancelledError";
  }
}

// ── Worker lifecycle ────────────────────────────────────────────────────────
// One cached worker for the page. It keeps Pyodide + the engine loaded across
// runs. Terminating it (cancel) throws that away; the next run lazily respawns.

let worker: Worker | null = null;
// The in-flight run's reject fn, so cancel can unblock a pending await.
let activeReject: ((e: unknown) => void) | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

function manifestUrl(): string {
  return new URL("/engine/manifest.json", window.location.origin).href;
}

/**
 * Cancel the in-flight run. Terminating the worker is the ONLY way to interrupt
 * a blocking WASM computation; the pending run promise rejects with
 * EngineCancelledError and the next run respawns a fresh (cold) worker.
 */
export function cancelBrowserRun(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (activeReject) {
    const rej = activeReject;
    activeReject = null;
    rej(new EngineCancelledError());
  }
}

/**
 * Warm the engine ahead of a run (preloads Pyodide + numpy/scipy/pydantic + the
 * wheels in the worker). Call it when the user reaches the Run step so the
 * ~20 MB first-load overlaps with reading/config instead of the click. Cached
 * in the worker, so calling it repeatedly is cheap. `onPhase` drives the loud
 * loading status.
 */
export function ensureEngine(onPhase?: (p: LoadPhase) => void): Promise<void> {
  const w = getWorker();
  return new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const m = e.data as { type: string; phase?: LoadPhase; error?: string };
      if (m.type === "phase") onPhase?.(m.phase as LoadPhase);
      else if (m.type === "warmed") {
        cleanup();
        resolve();
      } else if (m.type === "error") {
        cleanup();
        reject(new Error(m.error));
      }
    };
    const cleanup = () => w.removeEventListener("message", handler);
    w.addEventListener("message", handler);
    w.postMessage({ type: "warm", manifestUrl: manifestUrl() });
  });
}

/** Run one simulation in the worker and return the persisted-row-shaped result.
 *  `onReplication` fires as each replication completes (live streaming). */
export function runInBrowser(
  args: RunArgs,
  onPhase?: (p: LoadPhase) => void,
  onReplication?: OnReplication,
): Promise<EngineResult> {
  const w = getWorker();
  const payload = JSON.stringify({
    run_id: args.runId,
    project_id: args.projectId,
    snapshot: args.snapshot,
    scenario: { ...args.scenario, crn: args.scenario.crn ?? true },
    project_model: args.projectModel,
    dataset: args.dataset,
  });
  return new Promise<EngineResult>((resolve, reject) => {
    activeReject = reject;
    const handler = (e: MessageEvent) => {
      const m = e.data as {
        type: string;
        phase?: LoadPhase;
        rep?: Record<string, unknown>;
        done?: number;
        total?: number;
        result?: { engine_version?: string; run_update: Record<string, unknown>; replications: Record<string, unknown>[] };
        error?: string;
      };
      switch (m.type) {
        case "phase":
          onPhase?.(m.phase as LoadPhase);
          break;
        case "replication":
          onReplication?.(m.rep ?? {}, m.done ?? 0, m.total ?? 0);
          break;
        case "result":
          cleanup();
          resolve({
            engineVersion: m.result?.engine_version ?? "scsim",
            runUpdate: m.result!.run_update,
            replications: m.result!.replications,
          });
          break;
        case "error":
          cleanup();
          reject(new Error(m.error));
          break;
      }
    };
    const cleanup = () => {
      w.removeEventListener("message", handler);
      activeReject = null;
    };
    w.addEventListener("message", handler);
    w.postMessage({ type: "run", manifestUrl: manifestUrl(), payload });
  });
}

/** One-click self-test result — a single flat shape (not a discriminated union)
 *  so callers narrow on `ok` without depending on strictNullChecks. */
export interface SelfTestResult {
  ok: boolean;
  fillRate?: number;
  reps?: number;
  engineVersion?: string;
  error?: string;
}

/** One-click self-test: run a fixed built-in scenario (no user data, no DB).
 *  Exercises the full off-thread worker path end to end. */
export async function selfTest(onPhase?: (p: LoadPhase) => void): Promise<SelfTestResult> {
  try {
    const result = await runInBrowser(
      {
        runId: "selftest",
        projectId: "selftest",
        snapshot: {
          schema_version: 2,
          defaults: {
            inventory: { type: "min_max", safety_stock_method: "fixed_days", safety_stock_days: 7 },
            fulfillment: { allocation: "priority", backorder_allowed: true, max_backorder_days: 14 },
          },
          fulfillment_strategy: "make_to_stock",
          overrides: [],
        },
        scenario: { seed: 1, horizon_days: 365, replications: 3 },
        projectModel: "make_to_stock",
        dataset: {
          suppliers: [{ supplier_id: "S", reliability_score: 0.95 }],
          materials: [{ material_id: "M", cost: 4.0, initial_on_hand: 200 }],
          products: [{ product_id: "P", sell_price: 25.0, production_capacity: 900, demand_mean: 300, demand_cv: 0.2 }],
          inbound: [{ supplier_id: "S", material_id: "M", unit_price: 4.0, lead_time: 2, time_unit: "week" }],
          bom: [{ product_id: "P", material_id: "M", consumption_rate: 1.0 }],
          outbound: [{ product_id: "P", customer_id: "C", unit_price: 25.0, volume: 300, time_unit: "week" }],
        },
      },
      onPhase,
    );
    const agg = result.runUpdate.aggregate_kpis as Record<string, number> | undefined;
    return {
      ok: true,
      fillRate: agg?.fill_rate ?? NaN,
      reps: result.replications.length,
      engineVersion: result.engineVersion,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? String(e) };
  }
}

// ── DB helpers (best-effort persistence; the run displays regardless) ───────

/**
 * Persist an engine result to Supabase so the run joins project history and
 * the Lab. Needs the anon-write grants (migrations 20260706000001 /
 * 20260707000002); returns false (harmlessly) if they aren't applied yet —
 * the caller already rendered the result from memory. `false` is surfaced to
 * the user, not swallowed.
 */
export async function persistEngineResult(
  runId: string,
  projectId: string,
  result: EngineResult,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  try {
    if (result.replications.length > 0) {
      const rows = result.replications.map((r) => ({ ...r, run_id: runId, project_id: projectId }));
      const { error: repErr } = await sb
        .from("run_replications")
        .upsert(rows, { onConflict: "run_id,rep_index" });
      if (repErr) throw repErr;
    }
    const { error: runErr } = await sb
      .from("simulation_runs")
      .update({ ...result.runUpdate, ended_at: new Date().toISOString() })
      .eq("id", runId);
    if (runErr) throw runErr;
    return true;
  } catch (err) {
    console.warn("[pyodideEngine] result rendered but not persisted:", err);
    return false;
  }
}

/** Fetch the saved policy snapshot (reproducible source). Falls back to a
 *  client-built snapshot when the version row can't be read. */
export async function fetchPolicySnapshot(versionId: string): Promise<Record<string, unknown> | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  try {
    const { data, error } = await sb
      .from("policy_versions")
      .select("snapshot")
      .eq("id", versionId)
      .maybeSingle();
    if (error || !data?.snapshot) return null;
    return data.snapshot as Record<string, unknown>;
  } catch {
    return null;
  }
}
