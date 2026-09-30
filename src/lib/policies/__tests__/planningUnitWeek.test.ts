/**
 * The planning unit is fixed to WEEK until unit selection is reworked: the
 * engine steps in weeks and lane lead times are canonical in weeks, so every
 * surface shows weeks and none may select day or month.
 *
 * Node, no DOM — `window` and `localStorage` are stubbed for the one read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DAYS_PER_UNIT,
  PLANNING_UNIT,
  SELECTABLE_UNITS,
  getTimeUnit,
  isSelectableUnit,
} from "@/hooks/useTimeUnit";

const stubStorage = (stored: Record<string, string>) => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: (k: string) => stored[k] ?? null });
};

afterEach(() => vi.unstubAllGlobals());

describe("planning unit is fixed to week", () => {
  it("week is the planning unit and the only selectable one", () => {
    expect(PLANNING_UNIT).toBe("week");
    expect(SELECTABLE_UNITS).toEqual(["week"]);
    expect(isSelectableUnit("day")).toBe(false);
    expect(isSelectableUnit("month")).toBe(false);
    expect(DAYS_PER_UNIT[PLANNING_UNIT]).toBe(7);
  });

  it("an unset project reads as week, not day", () => {
    stubStorage({});
    expect(getTimeUnit("p1")).toBe("week");
    expect(getTimeUnit(null)).toBe("week");
  });

  it("a day or month stored before the unit was fixed reads as week", () => {
    stubStorage({ "policy.time_unit.p1": "day", "policy.time_unit.p2": "month" });
    expect(getTimeUnit("p1")).toBe("week");
    expect(getTimeUnit("p2")).toBe("week");
  });

  it("blocked storage still yields week", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(getTimeUnit("p1")).toBe("week");
  });
});
