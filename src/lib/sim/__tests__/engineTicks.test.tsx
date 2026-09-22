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
