import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Dataset (graph + economics) versioning — Phase A / G5 / §8.4.
// Mirrors the policy_hash dirty-detection in usePolicies, for the six tables
// the engine consumes. A run is stamped with dataset_version_id + graph_hash
// server-side in sim-command; this hook surfaces the current state so a
// re-uploaded CSV is visible rather than silently changing history.

export interface DatasetVersion {
  id: string;
  label: string | null;
  graph_hash: string | null;
  author_email: string | null;
  created_at: string;
}

interface UseDatasetVersionResult {
  latest: DatasetVersion | null;
  currentHash: string | null;
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
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [{ data: versions }, { data: hash }] = await Promise.all([
      sb.rpc("list_dataset_versions", { p_project_id: projectId }),
      sb.rpc("current_graph_hash", { p_project_id: projectId }),
    ]);
    setLatest(((versions as DatasetVersion[] | null) ?? [])[0] ?? null);
    setCurrentHash((hash as string | null) ?? null);
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

  return { latest, currentHash, isDirty, neverSnapshotted, loading, refresh, snapshot };
}
