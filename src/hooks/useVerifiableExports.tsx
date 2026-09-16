// Fetch + download for the verifiable exports (G17 / §8.4 / §9.5.1 — W2):
// the dataset workbook (canonical hashed rows) and the per-run results
// workbook. The policy-snapshot export lives in usePolicies.exportVersion;
// all three are wired into the model version-history UI.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fetchProjectLanes, laneTruncationNotice } from "@/lib/policies/projectLanes";
import { downloadWorkbook } from "@/lib/policies/excel";
import {
  buildDatasetWorkbook,
  buildRunResultsWorkbook,
  type DatasetVersionRow,
  type RunScenarioMeta,
} from "@/lib/policies/verifiableExports";
import type { Replication, SimulationRun } from "@/hooks/useSimulationRun";

export interface ExportableRun {
  id: string;
  scenario_id: string;
  scenario_name: string | null;
  ended_at: string | null;
  code_version: string | null;
  rep_count_done: number | null;
  policy_version_id: string | null;
}

interface UseVerifiableExportsResult {
  /** Completed runs of the project, newest first (for the results export picker). */
  runs: ExportableRun[];
  refreshRuns: () => Promise<void>;
  /** Snapshot-or-reuse the dataset version, then download its canonical rows. */
  exportDataset: () => Promise<void>;
  /** Download one run's metadata + per-seed KPIs + weekly series. */
  exportRunResults: (runId: string) => Promise<void>;
  busy: "dataset" | "results" | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

function safeName(s: string): string {
  return s.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 48);
}

export function useVerifiableExports(
  projectId: string | null | undefined,
  projectName?: string | null,
): UseVerifiableExportsResult {
  const { user } = useAuth();
  const [runs, setRuns] = useState<ExportableRun[]>([]);
  const [busy, setBusy] = useState<"dataset" | "results" | null>(null);

  const refreshRuns = useCallback(async () => {
    if (!projectId) return;
    const { data, error } = await sb
      .from("simulation_runs")
      .select("id,scenario_id,ended_at,code_version,rep_count_done,policy_version_id")
      .eq("project_id", projectId)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      console.error("export run list failed", error);
      return;
    }
    const list = (data ?? []) as ExportableRun[];
    // Attach scenario names (small list; one read).
    const scenarioIds = Array.from(new Set(list.map((r) => r.scenario_id)));
    if (scenarioIds.length > 0) {
      const { data: scens } = await sb
        .from("scenarios")
        .select("id,name")
        .in("id", scenarioIds);
      const nameOf = new Map(
        ((scens ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
      );
      for (const r of list) r.scenario_name = nameOf.get(r.scenario_id) ?? null;
    }
    setRuns(list);
  }, [projectId]);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  const exportDataset = useCallback(async () => {
    if (!projectId) return;
    setBusy("dataset");
    try {
      // Snapshot-or-reuse (the RPC dedupes an unchanged dataset), then read
      // the EXACT rows the graph_hash was computed over.
      const { data: dsId, error: dsErr } = await sb.rpc("snapshot_dataset", {
        p_project_id: projectId,
      });
      if (dsErr) throw dsErr;
      const { data: version, error: verErr } = await sb
        .from("dataset_versions")
        .select("id,label,graph_hash,created_at,snapshot")
        .eq("id", dsId as string)
        .maybeSingle();
      if (verErr || !version) throw verErr ?? new Error("dataset version not readable");
      // Multi-level BOM rows ride along when the project uses them (the
      // engine reads them when present; graph_hash v1 hashes single-level).
      let bomMulti: Record<string, unknown>[] | undefined;
      try {
        const lanes = await fetchProjectLanes(projectId, user);
        if (lanes.bomLevel === "multi") bomMulti = lanes.bom;
        // D20 / §5 T3 — an export states the limits of its own computation.
        // The rows still go into the workbook (dropping them silently would be
        // worse), but the person clicking Export is told, now, that the sheet
        // is a slice. A file leaves the building; a console warning does not.
        const note = laneTruncationNotice(lanes);
        if (note) toast.warning(note);
      } catch {
        /* optional sheet only */
      }
      const wb = buildDatasetWorkbook(
        version as DatasetVersionRow,
        projectName ?? null,
        bomMulti,
      );
      const hash8 = String((version as DatasetVersionRow).graph_hash).slice(0, 8);
      downloadWorkbook(wb, `dataset-${safeName(projectName ?? projectId)}-${hash8}.xlsx`);
      toast.success(`Dataset exported (graph_hash ${hash8}…)`);
    } catch (err) {
      console.error("exportDataset failed", err);
      toast.error(`Dataset export failed: ${(err as Error).message ?? err}`);
    } finally {
      setBusy(null);
    }
  }, [projectId, projectName, user]);

  const exportRunResults = useCallback(
    async (runId: string) => {
      if (!projectId) return;
      setBusy("results");
      try {
        const { data: run, error: runErr } = await sb
          .from("simulation_runs")
          .select("*")
          .eq("id", runId)
          .maybeSingle();
        if (runErr || !run) throw runErr ?? new Error("run not readable");
        const { data: scenario } = await sb
          .from("scenarios")
          .select("id,name,seed,replications,crn,horizon_days,warmup_mode,warmup_days,disruption_schedule")
          .eq("id", (run as SimulationRun).scenario_id)
          .maybeSingle();
        const { data: reps, error: repErr } = await sb
          .from("run_replications")
          .select("*")
          .eq("run_id", runId)
          .order("rep_index", { ascending: true });
        if (repErr) throw repErr;
        let versionLabel: string | null = null;
        if ((run as SimulationRun).policy_version_id) {
          const { data: ver } = await sb
            .from("policy_versions")
            .select("label")
            .eq("id", (run as SimulationRun).policy_version_id)
            .maybeSingle();
          versionLabel = (ver?.label as string | null) ?? null;
        }
        const wb = buildRunResultsWorkbook(
          run as SimulationRun,
          (scenario ?? null) as RunScenarioMeta | null,
          (reps ?? []) as Replication[],
          versionLabel,
        );
        downloadWorkbook(wb, `run-results-${runId.slice(0, 8)}.xlsx`);
        toast.success("Run results exported");
      } catch (err) {
        console.error("exportRunResults failed", err);
        toast.error(`Results export failed: ${(err as Error).message ?? err}`);
      } finally {
        setBusy(null);
      }
    },
    [projectId],
  );

  return { runs, refreshRuns, exportDataset, exportRunResults, busy };
}
