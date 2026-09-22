import { describe, expect, it } from "vitest";
import { gateNotice } from "@/lib/sim/gateNotice";

// Audit F-19(a). When the pre-run gate could not load its data, dispatch
// proceeds and records `gate_skipped = true` on the run — and nothing in the
// browser read it, so the run wore the same result badge as one that passed.
describe("a run that skipped the pre-run gate says so", () => {
  it("gate_skipped → a notice naming what was not checked", () => {
    expect(gateNotice({ gate_skipped: true })).toMatch(/pre-run data check did not run/);
  });
  it("a checked run carries none", () => {
    expect(gateNotice({ gate_skipped: false })).toBeNull();
    expect(gateNotice({})).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("the results header renders it", () => {
  it("ResultsDashboard derives the notice from the run, on both skins", () => {
    const src = readFileSync(join(__dirname, "..", "..", "..", "components", "sim", "ResultsDashboard.tsx"), "utf8");
    expect(src).toMatch(/const gateText = gateNotice\(run\)/);
    expect(src.match(/\{gateText && /g)?.length).toBe(2);
  });
});
