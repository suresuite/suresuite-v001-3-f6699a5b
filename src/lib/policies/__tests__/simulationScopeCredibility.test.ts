import { describe, expect, it, vi } from "vitest";

// The hook module imports the Supabase client; the pure functions under test do not use it.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { cardInputsMatch, deriveCredibility, type ModelValidationCard } from "@/hooks/useModelValidation";

// WP 11.2 · PLAN.md §4 D259 — a Validated Model binds the scope the engine READS.
// A deep-tier upload moves the composite and not the simulation's inputs, so the
// model stays validated and the change is SHOWN as a note; an edit to an input makes
// it stale. `rehearsal/670` holds the SQL half (stamping, inheritance, the RunKey).

const P = "p".repeat(64);
const G1 = "1".repeat(64);    // the composite the model was validated on
const G2 = "2".repeat(64);    // the composite after a deep-tier upload
const I1 = "i".repeat(64);    // the simulation inputs it was validated on
const I2 = "j".repeat(64);    // the inputs after a price edit
const S = "s".repeat(64);

const card = (over: Partial<ModelValidationCard> = {}): ModelValidationCard => ({
  id: "m1",
  project_id: "proj",
  policy_version_id: "pv",
  policy_hash: P,
  dataset_version_id: "ds1",
  graph_hash: G1,
  hash_simulation: I1,
  scenario_hash: S,
  scenario_fingerprint: {},
  engine_fingerprint: null,
  adopted_warmup_days: 28,
  warmup_method: "engine",
  recommended_replications: 10,
  replication_basis: {},
  validation_tests: [],
  findings_snapshot: [],
  verdict: "validated",
  basis: "statistical",
  evidence_run_id: null,
  status: "active",
  validated_at: "2026-10-01T09:30:00Z",
  author_email: null,
  created_at: "2026-10-01T09:30:00Z",
  ...over,
});

describe("a model is stale when the SIMULATION'S inputs changed, not the composite (D259)", () => {
  it("a deep-tier upload: still validated, with a network note — never re-validate", () => {
    const cred = deriveCredibility([card()], { policyHash: P, graphHash: G2, simulationHash: I1, scenarioHash: S });
    expect(cred.state).toBe("validated");
    expect(cred.state === "validated" && cred.notes).toEqual(["network"]);
  });

  it("an edit to an input the engine reads: stale with data drift", () => {
    const cred = deriveCredibility([card()], { policyHash: P, graphHash: G2, simulationHash: I2, scenarioHash: S });
    expect(cred.state).toBe("stale");
    expect(cred.state === "stale" && cred.drift).toEqual(["data"]);
  });

  it("nothing moved: validated, no note", () => {
    const cred = deriveCredibility([card()], { policyHash: P, graphHash: G1, simulationHash: I1, scenarioHash: S });
    expect(cred).toEqual({ state: "validated", card: expect.objectContaining({ id: "m1" }) });
  });

  it("the live simulation hash not loaded yet is not drift (no flash of stale)", () => {
    const cred = deriveCredibility([card()], { policyHash: P, graphHash: G2, simulationHash: null, scenarioHash: S });
    expect(cred.state).toBe("validated");
  });

  it("a card no snapshot could teach keeps the composite rule — and says nothing it cannot know", () => {
    const legacy = card({ hash_simulation: null });
    expect(deriveCredibility([legacy], { policyHash: P, graphHash: G1, simulationHash: I1, scenarioHash: S }).state)
      .toBe("validated");
    const moved = deriveCredibility([legacy], { policyHash: P, graphHash: G2, simulationHash: I1, scenarioHash: S });
    expect(moved.state).toBe("stale");
    expect("notes" in moved && moved.notes).toBeFalsy();
  });

  it("among cards of one policy, the one whose INPUTS match ranks first", () => {
    const old = card({ id: "old", hash_simulation: I2, graph_hash: G1, validated_at: "2026-10-01T11:00:00Z" });
    const right = card({ id: "right", hash_simulation: I1, graph_hash: G1, validated_at: "2026-10-01T09:00:00Z" });
    const cred = deriveCredibility([old, right], { policyHash: P, graphHash: G2, simulationHash: I1, scenarioHash: S });
    expect(cred.state === "validated" && cred.card.id).toBe("right");
  });

  it("cardInputsMatch is the one rule — inheritance and the badge ask it", () => {
    expect(cardInputsMatch(card(), { graphHash: G2, simulationHash: I1 })).toBe(true);
    expect(cardInputsMatch(card(), { graphHash: G1, simulationHash: I2 })).toBe(false);
    expect(cardInputsMatch(card({ hash_simulation: null }), { graphHash: G1, simulationHash: I2 })).toBe(true);
    expect(cardInputsMatch(card(), { graphHash: G1, simulationHash: undefined })).toBeNull();
  });
});
