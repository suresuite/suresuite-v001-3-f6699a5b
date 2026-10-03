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
//   { type: "inputs", manifestUrl, payload }   map only: the engine's input, no simulation
// Protocol — worker → main:
//   { type: "phase", phase }                   LoadPhase during boot
//   { type: "warmed" }                         warm complete
//   { type: "replication", rep, done, total }  one replication finished (live)
//   { type: "result", result }                 { engine_version, run_update, replications }
//   { type: "inputs", result }                 sim_worker.local.engine_input_from_snapshots
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

// The in-worker driver. Since Phase 12 · WP 12.1 it holds NO pipeline of its
// own: `sim_worker.local.run_from_snapshots` is the one entry point the browser,
// the `suresuite` Python package and the notebooks' demo recorder share, and it
// is the worker's own pipeline (snapshot_to_policies → build_project_data →
// compute_run_from_project → run_shape.build_run_update). This string used to
// be a hand copy of it, and its result shaping had drifted: it dropped `_range`
// and `capacity_binding` (§4 D273). It now only adapts the message protocol.
const PY_DRIVER = `
import json
from sim_worker.local import engine_input_from_snapshots, run_from_snapshots

def _run(payload_json, on_rep=None):
    b = json.loads(payload_json)

    def _cb(rep_row, done, total):
        if on_rep is not None:
            on_rep(json.dumps(rep_row), int(done), int(total))

    out = run_from_snapshots(
        b.get("dataset") or {}, b.get("snapshot") or {}, b.get("scenario") or {},
        project_model=b.get("project_model"), on_replication=_cb)

    run_id, project_id = b.get("run_id"), b.get("project_id")
    reps = [{
        "run_id": run_id, "project_id": project_id,
        "rep_index": r["rep_index"], "seed_used": r["seed_used"], "status": "done",
        "kpis": r.get("kpis", {}), "time_series": r.get("time_series", {}),
        "warmup_at": r.get("warmup_at"),
    } for r in out["replications"]]

    return json.dumps({
        "engine_version": out["engine_version"],
        "run_update": out["run_update"], "replications": reps,
        "item_series": out["item_series"],
    })

def _inputs(payload_json):
    # PLAN.md §4 D289 — the policy version's Export: what a run of these frozen
    # inputs hands the engine, from the same two calls, stopped before simulating.
    b = json.loads(payload_json)
    return json.dumps(engine_input_from_snapshots(
        b.get("dataset") or {}, b.get("snapshot") or {}, b.get("scenario") or {},
        project_model=b.get("project_model")))
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
    if (msg.type === "inputs") {
      await ensure(msg.manifestUrl);
      const fn = pyodide.globals.get("_inputs");
      let out: string;
      try {
        out = fn(msg.payload) as string;
      } finally {
        fn?.destroy?.();
      }
      post({ type: "inputs", result: JSON.parse(out) });
      return;
    }
  } catch (err) {
    post({ type: "error", error: (err as Error)?.message ?? String(err) });
  }
};
