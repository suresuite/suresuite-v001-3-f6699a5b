import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ScenarioRole } from "@/lib/sim/validationBaseline";

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
  /** What the scenario is for (§4 D227). Absent until the column deploys. */
  role?: ScenarioRole;
  /** Created from a network page rather than from the Lab. */
  from_network?: boolean;
  created_at: string;
  updated_at: string;
}

/** The engine's neutral starting point for a new scenario. Exported so the
 *  setup form can mark a field "edited" against ONE source of truth instead of
 *  re-declaring the defaults next to the inputs. */
export const SCENARIO_ENGINE_DEFAULTS = {
  description: "",
  horizon_days: 364,
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

/** PostgREST / PostgreSQL saying the `role` column does not exist yet. */
const missingRoleColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST204" || e.code === "42703") && /\brole\b/.test(e.message ?? "");

/**
 * The one insert every scenario goes through. If the `role` column has not
 * deployed yet (it ships in a migration that applies on merge), the row is
 * written without it rather than failing — the name fallback in
 * `validationBaseline.ts` covers that window.
 */
export async function createScenarioRow(row: Partial<Scenario>): Promise<Scenario | null> {
  const first = await sb.from("scenarios").insert(row).select().single();
  if (!first.error) return first.data as Scenario;
  if ("role" in row && missingRoleColumn(first.error)) {
    const { role: _r, ...rest } = row;
    const retry = await sb.from("scenarios").insert(rest).select().single();
    if (retry.error) throw retry.error;
    return retry.data as Scenario;
  }
  throw first.error;
}

/** The project's validated baseline, read by role (§4 D227); null when none. */
export async function fetchValidationBaseline(projectId: string): Promise<Scenario | null> {
  const { data, error } = await sb
    .from("scenarios")
    .select("*")
    .eq("project_id", projectId)
    .eq("role", "validation_baseline")
    .maybeSingle();
  if (error) throw error;
  return (data as Scenario | null) ?? null;
}

export function useScenarios(projectId: string | null | undefined) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!projectId) return;
    if (!opts?.silent) setLoading(true);
    const { data } = await sb
      .from("scenarios")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    setScenarios((data ?? []) as Scenario[]);
    if (!opts?.silent) setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setScenarios([]);
      return;
    }
    void refresh(); // initial load — show the loading state
    const ch = sb
      .channel(`scenarios:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scenarios", filter: `project_id=eq.${projectId}` },
        () => void refresh({ silent: true }), // background sync — no flash
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [projectId, refresh]);

  const create = useCallback(
    async (name = "New scenario", extra?: Partial<Scenario>): Promise<Scenario | null> => {
      if (!projectId) return null;
      return createScenarioRow({ ...SCENARIO_DEFAULTS(projectId, name), ...(extra ?? {}) });
    },
    [projectId],
  );

  const update = useCallback(async (id: string, patch: Partial<Scenario>) => {
    setScenarios((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await sb.from("scenarios").update(patch).eq("id", id);
    if (error) {
      void refresh(); // failed — resync with the server's actual state
      throw error;
    }
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    const { error } = await sb.from("scenarios").delete().eq("id", id);
    if (error) throw error;
  }, []);

  const duplicate = useCallback(
    async (s: Scenario): Promise<Scenario | null> => {
      if (!projectId) return null;
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = s;
      // A copy is always an experiment — even a copy of the baseline (§4 D227).
      return createScenarioRow({ ...rest, name: `${s.name} (copy)`, ...(s.role ? { role: "experiment" } : {}) });
    },
    [projectId],
  );

  return { scenarios, loading, create, update, remove, duplicate, refresh };
}
