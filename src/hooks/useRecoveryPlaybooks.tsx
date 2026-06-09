import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RecoveryConfig } from "@/lib/sim/recoveryScore";

export interface RecoveryPlaybook {
  id: string;
  project_id: string | null;
  name: string;
  description: string;
  is_system: boolean;
  config: Partial<RecoveryConfig> & Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export function useRecoveryPlaybooks(projectId: string | null | undefined) {
  const [playbooks, setPlaybooks] = useState<RecoveryPlaybook[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    let query = sb.from("recovery_playbooks").select("*").order("is_system", { ascending: false }).order("name");
    if (projectId) {
      query = query.or(`is_system.eq.true,project_id.eq.${projectId}`);
    } else {
      query = query.eq("is_system", true);
    }
    const { data } = await query;
    setPlaybooks((data ?? []) as RecoveryPlaybook[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void refresh();
    if (!projectId) return;
    const ch = sb
      .channel(`playbooks:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "recovery_playbooks" },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [projectId, refresh]);

  const create = useCallback(
    async (input: { name: string; description?: string; config: Record<string, unknown> }) => {
      if (!projectId) throw new Error("No project selected");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Not signed in");
      const { data, error } = await sb
        .from("recovery_playbooks")
        .insert({
          project_id: projectId,
          name: input.name,
          description: input.description ?? "",
          is_system: false,
          config: input.config,
          created_by: uid,
        })
        .select()
        .single();
      if (error) throw error;
      return data as RecoveryPlaybook;
    },
    [projectId],
  );

  const update = useCallback(async (id: string, patch: Partial<RecoveryPlaybook>) => {
    const { error } = await sb.from("recovery_playbooks").update(patch).eq("id", id);
    if (error) throw error;
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await sb.from("recovery_playbooks").delete().eq("id", id);
    if (error) throw error;
  }, []);

  return { playbooks, loading, create, update, remove, refresh };
}
