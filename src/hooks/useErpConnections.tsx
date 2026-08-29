import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MappingWarning } from "@/hooks/useSimulationRun";

/** One project<->external-ERP-company link (plan §6b). */
export interface ProjectErpLink {
  id: string;
  project_id: string;
  external_system: string;
  external_company_id: string;
  external_company_name: string | null;
  status: "active" | "needs_attention" | "revoked";
  status_detail: string | null;
  last_verified_at: string | null;
  auto_apply_threshold_pct: number;
  created_at: string;
}

/** One sync attempt + its Sync Mapping Report (plan §6c.1). */
export interface ErpSyncRun {
  id: string;
  link_id: string;
  triggered_by: "manual" | "scheduled";
  status: "running" | "staged" | "applied" | "failed" | "skipped";
  rows_fetched: Record<string, number>;
  rows_new: number;
  rows_changed: number;
  rows_unchanged: number;
  rows_removed: number;
  mapping_warnings: MappingWarning[];
  fields_mapped: number;
  fields_defaulted: number;
  fields_failed: number;
  applied_at: string | null;
  error_detail: string | null;
  created_at: string;
}

export function useErpConnections(projectId: string | null) {
  const [links, setLinks] = useState<ProjectErpLink[]>([]);
  const [runsByLink, setRunsByLink] = useState<Record<string, ErpSyncRun[]>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data: linkRows } = await supabase
      .from("project_erp_links")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    setLinks((linkRows as ProjectErpLink[]) ?? []);

    if (linkRows?.length) {
      const { data: runRows } = await supabase
        .from("erp_sync_runs")
        .select("*")
        .in("link_id", linkRows.map((l) => l.id))
        .order("created_at", { ascending: false });
      const grouped: Record<string, ErpSyncRun[]> = {};
      for (const run of (runRows as ErpSyncRun[]) ?? []) {
        (grouped[run.link_id] ??= []).push(run);
      }
      setRunsByLink(grouped);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const triggerSync = useCallback(
    async (linkId: string) => {
      const { error } = await supabase.functions.invoke("erp-sync-orbit-mrp", {
        body: { action: "sync", link_id: linkId },
      });
      await refresh();
      return { error };
    },
    [refresh],
  );

  const applySync = useCallback(
    async (runId: string) => {
      const { error } = await supabase.functions.invoke("erp-sync-orbit-mrp", {
        body: { action: "apply", run_id: runId },
      });
      await refresh();
      return { error };
    },
    [refresh],
  );

  const revokeLink = useCallback(
    async (linkId: string) => {
      const { error } = await supabase
        .from("project_erp_links")
        .update({ status: "revoked", revoked_at: new Date().toISOString(), status_detail: "Revoked by user" })
        .eq("id", linkId);
      await refresh();
      return { error };
    },
    [refresh],
  );

  return { links, runsByLink, loading, refresh, triggerSync, applySync, revokeLink };
}
