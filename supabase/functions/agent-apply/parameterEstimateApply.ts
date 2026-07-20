// parameter_estimate apply mapping — Phase 4a (ai-agents.md §4.4 row added
// in v1.5, §18.1 hard gate 7).
//
// The §4.4 item_master_diff sequence verbatim, with the reducer check swapped
// for the method check:
//   (1) re-run the §18.1 method recomputation server-side — every row's
//       {value, low, high} re-derived through its named method@version
//       against live tables + the checked-in benchmark seed table (tolerance
//       1e-9; mismatch or back-test demotion ⇒ `stale_values`);
//   (2) read current rows for the touched ids (the `before` snapshot);
//   (3) bulk_upsert_materials/products/suppliers with FULL-ROW payloads
//       merged onto `before` — only the point `value` is written (intervals
//       live in the payload/card; the item master has no interval columns);
//   (4) re-run gradeManifest and store the finding delta.
//
// Pure orchestration over an injected supabase-like client: no Deno.env, no
// module-level clients — the deterministic eval tier drives it with a
// stateful stub, and index.ts drives it with the service role.

import { loadGateDataset } from "../_shared/validationGate.ts";
import {
  entityIdSets,
  gradeDataset,
  loadPolicyDefaults,
  TABLE_COLUMNS,
  type DraftRow,
} from "../_shared/itemMasterCandidates.ts";
import {
  verifyEstimateRow,
  type EstimatorInputs,
} from "../_shared/estimators.ts";
import { normalizeEstimateRows } from "../project-ai-chat/estimatorTools.ts";
import {
  ApplyFailure,
  mergeFullRows,
  type ApplyErrorCode,
  type GateFindingLite,
  type ItemMasterApplyResult,
} from "./itemMasterApply.ts";
import { flattenFindings, type GradingDataset, type Row } from "../_shared/grading.ts";

/** §4.4: parameter_estimate reuses the item_master_diff applied_result shape
 * — same before snapshot, same counts, same findings delta. */
export type ParameterEstimateApplyResult = ItemMasterApplyResult;

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

function findingsLite(dataset: GradingDataset, defaults: Record<string, unknown>): GateFindingLite[] {
  return flattenFindings(gradeDataset(dataset, defaults)).map(
    ({ severity, field, policy, rows, message }) => ({ severity, field, policy, rows, message }),
  );
}

/**
 * Apply one approved parameter_estimate proposal. Throws ApplyFailure with a
 * §4.4 code; multi-table applies run per-table so a failed second table
 * reports exactly which (the first stays applied — retry is idempotent: the
 * method recomputation is missingness-independent, so already-applied rows
 * re-verify cleanly).
 */
export async function applyParameterEstimate(
  db: Db,
  args: {
    projectId: string;
    payload: Record<string, unknown>;
    grounding: Record<string, unknown>;
  },
): Promise<ParameterEstimateApplyResult> {
  // Stored payload rows are the enriched §18.1 shape (family/basis/sources/
  // assumptions added server-side at draft) — strip back to the core row
  // before re-running the draft-time normalizer.
  const storedRows = Array.isArray(args.payload?.rows) ? (args.payload.rows as Row[]) : [];
  const coreRows = storedRows.map((r) => ({
    table: r.table,
    entity_id: r.entity_id,
    field: r.field,
    method: r.method,
    value: r.value,
    low: r.low,
    high: r.high,
    ...(typeof r.why === "string" && r.why ? { why: r.why } : {}),
  }));
  const normalized = normalizeEstimateRows(coreRows);
  if ("code" in normalized) {
    throw new ApplyFailure("rpc_error", `stored payload failed validation: ${normalized.reason}`);
  }
  const rows = normalized.rows;

  // Grounding freshness (§4.2 approved→applied precondition, §8 T8): an
  // estimate drafted against a superseded dataset must not apply.
  const groundedGraphHash = typeof args.grounding?.graph_hash === "string"
    ? String(args.grounding.graph_hash)
    : null;
  if (groundedGraphHash) {
    const { data: currentHash, error } = await db.rpc("current_graph_hash", {
      p_project_id: args.projectId,
    });
    if (!error && typeof currentHash === "string" && currentHash !== groundedGraphHash) {
      throw new ApplyFailure(
        "stale_values",
        "the project's dataset changed since this proposal was drafted (graph hash drift) — ask for a fresh draft",
      );
    }
  }

  // (1) method recomputation, again, against the LIVE tables + seed table.
  const [dataset, defaults] = await Promise.all([
    loadGateDataset(db, args.projectId),
    loadPolicyDefaults(db, args.projectId),
  ]);
  const inputs: EstimatorInputs = { dataset, defaults };
  const idSets = entityIdSets(dataset);
  for (const r of rows) {
    if (!idSets[r.table].has(r.entity_id)) {
      throw new ApplyFailure("stale_values", `${r.table} entity ${r.entity_id} no longer exists in this project`);
    }
  }
  for (const r of rows) {
    const check = verifyEstimateRow(r, inputs);
    if (!check.ok) {
      throw new ApplyFailure("stale_values", check.reason ?? "estimate recomputation mismatch");
    }
  }

  const findingsBefore = findingsLite(dataset, defaults as Record<string, unknown>);

  // (2) before snapshot: current full rows for the touched ids.
  const before: ParameterEstimateApplyResult["before"] = {};
  const tables = [...new Set(rows.map((r) => r.table))].sort();
  for (const table of tables) {
    const { id: idCol, columns } = TABLE_COLUMNS[table];
    const ids = [...new Set(rows.filter((r) => r.table === table).map((r) => r.entity_id))];
    const { data, error } = await db
      .from(table)
      .select(columns.join(","))
      .eq("project_id", args.projectId)
      .in(idCol, ids);
    if (error) throw new ApplyFailure("rpc_error", `${table}: before-snapshot read failed (${error.message})`);
    before[table] = (data ?? []) as Array<Record<string, unknown>>;
  }

  // (3) full-row merge + the existing gated write RPCs, per table. Only the
  // point value lands in the master (§18.1 hard gate 7).
  const diffRows: DraftRow[] = rows.map((r) => ({
    table: r.table,
    entity_id: r.entity_id,
    field: r.field,
    value: r.value,
    source: "reducer", // shape-compat only; mergeFullRows never reads it
  }));
  const fullRows = mergeFullRows(diffRows, before);
  const afterCounts: ParameterEstimateApplyResult["after_counts"] = {};
  for (const table of tables) {
    const { data: count, error } = await db.rpc(`bulk_upsert_${table}`, {
      p_project_id: args.projectId,
      p_rows: fullRows[table],
    });
    if (error) {
      const msg = String(error.message ?? "write failed");
      const code: ApplyErrorCode = msg.startsWith("invalid ") ? "gate_blocked" : "rpc_error";
      throw new ApplyFailure(code, `${table}: ${msg}`);
    }
    afterCounts[table] = Number(count ?? fullRows[table]?.length ?? 0) || 0;
  }

  // (4) post-apply gradeManifest delta.
  const datasetAfter = await loadGateDataset(db, args.projectId);
  const findingsAfter = findingsLite(datasetAfter, defaults as Record<string, unknown>);

  return {
    before,
    after_counts: afterCounts,
    findings_before: findingsBefore,
    findings_after: findingsAfter,
  };
}
