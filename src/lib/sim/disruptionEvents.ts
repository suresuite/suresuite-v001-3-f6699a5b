/**
 * One disruption-event model for every surface that writes one (WP 9.4 slice 6).
 *
 * The Lab's event editor and the network pages' disruption dialog both build
 * `scenarios.disruption_schedule` rows here, and both judge a target by the
 * engine's own rule (`engineTargetOf`, shared with the sim-command gate). The
 * numbers — the cap, the week bounds, the target kinds — are the mapper's,
 * exported as `registry.disruption`; none is restated in `src/` (§4 D226).
 *
 * Rows stay in DAYS (`start_day`, `duration_days`): that is the stored shape the
 * engine, the gate and every existing scenario read. What changes is that every
 * surface authors them in whole engine weeks.
 */
import registry from "@/lib/policies/registry.generated.json";
import type { Scenario } from "@/hooks/useScenarios";
import {
  engineTargetOf,
  engineTargetReason,
  type DisruptionRule,
  type EngineTarget,
} from "../../../supabase/functions/_shared/disruptionRules";
import { defaultDisruptionStartDay } from "./disruptionTiming";
import { DAYS_PER_WEEK } from "./planningTime";
import { disruptionWeeks } from "./runWindow";

export type ScheduleEvent = Scenario["disruption_schedule"][number];

/** The mapper's event rule, as exported. */
export const DISRUPTION_RULE = (registry as unknown as { disruption: DisruptionRule }).disruption;

/** How a target is written: the plant, or `supplier:<id>`. */
export const PLANT_TARGET = "node:plant";
export const supplierTarget = (id: string) => `supplier:${id}`;

/** A new event: a full outage of `target`, four weeks long, starting four
 *  measured weeks after the warm-up (audit F-03's default). */
export function newEvent(target = "", warmupDays?: number): ScheduleEvent {
  return {
    target,
    target_type: "node",
    start_day: defaultDisruptionStartDay(warmupDays),
    duration_days: 4 * DAYS_PER_WEEK,
    magnitude_pct: DISRUPTION_RULE.full_outage_pct,
  };
}

/** What the engine will do with this target. */
export function judgeTarget(target: string, supplierIds: readonly string[]): {
  target: EngineTarget;
  reason: string | null;
} {
  const t = engineTargetOf(target, supplierIds, DISRUPTION_RULE);
  return { target: t, reason: engineTargetReason(t) };
}

/** Why no further event can be added, or null. */
export function addBlockedReason(schedule: readonly unknown[]): string | null {
  return schedule.length >= DISRUPTION_RULE.event_cap
    ? `The engine runs at most ${DISRUPTION_RULE.event_cap} events per scenario.`
    : null;
}

/**
 * The words every disruption surface uses, so the network pages' dialog, the
 * Lab's schedule editor, the stress presets and the phone sheet cannot name one
 * thing three ways. They are the engine's own model
 * (`scsim/scsim/entities/disruption.py`): a disruption EVENT hits a TARGET node
 * with an EFFECT — a full outage, or a capacity reduction that leaves a share of
 * the node's capacity — from its ONSET week for a DURATION, counted in
 * simulation weeks. A scenario's events, together, are its disruption schedule.
 */
export const DISRUPTION_TERMS = {
  event: "Disruption event",
  schedule: "Disruption schedule",
  target: "Disrupted node",
  effect: "Effect",
  fullOutage: "Full outage",
  capacityReduction: "Capacity reduction",
  onset: "Onset week",
  duration: "Duration",
} as const;

/** The engine's reading of `magnitude_pct`: at or above the outage threshold
 *  nothing flows; below it, capacity is reduced BY that share. */
export function isFullOutage(magnitudePct: number): boolean {
  return magnitudePct >= DISRUPTION_RULE.full_outage_pct;
}

/** "Full outage" or "Capacity reduction 30%". */
export function effectLabel(magnitudePct: number): string {
  return isFullOutage(magnitudePct)
    ? DISRUPTION_TERMS.fullOutage
    : `${DISRUPTION_TERMS.capacityReduction} ${magnitudePct}%`;
}

/** What the effect does to the node, in one sentence. */
export function effectMeaning(magnitudePct: number): string {
  return isFullOutage(magnitudePct)
    ? "The node delivers nothing until the event ends."
    : `${100 - magnitudePct}% of the node's weekly capacity remains.`;
}

/** A target as a person reads it: "Plant", "Supplier S-104", or the raw value. */
export function targetLabel(target: string): string {
  if (!target) return "No node";
  if (target === PLANT_TARGET) return "Plant";
  if (target.startsWith("supplier:")) return `Supplier ${target.slice("supplier:".length)}`;
  return target;
}

/** The simulation weeks an event covers, as the engine rounds them: "weeks 19–22". */
export function eventWindow(startDay: number, durationDays: number): string {
  const { startWeek, durationWeeks } = disruptionWeeks(startDay, durationDays);
  return durationWeeks <= 1
    ? `week ${startWeek}`
    : `weeks ${startWeek}–${startWeek + durationWeeks - 1}`;
}

/** One line per event: "Full outage · Supplier S-104 · weeks 19–22". */
export function describeEvent(e: Pick<ScheduleEvent, "target" | "start_day" | "duration_days" | "magnitude_pct">): string {
  return `${effectLabel(e.magnitude_pct)} · ${targetLabel(e.target)} · ${eventWindow(e.start_day, e.duration_days)}`;
}

/** Target choices the engine can disrupt, grouped: the plant, then the project's suppliers. */
export function targetChoices(supplierIds: readonly string[]): { value: string; label: string; group: "Plant" | "Suppliers" }[] {
  return [
    { value: PLANT_TARGET, label: "Plant", group: "Plant" },
    ...[...supplierIds].sort().map((id) => ({ value: supplierTarget(id), label: id, group: "Suppliers" as const })),
  ];
}
