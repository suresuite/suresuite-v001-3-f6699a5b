/**
 * WP 4.3 · THE CLIENT SIDE OF WP 4.2's STORE, WRITTEN ONCE.
 *
 * Three analyzers run the same five steps — claim a key, compute, mirror onto
 * the entity rows, complete the run, fail it if the compute threw — and §11's
 * "shared getOrCompute" is that sequence. Three copies of it would diverge
 * within a quarter; `columnSpecs.defaultWhenMissing` versus the Zod bundle
 * (WP 6.2) is what two copies of one table look like after a year.
 *
 * WHY THE CALLER STILL COMPUTES. The store cannot: the analyses live in Deno and
 * in Python. So the primitive is LOOKUP-OR-CLAIM (`20260917000006`'s own header),
 * and this module is the loop around it rather than a `getOrCompute` that hides
 * where the work happens.
 *
 * WHAT IT WILL NOT DO IS SWALLOW A FAILED CLAIM. If the RPC errors, the analyzer
 * must fail loudly: an analysis that quietly runs without a run row is exactly
 * the state D19 describes — a number on an entity column that nothing can
 * attribute — and WP 4.3 exists to end it, not to make it optional.
 */

export interface RunHandle {
  runId: string;
  cacheHit: boolean;
  status: "running" | "succeeded" | "failed";
  inputHash: string;
  /** The level `inputHash` is the hash of — `product`, `process`, `firm` or `all`
   *  — resolved by the store from `analysis_kinds` (WP 10.1). An analyzer with a
   *  declared fallback reads the graph this names; it does not decide for itself. */
  inputScope: "product" | "process" | "firm" | "all";
  /** The graph version the run computes over ("Graph vN"). */
  datasetVersionId: string | null;
  paramsHash: string;
  codeVersion: string;
  /** Present on a hit; the stored answer's shape, not the answer itself. */
  rowCounts?: Record<string, unknown>;
  warnings?: unknown[];
  /** True when another request won the key while this one was looking it up. */
  claimedByOther?: boolean;
}

/** What a supabase-js client returns from `.rpc()`, narrowed to what is used. */
export interface RpcResult {
  data: unknown;
  error: { message?: string } | null;
}

export interface StoreClient {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
}

/** The RPCs all return a jsonb object; this is the one cast, in one place. */
function asRecord(data: unknown): Record<string, unknown> {
  return (data ?? {}) as Record<string, unknown>;
}

/**
 * `topologyDigest` STOOD HERE (WP 4.3) and is gone (WP 10.1, §4 D240). It carried
 * the deep-tier topology in `params` because the anchor could not see it; the
 * anchor has seen it since WP 5.3, and since WP 10.1 a run is keyed on the LEVEL
 * its kind reads — the firm level for the two centrality kinds — so the digest only
 * split the cache. Which level a kind reads is stated once, in `analysis_kinds`,
 * and comes back on the handle as `inputScope`.
 */

/** Claim the key, or learn that somebody already answered it. */
export async function getOrStart(
  client: StoreClient,
  args: {
    projectId: string;
    analysisKind: string;
    params: Record<string, unknown>;
    codeVersion: string;
    actorUserId: string;
  },
): Promise<RunHandle> {
  if (!args.actorUserId) {
    throw new Error(
      `${args.analysisKind}: uploaded_by is required — a tier-3 write must name ` +
        `its actor (invariant audit-actor, G4).`,
    );
  }
  const { data, error } = await client.rpc("analysis_get_or_start", {
    _project_id: args.projectId,
    _analysis_kind: args.analysisKind,
    _params: args.params,
    _code_version: args.codeVersion,
    _actor_user_id: args.actorUserId,
  });
  if (error) throw new Error(`analysis_get_or_start(${args.analysisKind}) failed: ${error.message ?? error}`);

  const row = asRecord(data);
  return {
    runId: row.run_id as string,
    cacheHit: Boolean(row.cache_hit),
    status: row.status as RunHandle["status"],
    inputHash: row.input_hash as string,
    inputScope: ((row.input_scope as string) ?? "all") as RunHandle["inputScope"],
    datasetVersionId: (row.dataset_version_id as string | null) ?? null,
    paramsHash: row.params_hash as string,
    codeVersion: row.code_version as string,
    rowCounts: (row.row_counts as Record<string, unknown>) ?? undefined,
    warnings: (row.warnings as unknown[]) ?? undefined,
    claimedByOther: (row.claimed_by_other as boolean) ?? undefined,
  };
}

/**
 * The entity half of the dual-write: one statement, stamped with the run's own
 * `input_hash`. The hash is NOT a parameter — `analysis_apply_node_metrics`
 * reads it off the run — so the mirror cannot claim a world the run never saw.
 */
export async function applyNodeMetrics(
  client: StoreClient,
  runId: string,
  actorUserId: string,
  metrics: Array<Record<string, unknown>>,
): Promise<number> {
  const { data, error } = await client.rpc("analysis_apply_node_metrics", {
    _run_id: runId,
    _metrics: metrics,
    _actor_user_id: actorUserId,
  });
  if (error) throw new Error(`analysis_apply_node_metrics failed: ${error.message ?? error}`);
  return Number(asRecord(data).rows_updated ?? 0);
}

/** The store half. Immutable once written — WP 4.2 refuses a second call. */
export async function completeRun(
  client: StoreClient,
  runId: string,
  actorUserId: string,
  results: Array<{ entity_type: string; entity_id: string; metrics: Record<string, unknown> }>,
  rowCounts: Record<string, unknown>,
  warnings: unknown[] = [],
): Promise<number> {
  const { data, error } = await client.rpc("analysis_complete_run", {
    _run_id: runId,
    _results: results,
    _row_counts: rowCounts,
    _warnings: warnings,
    _actor_user_id: actorUserId,
  });
  if (error) throw new Error(`analysis_complete_run failed: ${error.message ?? error}`);
  return Number(asRecord(data).results_written ?? 0);
}

/**
 * A run that died stays as a ROW — nothing is deleted — but outside the partial
 * unique index, so the key is free and a retry is possible. Failing to record
 * the failure is worse than the failure: it leaves a `running` row owning the
 * key forever, and the next request waits on an analysis nobody is running.
 */
export async function failRun(
  client: StoreClient,
  runId: string,
  actorUserId: string,
  warnings: unknown[],
): Promise<void> {
  const { error } = await client.rpc("analysis_fail_run", {
    _run_id: runId,
    _warnings: warnings,
    _actor_user_id: actorUserId,
  });
  if (error) console.error("analysis_fail_run also failed", error);
}
