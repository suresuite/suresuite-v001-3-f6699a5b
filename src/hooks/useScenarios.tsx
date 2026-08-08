import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Scenario {
  id: string;
  project_id: string;
  name: string;
  description: string;
  horizon_days: number;
  time_step: "day" | "hour";
  warmup_mode: "manual" | "auto";
  warmup_days: number;
  replications: number;
  seed: number;
  crn: boolean;
  demand_model: { kind: string; lambda?: number; r?: number; p?: number };
  disruption_schedule: Array<{
    target: string;
    target_type: "node" | "edge";
    start_day: number;
    duration_days: number;
    magnitude_pct: number;
  }>;
  recovery_overrides: Record<string, unknown>;
  stopping_rule: { kind: "fixed_horizon" | "ci_halfwidth"; epsilon?: number; max_wall_seconds?: number };
  primary_kpi: string;
  /** Model-validation card that seeded warm-up/replications (B0 / G13 / §9.5);
   *  null once the user hand-edits either — divergence is explicit. */
  inherited_validation_id?: string | null;
  created_at: string;
  updated_at: string;
}

/** The engine's neutral starting point for a new scenario. Exported so the
 *  setup form can mark a field "edited" against ONE source of truth instead of
 *  re-declaring the defaults next to the inputs. */
export const SCENARIO_ENGINE_DEFAULTS = {
  description: "",
  horizon_days: 90,
  time_step: "day",
  warmup_mode: "auto",
  warmup_days: 14,
  replications: 10,
  seed: 42,
  crn: true,
  demand_model: { kind: "poisson", lambda: 50 },
  disruption_schedule: [],
  recovery_overrides: {},
  stopping_rule: { kind: "fixed_horizon", max_wall_seconds: 600 },
  primary_kpi: "fill_rate",
} satisfies Partial<Scenario>;

const SCENARIO_DEFAULTS = (projectId: string, name = "Baseline"): Partial<Scenario> => ({
  project_id: projectId,
  name,
  ...SCENARIO_ENGINE_DEFAULTS,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export function useScenarios(projectId: string | null | undefined) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await sb
      .from("scenarios")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    setScenarios((data ?? []) as Scenario[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setScenarios([]);
      return;
    }
    void refresh();
    const ch = sb
      .channel(`scenarios:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scenarios", filter: `project_id=eq.${projectId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [projectId, refresh]);

  const create = useCallback(
    async (name = "New scenario"): Promise<Scenario | null> => {
      if (!projectId) return null;
      const { data, error } = await sb
        .from("scenarios")
        .insert(SCENARIO_DEFAULTS(projectId, name))
        .select()
        .single();
      if (error) throw error;
      return data as Scenario;
    },
    [projectId],
  );

  const update = useCallback(async (id: string, patch: Partial<Scenario>) => {
    const { error } = await sb.from("scenarios").update(patch).eq("id", id);
    if (error) throw error;
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await sb.from("scenarios").delete().eq("id", id);
    if (error) throw error;
  }, []);

  const duplicate = useCallback(
    async (s: Scenario): Promise<Scenario | null> => {
      if (!projectId) return null;
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = s;
      const { data, error } = await sb
        .from("scenarios")
        .insert({ ...rest, name: `${s.name} (copy)` })
        .select()
        .single();
      if (error) throw error;
      return data as Scenario;
    },
    [projectId],
  );

  /**
   * Create a new scenario pre-configured with a single-node disruption.
   * Called from network pages (ProductLevelNetwork etc.) to let the user jump
   * straight into SimulationLab with the disruption already set up.
   */
  const createFromNode = useCallback(
    async (
      targetProjectId: string,
      nodeId: string,
      nodeType: "supplier" | "material" | "product" | "customer" | string,
      magnitudePct = 80,
      durationDays = 42,
      startDay = 7,
    ): Promise<Scenario | null> => {
      const disruption_schedule = [
        {
          target: nodeId,
          target_type: "node" as const,
          start_day: startDay,
          duration_days: durationDays,
          magnitude_pct: magnitudePct,
        },
      ];
      const name = `Disruption: ${nodeType}/${nodeId}`;
      const { data, error } = await sb
        .from("scenarios")
        .insert({
          ...SCENARIO_DEFAULTS(targetProjectId, name),
          disruption_schedule,
          horizon_days: 182,
          replications: 30,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Scenario;
    },
    [],
  );

  return { scenarios, loading, create, update, remove, duplicate, refresh, createFromNode };
}
