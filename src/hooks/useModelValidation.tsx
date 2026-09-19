import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// Model-validation cards — Phase B0 / G13 / §9.5.
// Loads the project's model_validations rows (the persisted V&V credibility
// artifact, docs/design/phase-b0-core-loop.md §2) plus the live
// current_policy_hash / current_graph_hash, and derives the badge state at
// read time by hash comparison. The three states (validated / stale /
// unvalidated) are NEVER stored — staleness is computed against the current
// context, so reverting a drift self-heals without a new card (§2.4).
// Writes go through the SECURITY DEFINER RPCs only (record / revoke / apply).
//
// Two resolution surfaces share this hook:
//  - Run & Validate (/policies) supplies its own context hashes and calls
//    `resolve(ctx)`; it also records/revokes cards.
//  - The Simulation Lab resolves per-scenario via `resolveScenario` (the hook
//    fetches and caches scenario fingerprints itself so it stays synchronous),
//    stamps run badges via `resolveRun`, and inherits via `applyIfValidated`.

export interface ModelValidationCard {
  id: string;
  project_id: string;
  policy_version_id: string;
  policy_hash: string;
  dataset_version_id: string | null;
  graph_hash: string;
  scenario_hash: string;
  scenario_fingerprint: Record<string, unknown>;
  engine_fingerprint: string | null;
  adopted_warmup_days: number;
  warmup_method: "engine" | "welch" | "mser5";
  recommended_replications: number;
  replication_basis: {
    confidence?: number;
    target_precision?: number;
    per_kpi?: Record<string, { mean: number; half: number; rel: number; n: number; n_star?: number }>;
  };
  validation_tests: Array<{
    kpi: string;
    ks: number;
    ks_p: number;
    t: number;
    t_p: number;
    n: number;
    source: string;
    pass: boolean;
  }>;
  findings_snapshot: unknown[];
  verdict: "validated" | "rejected";
  basis: "statistical" | "face";
  evidence_run_id: string | null;
  status: "active" | "superseded" | "revoked";
  superseded_by?: string | null;
  validated_at: string;
  author_email: string | null;
  created_at: string;
}

export type DriftComponent = "policy" | "data" | "scenario" | "engine";

export type Credibility =
  | { state: "unvalidated" }
  | { state: "validated"; card: ModelValidationCard }
  | { state: "stale"; card: ModelValidationCard; drift: DriftComponent[] };

/** The current context a card is compared against (all hashes read live). */
export interface CredibilityContext {
  policyVersionId: string | null;
  /** live policy edits diverge from the selected version (usePolicies.isDirty) */
  policyDirty: boolean;
  /** current_graph_hash (useDatasetVersion.currentHash) */
  graphHash: string | null;
  /** scenario_fingerprint_hash of the scenario in context; null = unknown */
  scenarioHash: string | null;
  /** advisory 4th component: a completed run's code_version (§2.4) — only
   *  checked post-run; omit for live surfaces. */
  runCodeVersion?: string | null;
}

/** The world-model fields the baseline fingerprint covers (§2.3). */
export interface ScenarioFingerprintInput {
  id: string;
  horizon_days: number;
  time_step: string;
  demand_model: Record<string, unknown>;
}

const fingerprintKey = (s: ScenarioFingerprintInput) =>
  `${s.id}:${s.horizon_days}:${s.time_step}:${JSON.stringify(s.demand_model ?? {})}`;

export interface RecordValidationArgs {
  projectId: string;
  policyVersionId: string;
  datasetVersionId: string;
  scenarioId: string;
  adoptedWarmupDays: number;
  warmupMethod: "engine" | "welch" | "mser5";
  recommendedReplications: number;
  replicationBasis: Record<string, unknown>;
  validationTests: unknown[];
  findings: unknown[];
  verdict: "validated" | "rejected";
  basis: "statistical" | "face";
  evidenceRunId: string | null;
  userId?: string | null;
  userEmail?: string | null;
}

/** Fetch the baseline fingerprint hash of a scenario (single canonicalization
 *  point: the scenario_fingerprint_hash RPC — never hashed client-side). */
export async function fetchScenarioFingerprintHash(
  scenarioId: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb.rpc("scenario_fingerprint_hash", {
    p_scenario_id: scenarioId,
  });
  if (error) {
    console.error("scenario_fingerprint_hash failed", error);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Badge derivation (§2.4): one stored fact, three derived states. */
export function deriveCredibility(
  cards: ModelValidationCard[],
  ctx: CredibilityContext,
): Credibility {
  if (!ctx.policyVersionId) return { state: "unvalidated" };
  // Cards are looked up by the exact version (or the version dirty edits
  // branch from — same id, dirty just adds policy drift).
  const card = cards.find(
    (c) =>
      c.status === "active" &&
      c.verdict === "validated" &&
      c.policy_version_id === ctx.policyVersionId,
  );
  if (!card) return { state: "unvalidated" };

  // null current hashes mean "not loaded yet", not drift — skip those
  // comparisons rather than flashing a false stale state while loading.
  const drift: DriftComponent[] = [];
  if (ctx.policyDirty) drift.push("policy");
  if (ctx.graphHash !== null && ctx.graphHash !== card.graph_hash) {
    drift.push("data");
  }
  if (ctx.scenarioHash !== null && ctx.scenarioHash !== card.scenario_hash) {
    drift.push("scenario");
  }
  if (
    ctx.runCodeVersion != null &&
    card.engine_fingerprint != null &&
    ctx.runCodeVersion !== card.engine_fingerprint
  ) {
    drift.push("engine");
  }
  return drift.length === 0
    ? { state: "validated", card }
    : { state: "stale", card, drift };
}

interface UseModelValidationResult {
  /** ACTIVE cards for the project, newest first (the Run & Validate surface). */
  cards: ModelValidationCard[];
  /** Every card regardless of status — run badges need superseded ones too. */
  allCards: ModelValidationCard[];
  currentPolicyHash: string | null;
  currentGraphHash: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Derive the badge for a caller-supplied context (Run & Validate). */
  resolve: (ctx: CredibilityContext) => Credibility;
  /**
   * Lab-side badge derivation (§2.4): exact active-card triple match and not
   * dirty → validated; a card on this policy version with any component
   * mismatched → stale (drift names which); no card → unvalidated. Scenario
   * fingerprints are fetched lazily and cached so this stays synchronous.
   */
  resolveScenario: (
    policyVersionId: string | null | undefined,
    scenario: ScenarioFingerprintInput | null | undefined,
    opts?: { dirty?: boolean },
  ) => Credibility;
  /** Immutable-history badge for a completed run (stamped card + engine check). */
  resolveRun: (run: {
    model_validation_id?: string | null;
    code_version?: string | null;
  } | null | undefined) => Credibility;
  /**
   * Inheritance (§2.6): if the exact active triple (policy version ×
   * current graph × this scenario's baseline fingerprint) is validated and
   * the policy is not dirty, apply the card to the scenario via the ONE
   * server-side inheritance RPC. Returns the applied card id, or null.
   */
  applyIfValidated: (
    scenario: ScenarioFingerprintInput,
    policyVersionId: string | null | undefined,
    opts?: { dirty?: boolean },
  ) => Promise<string | null>;
  /** record_model_validation RPC — supersedes the same-triple active card. */
  record: (args: RecordValidationArgs) => Promise<string>;
  /** revoke_model_validation RPC — status flip, never a delete. */
  revoke: (validationId: string) => Promise<void>;
}

export function useModelValidation(
  projectId: string | null | undefined,
): UseModelValidationResult {
  // WP 6.4 · §4 D71 — `apply_validation_to_scenario` writes `scenarios`, a described
  // tier-4 table since this package, so its audit row has to name somebody.
  const { user } = useAuth();
  const [allCards, setAllCards] = useState<ModelValidationCard[]>([]);
  const [currentPolicyHash, setCurrentPolicyHash] = useState<string | null>(null);
  const [currentGraphHash, setCurrentGraphHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // fingerprintKey(scenario) → scenario_hash (RPC result). A state map so a
  // resolved fingerprint re-renders every consumer of resolveScenario().
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});
  const pendingFp = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Direct SELECT (the table is SELECT-only to clients) — the full-row shape
    // list_model_validations trims is needed here (fingerprint, basis jsonb).
    const [{ data: rows, error }, { data: pHash }, { data: gHash }] = await Promise.all([
      sb
        .from("model_validations")
        .select("*")
        .eq("project_id", projectId)
        .order("validated_at", { ascending: false }),
      sb.rpc("current_policy_hash", { p_project_id: projectId }),
      sb.rpc("current_graph_hash", { p_project_id: projectId }),
    ]);
    if (error) {
      console.error("model_validations load failed", error);
    } else {
      setAllCards((rows ?? []) as ModelValidationCard[]);
    }
    setCurrentPolicyHash((pHash as string | null) ?? null);
    setCurrentGraphHash((gHash as string | null) ?? null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setAllCards([]);
      setCurrentPolicyHash(null);
      setCurrentGraphHash(null);
      setFingerprints({});
      pendingFp.current.clear();
      return;
    }
    void refresh();
  }, [projectId, refresh]);

  // Realtime keeps every badge live: a card recorded (or revoked) anywhere
  // re-derives the state here without a reload (§2.6); policy edits change
  // the current policy hash, which flips badges to stale.
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`model_validations:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "model_validations",
          filter: `project_id=eq.${projectId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "policy_defaults",
          filter: `project_id=eq.${projectId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, refresh]);

  const cards = useMemo(
    () => allCards.filter((c) => c.status === "active"),
    [allCards],
  );

  const resolve = useCallback(
    (ctx: CredibilityContext) => deriveCredibility(allCards, ctx),
    [allCards],
  );

  const ensureFingerprint = useCallback(
    (scenario: ScenarioFingerprintInput) => {
      const key = fingerprintKey(scenario);
      if (fingerprints[key] !== undefined || pendingFp.current.has(key)) return;
      pendingFp.current.add(key);
      void fetchScenarioFingerprintHash(scenario.id).then((hash) => {
        pendingFp.current.delete(key);
        if (!hash) return;
        setFingerprints((cur) => ({ ...cur, [key]: hash }));
      });
    },
    [fingerprints],
  );

  const resolveScenario = useCallback<UseModelValidationResult["resolveScenario"]>(
    (policyVersionId, scenario, opts) => {
      if (!policyVersionId) return { state: "unvalidated" };
      const active = cards.filter(
        (c) => c.verdict === "validated" && c.policy_version_id === policyVersionId,
      );
      if (active.length === 0) return { state: "unvalidated" };

      let scenarioHash: string | null = null;
      if (scenario) {
        scenarioHash = fingerprints[fingerprintKey(scenario)] ?? null;
        if (scenarioHash === null) ensureFingerprint(scenario);
      }

      const dirty = opts?.dirty === true;
      // Prefer the card matching the most components (exact triple first).
      const score = (c: ModelValidationCard) =>
        (currentGraphHash !== null && c.graph_hash === currentGraphHash ? 2 : 0) +
        (scenarioHash !== null && c.scenario_hash === scenarioHash ? 1 : 0);
      const card = [...active].sort((a, b) => score(b) - score(a))[0];

      const drift: DriftComponent[] = [];
      if (dirty) drift.push("policy");
      if (currentGraphHash !== null && card.graph_hash !== currentGraphHash) drift.push("data");
      if (scenarioHash !== null && card.scenario_hash !== scenarioHash) drift.push("scenario");

      if (drift.length === 0) return { state: "validated", card };
      return { state: "stale", card, drift };
    },
    [cards, currentGraphHash, fingerprints, ensureFingerprint],
  );

  const resolveRun = useCallback<UseModelValidationResult["resolveRun"]>(
    (run) => {
      const cardId = run?.model_validation_id ?? null;
      if (!cardId) return { state: "unvalidated" };
      const card = allCards.find((c) => c.id === cardId);
      if (!card) return { state: "unvalidated" };
      // Advisory engine fingerprint (§2.4): the worker stamps code_version on
      // completion; a mismatch with the card's evidence engine renders stale.
      const cv = run?.code_version ?? null;
      if (cv && card.engine_fingerprint && cv !== card.engine_fingerprint) {
        return { state: "stale", card, drift: ["engine"] };
      }
      return { state: "validated", card };
    },
    [allCards],
  );

  const applyIfValidated = useCallback<UseModelValidationResult["applyIfValidated"]>(
    async (scenario, policyVersionId, opts) => {
      if (!policyVersionId || opts?.dirty === true || currentGraphHash === null) return null;
      const candidates = cards.filter(
        (c) =>
          c.verdict === "validated" &&
          c.policy_version_id === policyVersionId &&
          c.graph_hash === currentGraphHash,
      );
      if (candidates.length === 0) return null;
      const hash = await fetchScenarioFingerprintHash(scenario.id);
      if (!hash) return null;
      setFingerprints((cur) => ({ ...cur, [fingerprintKey(scenario)]: hash }));
      const card = candidates.find((c) => c.scenario_hash === hash);
      if (!card) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { error } = await sb.rpc("apply_validation_to_scenario", {
        p_scenario_id: scenario.id,
        p_validation_id: card.id,
        _actor_user_id: user?.id ?? null,   // WP 6.4 · §4 D71
      });
      if (error) {
        console.error("apply_validation_to_scenario failed", error);
        return null;
      }
      return card.id;
    },
    // `user?.id` and not `user`: without it the callback closes over the person who
    // was signed in at first render, so a session change would attribute this write
    // to the previous one (WP 6.2 slice 12's lesson, ten arrays over).
    [cards, currentGraphHash, user?.id],
  );

  const record = useCallback(
    async (args: RecordValidationArgs): Promise<string> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error } = await sb.rpc("record_model_validation", {
        p_project_id: args.projectId,
        p_policy_version_id: args.policyVersionId,
        p_dataset_version_id: args.datasetVersionId,
        p_scenario_id: args.scenarioId,
        p_adopted_warmup_days: args.adoptedWarmupDays,
        p_warmup_method: args.warmupMethod,
        p_recommended_replications: args.recommendedReplications,
        p_replication_basis: args.replicationBasis,
        p_validation_tests: args.validationTests,
        p_findings: args.findings,
        p_verdict: args.verdict,
        p_basis: args.basis,
        p_evidence_run_id: args.evidenceRunId,
        p_user_id: args.userId ?? null,
        p_user_email: args.userEmail ?? null,
      });
      if (error) throw new Error(error.message ?? String(error));
      await refresh();
      return data as string;
    },
    [refresh],
  );

  const revoke = useCallback(
    async (validationId: string): Promise<void> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { error } = await sb.rpc("revoke_model_validation", {
        p_validation_id: validationId,
      });
      if (error) throw new Error(error.message ?? String(error));
      await refresh();
    },
    [refresh],
  );

  return useMemo(
    () => ({
      cards,
      allCards,
      currentPolicyHash,
      currentGraphHash,
      loading,
      refresh,
      resolve,
      resolveScenario,
      resolveRun,
      applyIfValidated,
      record,
      revoke,
    }),
    [
      cards,
      allCards,
      currentPolicyHash,
      currentGraphHash,
      loading,
      refresh,
      resolve,
      resolveScenario,
      resolveRun,
      applyIfValidated,
      record,
      revoke,
    ],
  );
}
