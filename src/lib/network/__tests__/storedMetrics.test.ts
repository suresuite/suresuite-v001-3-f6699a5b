import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzerOutcome, rowFreshnessLabel, storedMetricsDecision } from "../storedMetrics";

// WP 10.1 · §4 D235–D239 — a reload with unchanged hashes invokes no analyzer.

const current = { metrics_source: "store" as const, hash_is_current: true, run_id: "r1", computed_at: "2026-10-01T14:02:00Z" };

describe("compute once — the decision a network page makes on load", () => {
  it("a current stored run is READ, not recomputed: a reload with unchanged hashes invokes nothing", () => {
    const d = storedMetricsDecision([current, { ...current }]);
    expect(d).toEqual({ state: "current", invoke: false, runId: "r1", computedAt: "2026-10-01T14:02:00Z" });
  });
  it("a stale stored run is shown as stale and recomputed once", () => {
    const d = storedMetricsDecision([{ ...current, hash_is_current: false }]);
    expect(d.state).toBe("stale");
    expect(d.invoke).toBe(true);
  });
  it("legacy mirror values carry no provenance: unknown, never current", () => {
    expect(storedMetricsDecision([{ metrics_source: "column" }]).state).toBe("unknown");
  });
  it("nothing stored is missing", () => {
    expect(storedMetricsDecision([]).state).toBe("missing");
    expect(storedMetricsDecision([{ metrics_source: "none" }]).invoke).toBe(true);
  });
  it("each row says its own freshness beside its number", () => {
    expect(rowFreshnessLabel(current)).toBe("current");
    expect(rowFreshnessLabel({ ...current, hash_is_current: false })).toBe("stale");
    expect(rowFreshnessLabel({ metrics_source: "column" })).toBe("no provenance");
    expect(rowFreshnessLabel({ metrics_source: "none" })).toBe("not computed");
  });
  it("an analyzer's answer says whether it reused or computed", () => {
    expect(analyzerOutcome({ cache_hit: true })).toBe("reused");
    expect(analyzerOutcome({ cache_hit: false })).toBe("computed");
    expect(analyzerOutcome({ in_progress: true })).toBe("in progress");
  });
});

describe("the pages read before they compute", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../../../pages", p), "utf8");
  it("product level decides with storedMetricsDecision and has no browser fallback", () => {
    const src = read("ProductLevelNetwork.tsx");
    expect(src).toMatch(/storedMetricsDecision\(/);
    expect(src).not.toMatch(/computeLocalMetrics/);
  });
  it("firm level reads stored prominence and invokes the analyzer only on a miss", () => {
    const src = read("FirmLevelNetwork.tsx");
    expect(src).toMatch(/storedMetricsDecision\(/);
    expect(src).toMatch(/metrics_source/);
  });
  it("process level reads the stored structure instead of walking the graph in the browser", () => {
    const src = read("ProcessLevelNetwork.tsx");
    expect(src).toMatch(/rpc\('process_structure'/);
    expect(src).not.toMatch(/const findReachableNodes = useCallback/);
  });
  it("all three show the graph version chip", () => {
    for (const p of ["ProductLevelNetwork.tsx", "FirmLevelNetwork.tsx", "ProcessLevelNetwork.tsx"]) {
      expect(read(p), p).toMatch(/<GraphVersionChip/);
    }
  });
});
