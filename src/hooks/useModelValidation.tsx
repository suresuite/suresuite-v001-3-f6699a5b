import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Model-validation cards — Phase B0 / G13 / §9.5(6).
// Loads the project's model_validations rows (the persisted V&V credibility
// artifact, docs/design/phase-b0-core-loop.md §2) and derives the badge state
// at read time by hash comparison. The three states (validated / stale /
// unvalidated) are NEVER stored — staleness is computed against the current
// context, so reverting a drift self-heals without a new card (§2.4).
// Writes go through the SECURITY DEFINER RPCs only (record / revoke).

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
  /** All ACTIVE cards for the project, newest first. */
  cards: ModelValidationCard[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Derive the badge for a context against the loaded active cards. */
  resolve: (ctx: CredibilityContext) => Credibility;
  /** record_model_validation RPC — supersedes the same-triple active card. */
  record: (args: RecordValidationArgs) => Promise<string>;
  /** revoke_model_validation RPC — status flip, never a delete. */
  revoke: (validationId: string) => Promise<void>;
}

export function useModelValidation(
  projectId: string | null | undefined,
): UseModelValidationResult {
  const [cards, setCards] = useState<ModelValidationCard[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Direct SELECT (the table is SELECT-only to clients) — the full-row shape
    // list_model_validations trims is needed here (fingerprint, basis jsonb).
    const { data, error } = await sb
      .from("model_validations")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "active")
      .order("validated_at", { ascending: false });
    if (error) {
      console.error("model_validations load failed", error);
    } else {
      setCards((data ?? []) as ModelValidationCard[]);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime keeps every badge live: a card recorded (or revoked) anywhere
  // re-derives the state here without a reload (§2.6).
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, refresh]);

  const resolve = useCallback(
    (ctx: CredibilityContext) => deriveCredibility(cards, ctx),
    [cards],
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

  return { cards, loading, refresh, resolve, record, revoke };
}
