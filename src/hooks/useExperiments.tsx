import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Experiment {
  id: string;
  project_id: string;
  name: string;
  design_type: string;
  factors: Array<{ key: string; label: string; levels: (number | string)[] }>;
  scenario_ids: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export function useExperiments(projectId: string | null | undefined) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setExperiments([]);
      return;
    }
    setLoading(true);
    const { data } = await sb
      .from("experiments")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    setExperiments((data ?? []) as Experiment[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void refresh();
    if (!projectId) return;
    const ch = sb
      .channel(`experiments:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "experiments", filter: `project_id=eq.${projectId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [projectId, refresh]);

  const create = useCallback(
    async (input: {
      name: string;
      design_type: string;
      factors: Experiment["factors"];
      scenario_ids: string[];
      status?: string;
    }): Promise<Experiment> => {
      if (!projectId) throw new Error("No project selected");
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await sb
        .from("experiments")
        .insert({
          project_id: projectId,
          name: input.name,
          design_type: input.design_type,
          factors: input.factors,
          scenario_ids: input.scenario_ids,
          status: input.status ?? "running",
          created_by: u.user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Experiment;
    },
    [projectId],
  );

  const update = useCallback(async (id: string, patch: Partial<Experiment>) => {
    const { error } = await sb.from("experiments").update(patch).eq("id", id);
    if (error) throw error;
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await sb.from("experiments").delete().eq("id", id);
    if (error) throw error;
  }, []);

  return { experiments, loading, create, update, remove, refresh };
}
