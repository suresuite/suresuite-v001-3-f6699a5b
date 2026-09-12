// Shared hook to list the current user's projects via the list_projects RPC.
// Used by /simulation-lab, /policies and the floating chat bubble — and the
// bubble renders on every route, so before this was cached the RPC fired on
// every page load, once per mounted consumer.
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface ProjectSummary {
  id: string;
  name: string;
  plant_name?: string | null;
  [k: string]: unknown;
}

/** Keyed by user id, not just "projects": two accounts in one browser session
 *  must never read each other's list out of the cache. */
const projectsKey = (userId: string | undefined) => ["projects", userId ?? null] as const;

/** One array instance for the empty case, for the same reason the previous
 *  implementation held it in `useState`: `ProjectPolicies` and
 *  `FloatingChatBubble` both list `projects` in a `useEffect` dependency array,
 *  so handing back a fresh `[]` each render would re-run those effects on every
 *  render until the data lands. */
const NO_PROJECTS: ProjectSummary[] = [];

export function useProjects() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: projectsKey(user?.id),
    // No user, no query — matches the previous `if (!user) return`, and leaves
    // the cache untouched rather than writing an empty list into it.
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_projects", {
        p_user_id: user!.id,
        p_user_email: user!.email,
      });
      if (error) {
        // Kept from the original: a failing RPC here is silent in the UI (the
        // list just stays empty), so the console is the only place it shows.
        console.error("[useProjects] failed", error);
        throw error;
      }
      return (data as ProjectSummary[]) || [];
    },
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: projectsKey(user?.id) }),
    [queryClient, user?.id],
  );

  return { projects: data ?? NO_PROJECTS, loading: isFetching, refresh };
}
