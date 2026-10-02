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
import { driftReasons, protocolLine, type ValidatedModelProtocol } from "./validatedModel";

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

// ── what the plan leaves (WP 10.7 · §4 D247) ─────────────────────────────────

/** `get_my_capacity`'s answer: the organization's pool and the member's role
 *  share, with what each has used. NULL quota = unlimited. */
export interface CapacityState {
  org_id: string | null;
  role: string | null;
  pool: {
    compute_quota_rep_weeks_month: number | null;
    compute_used_rep_weeks: number;
    storage_quota_bytes: number | null;
    storage_used_bytes: number;
    max_concurrent_runs: number | null;
    active_runs: number;
    max_replications_per_run: number | null;
  };
  share: {
    compute_share_pct: number | null;
    storage_share_pct: number | null;
    max_concurrent: number | null;
    compute_used_rep_weeks: number;
    storage_used_bytes: number;
    active_runs: number;
  } | null;
}

export interface CapacityVerdict {
  /** what is left, in words, for the Run card */
  line: string;
  /** the refusal the database will give this run, forecast in its own order — null when it fits */
  refusal: string | null;
}

/** A quota and its use → what is left of the pool and of the role's share.
 *  The share is a percentage OF the pool, floored as the database floors it. */
function leftOf(quota: number | null, poolUsed: number, pct: number | null | undefined, shareUsed: number | undefined) {
  if (quota == null) return null;
  const pool = Math.max(0, quota - poolUsed);
  if (pct == null || shareUsed == null) return { left: pool, by: "organization" as const, cap: quota };
  const cap = Math.floor((quota * pct) / 100);
  const share = Math.max(0, cap - shareUsed);
  return share < pool ? { left: share, by: "share" as const, cap } : { left: pool, by: "organization" as const, cap: quota };
}

/** The Run card's forecast of `_capacity_admit`, which stays the authority: the
 *  same checks in the same order, so the card says before the click what the
 *  dispatcher would answer after it. */
export function capacityVerdict(
  s: CapacityState | null,
  run: { replications: number; repWeeks: number; bytes: number },
): CapacityVerdict {
  if (!s) return { line: "capacity unknown — the plan could not be read", refusal: null };
  const p = s.pool;
  const sh = s.share;
  const role = s.role ?? "member";
  const compute = leftOf(p.compute_quota_rep_weeks_month, p.compute_used_rep_weeks, sh?.compute_share_pct, sh?.compute_used_rep_weeks);
  const storage = leftOf(p.storage_quota_bytes, p.storage_used_bytes, sh?.storage_share_pct, sh?.storage_used_bytes);
  const parts: string[] = [];
  if (compute) {
    parts.push(
      `${compute.left.toLocaleString()} of ${compute.cap.toLocaleString()} replication-weeks left this month` +
        (compute.by === "share" ? ` (your ${role} share)` : ""),
    );
  }
  if (storage) {
    parts.push(`${formatBytes(storage.left)} of ${formatBytes(storage.cap)} storage left` + (storage.by === "share" ? ` (your ${role} share)` : ""));
  }
  const line = parts.length > 0 ? parts.join(" · ") : "no compute or storage limit on this plan";

  let refusal: string | null = null;
  const inFlightCap = p.max_concurrent_runs;
  if (p.max_replications_per_run != null && run.replications > p.max_replications_per_run) {
    refusal = `this run asks for ${run.replications} replications; the limit is ${p.max_replications_per_run} per run`;
  } else if (inFlightCap != null && p.active_runs >= inFlightCap) {
    refusal = `the organization has ${p.active_runs} runs queued or running; the limit is ${inFlightCap}`;
  } else if (inFlightCap != null && sh?.max_concurrent != null && sh.active_runs >= sh.max_concurrent) {
    refusal = `you have ${sh.active_runs} runs queued or running; your ${role} role allows ${sh.max_concurrent}`;
  } else if (compute && run.repWeeks > compute.left) {
    refusal = `this run needs ${run.repWeeks.toLocaleString()} replication-weeks; ${compute.left.toLocaleString()} are left`;
  } else if (storage && run.bytes > storage.left) {
    refusal = `this run is expected to keep ${formatBytes(run.bytes)}; ${formatBytes(storage.left)} is left — release pinned runs or let runs expire`;
  }
  return { line, refusal };
}

/**
 * PLAN.md §23 WP 13.3 — what the Lab may offer for a run of a Validated Model.
 *
 * A run of a model is dispatched with the MODEL's own dataset version and policy
 * version (the dispatcher enforces it), so a live project that has MOVED since
 * validation no longer makes the run unfaithful: it replays the validated data.
 * The user chooses — *run the validated versions*, or *run current data as
 * exploratory* (the model's policies on today's data, never a validated result).
 * Only what a replay cannot hold still blocks: the scenario's world or the engine
 * changed, or the model is no longer in force. A model recorded before models
 * named their dataset version cannot be replayed on moved data at all.
 */
export type ModelRunOffer =
  | { kind: "faithful" }
  | { kind: "moved"; replayable: boolean; note: string }
  | { kind: "blocked"; reason: string };

export function modelRunOffer(
  card: Pick<ModelValidationCard, "status" | "dataset_version_id">,
  credibility: { state: string; drift?: string[] } | null,
): ModelRunOffer {
  if (card.status !== "active") {
    return { kind: "blocked", reason: "This model is no longer in force — choose the one that is." };
  }
  const drift = credibility?.state === "stale" ? credibility.drift ?? [] : [];
  if (drift.includes("scenario") || drift.includes("engine")) {
    return {
      kind: "blocked",
      reason: `${driftReasons(drift.filter((d) => d !== "data")).join(" and ")} since this model was validated — re-validate it in Policies first.`.replace(/^./, (c) => c.toUpperCase()),
    };
  }
  if (drift.includes("data")) {
    return card.dataset_version_id
      ? {
          kind: "moved",
          replayable: true,
          note: "Your project's data changed since this model was validated. A run of the model replays the data it was validated on; run current data to see today's numbers as an exploratory run.",
        }
      : {
          kind: "moved",
          replayable: false,
          note: "Your project's data changed since this model was validated, and this model does not name the data version it was validated on — it cannot be replayed. Run current data as exploratory, or re-validate.",
        };
  }
  return { kind: "faithful" };
}
