// Fetch + map + build for the policy version's Export — PLAN.md §4 D289.
//
// A run reads TWO frozen versions — the policy version and a dataset version —
// through the mapper (`sim_worker.local`). This reads the same two, hands them to
// the same mapper in the browser engine, and lays out what comes back
// (`engineInputWorkbook.ts`). Which dataset version and which scenario are
// decisions this module makes, so the file states both rather than implying one:
//
//   * the version's latest run, when it has one: that run's dataset version, its
//     scenario, and the seed and disruption schedule stamped on it at dispatch;
//   * otherwise the project's data as a run would freeze it now (`snapshot_dataset`,
//     the same snapshot-or-reuse the dataset export calls) and no scenario.

import { supabase } from "@/integrations/supabase/client";
import { engineInputInBrowser, type LoadPhase } from "@/lib/sim/pyodideEngine";
import {
  buildEngineInputWorkbook,
  sha256Hex,
  type EngineInputExportData,
  type PolicyHashCheck,
} from "./engineInputWorkbook";
import type * as XLSX from "xlsx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface ExportableVersion {
  id: string;
  label: string | null;
  version_no?: number | null;
  notes?: string | null;
  author_name?: string | null;
  author_email?: string | null;
  created_at: string;
  policy_hash: string | null;
}

/**
 * The stored snapshot, AS TEXT when possible. `policy_hash` is
 * `sha256(snapshot::text)` (`snapshot_policy`), and PostgREST can return that
 * exact text, so the hash is re-checked here from the bytes it digests — not from
 * a re-serialization, which would differ in key order and number spelling.
 */
async function readPolicySnapshot(
  version: ExportableVersion,
): Promise<{ snapshot: Record<string, unknown>; text: string | null; check: PolicyHashCheck }> {
  const { data, error } = await sb
    .from("policy_versions")
    .select("snapshot_text:snapshot::text")
    .eq("id", version.id)
    .maybeSingle();
  const text = typeof data?.snapshot_text === "string" ? (data.snapshot_text as string) : null;
  if (!error && text) {
    const snapshot = JSON.parse(text) as Record<string, unknown>;
    if (!version.policy_hash) return { snapshot, text, check: { state: "unchecked", reason: "no policy hash is stored" } };
    const recomputed = await sha256Hex(text);
    return {
      snapshot,
      text,
      check: recomputed === version.policy_hash ? { state: "match", recomputed } : { state: "mismatch", recomputed },
    };
  }
  // The RLS-safe read every other export uses; it returns parsed JSON, so the
  // hash cannot be re-checked from it — and the file says so.
  const { data: snap, error: rpcErr } = await sb.rpc("get_policy_version_snapshot", { p_version_id: version.id });
  if (rpcErr || !snap) throw new Error("this policy version could not be read");
  return {
    snapshot: snap as Record<string, unknown>,
    text: null,
    check: {
      state: "unchecked",
      reason: `the version's stored text could not be read${error?.message ? ` (${error.message})` : ""}, so its hash was not recomputed`,
    },
  };
}

function shortDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "?";
}

export async function buildPolicyVersionEngineInput(
  projectId: string,
  version: ExportableVersion,
  onPhase?: (p: LoadPhase | "reading") => void,
): Promise<XLSX.WorkBook> {
  onPhase?.("reading");
  const { snapshot, text, check } = await readPolicySnapshot(version);

  // The version's latest run that froze a dataset — the input it actually ran on.
  const { data: runs } = await sb
    .from("simulation_runs")
    .select("id,dataset_version_id,scenario_id,seed,disruption_schedule,created_at")
    .eq("policy_version_id", version.id)
    .not("dataset_version_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const run = ((runs ?? []) as Array<Record<string, unknown>>)[0] ?? null;

  let datasetId: string;
  let datasetReason: string;
  if (run) {
    datasetId = String(run.dataset_version_id);
    datasetReason =
      `The dataset version the latest run of this policy version read (run ${String(run.id).slice(0, 8)}, ` +
      `${shortDate(run.created_at as string)}). A run is computed from this frozen copy, not from the live project.`;
  } else {
    const { data: dsId, error: dsErr } = await sb.rpc("snapshot_dataset", { p_project_id: projectId });
    if (dsErr || !dsId) throw new Error(`the project's data could not be frozen: ${dsErr?.message ?? "no dataset version"}`);
    datasetId = String(dsId);
    datasetReason =
      "No run has used this policy version yet, so this is the project's data as a run would freeze it now. " +
      "A later upload changes it; a run records the dataset version it actually read.";
  }
  const { data: ds, error: dsReadErr } = await sb
    .from("dataset_versions")
    .select("id,label,graph_hash,hash_inputs,created_at,snapshot")
    .eq("id", datasetId)
    .maybeSingle();
  if (dsReadErr || !ds?.snapshot) throw new Error("the dataset version could not be read");

  // The scenario the mapping reads settings, disruptions and a demand default from.
  let scenario: Record<string, unknown> = {};
  let scenarioReason =
    "None — no run has used this version, so the settings are the engine's defaults and there are no disruptions. " +
    "A run uses its own scenario's settings and disruptions; the network and policy values do not change with it, " +
    "except the demand model of a product whose data sets none.";
  if (run?.scenario_id) {
    const { data: sc } = await sb.from("scenarios").select("*").eq("id", run.scenario_id).maybeSingle();
    if (sc) {
      scenario = {
        ...(sc as Record<string, unknown>),
        // Stamped on the run at dispatch (audit WP 8) — what that run used.
        ...(run.seed != null ? { seed: run.seed } : {}),
        ...(run.disruption_schedule != null ? { disruption_schedule: run.disruption_schedule } : {}),
      };
      scenarioReason =
        `«${String(sc.name ?? "scenario")}» — the scenario of that latest run. Its seed and disruption schedule are the ones ` +
        "stamped on the run; its other settings are read as the scenario holds them now.";
    } else {
      scenarioReason = "The latest run's scenario could not be read (deleted?), so the settings are the engine's defaults.";
    }
  }

  // `projects.supply_chain_model` — the worker reads exactly this as the run's
  // MTS/MTO default (`_fetch_project_model`).
  const { data: proj } = await sb.from("projects").select("supply_chain_model").eq("id", projectId).maybeSingle();
  const projectModel = (proj?.supply_chain_model as string | null | undefined) ?? null;

  const engine = await engineInputInBrowser(
    { snapshot, scenario, projectModel, dataset: ds.snapshot },
    (p) => onPhase?.(p),
  );

  const data: EngineInputExportData = {
    version,
    policySnapshot: snapshot,
    policySnapshotText: text,
    policyHashCheck: check,
    dataset: ds,
    datasetReason,
    scenarioReason,
    projectModel,
    engine,
    generatedAt: new Date().toISOString(),
  };
  return buildEngineInputWorkbook(data);
}
