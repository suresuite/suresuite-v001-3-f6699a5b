/**
 * PLAN.md §23 WP 13.2 · §4 D280 — the worker computes from the FROZEN versions.
 *
 * The worker half is proved in `sim-worker/tests/test_frozen_inputs.py`, which
 * drives the real `experiment.run` handler: it reads the envelope's
 * `dataset_version_id` and treats a MISSING key as an envelope from before the
 * binding (the legacy live path). So the dispatcher's half is the contract that
 * makes the worker's rule mean anything: every worker envelope carries the key,
 * and a server run with no dataset version is refused before it is queued rather
 * than run from the live tables. Read off the source, because the function needs
 * a database, a Redis and a queue to run.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const DISPATCH = readFileSync(join(ROOT, "supabase", "functions", "_shared", "dispatch.ts"), "utf8");
const WORKER = readFileSync(join(ROOT, "sim-worker", "sim_worker", "worker.py"), "utf8");
const LAB = readFileSync(join(ROOT, "src", "components", "policies", "RunValidateStage.tsx"), "utf8");

describe("§23 WP 13.2 — a server run is computed from its frozen versions", () => {
  it("every worker envelope carries the dataset version key", () => {
    const env = DISPATCH.slice(DISPATCH.indexOf("const workerEnvelope"), DISPATCH.indexOf("const stream = `sim.cmd."));
    expect(env, "the worker envelope no longer names the run's dataset version").toMatch(
      /dataset_version_id:\s*datasetVersionId/,
    );
  });

  it("a server run that could not be frozen is refused before it is queued", () => {
    const refuse = DISPATCH.indexOf("compute !== \"client\" && !datasetVersionId");
    const create = DISPATCH.indexOf("create_simulation_run\", {");
    expect(refuse, "the refusal of an unfrozen server run is gone").toBeGreaterThan(0);
    expect(refuse, "the refusal must come before the run row is created").toBeLessThan(create);
  });

  it("the worker computes through the one pipeline and reads no live table on the frozen path", () => {
    expect(WORKER).toMatch(/from \.local import run_from_snapshots/);
    const frozen = WORKER.slice(WORKER.indexOf('if binding == "frozen":'), WORKER.indexOf("else:\n                                data = await load_project_data("));
    expect(frozen).toMatch(/run_from_snapshots/);
    expect(frozen).not.toMatch(/load_project_data|get_effective_policies/);
  });

  it("a browser run computes from the same frozen version, and says so when it has none", () => {
    expect(LAB).toMatch(/frozen = await fetchRunDatasetSnapshot\(runId\)/);
    expect(LAB).toMatch(/dataset: frozen\?\.snapshot \?\? engineDataset\(\)/);
    expect(LAB).toMatch(/the run has no frozen dataset version/);
  });
});
