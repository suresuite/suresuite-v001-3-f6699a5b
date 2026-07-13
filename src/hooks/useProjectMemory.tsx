import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Project memory client hook — workstream M2 (ai-agents.md §14.4).
 *
 * Consent-only writes: every save here is user-initiated (an accepted memory
 * chip or a manual panel entry) and goes through the save_project_memory RPC
 * — the model never writes memory. Entries carrying grounding hashes render a
 * `stale` chip when the current policy/graph hashes drift (display-only;
 * §14.4). Edit = archive + new row (A5 discipline).
 */

export interface ProjectMemoryEntry {
  id: string;
  project_id: string;
  kind: "fact" | "preference" | "decision";
  content: string;
  citations: Array<Record<string, unknown>>;
  grounding: Record<string, unknown>;
  status: "active" | "archived";
  created_by: string | null;
  source_thread_id: string | null;
  created_at: string;
  /** Derived at read time against the current hashes — never stored. */
  stale: boolean;
}

// The project_memory table/RPCs postdate the generated supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function deriveStale(
  grounding: Record<string, unknown> | null,
  policyHash: string | null,
  graphHash: string | null,
): boolean {
  const g = grounding ?? {};
  const gPolicy = typeof g.policy_hash === "string" ? g.policy_hash : null;
  const gGraph = typeof g.graph_hash === "string" ? g.graph_hash : null;
  if (gPolicy && policyHash !== null && gPolicy !== policyHash) return true;
  if (gGraph && graphHash !== null && gGraph !== graphHash) return true;
  return false;
}

export function useProjectMemory(projectId: string | null | undefined) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<ProjectMemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const [{ data: rows }, policyHash, graphHash] = await Promise.all([
        db.from("project_memory")
          .select("*")
          .eq("project_id", projectId)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(200),
        db.rpc("current_policy_hash", { p_project_id: projectId })
          .then(({ data }: { data: unknown }) => (typeof data === "string" ? data : null))
          .catch(() => null),
        db.rpc("current_graph_hash", { p_project_id: projectId })
          .then(({ data }: { data: unknown }) => (typeof data === "string" ? data : null))
          .catch(() => null),
      ]);
      setEntries(
        ((rows ?? []) as Array<Omit<ProjectMemoryEntry, "stale">>).map((r) => ({
          ...r,
          stale: deriveStale(r.grounding, policyHash, graphHash),
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** User-consented save (chip Save / panel add). Returns an error string or null. */
  const save = useCallback(
    async (args: {
      content: string;
      kind: "fact" | "preference" | "decision";
      sourceThreadId?: string | null;
      citations?: Array<Record<string, unknown>>;
    }): Promise<string | null> => {
      if (!projectId) return "No project attached.";
      const content = args.content.trim().slice(0, 500);
      if (!content) return "Nothing to save.";
      // Grounding hashes stamp the save so the panel can show staleness later.
      const grounding: Record<string, unknown> = {};
      try {
        const { data } = await db.rpc("current_policy_hash", { p_project_id: projectId });
        if (typeof data === "string" && data) grounding.policy_hash = data;
      } catch { /* optional */ }
      try {
        const { data } = await db.rpc("current_graph_hash", { p_project_id: projectId });
        if (typeof data === "string" && data) grounding.graph_hash = data;
      } catch { /* optional */ }
      const { error } = await db.rpc("save_project_memory", {
        p_project_id: projectId,
        p_kind: args.kind,
        p_content: content,
        p_citations: args.citations ?? [],
        p_source_thread_id: args.sourceThreadId ?? null,
        p_user_id: user?.id ?? null,
        p_grounding: grounding,
      });
      if (error) return error.message ?? "Save failed.";
      await refresh();
      return null;
    },
    [projectId, user?.id, refresh],
  );

  const archive = useCallback(
    async (id: string): Promise<string | null> => {
      const { error } = await db.rpc("archive_project_memory", { p_id: id });
      if (error) return error.message ?? "Archive failed.";
      await refresh();
      return null;
    },
    [refresh],
  );

  return { entries, loading, refresh, save, archive };
}
