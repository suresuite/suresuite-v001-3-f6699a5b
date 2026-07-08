// The scsim engine, hosted in a Web Worker so it runs OFF the main UI thread.
//
// Why a worker: Pyodide/WASM executes synchronously, and a multi-replication
// 365-day run is heavy. On the main thread that blocks everything — the tab
// freezes, the spinner can't animate, buttons don't respond ("almost stopped,
// no response"). In a worker the computation runs on its own thread; the page
// stays fully interactive, per-replication progress streams back live, and the
// run can be genuinely cancelled (the ONLY way to interrupt a blocking WASM
// call is to terminate the worker).
//
// Protocol — main → worker:
//   { type: "warm", manifestUrl }              preload runtime + engine
//   { type: "run",  manifestUrl, payload }     run one simulation (payload = JSON string)
// Protocol — worker → main:
//   { type: "phase", phase }                   LoadPhase during boot
//   { type: "warmed" }                         warm complete
//   { type: "replication", rep, done, total }  one replication finished (live)
//   { type: "result", result }                 { engine_version, run_update, replications }
//   { type: "error", error }                   any failure (string)

/// <reference lib="webworker" />

interface EngineManifest {
  engine_version: string;
  pyodide_version: string;
  wheels: string[];
  pyodide_packages: string[];
  micropip_packages: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const self: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = (m: any) => self.postMessage(m);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyodide: any = null;
let ready: Promise<void> | null = null;

// The in-worker equivalent of the old api/run_simulation.py — the SAME worker
// pipeline (snapshot_to_policies → build_project_data → compute_run_from_project),
// now driving the engine's on_replication hook so each finished replication is
// reported back the instant it completes.
const PY_DRIVER = `
import json
from sim_worker.policy_snapshot import snapshot_to_policies
from sim_worker.datamap import build_project_data
from sim_worker.scsim_bridge import compute_run_from_project

def _run(payload_json, on_rep=None):
    b = json.loads(payload_json)
    ds = b.get("dataset") or {}
    policies = snapshot_to_policies(b.get("snapshot") or {})
    data = build_project_data(
        suppliers=ds.get("suppliers") or [], materials=ds.get("materials") or [],
        products=ds.get("products") or [], inbound=ds.get("inbound") or [],
        bom=ds.get("bom") or [], outbound=ds.get("outbound") or [],
        policies=policies, scenario=b.get("scenario") or {},
        project_model=b.get("project_model"))

    def _cb(rep_row, done, total):
        if on_rep is not None:
            on_rep(json.dumps(rep_row), int(done), int(total))

    kpis = compute_run_from_project(data, on_replication=_cb)

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

async function ensure(manifestUrl: string): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const manifest: EngineManifest = await (await fetch(manifestUrl, { cache: "no-cache" })).json();
    post({ type: "phase", phase: "loading-runtime" });
    const base = `https://cdn.jsdelivr.net/pyodide/v${manifest.pyodide_version}/full/`;
    // ESM build of Pyodide — a module worker has no DOM to attach a <script> to.
    const mod = await import(/* @vite-ignore */ `${base}pyodide.mjs`);
    pyodide = await mod.loadPyodide({ indexURL: base });

    post({ type: "phase", phase: "loading-packages" });
    await pyodide.loadPackage(manifest.pyodide_packages);
    const micropip = pyodide.pyimport("micropip");
    for (const pkg of manifest.micropip_packages || []) await micropip.install(pkg);

    post({ type: "phase", phase: "loading-engine" });
    for (const whl of manifest.wheels) {
      await micropip.install(new URL(`/engine/${whl}`, self.location.origin).href, { deps: false });
    }
    await pyodide.runPythonAsync(PY_DRIVER);
    post({ type: "phase", phase: "ready" });
  })();
  try {
    return await ready;
  } catch (e) {
    ready = null; // allow retry after a transient failure
    throw e;
  }
}

self.onmessage = async (e: MessageEvent) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = (e as any).data;
  try {
    if (msg.type === "warm") {
      await ensure(msg.manifestUrl);
      post({ type: "warmed" });
      return;
    }
    if (msg.type === "run") {
      await ensure(msg.manifestUrl);
      const runFn = pyodide.globals.get("_run");
      // JS callback the engine invokes after each replication. postMessage from
      // inside the (blocking) Python call is delivered to the free main thread,
      // so replications appear live even while this worker thread is busy.
      const onRep = (repJson: string, done: number, total: number) =>
        post({ type: "replication", rep: JSON.parse(repJson), done, total });
      let out: string;
      try {
        out = runFn(msg.payload, onRep) as string;
      } finally {
        runFn?.destroy?.();
      }
      post({ type: "result", result: JSON.parse(out) });
      return;
    }
  } catch (err) {
    post({ type: "error", error: (err as Error)?.message ?? String(err) });
  }
};
