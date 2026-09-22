import { describe, expect, it } from "vitest";
import { replicationLabel } from "@/lib/sim/replicationLabel";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Audit F-23. `seed_used` is `project_seed * 1000 + model_rep` — a display
// label, not a seed: the engine's entropy is SeedSequence(project_seed,
// spawn_key=(realm, model_rep, stream)). The dropdown read "seed 42003", and
// entering 42003 as a project seed reproduces nothing. It also COLLIDES across
// event replications (same model_rep → same seed_used).
describe("a replication is labelled by what identifies it", () => {
  it("names the replication and its CRN cell, and never calls seed_used a seed", () => {
    const l = replicationLabel({ rep_index: 3, seed_used: 42003, kpis: { model_rep: 3, event_rep: 0 } });
    expect(l).toBe("rep 3 · world 3");
    expect(l).not.toMatch(/seed/);
  });
  it("shows the event draw when there is more than one", () => {
    expect(replicationLabel({ rep_index: 7, seed_used: 42001, kpis: { model_rep: 1, event_rep: 2 } }))
      .toBe("rep 7 · world 1 · event draw 2");
  });
  it("falls back to the rep index alone", () => {
    expect(replicationLabel({ rep_index: 5, seed_used: 0, kpis: {} })).toBe("rep 5");
  });
});

describe("no surface prints seed_used as a seed", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  for (const f of ["components/sim/ReplicationSeedExplorer.tsx", "components/sim/MobileSimulationLab.tsx",
                   "components/sim/RunProgressPanel.tsx"]) {
    it(f, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).not.toMatch(/seed \$?\{?[a-zA-Z.]*seed_used/);
    });
  }
  it("the selector keys and values by rep_index, which is unique per run", () => {
    const src = readFileSync(join(ROOT, "components/sim/ReplicationSeedExplorer.tsx"), "utf8");
    expect(src).not.toMatch(/key=\{r\.seed_used\}/);
    expect(src).not.toMatch(/value=\{String\(r\.seed_used\)\}/);
  });
});
