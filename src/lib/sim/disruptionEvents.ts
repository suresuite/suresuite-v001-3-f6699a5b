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

/** "Full outage" or "Cut by 30%" — the engine's reading of `magnitude_pct`. */
export function effectLabel(magnitudePct: number): string {
  return magnitudePct >= DISRUPTION_RULE.full_outage_pct ? "Full outage" : `Cut by ${magnitudePct}%`;
}

/** Target choices the engine can disrupt: the plant, then the project's suppliers. */
export function targetChoices(supplierIds: readonly string[]): { value: string; label: string }[] {
  return [
    { value: PLANT_TARGET, label: "Plant" },
    ...[...supplierIds].sort().map((id) => ({ value: supplierTarget(id), label: id })),
  ];
}
