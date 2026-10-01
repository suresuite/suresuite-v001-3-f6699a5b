import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { dispatchExperiment, type RunDispatchResult } from "@/lib/sim/dispatch";

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
  /** Touched by every worker write, including the per-replication counter —
   *  what `runStatus.ts` reads to notice a run that stopped moving (F-30). */
  updated_at?: string | null;
  /** Baseline fingerprint stamped at dispatch (Phase B0 / G13 / §9.5). */
  scenario_hash?: string | null;
  /** Seed and disruption schedule stamped at dispatch (audit WP 8) — what a
   *  paired comparison reads, rather than the live scenario row. */
  seed?: number | null;
  disruption_schedule?: unknown[] | null;
  /** The model-validation card in force at dispatch — immutable history. */
  model_validation_id?: string | null;
  /** The pre-run gate could not load its data and dispatch proceeded unchecked
   *  (`20260707000001_run_gate_skipped.sql`). Rendered by `gateNotice` (F-19a). */
  gate_skipped?: boolean | null;
  // ── WP 10.4 · §4 D245 — the binding on the row (`20261001000009`) ──
  /** The registered engine the run was dispatched to (`sim_engines.id`). */
  engine_id?: string | null;
  /** sha256 of `run_spec` — the run's identity; identical submissions share it. */
  run_key?: string | null;
  /** Everything the RunKey hashes, as data: engine, hashes, the scenario's run
   *  spec, overrides. Every binding resolves from here without a live read. */
  run_spec?: Record<string, unknown> | null;
  /** Deviations from the Validated Model's protocol; `{}` = faithful. */
  protocol_overrides?: Record<string, unknown> | null;
  /** Ran under no Validated Model, or explicitly as an exploratory model. */
  exploratory?: boolean | null;
}

// The dispatch types and client live in lib/sim/dispatch.ts (WP 9.4 slice 8),
// shared with Run & Validate; re-exported here for existing importers.
export type { GateResponseFinding, ReuseCandidate, RunDispatchResult } from "@/lib/sim/dispatch";

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

  // The worker streams run_replications rows live while the engine runs, so
  // realtime events arrive in bursts — coalesce reloads instead of refetching
  // per row.
  const reloadTimer = useRef<number | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current != null) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      void loadLatest();
    }, 400);
  }, [loadLatest]);

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
        scheduleReload,
      )
      .subscribe();
    return () => {
      if (reloadTimer.current != null) window.clearTimeout(reloadTimer.current);
      sb.removeChannel(ch);
    };
  }, [scenarioId, loadLatest, scheduleReload]);

  // Replication rows of the run this hook SHOWS, and no other (audit F-33).
  // This used to subscribe to `run_replications` with no filter, so every
  // replication of every project woke every open Lab. `run_replications` has no
  // `scenario_id`; the displayed run's id is the exact filter, and a new run
  // arrives through the `simulation_runs` subscription above, which re-keys this.
  const latestRunId = latestRun?.id ?? null;
  useEffect(() => {
    if (!latestRunId) return;
    const ch = sb
      .channel(`sim_reps:${latestRunId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "run_replications", filter: `run_id=eq.${latestRunId}` },
        scheduleReload,
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [latestRunId, scheduleReload]);

  const runExperiment = useCallback(
    async (
      projectId: string,
      policyVersionId: string,
      acknowledgeWarnings = false,
      forceRerun = false,
    ): Promise<RunDispatchResult> => {
      if (!scenarioId) throw new Error("no scenario selected");
      return dispatchExperiment({
        projectId,
        scenarioId,
        policyVersionId,
        acknowledgeWarnings,
        forceRerun,
      });
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

  // Load one run's replications on demand — for the Run-queue console's
  // "View" (6.E), which inspects a historical run other than the latest (the
  // realtime path only keeps the latest run's reps hot). Read-only.
  const loadReps = useCallback(async (runId: string): Promise<Replication[]> => {
    const { data } = await sb
      .from("run_replications")
      .select("*")
      .eq("run_id", runId)
      .order("rep_index", { ascending: true });
    return (data ?? []) as Replication[];
  }, []);

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

  return { latestRun, reps, history, runExperiment, cancelRun, addReps, loadReps, refresh: loadLatest };
}
