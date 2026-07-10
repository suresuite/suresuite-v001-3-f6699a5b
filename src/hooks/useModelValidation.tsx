import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Model-validation cards — Phase B0 / G13 / §9.5
// (design: docs/design/phase-b0-core-loop.md §2.4–§2.6).
//
// Mirrors useDatasetVersion: loads the project's model_validations cards plus
// current_policy_hash / current_graph_hash, and derives the badge state at
// read time by comparing hashes — staleness is NEVER stored (§2.4). Scenario
// fingerprints come from the scenario_fingerprint_hash RPC (the single
// canonicalization point); they are cached per scenario keyed by the fields
// the fingerprint covers, so `resolve` stays synchronous.

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
  replication_basis: Record<string, unknown>;
  validation_tests: Array<Record<string, unknown>>;
  findings_snapshot: Array<Record<string, unknown>>;
  verdict: "validated" | "rejected";
  basis: "statistical" | "face";
  evidence_run_id: string | null;
  status: "active" | "superseded" | "revoked";
  superseded_by: string | null;
  validated_at: string;
  author_email: string | null;
  created_at: string;
}

export type DriftComponent = "policy" | "data" | "scenario" | "engine";

export type Credibility =
  | { state: "unvalidated" }
  | { state: "validated"; card: ModelValidationCard }
  | { state: "stale"; card: ModelValidationCard; drift: DriftComponent[] };

/** The world-model fields the baseline fingerprint covers (§2.3). */
export interface ScenarioFingerprintInput {
  id: string;
  horizon_days: number;
  time_step: string;
  demand_model: Record<string, unknown>;
}

const fingerprintKey = (s: ScenarioFingerprintInput) =>
  `${s.id}:${s.horizon_days}:${s.time_step}:${JSON.stringify(s.demand_model ?? {})}`;

interface UseModelValidationResult {
  /** All cards for the project (any status) — run badges need superseded ones too. */
  cards: ModelValidationCard[];
  currentPolicyHash: string | null;
  currentGraphHash: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /**
   * Badge derivation (§2.4): exact active-card triple match and not dirty →
   * validated; a card on this policy version with any component mismatched →
   * stale (drift names which); no card in the version's lineage → unvalidated.
   */
  resolve: (
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export function useModelValidation(
  projectId: string | null | undefined,
): UseModelValidationResult {
  const [cards, setCards] = useState<ModelValidationCard[]>([]);
  const [currentPolicyHash, setCurrentPolicyHash] = useState<string | null>(null);
  const [currentGraphHash, setCurrentGraphHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // fingerprintKey(scenario) → scenario_hash (RPC result). A state map so a
  // resolved fingerprint re-renders every consumer of resolve().
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});
  const pendingFp = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const [{ data: rows }, { data: pHash }, { data: gHash }] = await Promise.all([
      sb
        .from("model_validations")
        .select("*")
        .eq("project_id", projectId)
        .order("validated_at", { ascending: false }),
      sb.rpc("current_policy_hash", { p_project_id: projectId }),
      sb.rpc("current_graph_hash", { p_project_id: projectId }),
    ]);
    setCards((rows ?? []) as ModelValidationCard[]);
    setCurrentPolicyHash((pHash as string | null) ?? null);
    setCurrentGraphHash((gHash as string | null) ?? null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setCards([]);
      setCurrentPolicyHash(null);
      setCurrentGraphHash(null);
      setFingerprints({});
      pendingFp.current.clear();
      return;
    }
    void refresh();
    // Realtime on the card table AND on the six graded tables' proxy hashes:
    // dataset/policy edits change current hashes, which flips badges to stale.
    const ch = sb
      .channel(`model_validations:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "model_validations", filter: `project_id=eq.${projectId}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "policy_defaults", filter: `project_id=eq.${projectId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [projectId, refresh]);

  const ensureFingerprint = useCallback(
    (scenario: ScenarioFingerprintInput) => {
      const key = fingerprintKey(scenario);
      if (fingerprints[key] !== undefined || pendingFp.current.has(key)) return;
      pendingFp.current.add(key);
      void sb
        .rpc("scenario_fingerprint_hash", { p_scenario_id: scenario.id })
        .then(({ data, error }: { data: string | null; error: unknown }) => {
          pendingFp.current.delete(key);
          if (error || !data) return;
          setFingerprints((cur) => ({ ...cur, [key]: data }));
        });
    },
    [fingerprints],
  );

  const resolve = useCallback<UseModelValidationResult["resolve"]>(
    (policyVersionId, scenario, opts) => {
      if (!policyVersionId) return { state: "unvalidated" };
      const active = cards.filter(
        (c) =>
          c.status === "active" &&
          c.verdict === "validated" &&
          c.policy_version_id === policyVersionId,
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
      const card = cards.find((c) => c.id === cardId);
      if (!card) return { state: "unvalidated" };
      // Advisory engine fingerprint (§2.4): the worker stamps code_version on
      // completion; a mismatch with the card's evidence engine renders stale.
      const cv = run?.code_version ?? null;
      if (cv && card.engine_fingerprint && cv !== card.engine_fingerprint) {
        return { state: "stale", card, drift: ["engine"] };
      }
      return { state: "validated", card };
    },
    [cards],
  );

  const applyIfValidated = useCallback<UseModelValidationResult["applyIfValidated"]>(
    async (scenario, policyVersionId, opts) => {
      if (!policyVersionId || opts?.dirty === true || currentGraphHash === null) return null;
      const candidates = cards.filter(
        (c) =>
          c.status === "active" &&
          c.verdict === "validated" &&
          c.policy_version_id === policyVersionId &&
          c.graph_hash === currentGraphHash,
      );
      if (candidates.length === 0) return null;
      const { data: hash, error: fpErr } = await sb.rpc("scenario_fingerprint_hash", {
        p_scenario_id: scenario.id,
      });
      if (fpErr || !hash) return null;
      setFingerprints((cur) => ({ ...cur, [fingerprintKey(scenario)]: hash as string }));
      const card = candidates.find((c) => c.scenario_hash === hash);
      if (!card) return null;
      const { error } = await sb.rpc("apply_validation_to_scenario", {
        p_scenario_id: scenario.id,
        p_validation_id: card.id,
      });
      if (error) {
        console.error("apply_validation_to_scenario failed", error);
        return null;
      }
      return card.id;
    },
    [cards, currentGraphHash],
  );

  return useMemo(
    () => ({ cards, currentPolicyHash, currentGraphHash, loading, refresh, resolve, resolveRun, applyIfValidated }),
    [cards, currentPolicyHash, currentGraphHash, loading, refresh, resolve, resolveRun, applyIfValidated],
  );
}
