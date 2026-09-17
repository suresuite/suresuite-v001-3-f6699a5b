import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Dataset (graph + economics) versioning — Phase A / G5 / §8.4.
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
  author_email: string | null;
  created_at: string;
}

/** Which half of the dataset moved, when that can be told at all. */
export type DirtyDomain = "inputs" | "network" | "both" | null;

interface UseDatasetVersionResult {
  latest: DatasetVersion | null;
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

export function useDatasetVersion(
  projectId: string | null | undefined,
): UseDatasetVersionResult {
  const [latest, setLatest] = useState<DatasetVersion | null>(null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [currentInputs, setCurrentInputs] = useState<string | null>(null);
  const [currentNetwork, setCurrentNetwork] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // `list_dataset_versions` keeps its RETURNS TABLE shape — widening it means
    // DROP + CREATE, which breaks every in-flight caller for the length of a
    // deploy to add two columns readable from the table itself.
    const [{ data: versions }, { data: hash }, { data: hin }, { data: hnet }, { data: row }] =
      await Promise.all([
        sb.rpc("list_dataset_versions", { p_project_id: projectId }),
        sb.rpc("current_graph_hash", { p_project_id: projectId }),
        sb.rpc("current_hash_inputs", { p_project_id: projectId }),
        sb.rpc("current_hash_network", { p_project_id: projectId }),
        sb
          .from("dataset_versions")
          .select("id,hash_inputs,hash_network")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    const head = ((versions as DatasetVersion[] | null) ?? [])[0] ?? null;
    const domains = (row as { hash_inputs?: string | null; hash_network?: string | null } | null);
    setLatest(head ? { ...head, ...(domains ?? {}) } : null);
    setCurrentHash((hash as string | null) ?? null);
    setCurrentInputs((hin as string | null) ?? null);
    setCurrentNetwork((hnet as string | null) ?? null);
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
    latest, currentHash, currentInputs, currentNetwork,
    isDirty, dirtyDomain, neverSnapshotted, loading, refresh, snapshot,
  };
}
