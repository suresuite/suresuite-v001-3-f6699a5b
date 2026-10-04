import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  capacityVerdict,
  type CapacityState,
  compareScope,
  defaultModel,
  formatBytes,
  modelChoices,
  modelOptionLabel,
  overridesOf,
  protocolDeviations,
  replicationWeeks,
  SERIES_PER_REPLICATION,
  storageEstimate,
} from "../labModel";
import { REPLICATION_SERIES_FACTS } from "@/components/docs/generated/policy.generated";
import type { ModelValidationCard } from "@/hooks/useModelValidation";

// WP 10.5 — the Lab's Model → Engine → Scenario → Settings → Run flow, as rules.

const protocol = {
  replications: 30, root_seed: 42, crn: true, warmup_week: 12, horizon_weeks: 52,
  analysis_window_weeks: 40, ci_level: 0.95, ci_halfwidth_target: 0.05, stopping_rule: "fixed_horizon" as const,
};
const card = (over: Partial<ModelValidationCard>): ModelValidationCard => ({
  id: "m", project_id: "p", policy_version_id: "pv", policy_hash: "h", dataset_version_id: "dv",
  graph_hash: "g", scenario_hash: "s", scenario_fingerprint: {}, engine_fingerprint: null,
  adopted_warmup_days: 84, warmup_method: "mser5", recommended_replications: 30, replication_basis: {},
  validation_tests: [], findings_snapshot: [], verdict: "validated", basis: "face", evidence_run_id: null,
  status: "active", validated_at: "2026-09-01T00:00:00Z", author_email: null, created_at: "2026-09-01T00:00:00Z",
  name: "Baseline", version_no: 1, protocol,
  ...over,
});

describe("the model choice", () => {
  const older = card({ id: "a", validated_at: "2026-09-01T00:00:00Z", version_no: 1 });
  const newer = card({ id: "b", validated_at: "2026-09-20T00:00:00Z", version_no: 2 });
  const gone = card({ id: "c", status: "superseded", validated_at: "2026-09-30T00:00:00Z" });
  const refused = card({ id: "d", verdict: "rejected", validated_at: "2026-09-29T00:00:00Z" });

  it("offers active validated models, newest first — never history", () => {
    expect(modelChoices([older, gone, newer, refused]).map((c) => c.id)).toEqual(["b", "a"]);
  });
  it("defaults to the newest; a link wins, even to a superseded model", () => {
    expect(defaultModel([older, newer, gone], null)?.id).toBe("b");
    expect(defaultModel([older, newer, gone], "c")?.id).toBe("c");
    expect(defaultModel([older, newer], "nope")?.id).toBe("b");
    expect(defaultModel([gone], null)).toBeNull();
  });
  it("labels a model by its code, its data and policy codes, and its name (WP 10.5 follow-up)", () => {
    expect(modelOptionLabel({ ...newer, model_code: "2026Q3" }, { data: "Data 20260915", policy: "Policy 20261004" })).toBe(
      "2026Q3 - Data 20260915 - Policy 20261004 · Baseline",
    );
    // A model saved before periods existed says so — no code is invented for it.
    expect(modelOptionLabel(newer)).toBe("v2 · no period · Baseline");
  });
});

describe("deviations from the protocol are read off the scenario the run would use", () => {
  const faithful = { replications: 30, horizon_days: 364, seed: 42, crn: true, warmup_mode: "manual", warmup_days: 84,
    stopping_rule: { kind: "fixed_horizon" } };

  it("a scenario seeded from the model and inherited is faithful: {}", () => {
    expect(protocolDeviations(protocol, faithful)).toEqual([]);
    expect(overridesOf(protocolDeviations(protocol, faithful))).toEqual({});
  });
  it("each changed key is one deviation, stored as the value the run used", () => {
    const devs = protocolDeviations(protocol, { ...faithful, replications: 10, seed: 7 });
    expect(devs.map((d) => d.key)).toEqual(["replications", "root_seed"]);
    expect(overridesOf(devs)).toEqual({ replications: 10, root_seed: 7 });
  });
  it("an automatic warm-up is said, not passed off as the model's week", () => {
    const devs = protocolDeviations(protocol, { ...faithful, warmup_mode: "auto" });
    expect(devs).toEqual([{ key: "warmup_week", label: "Steady state from (week)", model: 12, run: "detected per run" }]);
  });
  it("a key the model never recorded is not a deviation", () => {
    expect(protocolDeviations({ ...protocol, crn: null as unknown as boolean }, { ...faithful, crn: false })).toEqual([]);
    expect(protocolDeviations(null, faithful)).toEqual([]);
  });
});

describe("the run's size", () => {
  it("replication-weeks are replications × horizon weeks", () => {
    expect(replicationWeeks(30, 364)).toBe(1560);
    expect(replicationWeeks(10, 365)).toBe(530);
  });
  it("storage counts the published weekly series from the engine's own declaration", () => {
    expect(SERIES_PER_REPLICATION).toBe(REPLICATION_SERIES_FACTS.declared.filter((s) => s.published).length);
    expect(SERIES_PER_REPLICATION).toBeGreaterThan(0);
    const e = storageEstimate(30, 364);
    expect(e.bytes).toBe(30 * (2048 + SERIES_PER_REPLICATION * 52 * 10));
    expect(e.basis).toContain(`${SERIES_PER_REPLICATION} weekly series × 52 weeks`);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("a comparison defaults to the same model; an exploratory run is never the baseline", () => {
  const cands = [
    { scenarioId: "s1", modelId: "m1", exploratory: false },
    { scenarioId: "s2", modelId: "m1", exploratory: false },
    { scenarioId: "s3", modelId: "m2", exploratory: false },
    { scenarioId: "s4", modelId: null, exploratory: true },
  ];
  it("by default only the model's own runs", () => {
    expect(compareScope(cands, "m1", false).offered.map((c) => c.scenarioId)).toEqual(["s1", "s2"]);
  });
  it("across models is allowed, and labelled", () => {
    const s = compareScope(cands, "m1", true);
    expect(s.offered).toHaveLength(4);
    expect(s.baselineEligible.map((c) => c.scenarioId)).toEqual(["s1", "s2", "s3"]);
    expect(s.labelOf(cands[2])).toBe("different model");
    expect(s.labelOf(cands[3])).toBe("exploratory");
    expect(s.labelOf(cands[0])).toBeNull();
  });
});

// WP 10.7 · §4 D247 — the Run card's estimate against what the plan leaves. The
// figures mirror `rehearsal/615`, so the card and the database agree on them.
describe("capacityVerdict (WP 10.7)", () => {
  const state = (over: Partial<CapacityState["pool"]> = {}, share: Partial<NonNullable<CapacityState["share"]>> | null = {}): CapacityState => ({
    org_id: "o",
    role: "analyst",
    pool: {
      compute_quota_rep_weeks_month: 100,
      compute_used_rep_weeks: 69,
      storage_quota_bytes: null,
      storage_used_bytes: 0,
      max_concurrent_runs: 10,
      active_runs: 0,
      max_replications_per_run: 50,
      ...over,
    },
    share: share === null ? null : {
      compute_share_pct: 25,
      storage_share_pct: 25,
      max_concurrent: 1,
      compute_used_rep_weeks: 6,
      storage_used_bytes: 0,
      active_runs: 0,
      ...share,
    },
  });

  it("an under-share run fits, and the line names the share that binds", () => {
    const v = capacityVerdict(state(), { replications: 6, repWeeks: 18, bytes: 0 });
    expect(v.refusal).toBeNull();
    expect(v.line).toBe("19 of 25 replication-weeks left this month (your analyst share)");
  });

  it("an over-share run is forecast refused with the database's numbers", () => {
    const v = capacityVerdict(state(), { replications: 7, repWeeks: 21, bytes: 0 });
    expect(v.refusal).toBe("this run needs 21 replication-weeks; 19 are left");
  });

  it("the pool binds when it is tighter than the share", () => {
    const v = capacityVerdict(state({}, { compute_share_pct: 100, compute_used_rep_weeks: 0 }), { replications: 12, repWeeks: 36, bytes: 0 });
    expect(v.line).toBe("31 of 100 replication-weeks left this month");
    expect(v.refusal).toBe("this run needs 36 replication-weeks; 31 are left");
  });

  it("checks in the database's order: replications, in flight, compute, storage", () => {
    expect(capacityVerdict(state(), { replications: 51, repWeeks: 999, bytes: 0 }).refusal).toMatch(/limit is 50 per run/);
    expect(capacityVerdict(state({}, { active_runs: 1 }), { replications: 1, repWeeks: 999, bytes: 0 }).refusal)
      .toBe("you have 1 runs queued or running; your analyst role allows 1");
    const st = state({ compute_quota_rep_weeks_month: null, storage_quota_bytes: 1000, storage_used_bytes: 600 }, { storage_used_bytes: 0 });
    expect(capacityVerdict(st, { replications: 1, repWeeks: 3, bytes: 300 }).refusal).toMatch(/expected to keep 300 B; 250 B is left/);
  });

  it("the role's in-flight allowance binds only where the plan caps concurrency", () => {
    const v = capacityVerdict(state({ max_concurrent_runs: null }, { active_runs: 3 }), { replications: 1, repWeeks: 3, bytes: 0 });
    expect(v.refusal).toBeNull();
  });

  it("no plan reads as no limit; an unreadable plan says so rather than inventing a figure", () => {
    const free = state({ compute_quota_rep_weeks_month: null, max_concurrent_runs: null, max_replications_per_run: null }, null);
    expect(capacityVerdict(free, { replications: 200, repWeeks: 10400, bytes: 1e9 })).toEqual({
      line: "no compute or storage limit on this plan",
      refusal: null,
    });
    expect(capacityVerdict(null, { replications: 1, repWeeks: 1, bytes: 1 }).line).toMatch(/could not be read/);
  });
});
