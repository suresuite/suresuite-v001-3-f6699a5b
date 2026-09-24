/**
 * Stress-preset target resolution — §4 D172 (acceptance audit 2026-09-23).
 *
 * The stress presets shipped fixed placeholder targets (`supplier:primary`)
 * that `project_map.py::_map_events` resolves against the project's OWN
 * supplier ids — so unless a supplier was literally named "primary", the
 * event was skipped with one mapping warning and the "stress test" completed
 * on the undisrupted baseline, presenting healthy KPIs under a stress-test
 * name. The manual said so (D111); the drawer did not, and the run least of
 * all.
 *
 * This module is the launch-time half of the fix: `supplier:primary` is
 * resolved HERE, before the scenario is created, to the supplier carrying the
 * largest share of the project's weekly inbound volume — the same
 * normalization the lane ETL applies (`rateToWeekly`, one unit table, D10),
 * because "which supplier the platform calls primary" is a sourcing-share
 * question (see laneVolumes.ts on D2). A project whose inbound rows cannot
 * name a primary supplier gets a REFUSAL with the reason, never a scenario
 * whose event will silently map to nothing.
 *
 * `chains.mjs::deriveStressPresets` pins this file (RESOLVER_ANCHORS) the way
 * it pins the mapper, so the manual's classification of `supplier:primary` as
 * "resolved at launch" fails the build if this resolution ever stops
 * happening.
 */
import { rateToWeekly } from "../../../supabase/functions/_shared/grading";
import { STRESS_PRESETS } from "@/components/docs/generated/policy.generated";

/**
 * Why a preset cannot be launched, or null when it can — §4 D172.
 *
 * Read from the DERIVED classification (`STRESS_PRESETS`), not re-decided
 * here: `chains.mjs` applies the mapper's own resolution rule to each event
 * against pinned anchors, so this answer moves when the engine's does. A
 * preset with any event the engine would drop is disabled WITH the reason
 * (the §4.5 gating rule: disabled, not hidden) — launching it would produce
 * a run of nothing happening, presented under a stress-test name.
 */
export function stressPresetUnavailableReason(id: string): string | null {
  const derived = STRESS_PRESETS.find((p) => p.id === id);
  if (!derived) return null; // not derived yet: the generator gate will catch it
  const dropped = derived.events.filter((e) => e.resolves === "unsupported");
  if (dropped.length === 0) return null;
  const kinds = [...new Set(dropped.map((e) => e.target.split(":")[0]))].join(", ");
  return dropped.length === derived.events.length
    ? `The engine cannot disrupt ${kinds} targets yet — this run would complete with no disruption at all.`
    : `The engine cannot disrupt ${kinds} targets yet — half of this schedule would be dropped, so the run would not be the compound test it names.`;
}

/** One inbound row as the lane reads deliver it (untyped, like `grading.Row`). */
export interface StressInboundRow {
  supplier_id?: unknown;
  volume?: unknown;
  time_unit?: unknown;
  [key: string]: unknown;
}

export interface PrimarySupplier {
  supplierId: string;
  /** This supplier's share of the project's total weekly inbound volume, 0–100. */
  sharePct: number;
  weeklyVolume: number;
}

/**
 * The supplier with the largest weekly inbound volume, or null with a reason
 * a person can act on. Rows with a blank supplier or a non-numeric volume are
 * skipped — the promotion normalizes tier-2 rows to weekly, and pre-promotion
 * legacy rows still carry their own `time_unit`, which `rateToWeekly` reads.
 */
export function resolvePrimarySupplier(
  rows: readonly StressInboundRow[],
): { primary: PrimarySupplier; candidates: number } | { error: string } {
  const bySupplier = new Map<string, number>();
  for (const r of rows) {
    const id = String(r.supplier_id ?? "").trim();
    const vol =
      typeof r.volume === "string" ? Number(r.volume) : typeof r.volume === "number" ? r.volume : NaN;
    if (!id || !Number.isFinite(vol)) continue;
    const unit = typeof r.time_unit === "string" ? r.time_unit : null;
    bySupplier.set(id, (bySupplier.get(id) ?? 0) + rateToWeekly(vol, unit));
  }
  if (bySupplier.size === 0) {
    return {
      error:
        "this project has no inbound lanes to resolve a primary supplier from — " +
        "upload inbound logistics first",
    };
  }
  const total = [...bySupplier.values()].reduce((a, v) => a + v, 0);
  if (total <= 0) {
    return {
      error:
        "every inbound lane carries zero volume, so no supplier is primary — " +
        "give the lanes real volumes first",
    };
  }
  let best: PrimarySupplier | null = null;
  for (const [supplierId, weeklyVolume] of bySupplier) {
    if (!best || weeklyVolume > best.weeklyVolume) {
      best = { supplierId, weeklyVolume, sharePct: (weeklyVolume / total) * 100 };
    }
  }
  return { primary: best as PrimarySupplier, candidates: bySupplier.size };
}

/** The one placeholder the launch resolves. Everything else passes through. */
export const RESOLVABLE_PLACEHOLDER = "supplier:primary";

export interface StressEvent {
  target: string;
  target_type: "node" | "edge";
  start_day: number;
  duration_days: number;
  magnitude_pct: number;
}

/**
 * Replace `supplier:primary` with the resolved supplier across a schedule.
 * Returns the schedule plus the human sentence the scenario description
 * carries, so the substitution is visible at the point of decision (T2) —
 * or the resolver's refusal.
 */
export function resolveStressSchedule(
  schedule: readonly StressEvent[],
  inboundRows: readonly StressInboundRow[],
): { schedule: StressEvent[]; note: string | null } | { error: string } {
  if (!schedule.some((e) => e.target === RESOLVABLE_PLACEHOLDER)) {
    return { schedule: [...schedule], note: null };
  }
  const resolved = resolvePrimarySupplier(inboundRows);
  if ("error" in resolved) return resolved;
  const { primary } = resolved;
  return {
    schedule: schedule.map((e) =>
      e.target === RESOLVABLE_PLACEHOLDER ? { ...e, target: `supplier:${primary.supplierId}` } : e,
    ),
    note:
      `Primary supplier resolved at launch to ${primary.supplierId} ` +
      `(${primary.sharePct.toFixed(0)}% of weekly inbound volume).`,
  };
}
