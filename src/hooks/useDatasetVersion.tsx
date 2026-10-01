import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseLevelStates, type LevelStates } from "@/lib/trust/graphLevels";

// Dataset (graph + economics) versioning — Phase A / G5 / §8.4; one read and
// numbered graph versions since WP 10.1.
// Mirrors the policy_hash dirty-detection in usePolicies, for every tier-2
// input table (WP 4.1; it was six hand-picked tables and missed the deep BOM
// the engine PREFERS — §4 D11). A run is stamped with dataset_version_id +
// graph_hash server-side in sim-command; this hook surfaces the current state
// so a re-uploaded CSV is visible rather than silently changing history.
//
// `dirtyDomain` says WHICH HALF MOVED, and the distinction is not cosmetic:
// `inputs` dirty means a completed run cannot be reproduced; `network` dirty
// means a multi-tier ANALYSIS is stale and no simulation changed. Telling a
// user to re-run everything because a deep-tier upload landed would be a false
// alarm, and a badge that cannot tell the two apart has to raise it.
//
// It is `null` for a project whose latest version predates WP 4.1: those rows
// have no domain hashes and nothing can backfill them (the v1 snapshot has no
// `network` key). `null` there means UNKNOWN, not "nothing moved" — the
// composite still says whether the project is dirty at all.

export interface DatasetVersion {
  id: string;
  label: string | null;
  graph_hash: string | null;
  /** NULL on a version frozen before WP 4.1; not backfillable. */
  hash_inputs?: string | null;
  hash_network?: string | null;
  /** WP 10.1 · the three level hashes; NULL where the snapshot cannot support one. */
  hash_product?: string | null;
  hash_process?: string | null;
  hash_firm?: string | null;
  /** "Graph v7" — one number per content per project (WP 10.1). */
  version_no?: number | null;
  /** WP 11.1 · the snapshot's TUPLE — its level versions (`graph_level_versions`). */
  product_version_id?: string | null;
  process_version_id?: string | null;
  firm_version_id?: string | null;
  author_email: string | null;
  created_at: string;
}

/** Which half of the dataset moved, when that can be told at all. */
export type DirtyDomain = "inputs" | "network" | "both" | null;

/** Every hash of the project's LIVE data, as `project_graph_hashes` returns it. */
export interface GraphHashes {
  graph_hash: string | null;
  hash_inputs: string | null;
  hash_network: string | null;
  hash_product: string | null;
  hash_process: string | null;
  hash_firm: string | null;
  computed_at: string | null;
}

interface UseDatasetVersionResult {
  latest: DatasetVersion | null;
  /** The saved version whose content IS the live data ("Graph v7"), or null. */
  currentVersion: { id: string; version_no: number | null; label: string | null; created_at: string } | null;
  current: GraphHashes | null;
  /** WP 11.1 · §4 D258 — each level's own version ("Product graph v3"), from the
   *  same read. Empty on a database before WP 11.1. */
  levels: LevelStates;
  currentHash: string | null;
  currentInputs: string | null;
  currentNetwork: string | null;
  dirtyDomain: DirtyDomain;
  /** true once a snapshot exists and the live data no longer matches it. */
  isDirty: boolean;
  /** true when the project has never been snapshotted. */
  neverSnapshotted: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  snapshot: () => Promise<string | null>;
}

type StateRow = {
  current?: Partial<GraphHashes> | null;
  current_version?: UseDatasetVersionResult["currentVersion"];
  latest?: DatasetVersion | null;
  levels?: unknown;
};

/**
 * WP 10.1 · §4 D233 — ONE READ. `get_graph_version_state` returns every hash of
 * the live data from the STORED state (`project_graph_state`), the version that
 * content is, and the latest version. This hook made three hash calls on every
 * mount — three full rebuilds of a thirteen-table snapshot — plus two reads.
 *
 * Exported for the test that pins it: a reload is one RPC, never a rebuild per hash.
 */
export async function readGraphVersionState(projectId: string): Promise<StateRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb.rpc("get_graph_version_state", { p_project_id: projectId });
  if (error) {
    console.error("get_graph_version_state failed", error);
    return null;
  }
  return (data as StateRow | null) ?? null;
}

export function useDatasetVersion(
  projectId: string | null | undefined,
): UseDatasetVersionResult {
  const [latest, setLatest] = useState<DatasetVersion | null>(null);
  const [current, setCurrent] = useState<GraphHashes | null>(null);
  const [currentVersion, setCurrentVersion] = useState<UseDatasetVersionResult["currentVersion"]>(null);
  const [levels, setLevels] = useState<LevelStates>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const row = await readGraphVersionState(projectId);
    const c = row?.current ?? null;
    setCurrent(c ? {
      graph_hash: c.graph_hash ?? null,
      hash_inputs: c.hash_inputs ?? null,
      hash_network: c.hash_network ?? null,
      hash_product: c.hash_product ?? null,
      hash_process: c.hash_process ?? null,
      hash_firm: c.hash_firm ?? null,
      computed_at: c.computed_at ?? null,
    } : null);
    setLatest(row?.latest ?? null);
    setCurrentVersion(row?.current_version ?? null);
    setLevels(parseLevelStates(row?.levels));
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const snapshot = useCallback(async (): Promise<string | null> => {
    if (!projectId) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data, error } = await sb.rpc("snapshot_dataset", { p_project_id: projectId });
    if (error) {
      console.error("snapshot_dataset failed", error);
      return null;
    }
    await refresh();
    return (data as string | null) ?? null;
  }, [projectId, refresh]);

  const currentHash = current?.graph_hash ?? null;
  const currentInputs = current?.hash_inputs ?? null;
  const currentNetwork = current?.hash_network ?? null;
  const neverSnapshotted = latest === null;
  const isDirty =
    latest !== null && currentHash !== null && latest.graph_hash !== currentHash;

  // Only answerable when BOTH sides have the domain hashes. A v1 version has
  // neither, so the honest answer is `null` rather than a guess that reads like
  // a measurement (§5 T1).
  const dirtyDomain: DirtyDomain = (() => {
    if (!isDirty || !latest?.hash_inputs || !latest?.hash_network) return null;
    if (currentInputs === null || currentNetwork === null) return null;
    const inputsMoved = latest.hash_inputs !== currentInputs;
    const networkMoved = latest.hash_network !== currentNetwork;
    if (inputsMoved && networkMoved) return "both";
    if (inputsMoved) return "inputs";
    if (networkMoved) return "network";
    // Dirty overall but neither domain moved: the composite includes
    // schema_version, so this is what a SNAPSHOT VERSION BUMP looks like and it
    // is not a data change. Saying `null` would report it as unknowable.
    return "both";
  })();

  return {
    latest, currentVersion, current, levels, currentHash, currentInputs, currentNetwork,
    isDirty, dirtyDomain, neverSnapshotted, loading, refresh, snapshot,
  };
}
