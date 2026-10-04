import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { ValidatedModelProtocol } from "@/lib/sim/validatedModel";
import { engineDifference } from "@/lib/sim/engineBuild";
import { engineChangeSummary } from "@/lib/sim/engineChanges";

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
  // ── WP 10.3 · §4 D243 — the Validated Model's own identity ──────────────
  /** Display name; numbered per project by `version_no`. */
  name?: string | null;
  version_no?: number | null;
  /** How the model is run — `validated_model_protocol_problems` says what is complete. */
  protocol?: ValidatedModelProtocol | null;
  protocol_hash?: string | null;
  /** policy · graph · scenario world · protocol · engine — one hash, one model. */
  model_hash?: string | null;
  engine_id?: string | null;
  /** The recorded statement a face-validated model rests on. */
  face_validation?: string | null;
  revoked_at?: string | null;
  revoke_reason?: string | null;
  // ── WP 11.2 · §4 D259 — the scope the engine READS ────────────────────────
  /** The simulation scope's hash (`hash_inputs` of the snapshot it was validated
   *  on). NULL on a card no snapshot could teach — that card keeps the composite rule. */
  hash_simulation?: string | null;
  simulation_version_id?: string | null;
}

export type DriftComponent = "policy" | "data" | "scenario" | "engine";

/** WP 11.2 — shown beside a badge, never a reason it is stale: `network` means the
 *  composite moved and the simulation's inputs did not — the deep tier, tier 2/3 or
 *  the multi-tier chain changed, none of which the engine reads. */
/** WP 15.6 — the model's engine against the run's, in words: how they differ
 *  (version / build / unknowable) and what the change record says lies between. */
function describeEngineChange(from: string | null, to: string | null): string | null {
  const how = engineDifference(from, to);
  if (!how) return null;
  const between = engineChangeSummary(from, to);
  return between ? `${how}: ${between}` : how;
}

export type CredibilityNote = "network";

export type Credibility =
  | { state: "unvalidated" }
  | { state: "validated"; card: ModelValidationCard; notes?: CredibilityNote[] }
  | {
      state: "stale";
      card: ModelValidationCard;
      drift: DriftComponent[];
      notes?: CredibilityNote[];
      /** WP 15.6 · §4 D296 — what lies between the model's engine and the run's, in words
       *  (from the change record). Present only with `engine` drift. It never clears it. */
      engineChange?: string;
    };

/** The current context a card is compared against (all hashes read live).
 *
 *  WP 10.2 · §4 D242 — a card is matched by CONTENT: `policyHash`, not
 *  `policyVersionId`. Two version rows with one hash are one model, and matching
 *  by id is what made a freshly opened Lab read every validated model as
 *  unvalidated. */
export interface CredibilityContext {
  /** current_policy_hash of the policies in context; null = not loaded yet. When
   *  omitted, the hook's own `currentPolicyHash` is used. */
  policyHash?: string | null;
  /** For display only — never compared. */
  policyVersionId?: string | null;
  /** Kept for callers; the policy component is decided by `policyHash` alone. */
  policyDirty?: boolean;
  /** current_graph_hash (useDatasetVersion.currentHash) — the composite. Since WP
   *  11.2 it decides `data` drift only for a card with no simulation hash. */
  graphHash: string | null;
  /** WP 11.2 · the simulation scope's live hash (useDatasetVersion.currentInputs).
   *  Undefined = not supplied (the hook's own is used); null = not loaded yet. */
  simulationHash?: string | null;
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

/** Save Validated Model (WP 10.3): `record_validated_model`, which enforces the
 *  adoption rule and a complete protocol server-side as well. */
export interface RecordValidatedModelArgs {
  projectId: string;
  policyVersionId: string;
  datasetVersionId: string;
  scenarioId: string;
  name: string;
  protocol: ValidatedModelProtocol;
  warmupMethod: "engine" | "welch" | "mser5";
  replicationBasis: Record<string, unknown>;
  validationTests: unknown[];
  findings: unknown[];
  basis: "statistical" | "face";
  faceValidation: string | null;
  evidenceRunId: string | null;
  /** warm-up series + detector outputs, replication analysis, run ids. */
  evidence: Record<string, unknown>;
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

/**
 * WP 11.2 · §4 D259 — are a card's INPUTS the live ones? A card binds the scope the
 * engine reads (`hash_simulation`), so a deep-tier upload the engine never reads does
 * not make it a different model. A card that could not learn that hash (no snapshot)
 * keeps the composite rule. `null` = the live hash it needs is not loaded yet, which
 * is never drift.
 */
export function cardInputsMatch(
  card: Pick<ModelValidationCard, "hash_simulation" | "graph_hash">,
  ctx: { graphHash: string | null; simulationHash?: string | null },
): boolean | null {
  if (card.hash_simulation) {
    return ctx.simulationHash == null ? null : card.hash_simulation === ctx.simulationHash;
  }
  return ctx.graphHash === null ? null : card.graph_hash === ctx.graphHash;
}

/** Badge derivation (§2.4): one stored fact, three derived states.
 *
 *  By content (WP 10.2): the cards whose `policy_hash` IS the live policy hash
 *  are this model's; among them the one matching the most of graph and scenario
 *  wins. When the live policies match NO card, the newest validated card is
 *  still reported — as STALE with `policy` drift, which is what "you changed the
 *  policies since validating" means — so an edit reads stale, not unvalidated. */
export function deriveCredibility(
  cards: ModelValidationCard[],
  ctx: CredibilityContext,
): Credibility {
  const policyHash = ctx.policyHash ?? null;
  // Null means "not loaded yet": no badge rather than a flash of a wrong one.
  if (!policyHash) return { state: "unvalidated" };
  const validated = cards
    .filter((c) => c.status === "active" && c.verdict === "validated")
    .sort((a, b) => (a.validated_at < b.validated_at ? 1 : a.validated_at > b.validated_at ? -1 : 0));
  if (validated.length === 0) return { state: "unvalidated" };

  const exact = validated.filter((c) => c.policy_hash === policyHash);
  const pool = exact.length > 0 ? exact : validated;
  const score = (c: ModelValidationCard) =>
    (cardInputsMatch(c, ctx) === true ? 2 : 0) +
    (ctx.scenarioHash !== null && c.scenario_hash === ctx.scenarioHash ? 1 : 0);
  // Stable: `pool` is newest-first, so equal scores keep the newest card.
  const card = pool.reduce((best, c) => (score(c) > score(best) ? c : best), pool[0]);

  // null current hashes mean "not loaded yet", not drift — skip those
  // comparisons rather than flashing a false stale state while loading.
  const drift: DriftComponent[] = [];
  if (exact.length === 0) drift.push("policy");
  if (cardInputsMatch(card, ctx) === false) {
    drift.push("data");
  }
  // The composite moved and the inputs did not: shown, never a reason to re-validate.
  const notes: CredibilityNote[] =
    card.hash_simulation && cardInputsMatch(card, ctx) === true &&
      ctx.graphHash !== null && ctx.graphHash !== card.graph_hash
      ? ["network"]
      : [];
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
  const withNotes = notes.length > 0 ? { notes } : {};
  const engineChange = drift.includes("engine")
    ? describeEngineChange(card.engine_fingerprint, ctx.runCodeVersion ?? null)
    : null;
  return drift.length === 0
    ? { state: "validated", card, ...withNotes }
    : { state: "stale", card, drift, ...withNotes, ...(engineChange ? { engineChange } : {}) };
}

export interface UseModelValidationResult {
  /** ACTIVE cards for the project, newest first (the Run & Validate surface). */
  cards: ModelValidationCard[];
  /** Every card regardless of status — run badges need superseded ones too. */
  allCards: ModelValidationCard[];
  currentPolicyHash: string | null;
  currentGraphHash: string | null;
  /** WP 11.2 · the simulation scope's live hash — what a card's inputs are matched on. */
  currentSimulationHash: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Derive the badge for a caller-supplied context (Run & Validate). */
  resolve: (ctx: CredibilityContext) => Credibility;
  /**
   * Lab-side badge derivation (§2.4), by content (WP 10.2): the live policy
   * hash, the current graph hash and this scenario's fingerprint against the
   * project's cards — `deriveCredibility`, with the scenario fingerprint fetched
   * lazily and cached so this stays synchronous. `policyHash` undefined = use
   * the hook's own `currentPolicyHash`.
   */
  resolveScenario: (
    policyHash: string | null | undefined,
    scenario: ScenarioFingerprintInput | null | undefined,
  ) => Credibility;
  /** Immutable-history badge for a completed run (stamped card + engine check). */
  resolveRun: (run: {
    model_validation_id?: string | null;
    code_version?: string | null;
  } | null | undefined) => Credibility;
  /**
   * Inheritance (§2.6): if the exact active CONTENT triple (live policy hash ×
   * current graph × this scenario's baseline fingerprint) is validated, apply
   * the card to the scenario via the ONE server-side inheritance RPC, which
   * re-checks the same triple. Returns the applied card id, or null.
   */
  applyIfValidated: (
    scenario: ScenarioFingerprintInput,
    policyHash: string | null | undefined,
  ) => Promise<string | null>;
  /** record_model_validation RPC — supersedes the same-triple active card. */
  record: (args: RecordValidationArgs) => Promise<string>;
  /** record_validated_model RPC — Save Validated Model (WP 10.3). */
  recordValidatedModel: (args: RecordValidatedModelArgs) => Promise<string>;
  /** revoke_model_validation RPC — status flip, never a delete. */
  revoke: (validationId: string, reason?: string) => Promise<void>;
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
  const [currentSimulationHash, setCurrentSimulationHash] = useState<string | null>(null);
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
    // WP 11.2 — ONE stored-hash read gives the composite and the simulation scope
    // together (`project_graph_hashes`), so the two cannot come from different worlds.
    const [{ data: rows, error }, { data: pHash }, { data: hashes }] = await Promise.all([
      sb
        .from("model_validations")
        .select("*")
        .eq("project_id", projectId)
        .order("validated_at", { ascending: false }),
      sb.rpc("current_policy_hash", { p_project_id: projectId }),
      sb.rpc("project_graph_hashes", { p_project_id: projectId }),
    ]);
    const h = (hashes ?? {}) as { graph_hash?: string | null; hash_inputs?: string | null };
    if (error) {
      console.error("model_validations load failed", error);
    } else {
      setAllCards((rows ?? []) as ModelValidationCard[]);
    }
    setCurrentPolicyHash((pHash as string | null) ?? null);
    setCurrentGraphHash(h.graph_hash ?? null);
    setCurrentSimulationHash(h.hash_inputs ?? null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setAllCards([]);
      setCurrentPolicyHash(null);
      setCurrentGraphHash(null);
      setCurrentSimulationHash(null);
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
      // Overrides are half of the policy content the card is matched on (WP 10.2):
      // without this, a node-level edit left the badge on the old hash.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "policy_overrides",
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
    (ctx: CredibilityContext) =>
      deriveCredibility(allCards, {
        ...ctx,
        policyHash: ctx.policyHash === undefined ? currentPolicyHash : ctx.policyHash,
        simulationHash: ctx.simulationHash === undefined ? currentSimulationHash : ctx.simulationHash,
      }),
    [allCards, currentPolicyHash, currentSimulationHash],
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
    (policyHash, scenario) => {
      let scenarioHash: string | null = null;
      if (scenario) {
        scenarioHash = fingerprints[fingerprintKey(scenario)] ?? null;
        if (scenarioHash === null) ensureFingerprint(scenario);
      }
      return deriveCredibility(allCards, {
        policyHash: policyHash === undefined ? currentPolicyHash : policyHash,
        graphHash: currentGraphHash,
        simulationHash: currentSimulationHash,
        scenarioHash,
      });
    },
    [allCards, currentPolicyHash, currentGraphHash, currentSimulationHash, fingerprints, ensureFingerprint],
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
        const engineChange = describeEngineChange(card.engine_fingerprint, cv);
        return { state: "stale", card, drift: ["engine"], ...(engineChange ? { engineChange } : {}) };
      }
      return { state: "validated", card };
    },
    [allCards],
  );

  const applyIfValidated = useCallback<UseModelValidationResult["applyIfValidated"]>(
    async (scenario, policyHashArg) => {
      const policyHash = policyHashArg === undefined ? currentPolicyHash : policyHashArg;
      if (!policyHash || currentGraphHash === null) return null;
      // Matched on the INPUTS (WP 11.2), as `apply_validation_to_scenario` re-checks.
      const candidates = cards.filter(
        (c) =>
          c.verdict === "validated" &&
          c.policy_hash === policyHash &&
          cardInputsMatch(c, { graphHash: currentGraphHash, simulationHash: currentSimulationHash }) === true,
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
    [cards, currentPolicyHash, currentGraphHash, currentSimulationHash, user?.id],
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

  const recordValidatedModel = useCallback(
    async (args: RecordValidatedModelArgs): Promise<string> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error } = await sb.rpc("record_validated_model", {
        p_project_id: args.projectId,
        p_policy_version_id: args.policyVersionId,
        p_dataset_version_id: args.datasetVersionId,
        p_scenario_id: args.scenarioId,
        p_name: args.name,
        p_protocol: args.protocol,
        p_warmup_method: args.warmupMethod,
        p_replication_basis: args.replicationBasis,
        p_validation_tests: args.validationTests,
        p_findings: args.findings,
        p_basis: args.basis,
        p_face_validation: args.faceValidation,
        p_evidence_run_id: args.evidenceRunId,
        p_evidence: args.evidence,
        _actor_user_id: user?.id ?? null,
        p_user_email: args.userEmail ?? null,
      });
      if (error) throw new Error(error.message ?? String(error));
      await refresh();
      return data as string;
    },
    [refresh, user?.id],
  );

  const revoke = useCallback(
    async (validationId: string, reason?: string): Promise<void> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { error } = await sb.rpc("revoke_model_validation", {
        p_validation_id: validationId,
        _actor_user_id: user?.id ?? null,
        p_reason: reason ?? null,
      });
      if (error) throw new Error(error.message ?? String(error));
      await refresh();
    },
    [refresh, user?.id],
  );

  return useMemo(
    () => ({
      cards,
      allCards,
      currentPolicyHash,
      currentGraphHash,
      currentSimulationHash,
      loading,
      refresh,
      resolve,
      resolveScenario,
      resolveRun,
      applyIfValidated,
      record,
      recordValidatedModel,
      revoke,
    }),
    [
      cards,
      allCards,
      currentPolicyHash,
      currentGraphHash,
      currentSimulationHash,
      loading,
      refresh,
      resolve,
      resolveScenario,
      resolveRun,
      applyIfValidated,
      record,
      recordValidatedModel,
      revoke,
    ],
  );
}
