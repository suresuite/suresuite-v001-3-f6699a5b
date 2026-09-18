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
 * The digest of what the two centrality analyzers actually read.
 *
 * It is a SEPARATE ROUND TRIP rather than something the store computes inside
 * `analysis_get_or_start`, and that is deliberate: `predict-critical-nodes`
 * reads `supply_chain_data` and has no topology to digest, so folding it into
 * the store would make every analysis pay for one analyzer's blind spot.
 *
 * See `20260917000007`'s header for why this travels in `params` and not in
 * `graph_hash`: it belongs in `hash_network`, moving it there is a
 * `schema_version` bump, and a bump is unsafe until D70 lands in WP 4.4.
 */
export async function topologyDigest(
  client: StoreClient,
  projectId: string,
): Promise<string> {
  const { data, error } = await client.rpc("network_topology_hash", { p_project_id: projectId });
  if (error) {
    throw new Error(
      `network_topology_hash failed for project ${projectId}: ${error.message ?? error}. ` +
        `Without it the analysis cannot state which graph it ran against, and a ` +
        `cached answer keyed on graph_hash alone would be served for a graph that ` +
        `has changed (WP 4.3).`,
    );
  }
  return String(data);
}

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
