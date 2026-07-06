import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Engine fallback report (scsim MappingWarning, written by the worker). */
export interface MappingWarning {
  level: "info" | "warn" | "error";
  entity: string;
  field: string;
  reason: string;
}

export interface SimulationRun {
  id: string;
  scenario_id: string;
  project_id: string;
  status: "queued" | "running" | "done" | "cancelled" | "failed";
  started_at: string | null;
  ended_at: string | null;
  aggregate_kpis: Record<string, number>;
  ci_half_widths: Record<string, number>;
  warmup_detected_at: number | null;
  rep_count_target: number;
  rep_count_done: number;
  error_message: string | null;
  code_version: string | null;
  policy_version_id: string | null;
  policy_hash: string | null;
  mapping_warnings: MappingWarning[] | null;
  created_at: string;
}

/** Body of a sim-command 422 — the §8.1 required-data gate result. */
interface GateErrorBody {
  validation?: "blocked" | "ack_required";
  ack_required?: boolean;
  findings?: Array<{ severity: string; field: string; policy: string; message: string }>;
}

async function parseFunctionError(error: unknown): Promise<GateErrorBody | null> {
  const ctx = (error as { context?: Response }).context;
  if (!ctx || typeof ctx.json !== "function") return null;
  try {
    return (await ctx.json()) as GateErrorBody;
  } catch {
    return null;
  }
}

export interface Replication {
  id: string;
  run_id: string;
  rep_index: number;
  seed_used: number;
  status: string;
  kpis: Record<string, number>;
  time_series: Record<string, number[]>;
  warmup_at: number | null;
  started_at: string | null;
  ended_at: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export function useSimulationRun(scenarioId: string | null | undefined) {
  const [latestRun, setLatestRun] = useState<SimulationRun | null>(null);
  const [reps, setReps] = useState<Replication[]>([]);
  const [history, setHistory] = useState<SimulationRun[]>([]);

  const loadLatest = useCallback(async () => {
    if (!scenarioId) return;
    const { data: runs } = await sb
      .from("simulation_runs")
      .select("*")
      .eq("scenario_id", scenarioId)
      .order("created_at", { ascending: false })
      .limit(20);
    const list = (runs ?? []) as SimulationRun[];
    setHistory(list);
    setLatestRun(list[0] ?? null);
    if (list[0]) {
      const { data: rs } = await sb
        .from("run_replications")
        .select("*")
        .eq("run_id", list[0].id)
        .order("rep_index", { ascending: true });
      setReps((rs ?? []) as Replication[]);
    } else {
      setReps([]);
    }
  }, [scenarioId]);

  useEffect(() => {
    if (!scenarioId) {
      setLatestRun(null);
      setReps([]);
      setHistory([]);
      return;
    }
    void loadLatest();
    const ch = sb
      .channel(`sim_runs:${scenarioId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "simulation_runs", filter: `scenario_id=eq.${scenarioId}` },
        () => void loadLatest(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "run_replications" },
        () => void loadLatest(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [scenarioId, loadLatest]);

  const runExperiment = useCallback(
    async (projectId: string, policyVersionId: string, acknowledgeWarnings = false) => {
      if (!scenarioId) return;
      const { error } = await supabase.functions.invoke("sim-command", {
        body: {
          project_id: projectId,
          scenario_id: scenarioId,
          kind: "experiment.run",
          payload: {
            policy_version_id: policyVersionId,
            acknowledge_warnings: acknowledgeWarnings,
          },
          client_ts: Date.now(),
        },
      });
      if (!error) return;

      // §8.1 required-data gate: sim-command returns 422 with typed findings
      // instead of dispatching a run on silently-defaulted data.
      const body = await parseFunctionError(error);
      if (body?.validation) {
        const summary = (body.findings ?? [])
          .slice(0, 3)
          .map((f) => f.message)
          .join("\n");
        if (body.ack_required) {
          toast.warning("Run paused — data the engine would default", {
            description: summary,
            duration: 12000,
            action: {
              label: "Run anyway",
              onClick: () => void runExperiment(projectId, policyVersionId, true),
            },
          });
          return;
        }
        toast.error("Run blocked — required data is missing", {
          description: summary,
          duration: 12000,
        });
        return;
      }
      throw error;
    },
    [scenarioId],
  );

  const cancelRun = useCallback(
    async (projectId: string, runId: string) => {
      const { error } = await supabase.functions.invoke("sim-command", {
        body: {
          project_id: projectId,
          kind: "experiment.cancel",
          payload: { run_id: runId },
          client_ts: Date.now(),
        },
      });
      if (error) throw error;
    },
    [],
  );

  const addReps = useCallback(async (projectId: string, runId: string, n: number) => {
    const { error } = await supabase.functions.invoke("sim-command", {
      body: {
        project_id: projectId,
        kind: "experiment.add_reps",
        payload: { run_id: runId, n },
        client_ts: Date.now(),
      },
    });
    if (error) throw error;
  }, []);

  return { latestRun, reps, history, runExperiment, cancelRun, addReps, refresh: loadLatest };
}
