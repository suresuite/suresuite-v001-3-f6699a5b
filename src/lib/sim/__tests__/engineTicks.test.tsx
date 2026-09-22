import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EngineTicks } from "@/components/sim/DisruptionScheduleEditor";

// Audit F-22: day-granular disruptions collapse to weeks, and the desktop
// editor must say so at the row, as mobile's sheet header already did.
describe("EngineTicks", () => {
  it("a 3-day and a 10-day disruption render as the same one-week event", () => {
    const a = renderToStaticMarkup(<EngineTicks startDay={10} durationDays={3} />);
    const b = renderToStaticMarkup(<EngineTicks startDay={10} durationDays={10} />);
    expect(a).toContain("week 1 for 1 wk");
    expect(b).toContain("week 1 for 1 wk");
    expect(a).toContain("weekly ticks");
  });
  it("a row already on whole weeks carries no caveat", () => {
    const html = renderToStaticMarkup(<EngineTicks startDay={14} durationDays={21} />);
    expect(html).toContain("week 2 for 3 wk");
    expect(html).not.toContain("weekly ticks");
  });
});

import { defaultDisruptionStartDay, warmupNote } from "@/lib/sim/disruptionTiming";
import { disruptionWeeks } from "../runWindow";

// Audit F-03: the default disruption was day 10 → week 1, inside every warm-up.
describe("a new disruption starts where KPIs are measured", () => {
  it("at the shipped 105-day warm-up the default starts 4 measured weeks after it", () => {
    const day = defaultDisruptionStartDay(105);
    expect(disruptionWeeks(day, 5).startWeek).toBe(15 + 4);
    expect(warmupNote(disruptionWeeks(day, 5).startWeek,
      { days: 105, mode: "manual", horizonDays: 1092 })).toBeNull();
  });
  it("the old default is named as inside the warm-up", () => {
    expect(warmupNote(disruptionWeeks(10, 5).startWeek,
      { days: 105, mode: "manual", horizonDays: 1092 })).toMatch(/Inside the 15 wk warm-up/);
  });
  it("a start ON the first measured week says recovery is not measured", () => {
    expect(warmupNote(15, { days: 105, mode: "manual", horizonDays: 1092 })).toMatch(/not measured/);
  });
  it("under auto warm-up no row is judged — the rule is stated once", () => {
    expect(warmupNote(1, { days: 105, mode: "auto", horizonDays: 1092 })).toBeNull();
  });
});
