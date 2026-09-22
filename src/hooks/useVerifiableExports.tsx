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
  type RowProvenance,
  buildRunResultsWorkbook,
  type DatasetVersionRow,
  type RunScenarioMeta,
} from "@/lib/policies/verifiableExports";
import type { Replication, SimulationRun } from "@/hooks/useSimulationRun";
import {
  buildReproducibilityRecord,
  type AnalysisBinding,
} from "@/lib/trust/reproducibilityRecord";
import { knownLimits, type FreshnessPayload } from "@/lib/trust/trustReport";
import { analysesAtRun, exportTrustInput, ingestHistoryFrom } from "@/lib/trust/exportTrustInputs";
import { resolveRunScenarioBinding, scheduleDigest } from "@/lib/trust/runScenarioBinding";
import { INGEST_DATASETS } from "../../supabase/functions/_shared/ingestSpec.generated";

/**
 * The tables `ingest_row_provenance` can be asked about — DERIVED from the contract,
 * never listed here.
 *
 * `INGEST_DATASETS` is generated from `supabase/contract/*.contract.yaml`, and its
 * targets are exactly the tables the promotion writes, which are exactly the tables
 * that carry `ingest_run_id` + `source_row_id`. A hand-written list would be a
 * second copy that silently omits the eleventh dataset the day it lands — the shape
 * `single-source` (I1) exists to refuse, and the reason `ingest_target_is_promotable`
 * is checked against on the SQL side rather than trusted from the caller.
 */
const PROVENANCE_TABLES: readonly string[] = [
  ...new Set(Object.values(INGEST_DATASETS).map((d) => d.target)),
].sort();

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
        .select("id,label,graph_hash,hash_inputs,hash_network,created_at,snapshot")
        .eq("id", dsId as string)
        .maybeSingle();
      if (verErr || !version) throw verErr ?? new Error("dataset version not readable");

      // WP 4.1 — THE LIVE READ IS ONLY FOR v1 VERSIONS NOW, and that is the
      // point of the change rather than an optimization.
      //
      // `bom_multi_level` is INSIDE the snapshot from v2 on, so the workbook
      // takes it from the frozen rows like every other sheet. Reading it live
      // would put rows in a hashed export that the hash does not describe — the
      // exact defect the v1 path had to carry a `_meta` note about, because v1
      // could not do anything else. A freshly frozen version needs no note.
      const snapshotVersion = Number(
        (version as { snapshot?: { schema_version?: number } }).snapshot?.schema_version ?? 1,
      );
      let bomMulti: Record<string, unknown>[] | undefined;
      if (snapshotVersion < 2) {
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
      }
      // §5.4's ACCEPTANCE TEST — WP 6.3. One read per landable table this project
      // could hold, so the workbook can answer "which file, which line, which
      // person" for every row it lists.
      //
      // `undefined` when NOTHING could be read and `[]` when the reads returned
      // nothing: the sheet distinguishes them, because a workbook with no
      // `_provenance` sheet asserts neither, and "no row can be traced" is the true
      // and useful answer for most projects today (§4 D88).
      let provenance: RowProvenance[] | undefined;
      if (user?.id) {
        const gathered: RowProvenance[] = [];
        let anyRead = false;
        for (const table of PROVENANCE_TABLES) {
          const { data, error } = await sb.rpc("ingest_row_provenance", {
            p_project_id: projectId,
            p_user_id: user.id,
            p_target_table: table,
          });
          // A table this project has no rows in returns []; a table the RPC refuses
          // is a real failure and must not look the same. Either way one failed
          // table does not discard the others.
          if (error) continue;
          anyRead = true;
          for (const r of (data ?? []) as Array<Omit<RowProvenance, "table">>) {
            gathered.push({ ...r, table });
          }
        }
        if (anyRead) provenance = gathered;
      }

      const wb = buildDatasetWorkbook(
        version as DatasetVersionRow,
        projectName ?? null,
        bomMulti,
        provenance,
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
          .select("id,name,seed,replications,crn,horizon_days,warmup_mode,warmup_days,disruption_schedule,updated_at")
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
        // ── A5 · THE REPRODUCIBILITY RECORD (§5.4, I8) ────────────────────
        //
        // A4's sheets bind this RUN. The record adds what a reader in two years
        // also needs and the run row cannot supply: which ANALYSIS runs produced
        // the network figures — they come from `analysis_runs` and not from a
        // simulation — the hash ALGORITHM version behind `graph_hash`, and the
        // known limits of the whole thing.
        //
        // EVERY QUERY HERE IS ALLOWED TO FAIL, and a failure becomes an absent
        // binding with a stated reason rather than an aborted export. A reviewer
        // holding a workbook with six of nine bindings and three explanations is
        // better served than one holding an error toast.
        const runRow = run as SimulationRun & {
          dataset_version_id?: string | null;
          graph_hash?: string | null;
        };
        const { data: dsv } = await sb
          .from("dataset_versions")
          .select("id,graph_hash,schema_version")
          .eq("id", runRow.dataset_version_id ?? "00000000-0000-0000-0000-000000000000")
          .maybeSingle();
        const { data: analysisRows } = await sb
          .from("analysis_runs")
          .select("id,analysis_kind,code_version,input_hash,params_hash,finished_at,status")
          .eq("project_id", projectId)
          .eq("status", "succeeded");
        // The analyses that existed when this run was DISPATCHED (audit F-29) —
        // not the latest project-wide, which may have finished after it.
        const analysesBound = analysesAtRun(
          (analysisRows ?? []) as Array<Record<string, unknown>>,
          (run as SimulationRun).created_at, runRow.graph_hash);

        // The seed and schedule that RAN (audit F-11): the dispatch stamp, or the
        // live row only when provably unchanged since dispatch.
        const ran = resolveRunScenarioBinding(
          run as { created_at?: string; seed?: number | null; disruption_schedule?: unknown[] | null },
          (scenario ?? null) as { seed?: number; disruption_schedule?: unknown[]; updated_at?: string } | null,
        );

        // The Trust Report's own inputs (audit F-12): the real freshness payload
        // and ingest history. An empty `tables` map suppressed the two counted limits.
        const { data: freshness } = await sb.rpc("project_freshness", { p_project_id: projectId });
        const { data: ingestRows } = await sb
          .from("ingest_runs")
          .select("id,source_kind,applied_at,applied_by_user_id,rows_fetched")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(10);

        // The browser engine's own version, from the manifest the frontend ships.
        // A separate binding from the worker's `code_version` because the wheels
        // are committed and the two CAN differ (§4 D87).
        let browserEngineVersion: string | null = null;
        try {
          const res = await fetch("/engine/manifest.json");
          if (res.ok) {
            const manifest = (await res.json()) as { engine_version?: string };
            // "unknown" is what the build script used to write when its version
            // lookup failed. It is not a version and must not be bound as one.
            const v = manifest.engine_version;
            browserEngineVersion = v && v !== "unknown" ? v : null;
          }
        } catch {
          browserEngineVersion = null;
        }

        const record = buildReproducibilityRecord({
          projectId,
          // The project's NAME (audit F-29) — it was `"project " + id.slice(0, 8)`.
          projectName: projectName ?? projectId,
          graphHash: runRow.graph_hash ?? (dsv?.graph_hash as string | null) ?? null,
          datasetVersionId: runRow.dataset_version_id ?? (dsv?.id as string | null) ?? null,
          hashSchemaVersion: (dsv?.schema_version as number | null) ?? null,
          policyVersionId: (run as SimulationRun).policy_version_id ?? null,
          policyHash: (run as SimulationRun).policy_hash ?? null,
          scenarioId: (scenario?.id as string | null) ?? (run as SimulationRun).scenario_id ?? null,
          scenarioSeed: ran.seed,
          scenarioSeedSource: ran.seedSource,
          scenarioSeedReason: ran.reason,
          disruptionSchedule: ran.schedule === null ? null : scheduleDigest(ran.schedule),
          engineCodeVersion: (run as SimulationRun).code_version ?? null,
          browserEngineVersion,
          analyses: analysesBound,
          // The Trust Report's own computation over the Trust Report's own inputs
          // — the function was shared before; now the inputs are too (F-12, D-6).
          // A freshness read that failed is not "nothing stale": it is declared.
          limits: freshness
            ? knownLimits(exportTrustInput(projectName ?? projectId,
                freshness as FreshnessPayload,
                ingestHistoryFrom((ingestRows ?? []) as Array<Record<string, unknown>>)))
            : [{
                ref: "T3",
                limit: "Data freshness could not be read when this workbook was exported.",
                consequence: "The counted limits (rows with no input hash, rows from a different " +
                  "dataset) are unknown for this export — their absence here is not evidence of none.",
              }],
          measuredAt: new Date().toISOString(),
        });

        const wb = buildRunResultsWorkbook(
          run as SimulationRun,
          (scenario ?? null) as RunScenarioMeta | null,
          (reps ?? []) as Replication[],
          versionLabel,
          record,
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
