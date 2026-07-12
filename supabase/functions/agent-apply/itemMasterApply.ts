// item_master_diff apply mapping — Stage 1 (ai-agents.md §4.4 row 1).
//
// The exact §4.4 sequence, every step an interface that already exists:
//   (1) re-run the §5.1 reducer recomputation server-side — any deterministic
//       value that no longer matches its reducer (tolerance 1e-9) ⇒
//       `stale_values`;
//   (2) read current rows for the touched ids (the `before` snapshot);
//   (3) bulk_upsert_materials/products/suppliers with FULL-ROW payloads built
//       by merging the diff onto `before` (the RPCs are full-row upserts — a
//       NULL clears, so partial payloads must be completed before calling);
//   (4) re-run gradeManifest and store the finding delta.
//
// Pure orchestration over an injected supabase-like client: no Deno.env, no
// module-level clients — the deterministic eval tier drives it with a
// stateful stub, and index.ts drives it with the service role.

import { loadGateDataset } from "../_shared/validationGate.ts";
import { flattenFindings, type GradingDataset } from "../_shared/grading.ts";
import {
  entityIdSets,
  gradeDataset,
  loadPolicyDefaults,
  reducerCandidates,
  TABLE_COLUMNS,
  verifyReducerRow,
  type DraftRow,
  type ItemTable,
} from "../_shared/itemMasterCandidates.ts";
import { normalizeDraftRows } from "../project-ai-chat/draftTools.ts";

/** §4.4 apply-time failure codes (closed set; §13.4 adds quota_exceeded).
 * They prefix the human-readable detail in proposals.apply_error and reach
 * only the card — never the LLM. */
export type ApplyErrorCode = "stale_values" | "gate_blocked" | "rpc_error" | "quota_exceeded";

export class ApplyFailure extends Error {
  constructor(public code: ApplyErrorCode, message: string) {
    super(message);
  }
}

export interface GateFindingLite {
  severity: "block" | "warn" | "info";
  field: string;
  policy: string;
  rows: string[];
  message: string;
}

/** §4.4 `applied_result` shape for item_master_diff. */
export interface ItemMasterApplyResult {
  before: Partial<Record<ItemTable, Array<Record<string, unknown>>>>;
  after_counts: Partial<Record<ItemTable, number>>;
  findings_before: GateFindingLite[];
  findings_after: GateFindingLite[];
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

function findingsLite(dataset: GradingDataset, defaults: Record<string, unknown>): GateFindingLite[] {
  return flattenFindings(gradeDataset(dataset, defaults)).map(
    ({ severity, field, policy, rows, message }) => ({ severity, field, policy, rows, message }),
  );
}

/** Full-row merge (§4.4 step 3): group diff rows per (table, entity) and lay
 * them over the complete `before` row so the keyed upsert clears nothing the
 * proposal did not touch. */
export function mergeFullRows(
  rows: DraftRow[],
  before: Partial<Record<ItemTable, Array<Record<string, unknown>>>>,
): Partial<Record<ItemTable, Array<Record<string, unknown>>>> {
  const out: Partial<Record<ItemTable, Array<Record<string, unknown>>>> = {};
  const tables = [...new Set(rows.map((r) => r.table))];
  for (const table of tables) {
    const { id: idCol, columns } = TABLE_COLUMNS[table];
    const beforeById = new Map(
      (before[table] ?? []).map((row) => [String(row[idCol] ?? ""), row]),
    );
    const merged = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      if (r.table !== table) continue;
      if (!merged.has(r.entity_id)) {
        const base = beforeById.get(r.entity_id);
        if (!base) {
          throw new ApplyFailure(
            "stale_values",
            `${table} entity ${r.entity_id} no longer exists in this project`,
          );
        }
        const full: Record<string, unknown> = {};
        for (const c of columns) full[c] = base[c] ?? null;
        merged.set(r.entity_id, full);
      }
      merged.get(r.entity_id)![r.field] = r.value;
    }
    out[table] = [...merged.values()];
  }
  return out;
}

/**
 * Apply one approved item_master_diff proposal. Throws ApplyFailure with a
 * §4.4 code; multi-table applies run per-table so a failed second table
 * reports exactly which (the first stays applied — retry is idempotent, the
 * recomputation accepts already-applied values).
 */
export async function applyItemMasterDiff(
  db: Db,
  args: {
    projectId: string;
    payload: Record<string, unknown>;
    grounding: Record<string, unknown>;
  },
): Promise<ItemMasterApplyResult> {
  const normalized = normalizeDraftRows(args.payload?.rows);
  if ("code" in normalized) {
    throw new ApplyFailure("rpc_error", `stored payload failed validation: ${normalized.reason}`);
  }
  const rows = normalized.rows;

  // Grounding freshness (§4.2 approved→applied precondition, §8 T8): a diff
  // drafted against a superseded dataset must not apply.
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

  // (1) reducer recomputation, again, against the LIVE tables.
  const [dataset, defaults] = await Promise.all([
    loadGateDataset(db, args.projectId),
    loadPolicyDefaults(db, args.projectId),
  ]);
  const idSets = entityIdSets(dataset);
  for (const r of rows) {
    if (!idSets[r.table].has(r.entity_id)) {
      throw new ApplyFailure("stale_values", `${r.table} entity ${r.entity_id} no longer exists in this project`);
    }
  }
  const candidates = reducerCandidates(gradeDataset(dataset, defaults));
  for (const r of rows) {
    if (r.source !== "reducer") continue;
    const check = verifyReducerRow(r, candidates, dataset);
    if (!check.ok) throw new ApplyFailure("stale_values", check.reason ?? "reducer recomputation mismatch");
  }

  const findingsBefore = findingsLite(dataset, defaults as Record<string, unknown>);

  // (2) before snapshot: current full rows for the touched ids.
  const before: ItemMasterApplyResult["before"] = {};
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

  // (3) full-row merge + the existing gated write RPCs, per table.
  const fullRows = mergeFullRows(rows, before);
  const afterCounts: ItemMasterApplyResult["after_counts"] = {};
  for (const table of tables) {
    const { data: count, error } = await db.rpc(`bulk_upsert_${table}`, {
      p_project_id: args.projectId,
      p_rows: fullRows[table],
    });
    if (error) {
      const msg = String(error.message ?? "write failed");
      // The RPCs' enum CHECK exceptions ARE the gate for this artifact.
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
