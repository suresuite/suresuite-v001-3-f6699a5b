import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
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
  it("labels a model by name, number and protocol line", () => {
    expect(modelOptionLabel(newer)).toBe("Baseline v2 · 30 seeds · steady from wk 12 · 52 wks");
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
