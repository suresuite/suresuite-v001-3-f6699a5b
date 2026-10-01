import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { retentionText } from "@/lib/sim/runSeries";

// WP 10.6 · §4 D246 — how long a run keeps its series, said from the run's own columns.

const run = (over: Record<string, unknown>) => ({
  status: "done", retention: "standard", series_expires_at: null, series_expired_at: null,
  series_bytes: 2048, run_key: "0123456789abcdef", ...over,
}) as Parameters<typeof retentionText>[0];

describe("retentionText", () => {
  it("a standard run says until when, and what its series cost", () => {
    expect(retentionText(run({ series_expires_at: "2026-12-30T12:00:00Z" })))
      .toMatch(/^Series kept until .+ \(standard retention\) · 2\.0 KB$/);
  });
  it("evidence and pinned runs say why they are kept", () => {
    expect(retentionText(run({ retention: "evidence" }))).toBe("Series kept — the evidence of a Validated Model · 2.0 KB");
    expect(retentionText(run({ retention: "pinned", series_bytes: null }))).toBe("Series pinned — kept until released");
  });
  it("an expired run names the RunKey that reproduces it", () => {
    expect(retentionText(run({ series_expired_at: "2026-12-31T00:00:00Z" }))).toBe(
      "Series expired — re-run reproduces it (RunKey 0123456789ab). The run's KPIs and aggregates are kept.",
    );
  });
  it("a run still running says nothing yet", () => {
    expect(retentionText(run({ status: "running" }))).toBeNull();
  });
});
