import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The hook module imports the Supabase client; the pure function under test does not use it.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { currentPolicyVersion, policyVersionTag } from "@/lib/policies/currentPolicyVersion";
import { deriveCredibility, type ModelValidationCard } from "@/hooks/useModelValidation";

// WP 10.2 · PLAN.md §4 D241, D242 — a policy version IS its content, and a model
// card is found by content. These tests are the exit criterion "validate → open
// the Lab fresh → badge validated", stated over the two functions the Lab reads.

const H = "a".repeat(64);
const G = "g".repeat(64);
const S = "s".repeat(64);

const versionA = { id: "aaaaaaaa-0000-4000-8000-000000000001", policy_hash: H, created_at: "2026-10-01T09:00:00Z", version_no: 3 };
// "Save version & run" before WP 10.2 minted a second row for the same content.
const versionB = { id: "bbbbbbbb-0000-4000-8000-000000000002", policy_hash: H, created_at: "2026-10-01T10:00:00Z", version_no: 3 };
const other = { id: "cccccccc-0000-4000-8000-000000000003", policy_hash: "z".repeat(64), created_at: "2026-10-01T11:00:00Z", version_no: 4 };

const card = (over: Partial<ModelValidationCard> = {}): ModelValidationCard => ({
  id: "card-1",
  project_id: "p",
  policy_version_id: versionA.id,
  policy_hash: H,
  dataset_version_id: "ds",
  graph_hash: G,
  scenario_hash: S,
  scenario_fingerprint: {},
  engine_fingerprint: null,
  adopted_warmup_days: 84,
  warmup_method: "engine",
  recommended_replications: 30,
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

describe("the current policy version is derived from content (D242)", () => {
  it("a freshly opened page knows the version in force without having saved anything", () => {
    // Newest first, as list_policy_versions returns them.
    const v = currentPolicyVersion([other, versionB, versionA], H);
    expect(v?.id).toBe(versionA.id);
  });
  it("answers the OLDEST row of a content — the id snapshot_policy returns on every call", () => {
    expect(currentPolicyVersion([versionB, versionA], H)?.id).toBe(versionA.id);
  });
  it("live policies that match no saved version are unsaved edits, not a version", () => {
    expect(currentPolicyVersion([versionA, versionB], "e".repeat(64))).toBeNull();
    expect(currentPolicyVersion([versionA], null)).toBeNull();
  });
  it("names a version by its per-project content number", () => {
    expect(policyVersionTag(versionA)).toBe("Policy v3");
    expect(policyVersionTag({ ...versionA, version_no: null })).toBe(`Policy ${H.slice(0, 7)}`);
  });
});

describe("a model card is matched by content, not by version id (D242)", () => {
  it("validate → open the Lab fresh → validated, although the card was recorded on another id", () => {
    const cards = [card()];
    // The Lab's context is the live policy HASH; the version it resolves to is B's twin A,
    // and the card would be found from B as well — the id never decides.
    const cred = deriveCredibility(cards, { policyHash: H, graphHash: G, scenarioHash: S });
    expect(cred.state).toBe("validated");
    const fromB = deriveCredibility([card({ policy_version_id: versionB.id })], {
      policyHash: H, policyVersionId: versionA.id, graphHash: G, scenarioHash: S,
    });
    expect(fromB.state).toBe("validated");
  });
  it("editing the policies after validating reads STALE (policy), not unvalidated", () => {
    const cred = deriveCredibility([card()], { policyHash: "e".repeat(64), graphHash: G, scenarioHash: S });
    expect(cred.state).toBe("stale");
    expect(cred.state === "stale" && cred.drift).toEqual(["policy"]);
  });
  it("a data change reads stale (data); a different scenario world reads stale (scenario)", () => {
    const data = deriveCredibility([card()], { policyHash: H, graphHash: "x".repeat(64), scenarioHash: S });
    expect(data.state === "stale" && data.drift).toEqual(["data"]);
    const scen = deriveCredibility([card()], { policyHash: H, graphHash: G, scenarioHash: "y".repeat(64) });
    expect(scen.state === "stale" && scen.drift).toEqual(["scenario"]);
  });
  it("prefers the card that matches the current graph and scenario among one content's cards", () => {
    const old = card({ id: "old", graph_hash: "o".repeat(64), validated_at: "2026-10-01T11:00:00Z" });
    const exact = card({ id: "exact", validated_at: "2026-10-01T09:00:00Z" });
    const cred = deriveCredibility([old, exact], { policyHash: H, graphHash: G, scenarioHash: S });
    expect(cred.state === "validated" && cred.card.id).toBe("exact");
  });
  it("shows nothing while the live hash is still loading", () => {
    expect(deriveCredibility([card()], { policyHash: null, graphHash: G, scenarioHash: S }).state).toBe("unvalidated");
  });
  it("a superseded, revoked or rejected card never validates", () => {
    for (const over of [{ status: "superseded" as const }, { status: "revoked" as const }, { verdict: "rejected" as const }]) {
      expect(deriveCredibility([card(over)], { policyHash: H, graphHash: G, scenarioHash: S }).state).toBe("unvalidated");
    }
  });
});

describe("the dispatcher stamps a run with the card found by content", () => {
  const src = readFileSync(join(__dirname, "../../../../supabase/functions/_shared/dispatch.ts"), "utf8");
  it("asks active_model_validation_by_content with the version's policy_hash", () => {
    expect(src).toMatch(/rpc\("active_model_validation_by_content"/);
    expect(src).toMatch(/p_policy_hash: policyHash/);
  });
  it("falls back to the id-keyed RPC ONLY when the function is not deployed yet", () => {
    expect(src).toMatch(/if \(cardErr && isMissingFunction\(cardErr\)\)/);
  });
});

describe("no page remembers its own version in force", () => {
  it("usePolicies derives selectedVersionId from content and no longer exposes a setter", () => {
    const src = readFileSync(join(__dirname, "../../../hooks/usePolicies.tsx"), "utf8");
    expect(src).toMatch(/const currentVersion = currentPolicyVersion\(versions, currentHash\)/);
    expect(src).not.toMatch(/setSelectedVersionId/);
  });
});
