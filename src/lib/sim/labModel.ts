// The Simulation Lab's Model → Engine → Scenario → Settings → Run flow, as pure
// rules. Phase 10 / WP 10.5 / blueprint §9.1, §9.5.1.
//
// The Lab used to start from a scenario and attach whatever model happened to
// match it. It now starts from a CHOICE of Validated Model, and four rules decide
// everything the screen says about that choice — so the desktop page, the phone
// composition and the tests all read one answer:
//   - which models are offered, and which is chosen when nobody chose;
//   - what a run would deviate from the model's PROTOCOL, read off the scenario
//     the run would use (the engine runs the scenario row; the protocol is what
//     the model says that row should be) — the deviations are what the run records
//     as `protocol_overrides`, and what its results and exports show (T2, T4);
//   - how big the run is — replication-weeks, and the storage it will take;
//   - which runs a comparison defaults to: the same model's, never an
//     exploratory run as the baseline side.
import type { ModelValidationCard } from "@/hooks/useModelValidation";
import { REPLICATION_SERIES_FACTS } from "@/components/docs/generated/policy.generated";
import { protocolLine, type ValidatedModelProtocol } from "./validatedModel";

// ── the model choice ─────────────────────────────────────────────────────────

/** The models the Lab offers: active and validated, newest first. A superseded or
 *  revoked model is history — reachable by link (`?model=`), never offered. */
export function modelChoices(cards: ModelValidationCard[]): ModelValidationCard[] {
  return cards
    .filter((c) => c.status === "active" && c.verdict === "validated")
    .sort((a, b) => (a.validated_at < b.validated_at ? 1 : a.validated_at > b.validated_at ? -1 : 0));
}

/** The model chosen when the user has not chosen: the link's, if it names one this
 *  project has (any status — an old link still opens what it named), else the
 *  newest active model, else none (the Lab then runs exploratory only). */
export function defaultModel(
  allCards: ModelValidationCard[],
  linked: string | null,
): ModelValidationCard | null {
  if (linked) {
    const hit = allCards.find((c) => c.id === linked);
    if (hit) return hit;
  }
  return modelChoices(allCards)[0] ?? null;
}

/** One line per model in the picker: name and number, then its protocol. */
export function modelOptionLabel(c: ModelValidationCard): string {
  const head = `${c.name ?? "Validated model"}${c.version_no != null ? ` v${c.version_no}` : ""}`;
  const p = c.protocol;
  return p
    ? `${head} · ${protocolLine({ replications: p.replications, warmup_week: p.warmup_week, horizon_weeks: p.horizon_weeks })}`
    : `${head} · no protocol recorded`;
}

// ── deviations from the protocol ─────────────────────────────────────────────

/** The scenario fields a run actually uses for the protocol's keys. */
export interface ScenarioRunSettings {
  replications: number;
  horizon_days: number;
  seed: number;
  crn: boolean;
  warmup_mode?: string | null;
  warmup_days?: number | null;
  stopping_rule?: { kind?: string } | null;
}

export interface Deviation {
  key: "replications" | "horizon_weeks" | "warmup_week" | "root_seed" | "crn" | "stopping_rule";
  label: string;
  model: string | number | boolean | null;
  run: string | number | boolean | null;
}

/** What a run of `scenario` would deviate from `protocol`. Empty = faithful. A
 *  protocol key the model never recorded (a backfilled model's `unknown`) is not a
 *  deviation — there is nothing to deviate from — and is not invented here. */
export function protocolDeviations(
  protocol: Partial<ValidatedModelProtocol> | null | undefined,
  scenario: ScenarioRunSettings,
): Deviation[] {
  if (!protocol) return [];
  const out: Deviation[] = [];
  const cmp = (key: Deviation["key"], label: string, model: unknown, run: unknown) => {
    if (model === null || model === undefined) return;
    if (model !== run) {
      out.push({ key, label, model: model as Deviation["model"], run: (run ?? null) as Deviation["run"] });
    }
  };
  cmp("replications", "Replications", protocol.replications, scenario.replications);
  cmp("horizon_weeks", "Horizon (weeks)", protocol.horizon_weeks, Math.ceil(scenario.horizon_days / 7));
  // An `auto` warm-up is detected per run; only a manual one states a week.
  if (scenario.warmup_mode !== "auto") {
    cmp("warmup_week", "Steady state from (week)", protocol.warmup_week,
      Math.round(Number(scenario.warmup_days ?? 0) / 7));
  } else if (protocol.warmup_week != null) {
    out.push({ key: "warmup_week", label: "Steady state from (week)", model: protocol.warmup_week, run: "detected per run" });
  }
  cmp("root_seed", "Root seed", protocol.root_seed, scenario.seed);
  cmp("crn", "Common random numbers", protocol.crn, scenario.crn);
  cmp("stopping_rule", "Stopping rule", protocol.stopping_rule, scenario.stopping_rule?.kind ?? "fixed_horizon");
  return out;
}

/** The deviations as the run row stores them (`protocol_overrides`): key → the
 *  value the run used. `{}` = faithful. */
export function overridesOf(devs: Deviation[]): Record<string, unknown> {
  return Object.fromEntries(devs.map((d) => [d.key, d.run]));
}

// ── how big the run is ───────────────────────────────────────────────────────

/** Replication-weeks: the unit compute is measured in (WP 10.7 meters it). */
export function replicationWeeks(replications: number, horizonDays: number): number {
  return Math.max(0, Math.round(replications)) * Math.max(0, Math.ceil(horizonDays / 7));
}

/** The weekly series every replication persists — scsim's `WEEKLY_SERIES`,
 *  published ones, read from the generated declaration (not restated). */
export const SERIES_PER_REPLICATION = REPLICATION_SERIES_FACTS.declared.filter((s) => s.published).length;

/** Bytes one weekly value costs in `run_replications.time_series` (jsonb number
 *  text plus separator) and one replication's fixed cost (its KPI row and keys).
 *  Declared, so the estimate says what it assumed. */
export const BYTES_PER_POINT = 10;
export const BYTES_PER_REPLICATION_FIXED = 2048;

export interface StorageEstimate {
  bytes: number;
  /** How the figure was computed, in words — the estimate's source (T1). */
  basis: string;
}

export function storageEstimate(replications: number, horizonDays: number): StorageEstimate {
  const weeks = Math.max(0, Math.ceil(horizonDays / 7));
  const reps = Math.max(0, Math.round(replications));
  const bytes = reps * (BYTES_PER_REPLICATION_FIXED + SERIES_PER_REPLICATION * weeks * BYTES_PER_POINT);
  return {
    bytes,
    basis:
      `${reps} replication(s) × (${SERIES_PER_REPLICATION} weekly series × ${weeks} weeks × ` +
      `${BYTES_PER_POINT} B + ${BYTES_PER_REPLICATION_FIXED} B for the KPI row)`,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── which runs compare ───────────────────────────────────────────────────────

export interface CompareCandidate {
  scenarioId: string;
  modelId: string | null;
  exploratory: boolean;
}

/** The scenarios a comparison offers by default: those whose newest completed run
 *  followed `modelId`. With `includeOtherModels`, every scenario with results, and
 *  each one from another model (or none) is labelled — allowed, never hidden. An
 *  exploratory run is never offered as the baseline side. */
export function compareScope(
  candidates: CompareCandidate[],
  modelId: string | null,
  includeOtherModels: boolean,
): { offered: CompareCandidate[]; baselineEligible: CompareCandidate[]; labelOf: (c: CompareCandidate) => string | null } {
  const same = (c: CompareCandidate) => modelId !== null && c.modelId === modelId && !c.exploratory;
  const offered = includeOtherModels || modelId === null ? candidates : candidates.filter(same);
  return {
    offered,
    baselineEligible: offered.filter((c) => !c.exploratory),
    labelOf: (c) =>
      c.exploratory ? "exploratory" : modelId !== null && c.modelId !== modelId ? "different model" : null,
  };
}
