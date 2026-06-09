// Per-project planning time-unit. Persisted in localStorage only (v1).
// All sim payloads keep day-based units; this hook only relabels and converts
// what the UI shows / collects.
import { useCallback, useEffect, useState } from "react";

export type TimeUnit = "day" | "week" | "month";

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

export const DAYS_PER_UNIT: Record<TimeUnit, number> = {
  day: 1,
  week: 7,
  month: 30,
};

const storageKey = (projectId: string | null | undefined) =>
  `policy.time_unit.${projectId ?? "global"}`;

export function getTimeUnit(projectId: string | null | undefined): TimeUnit | null {
  if (typeof window === "undefined" || !projectId) return null;
  const v = localStorage.getItem(storageKey(projectId));
  if (v === "day" || v === "week" || v === "month") return v;
  return null;
}

export function useTimeUnit(projectId: string | null | undefined) {
  const [unit, setUnitState] = useState<TimeUnit | null>(() => getTimeUnit(projectId));

  useEffect(() => {
    setUnitState(getTimeUnit(projectId));
  }, [projectId]);

  const setUnit = useCallback(
    (u: TimeUnit) => {
      if (!projectId) return;
      localStorage.setItem(storageKey(projectId), u);
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

  const daysPerUnit = unit ? DAYS_PER_UNIT[unit] : 1;

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
      if (!unit || unit === "day") return label;
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
