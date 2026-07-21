// network_map_diff apply mapping — Phase 4b (ai-agents.md §4.4 row added in
// v1.5, §18.2 hard gate 7).
//
// v1 apply scope: add suppliers and supplier→material links through the
// EXISTING validated mutation paths — no new write path:
//   (1) grounding check: current_graph_hash freshness;
//   (2) per-row re-verification against the LIVE external_evidence store —
//       cited rows exist in this project, sources still registered for
//       extraction, canonical triples match the claims, and the tally still
//       reaches `verified` (>= 3 independent sources) — any failure ⇒
//       `stale_values` naming it;
//   (3) `before` snapshot of touched supplier rows;
//   (4) bulk_upsert_suppliers for add_supplier rows — a supplier that
//       appeared since draft is recorded `already_present`, never
//       overwritten;
//   (5) assign_material_supplier per add_supply_link row — the existing
//       lane + supply_chain_data edge + supplier-master sequence
//       (20260705000002), WHERE-NOT-EXISTS idempotent.
// The evidence citations are stamped per applied row in applied_result
// (suppliers/lanes have no citation columns by design — the card + payload
// are the audit trail, the §18.1 interval precedent).
//
// Pure orchestration over an injected supabase-like client: no Deno.env, no
// module-level clients — the deterministic eval tier drives it with a
// stateful stub, and index.ts drives it with the service role.

import {
  matchProjectMaterial,
  verifyMapRow,
  type EvidenceRow,
  type MapRowInput,
} from "../_shared/networkEvidence.ts";
import { normalizeMapRows } from "../project-ai-chat/cartographerTools.ts";
import { ApplyFailure } from "./itemMasterApply.ts";

export interface NetworkMapApplyResult {
  before: { suppliers: Array<Record<string, unknown>> };
  added_suppliers: number;
  added_links: number;
  /** Rows found already satisfied at apply time (idempotent retries, or a
   * supplier/lane that appeared between draft and apply) — left untouched. */
  already_present: string[];
  /** The evidence stamp: per applied row, the external_evidence ids that
   * ground it. */
  evidence_ids: Array<{
    op: string;
    supplier_id: string;
    material_id?: string;
    evidence_ids: string[];
  }>;
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

/**
 * Apply one approved network_map_diff proposal. Throws ApplyFailure with a
 * §4.4 code. Retry is idempotent: already-created suppliers/lanes are
 * recorded `already_present` and skipped, and assign_material_supplier is
 * WHERE-NOT-EXISTS by construction.
 */
export async function applyNetworkMapDiff(
  db: Db,
  args: {
    projectId: string;
    payload: Record<string, unknown>;
    grounding: Record<string, unknown>;
    userId: string;
    userEmail: string | null;
  },
): Promise<NetworkMapApplyResult> {
  // Stored payload rows are the enriched §18.2 shape — strip back to the
  // core row before re-running the draft-time normalizer.
  const storedRows = Array.isArray(args.payload?.rows)
    ? (args.payload.rows as Array<Record<string, unknown>>)
    : [];
  const coreRows = storedRows.map((r) => ({
    op: r.op,
    supplier_name: r.supplier_name,
    ...(r.lei ? { lei: r.lei } : {}),
    ...(r.material_id ? { material_id: r.material_id } : {}),
    evidence_ids: r.evidence_ids,
    ...(typeof r.why === "string" && r.why ? { why: r.why } : {}),
  }));
  const normalized = normalizeMapRows(coreRows);
  if ("code" in normalized) {
    throw new ApplyFailure("rpc_error", `stored payload failed validation: ${normalized.reason}`);
  }
  const rows = normalized.rows;

  // (1) Grounding freshness (§4.2 approved→applied precondition, §8 T8).
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

  // (2) Re-verification against the LIVE evidence store + live tables.
  const [evidenceRes, materialsRes, suppliersRes, lanesRes] = await Promise.all([
    db.from("external_evidence").select("*").eq("project_id", args.projectId),
    db.from("materials").select("material_id,name").eq("project_id", args.projectId),
    db.from("suppliers").select("supplier_id,name,capacity_per_week,reliability_score").eq("project_id", args.projectId),
    db.from("inbound_logistics").select("supplier_id,material_id").eq("project_id", args.projectId),
  ]);
  for (const res of [evidenceRes, materialsRes, suppliersRes, lanesRes]) {
    if (res.error) throw new ApplyFailure("rpc_error", `live-state read failed (${res.error.message})`);
  }
  const evidence = (evidenceRes.data ?? []) as EvidenceRow[];
  const materials = (materialsRes.data ?? []) as Array<Record<string, unknown>>;
  const suppliers = (suppliersRes.data ?? []) as Array<Record<string, unknown>>;
  const lanes = (lanesRes.data ?? []) as Array<Record<string, unknown>>;
  const supplierIds = new Set(suppliers.map((s) => String(s.supplier_id ?? "")));
  const laneKeys = new Set(lanes.map((l) => `${String(l.supplier_id ?? "")}|${String(l.material_id ?? "")}`));

  interface VerifiedRow {
    row: MapRowInput;
    supplierId: string;
    lei: string | null;
  }
  const verified: VerifiedRow[] = [];
  for (const row of rows) {
    const check = verifyMapRow(row, evidence);
    if (!check.ok || !check.supplierId || !check.tally) {
      throw new ApplyFailure("stale_values", check.reason ?? "evidence re-verification failed");
    }
    if (row.op === "add_supply_link") {
      const materialId = row.material_id!;
      if (!materials.some((m) => String(m.material_id ?? "") === materialId)) {
        throw new ApplyFailure("stale_values", `material ${materialId} no longer exists in this project`);
      }
      const matched = matchProjectMaterial(check.tally.object, materials);
      if (matched !== materialId) {
        throw new ApplyFailure(
          "stale_values",
          `the verified Produces evidence names "${check.tally.object}", which no longer matches material ${materialId}`,
        );
      }
    }
    verified.push({ row, supplierId: check.supplierId, lei: check.lei ?? null });
  }

  // (3) before snapshot: current supplier rows for the touched ids.
  const touchedIds = [...new Set(verified.map((v) => v.supplierId))];
  const beforeSuppliers = suppliers.filter((s) => touchedIds.includes(String(s.supplier_id ?? "")));

  const alreadyPresent: string[] = [];
  const evidenceStamp: NetworkMapApplyResult["evidence_ids"] = [];

  // (4) bulk_upsert_suppliers for the NEW suppliers only — an existing row
  // is never overwritten (its capacity/reliability may carry user edits).
  const newSuppliers = verified.filter(
    (v) => v.row.op === "add_supplier" && !supplierIds.has(v.supplierId),
  );
  for (const v of verified) {
    if (v.row.op === "add_supplier" && supplierIds.has(v.supplierId)) {
      alreadyPresent.push(v.supplierId);
    }
  }
  if (newSuppliers.length > 0) {
    const { error } = await db.rpc("bulk_upsert_suppliers", {
      p_project_id: args.projectId,
      p_rows: newSuppliers.map((v) => ({
        supplier_id: v.supplierId,
        name: v.row.supplier_name,
        capacity_per_week: null, // NULL = unlimited until the user sets it
        reliability_score: null, // RPC defaults to 1.0
      })),
    });
    if (error) {
      const msg = String(error.message ?? "write failed");
      throw new ApplyFailure(msg.startsWith("invalid ") ? "gate_blocked" : "rpc_error", `suppliers: ${msg}`);
    }
  }
  for (const v of newSuppliers) {
    evidenceStamp.push({ op: "add_supplier", supplier_id: v.supplierId, evidence_ids: v.row.evidence_ids });
  }

  // (5) assign_material_supplier per link — the existing lane + edge +
  // master sequence, WHERE-NOT-EXISTS idempotent.
  let addedLinks = 0;
  for (const v of verified) {
    if (v.row.op !== "add_supply_link") continue;
    const materialId = v.row.material_id!;
    if (laneKeys.has(`${v.supplierId}|${materialId}`)) {
      alreadyPresent.push(`${v.supplierId}|${materialId}`);
      continue;
    }
    const { error } = await db.rpc("assign_material_supplier", {
      p_project_id: args.projectId,
      p_material_id: materialId,
      p_supplier_id: v.supplierId,
      p_user_id: args.userId,
      p_user_email: args.userEmail,
    });
    if (error) {
      throw new ApplyFailure("rpc_error", `assign ${v.supplierId} → ${materialId}: ${String(error.message ?? "failed")}`);
    }
    addedLinks += 1;
    evidenceStamp.push({
      op: "add_supply_link",
      supplier_id: v.supplierId,
      material_id: materialId,
      evidence_ids: v.row.evidence_ids,
    });
  }

  return {
    before: { suppliers: beforeSuppliers },
    added_suppliers: newSuppliers.length,
    added_links: addedLinks,
    already_present: alreadyPresent,
    evidence_ids: evidenceStamp,
  };
}
