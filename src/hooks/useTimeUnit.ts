// Per-project planning time-unit. Persisted in localStorage only (v1).
// All sim payloads keep day-based units; this hook only relabels and converts
// what the UI shows / collects.
//
// FIXED TO WEEK FOR NOW. The engine (scsim) steps in weeks and every lane lead
// time is canonical in weeks (`duration_to_weeks` at promotion), so week is the
// one unit the whole chain agrees on. Day and month stay in the type so the
// selector can come back later, but no surface may select them today: the
// effective unit is always PLANNING_UNIT, whatever an older session stored.
import { useCallback, useEffect, useState } from "react";
import { UNIT_DAYS } from "../../supabase/functions/_shared/grading";

export type TimeUnit = "day" | "week" | "month";

/** The planning unit every surface uses until unit selection is reworked. */
export const PLANNING_UNIT: TimeUnit = "week";
/** Units a selector may offer today. Anything else renders disabled. */
export const SELECTABLE_UNITS: readonly TimeUnit[] = [PLANNING_UNIT];
export const isSelectableUnit = (u: TimeUnit): boolean => SELECTABLE_UNITS.includes(u);
/** The one sentence every selector shows beside the (fixed) unit. */
export const PLANNING_UNIT_NOTE =
  "Planning unit is fixed to weeks: lead times and time-based calculations are in weeks, because the engine simulates week by week.";

export const UNIT_LABEL: Record<TimeUnit, string> = {
  day: "day",
  week: "week",
  month: "month",
};
export const UNIT_LABEL_PLURAL: Record<TimeUnit, string> = {
  day: "days",
  week: "weeks",
  month: "months",
};

/** Read from the one unit table (`contract:units` gates it), never restated:
 *  a second `month: 30` here disagreed with its 30.4375 (§4 D223). */
export const DAYS_PER_UNIT: Record<TimeUnit, number> = {
  day: UNIT_DAYS.day,
  week: UNIT_DAYS.week,
  month: UNIT_DAYS.month,
};

const storageKey = (projectId: string | null | undefined) =>
  `policy.time_unit.${projectId ?? "global"}`;

/** The effective unit for a project. A stored choice counts only while it is
 *  selectable, so a "day" or "month" saved before the unit was fixed reads as
 *  week rather than resurrecting a unit no control can show. */
export function getTimeUnit(projectId: string | null | undefined): TimeUnit {
  if (typeof window === "undefined" || !projectId) return PLANNING_UNIT;
  let v: string | null = null;
  try {
    v = localStorage.getItem(storageKey(projectId));
  } catch {
    v = null;
  }
  if ((v === "day" || v === "week" || v === "month") && isSelectableUnit(v)) return v;
  return PLANNING_UNIT;
}

export function useTimeUnit(projectId: string | null | undefined) {
  const [unit, setUnitState] = useState<TimeUnit>(() => getTimeUnit(projectId));

  useEffect(() => {
    setUnitState(getTimeUnit(projectId));
  }, [projectId]);

  const setUnit = useCallback(
    (u: TimeUnit) => {
      if (!projectId || !isSelectableUnit(u)) return;
      try {
        localStorage.setItem(storageKey(projectId), u);
      } catch {
        /* storage blocked — the in-memory unit still applies */
      }
      setUnitState(u);
      // notify any other useTimeUnit instances in the page
      window.dispatchEvent(new CustomEvent("policy:time-unit-changed", { detail: { projectId, unit: u } }));
    },
    [projectId],
  );

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === projectId) setUnitState(detail.unit);
    };
    window.addEventListener("policy:time-unit-changed", onChange);
    return () => window.removeEventListener("policy:time-unit-changed", onChange);
  }, [projectId]);

  const daysPerUnit = DAYS_PER_UNIT[unit];

  /** convert a day-stored value into the chosen unit (for display). */
  const fromDays = useCallback((daysValue: number) => daysValue / daysPerUnit, [daysPerUnit]);
  /** convert a user-entered unit value back to days (for storage). */
  const toDays = useCallback((unitValue: number) => unitValue * daysPerUnit, [daysPerUnit]);

  /**
   * Adapt a field label whose canonical form mentions "(days)" or "/ day".
   * Leaves the label unchanged for non-time fields.
   */
  const adaptLabel = useCallback(
    (label: string) => {
      if (unit === "day") return label;
      return label
        .replace(/\(days\)/g, `(${UNIT_LABEL_PLURAL[unit]})`)
        .replace(/\/ ?day\b/g, `/ ${UNIT_LABEL[unit]}`)
        .replace(/\bper day\b/g, `per ${UNIT_LABEL[unit]}`)
        .replace(/units\/day/g, `units/${UNIT_LABEL[unit]}`);
    },
    [unit],
  );

  /** Heuristic: is a field name a "days" quantity that should be unit-converted? */
  const isDayField = (field: string) =>
    /days?$/.test(field) || field.endsWith("_per_day");

  return { unit, setUnit, daysPerUnit, fromDays, toDays, adaptLabel, isDayField };
}
