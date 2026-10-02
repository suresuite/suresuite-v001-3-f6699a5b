/**
 * The Python notebooks (`notebooks/src`, built into `public/notebooks`) restate two
 * things the platform owns, because a notebook a customer uploads to Colab cannot
 * import them. This test is what stops the restatements drifting:
 *
 *  1. The paired comparison. The notebooks' `paired_compare` and the Simulation
 *     Lab's `pairedDifference` must compute the same statistic, so both are run on
 *     one golden vector (`notebooks/tests/paired_compare_golden.json`; the Python
 *     side is `notebooks/tests/test_client.py`).
 *  2. The API shapes the offline demo answers with. The demo transport must
 *     return the run row the gateway selects, and accept exactly the scenario and
 *     run bodies the gateway's strict schemas accept — otherwise a cell that works
 *     in demo mode fails against the real API, which is the one thing demo mode
 *     must never do.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pairedDifference } from "@/lib/sim/pairedCompare";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("paired comparison — notebooks and Simulation Lab agree", () => {
  const golden = JSON.parse(read("notebooks/tests/paired_compare_golden.json"));
  type Expected = { mean: number; halfWidth: number; n: number; separated: boolean };
  for (const [kpi, exp] of Object.entries(golden.expected as Record<string, Expected>)) {
    it(kpi, () => {
      const p = pairedDifference(golden.a, golden.b, kpi);
      expect(p).not.toBeNull();
      expect(p!.n).toBe(exp.n);
      expect(p!.mean).toBeCloseTo(exp.mean, 9);
      expect(p!.halfWidth).toBeCloseTo(exp.halfWidth, 9);
      expect(p!.separated).toBe(exp.separated);
    });
  }
});

describe("offline demo answers in the gateway's shapes", () => {
  const gateway = read("supabase/functions/api/index.ts");
  const client = read("python/suresuite/client.py");

  const pyTuple = (name: string) => {
    const m = new RegExp(`^${name} = \\(([\\s\\S]*?)\\)`, "m").exec(client);
    expect(m, `${name} in client.py`).not.toBeNull();
    return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
  };
  const pyDictKeys = (name: string) => {
    const m = new RegExp(`^${name} = \\{([\\s\\S]*?)\\}\\n`, "m").exec(client);
    expect(m, `${name} in client.py`).not.toBeNull();
    return [...m![1].matchAll(/"([a-z_]+)":/g)].map((x) => x[1]).sort();
  };
  const zodKeys = (schema: string) => {
    const start = gateway.indexOf(`const ${schema} = z.object({`);
    expect(start, `${schema} in the gateway`).toBeGreaterThan(-1);
    const body = gateway.slice(start, gateway.indexOf("}).strict();", start));
    return [...body.matchAll(/^\s+([a-z_]+):/gm)].map((x) => x[1]).sort();
  };

  it("a run row has exactly the columns GET /runs/{id} selects", () => {
    const start = gateway.indexOf("async function loadAuthorizedRun");
    const select = /\.select\(\s*([\s\S]*?)\)/.exec(gateway.slice(start))![1];
    const cols = select.replace(/["+\s]/g, "").split(",").filter(Boolean).sort();
    expect(pyTuple("RUN_FIELDS")).toEqual(cols);
  });

  it("a scenario body accepts exactly the fields POST …/scenarios accepts", () => {
    expect(pyDictKeys("SCENARIO_FIELDS")).toEqual(zodKeys("ScenarioCreateSchema"));
  });

  it("a run body accepts exactly the fields POST …/runs accepts", () => {
    expect(pyTuple("RUN_BODY_FIELDS")).toEqual(zodKeys("RunCreateSchema"));
  });

  it("a finished run is `done`, as the worker writes it", () => {
    expect(read("sim-worker/sim_worker/worker.py")).toMatch(/"status": "done"/);
    expect(client).toMatch(/^TERMINAL = \("done", "failed", "cancelled"\)/m);
  });
});
