// Shared hook to list the current user's projects via the list_projects RPC.
// Used by /network/product-level and /policies so the project picker is
// consistent across pages.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface ProjectSummary {
  id: string;
  name: string;
  plant_name?: string | null;
  [k: string]: unknown;
}

export function useProjects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("list_projects", {
        p_user_id: user.id,
        p_user_email: user.email,
      });
      if (error) throw error;
      setProjects((data as ProjectSummary[]) || []);
    } catch (e) {
      console.error("[useProjects] failed", e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { projects, loading, refresh };
}
