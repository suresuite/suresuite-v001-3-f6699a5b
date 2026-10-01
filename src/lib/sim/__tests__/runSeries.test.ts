import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { fetchRunSeries, hydrateReplications, parseSeriesObject, seriesFromRows, seriesNotice } from "../runSeries";

// WP 10.6 · §4 D246 — the one loader for a run's weekly series.

describe("the worker's Parquet object reads back as the rows it replaced", () => {
  it("a file written by `sim_worker.series_store.write` (Python) parses to the same series", async () => {
    // Written by the worker's own code — a real Python → JS round trip, not a mock.
    const b = readFileSync(join(__dirname, "fixtures", "series-2rep.parquet"));
    const byRep = await parseSeriesObject(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    expect(byRep).toEqual({
      0: { fill_rate: [0.8, 0.9, 1.0], on_hand_units: [10, 12.5, 11] },
      1: { fill_rate: [0.7, 0.95], on_hand_units: [9, 9.5] },
    });
  });
  it("rows out of order are put back in week order, and a series a replication never had is dropped", () => {
    expect(
      seriesFromRows([
        { rep_index: 0, week: 1, fill_rate: 0.9, fg_units: null },
        { rep_index: 0, week: 0, fill_rate: 0.8, fg_units: null },
      ]),
    ).toEqual({ 0: { fill_rate: [0.8, 0.9] } });
  });
});

describe("hydration fills only what is missing", () => {
  it("an empty row is filled from the object; a row that already has series is left alone", () => {
    const reps = [
      { rep_index: 0, time_series: {} },
      { rep_index: 1, time_series: { fill_rate: [1] } },
      { rep_index: 2, time_series: {} },
    ];
    const out = hydrateReplications(reps, { 0: { fill_rate: [0.5] }, 1: { fill_rate: [0] } });
    expect(out[0].time_series).toEqual({ fill_rate: [0.5] });
    expect(out[1].time_series).toEqual({ fill_rate: [1] });
    expect(out[2].time_series).toEqual({});
  });
});

describe("what is said instead of an empty chart", () => {
  it("an expired run names the RunKey that reproduces it, and fetches nothing", async () => {
    const s = await fetchRunSeries({ id: "r", project_id: "p", series_object: null,
      series_expired_at: "2026-12-01T00:00:00Z", run_key: "abcdef0123456789" });
    expect(s).toEqual({ state: "expired", runKey: "abcdef0123456789" });
    expect(seriesNotice(s)).toBe(
      "Series expired — re-run reproduces it (RunKey abcdef012345). The run's KPIs and aggregates are kept.",
    );
  });
  it("a run with series in its rows needs no object", async () => {
    expect(await fetchRunSeries({ id: "r", project_id: "p", series_object: null })).toEqual({ state: "inline" });
    expect(seriesNotice({ state: "inline" })).toBeNull();
  });
});
