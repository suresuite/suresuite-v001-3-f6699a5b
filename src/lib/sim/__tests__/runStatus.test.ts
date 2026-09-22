import { describe, expect, it } from "vitest";
import { resultsHeader, STALE_AFTER_MINUTES } from "@/lib/sim/runStatus";

const T0 = Date.parse("2026-09-22T12:00:00Z");
const run = (over: Record<string, unknown>) => ({
  status: "done", code_version: "scsim-0.2.5", rep_count_done: 30, rep_count_target: 30,
  error_message: null, updated_at: "2026-09-22T12:00:00Z", ...over,
}) as Parameters<typeof resultsHeader>[0];

// Audit WP 4. F-07: the results header never read `run.status`, so a failed or
// cancelled run's partial replications sat under a green "Monte Carlo result"
// badge. F-18: which engine ran was shown on mobile only. F-30: a run whose
// worker died stayed "running" forever with nothing saying so.
describe("the results header says what the run IS", () => {
  it("a finished run names its replications AND its engine", () => {
    const h = resultsHeader(run({}), T0);
    expect(h.tone).toBe("ok");
    expect(h.text).toBe("Monte Carlo result · 30 replications · scsim-0.2.5");
    expect(h.showAggregates).toBe(true);
  });

  it("a failed run is not a result, and says why", () => {
    const h = resultsHeader(run({ status: "failed", error_message: "could not read outbound_logistics: HTTP 503" }), T0);
    expect(h.tone).toBe("bad");
    expect(h.text).toMatch(/^Failed — could not read outbound_logistics/);
    expect(h.showAggregates).toBe(false);
  });

  it("a cancelled run is not a result either, whatever replications it left", () => {
    const h = resultsHeader(run({ status: "cancelled", rep_count_done: 7 }), T0);
    expect(h.tone).toBe("warn");
    expect(h.text).toMatch(/Cancelled — 7 of 30 replications ran before the cancel; not a result/);
    expect(h.showAggregates).toBe(false);
  });

  it("a running run is labelled partial", () => {
    const h = resultsHeader(run({ status: "running", rep_count_done: 4 }), T0 + 60_000);
    expect(h.text).toMatch(/Running — 4 of 30 replications so far; figures are partial/);
    expect(h.showAggregates).toBe(true);
  });

  it(`a running run with no progress for ${STALE_AFTER_MINUTES} minutes says so`, () => {
    const h = resultsHeader(run({ status: "running", rep_count_done: 4 }),
                            T0 + (STALE_AFTER_MINUTES + 1) * 60_000);
    expect(h.tone).toBe("warn");
    expect(h.text).toMatch(/No progress for 11 min/);
  });

  it("a queued run past the threshold is flagged too", () => {
    expect(resultsHeader(run({ status: "queued", rep_count_done: 0 }), T0 + 60 * 60_000).text)
      .toMatch(/No progress for 60 min/);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ResultsDashboard obeys the header", () => {
  const src = readFileSync(join(__dirname, "..", "..", "..", "components", "sim", "ResultsDashboard.tsx"), "utf8");
  it("derives its badge from the run's status, on both skins", () => {
    expect(src).toMatch(/const header = resultsHeader\(run\)/);
    expect(src.match(/\{header\.text\}/g)?.length).toBe(2);
    expect(src).not.toMatch(/isStub/);
  });
  it("renders aggregates only for a run that is a result", () => {
    expect(src).toMatch(/\{!header\.showAggregates \? null : \(<>/);
  });
  it("never invents a disruption schedule or a horizon", () => {
    expect(src).not.toMatch(/magnitude_pct:\s*40/);
    expect(src).not.toMatch(/horizon_days \?\? 90/);
  });
});
