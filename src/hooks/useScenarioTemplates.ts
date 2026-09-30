import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SCENARIO_ENGINE_DEFAULTS, createScenarioRow, type Scenario } from "@/hooks/useScenarios";
import { buildScenarioSeed, type SeedWorld } from "@/lib/sim/scenarioSeed";

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

  /**
   * A template's disruption, run in the validated baseline's world when the
   * project has one (WP 9.4 slice 5, §4 D219) — so the clone can inherit the
   * validation. With no baseline the template's own settings apply, as before.
   * Written through the one scenario insert (`createScenarioRow`).
   */
  const cloneToProject = useCallback(
    async (
      template: ScenarioTemplate,
      projectId: string,
      from?: { world?: SeedWorld; baseline?: Pick<Scenario, "seed" | "crn"> | null },
    ): Promise<string | null> => {
      const own = {
        project_id: projectId,
        name: template.name,
        description: template.description,
        horizon_days: template.horizon_days,
        warmup_mode: "auto" as const,
        warmup_days: template.warmup_days,
        replications: template.replications,
        seed: template.seed,
        crn: true,
        demand_model: { kind: "poisson", lambda: 50 },
        disruption_schedule: template.disruption_schedule,
        recovery_overrides: {},
        stopping_rule: { kind: "fixed_horizon" as const, max_wall_seconds: 600 },
        primary_kpi: "fill_rate",
        from_network: false,
      };
      const row =
        from?.world && from.world.source !== "defaults"
          ? {
              ...own,
              ...buildScenarioSeed({
                name: template.name,
                world: from.world,
                baseline: from.baseline ?? null,
                description: template.description,
                disruption_schedule: template.disruption_schedule,
              }),
              project_id: projectId,
              // warm-up and replications come from the validation, not the template
              warmup_mode: "auto" as const,
              warmup_days: SCENARIO_ENGINE_DEFAULTS.warmup_days,
              replications: SCENARIO_ENGINE_DEFAULTS.replications,
            }
          : own;
      try {
        const data = await createScenarioRow(row);
        return data?.id ?? null;
      } catch (error) {
        console.error("cloneToProject failed", error);
        return null;
      }
    },
    [],
  );

  return { templates, loading, cloneToProject };
}
