import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ScenarioTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: "supplier" | "logistics" | "demand" | "production" | "geopolitical";
  severity: "low" | "medium" | "high" | "extreme";
  icon: string | null;
  disruption_schedule: Array<{
    target: string;
    target_type: "node" | "edge";
    start_day: number;
    duration_days: number;
    magnitude_pct: number;
  }>;
  suggested_playbook_name: string | null;
  horizon_days: number;
  warmup_days: number;
  replications: number;
  seed: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export function useScenarioTemplates() {
  const [templates, setTemplates] = useState<ScenarioTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    sb.from("scenario_templates")
      .select("*")
      .eq("is_system", true)
      .order("category")
      .order("name")
      .then(({ data }: { data: ScenarioTemplate[] | null }) => {
        setTemplates((data ?? []) as ScenarioTemplate[]);
        setLoading(false);
      });
  }, []);

  const cloneToProject = useCallback(
    async (template: ScenarioTemplate, projectId: string): Promise<string | null> => {
      const { data, error } = await sb
        .from("scenarios")
        .insert({
          project_id: projectId,
          name: template.name,
          description: template.description,
          horizon_days: template.horizon_days,
          warmup_mode: "auto",
          warmup_days: template.warmup_days,
          replications: template.replications,
          seed: template.seed,
          crn: true,
          demand_model: { kind: "poisson", lambda: 50 },
          disruption_schedule: template.disruption_schedule,
          recovery_overrides: {},
          stopping_rule: { kind: "fixed_horizon", max_wall_seconds: 600 },
          primary_kpi: "fill_rate",
          from_network: false,
        })
        .select("id")
        .single();
      if (error) {
        console.error("cloneToProject failed", error);
        return null;
      }
      return (data as { id: string }).id;
    },
    [],
  );

  return { templates, loading, cloneToProject };
}
