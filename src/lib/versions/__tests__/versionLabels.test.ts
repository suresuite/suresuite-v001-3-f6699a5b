import { describe, expect, it } from "vitest";
import {
  dataRef,
  engineLabel,
  modelCodeLine,
  modelRef,
  planningPeriodOptions,
  policyRef,
  protocolText,
  quarterOf,
  stripLegacyDate,
  usageText,
} from "../versionLabels";

describe("the version vocabulary (WP 10.5 follow-up)", () => {
  it("says the code a person reads aloud: model period, data day, policy day", () => {
    const line = modelCodeLine(
      { name: "Q4 baseline", version_no: 1, model_code: "2026Q3" },
      { data: dataRef({ version_code: "20260915" }), policy: policyRef({ version_code: "20261004" }) },
    );
    expect(line).toBe("2026Q3 - Data 20260915 - Policy 20261004 · Q4 baseline");
  });

  it("does not repeat the database's default name", () => {
    expect(modelCodeLine({ name: "Validated model", model_code: "2026Q3-2" })).toBe("2026Q3-2");
  });

  it("says when a model has no period rather than inventing one (T1)", () => {
    expect(modelRef({ version_no: 1, model_code: null })).toBe("v1 · no period");
  });

  it("falls back to the per-table number before a row carries a code", () => {
    expect(policyRef({ version_no: 5 })).toBe("Policy v5");
    expect(dataRef({ version_no: 2, version_code: null })).toBe("Data v2");
    expect(policyRef({})).toBeNull();
    expect(dataRef(null)).toBeNull();
  });

  it("states the protocol in words, singular when it is one", () => {
    expect(protocolText({ replications: 1, warmup_week: 5, horizon_weeks: 53 })).toBe(
      "1 replication · 53 weeks · results from wk 5",
    );
    expect(protocolText({ replications: 30, warmup_week: null, horizon_weeks: 156 })).toBe(
      "30 replications · 156 weeks · ?",
    );
  });

  it("names the engine once, the build only when it says something", () => {
    const e = { slug: "scsim", name: "scsim — the strategic engine", version: "0.6.1", code_version: "scsim-0.6.1" };
    expect(engineLabel(e)).toEqual({ label: "scsim 0.6.1", title: "the strategic engine · build scsim-0.6.1" });
    expect(engineLabel({ ...e, code_version: "abc1234" }).label).toBe("scsim 0.6.1 build abc1234");
    expect(engineLabel({ ...e, code_version: null }).label).toBe("scsim 0.6.1 build ?");
  });

  it("drops the locale date old auto-labels carried, and nothing else", () => {
    expect(stripLegacyDate("Run: Test Capacity — 9/30/2026, 11:21:19 AM")).toBe("Run: Test Capacity");
    expect(stripLegacyDate("Validate single — 10/4/2026, 12:54:00 AM")).toBe("Validate single");
    expect(stripLegacyDate("Grid edits — 04.10.2026, 00:54:00")).toBe("Grid edits");
    expect(stripLegacyDate("New s, S with initial inventory")).toBe("New s, S with initial inventory");
    expect(stripLegacyDate("Plan — Q4 freeze")).toBe("Plan — Q4 freeze");
  });

  it("says what 'in use' meant", () => {
    expect(usageText(3, 1)).toBe("used by 3 runs · 1 model");
    expect(usageText(1, 0)).toBe("used by 1 run");
    expect(usageText(0, 0)).toBeNull();
    expect(usageText(undefined, undefined)).toBeNull();
  });

  it("offers quarters around today, newest first", () => {
    expect(quarterOf(new Date(2026, 9, 4))).toBe("2026Q4");
    expect(quarterOf(new Date(2026, 8, 30))).toBe("2026Q3");
    const opts = planningPeriodOptions(new Date(2026, 9, 4));
    expect(opts[0]).toBe("2027Q4");
    expect(opts).toContain("2026Q3");
    expect(opts[opts.length - 1]).toBe("2024Q1");
  });
});
