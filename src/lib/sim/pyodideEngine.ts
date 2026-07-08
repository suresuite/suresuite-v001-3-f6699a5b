// The simulation engine, running IN THE BROWSER via Pyodide.
//
// Why: the Fly worker never deployed (no Fly token) and a Vercel Python
// function blows Vercel's 250 MB Lambda limit (scipy). Pyodide runs the REAL
// scsim Python engine client-side — no server, no new infra, no deploy
// coupling. It loads Pyodide + numpy/scipy/pydantic from the CDN once per
// session, micropip-installs the two committed pure-Python wheels
// (public/engine/*.whl), then runs the SAME pipeline the worker would:
// snapshot_to_policies → build_project_data → compute_run_from_project.
//
// Verified feasible: scsim has no browser-incompatible code; Pyodide 0.26.4
// ships every dependency (incl. pydantic's Rust core pydantic_core wasm).

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

interface EngineManifest {
  engine_version: string;
  pyodide_version: string;
  wheels: string[];
  pyodide_packages: string[];
  micropip_packages: string[];
}

/** Coarse phases for the loud UI status. */
export type LoadPhase = "loading-runtime" | "loading-packages" | "loading-engine" | "ready";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pyodide = any;

let pyodidePromise: Promise<Pyodide> | null = null;
let manifestPromise: Promise<EngineManifest> | null = null;

async function getManifest(): Promise<EngineManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch("/engine/manifest.json", { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`engine manifest missing (HTTP ${r.status}) — deploy did not include public/engine/`);
      return r.json();
    });
  }
  return manifestPromise;
}

/** Load the Pyodide script tag once (it exposes window.loadPyodide). */
function loadPyodideScript(version: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).loadPyodide) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const src = `https://cdn.jsdelivr.net/pyodide/v${version}/full/pyodide.js`;
    const existing = document.querySelector(`script[data-pyodide]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("failed to load Pyodide runtime from CDN")));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.pyodide = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load Pyodide runtime from CDN (network/CSP blocked?)"));
    document.head.appendChild(s);
  });
}

/**
 * Boot Pyodide + numpy/scipy/pydantic + the scsim/sim_worker wheels. Cached
 * across calls (loads once per page). `onPhase` drives the loud "loading…"
 * status so a ~20 MB first-load never looks like a hang.
 */
export async function ensureEngine(onPhase?: (p: LoadPhase) => void): Promise<Pyodide> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    const manifest = await getManifest();
    onPhase?.("loading-runtime");
    await loadPyodideScript(manifest.pyodide_version);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pyodide = await (window as any).loadPyodide({
      indexURL: `https://cdn.jsdelivr.net/pyodide/v${manifest.pyodide_version}/full/`,
    });
    onPhase?.("loading-packages");
    await pyodide.loadPackage(manifest.pyodide_packages);
    const micropip = pyodide.pyimport("micropip");
    for (const pkg of manifest.micropip_packages) await micropip.install(pkg);
    onPhase?.("loading-engine");
    // deps already satisfied by the pyodide packages above → keep_going/no refetch.
    for (const whl of manifest.wheels) {
      await micropip.install(new URL(`/engine/${whl}`, window.location.origin).href, {
        deps: false,
      });
    }
    onPhase?.("ready");
    return pyodide;
  })();
  try {
    return await pyodidePromise;
  } catch (e) {
    pyodidePromise = null; // allow retry after a transient failure
    throw e;
  }
}

// The in-browser equivalent of api/run_simulation.py::run_simulation — the SAME
// worker pipeline, returning persisted-row-shaped output.
const PY_DRIVER = `
import json
from sim_worker.policy_snapshot import snapshot_to_policies
from sim_worker.datamap import build_project_data
from sim_worker.scsim_bridge import compute_run_from_project

def _run(payload_json):
    b = json.loads(payload_json)
    ds = b.get("dataset") or {}
    policies = snapshot_to_policies(b.get("snapshot") or {})
    data = build_project_data(
        suppliers=ds.get("suppliers") or [], materials=ds.get("materials") or [],
        products=ds.get("products") or [], inbound=ds.get("inbound") or [],
        bom=ds.get("bom") or [], outbound=ds.get("outbound") or [],
        policies=policies, scenario=b.get("scenario") or {},
        project_model=b.get("project_model"))
    kpis = compute_run_from_project(data)

    agg = {k[len("mean_"):]: v for k, v in kpis.items() if k.startswith("mean_")}
    agg["_meta"] = {"engine": kpis.get("source", "pyodide")}
    if kpis.get("scsim_notes"):
        agg["_meta"]["scsim_notes"] = kpis["scsim_notes"]
    n_reps = int(kpis.get("n_reps", (b.get("scenario") or {}).get("replications", 1)) or 1)
    run_update = {
        "status": "done",
        "aggregate_kpis": agg,
        "ci_half_widths": {k[len("ci_"):]: v for k, v in kpis.items() if k.startswith("ci_")},
        "code_version": ("scsim-" + str(kpis.get("engine_version", "unknown"))) if kpis.get("source") == "scsim" else "worker-legacy",
        "rep_count_done": n_reps,
    }
    if kpis.get("mapping_warnings") is not None:
        run_update["mapping_warnings"] = kpis["mapping_warnings"]
    if kpis.get("warmup_detected_at") is not None:
        run_update["warmup_detected_at"] = kpis["warmup_detected_at"]

    run_id, project_id = b.get("run_id"), b.get("project_id")
    reps = [{
        "run_id": run_id, "project_id": project_id,
        "rep_index": r["rep_index"], "seed_used": r["seed_used"], "status": "done",
        "kpis": r.get("kpis", {}), "time_series": r.get("time_series", {}),
        "warmup_at": r.get("warmup_at"),
    } for r in (kpis.get("replications") or [])]

    return json.dumps({
        "engine_version": kpis.get("engine_version"),
        "run_update": run_update, "replications": reps,
    })
`;

/** Run one simulation in the browser and return the persisted-row-shaped result. */
export async function runInBrowser(
  args: RunArgs,
  onPhase?: (p: LoadPhase) => void,
): Promise<EngineResult> {
  const pyodide = await ensureEngine(onPhase);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globals = (pyodide as any).globals;
  if (!globals.get("_run")) {
    await pyodide.runPythonAsync(PY_DRIVER);
  }
  const runFn = globals.get("_run");
  const payload = JSON.stringify({
    run_id: args.runId,
    project_id: args.projectId,
    snapshot: args.snapshot,
    scenario: { ...args.scenario, crn: args.scenario.crn ?? true },
    project_model: args.projectModel,
    dataset: args.dataset,
  });
  let out: string;
  try {
    out = runFn(payload) as string;
  } finally {
    runFn?.destroy?.();
  }
  const parsed = JSON.parse(out) as {
    engine_version?: string;
    run_update: Record<string, unknown>;
    replications: Record<string, unknown>[];
  };
  return {
    engineVersion: parsed.engine_version ?? "scsim",
    runUpdate: parsed.run_update,
    replications: parsed.replications,
  };
}

export interface SelfTestResult {
  ok: boolean;
  fillRate?: number;
  reps?: number;
  engineVersion?: string;
  error?: string;
}

/** One-click self-test: run a fixed built-in scenario (no user data, no DB).
 *  Returns a single flat shape (not a discriminated union) so callers narrow
 *  on `ok` without depending on strictNullChecks. */
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
