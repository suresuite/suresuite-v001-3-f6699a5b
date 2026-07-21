// network_map_diff apply mapping — Phase 4b (ai-agents.md §4.4 row added in
// v1.5, §18.2 hard gate 7) + Phase 4c product level (§18.2 v2, flag
// CARTOGRAPHER_PRODUCT_LEVEL).
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
//
// v2 apply scope (§18.2 v2 — payloads with add_bom_line / add_outbound_lane
// rows, which can only exist when CARTOGRAPHER_PRODUCT_LEVEL was on at
// draft; the flag is re-checked here, the kill-switch discipline):
//   (2b) rate re-verification: every add_bom_line rate recomputed through
//        its named registered method against the LIVE dataset (1e-9), and
//        the MASS-BALANCE validator re-run over live flows — any failure ⇒
//        `stale_values` naming it (a rate is never silently adjusted);
//   (6) assign_bom_line per add_bom_line row — bom_single_level lane +
//       supply_chain_data 'bom' edge, WHERE-NOT-EXISTS idempotent
//       (20260728000001);
//   (7) assign_outbound_customer per add_outbound_lane row — structural
//       outbound_logistics lane (economics NULL — never estimated) +
//       supply_chain_data 'outbound' edge, WHERE-NOT-EXISTS idempotent;
//   (8) G16 self-verification (blueprint §12, verbatim): after the writes,
//       the outcome is confirmed through the SAME read paths the app uses —
//       list_projects (org-correct visibility), get_project_dataset_status
//       (dataset complete), and the pre-run gate (the ONE shared grader,
//       zero blocks) — recorded on applied_result.verification; `done` is
//       true only when all three pass, else the card reports what is still
//       red, as a human would see it.
//
// The evidence citations are stamped per applied row in applied_result
// (suppliers/lanes have no citation columns by design — the card + payload
// are the audit trail, the §18.1 interval precedent).
//
// Pure orchestration over an injected supabase-like client: no Deno.env
// beyond the flag read, no module-level clients — the deterministic eval
// tier drives it with a stateful stub, and index.ts drives it with the
// service role.

import {
  matchProjectMaterial,
  supplierIdFor,
  verifyMapRow,
  type EvidenceRow,
  type MapRowInput,
} from "../_shared/networkEvidence.ts";
import { normalizeMapRows, productLevelEnabled } from "../project-ai-chat/cartographerTools.ts";
import {
  checkMassBalance,
  verifyRateRow,
  type EstimatorInputs,
  type RatePair,
} from "../_shared/estimators.ts";
import { loadGateDataset, runValidationGate } from "../_shared/validationGate.ts";
import { loadPolicyDefaults } from "../_shared/itemMasterCandidates.ts";
import { normalizeBomRows } from "../_shared/grading.ts";
import { ApplyFailure } from "./itemMasterApply.ts";

/** The G16 self-verification record (blueprint §12): the three read-path
 * checks, verbatim, plus the derived `done`. */
export interface RunReadinessVerification {
  /** list_projects returns the project in the acting principal's org. */
  org_visible: boolean;
  /** get_project_dataset_status — the app's own completeness read. */
  dataset: Record<string, unknown> | null;
  /** The ONE shared pre-run grader: zero blocks = green (warns are
   * acknowledgeable, never blocking). */
  gate: { blocks: number; warns: number; green: boolean };
  /** True only when all three checks pass — otherwise the card reports
   * what is still red. */
  done: boolean;
}

export interface NetworkMapApplyResult {
  before: { suppliers: Array<Record<string, unknown>> };
  added_suppliers: number;
  added_links: number;
  /** §18.2 v2. Absent-as-zero on v1 payloads. */
  added_bom_lines: number;
  added_outbound_lanes: number;
  /** Rows found already satisfied at apply time (idempotent retries, or a
   * supplier/lane that appeared between draft and apply) — left untouched. */
  already_present: string[];
  /** The evidence stamp: per applied row, the external_evidence ids that
   * ground it. */
  evidence_ids: Array<{
    op: string;
    supplier_id: string;
    material_id?: string;
    product_id?: string;
    customer_id?: string;
    evidence_ids: string[];
  }>;
  /** §18.2 v2 payloads only: the G16 run-readiness self-verification. */
  verification?: RunReadinessVerification;
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

const V2_OPS = new Set(["add_bom_line", "add_outbound_lane"]);

/**
 * Apply one approved network_map_diff proposal. Throws ApplyFailure with a
 * §4.4 code. Retry is idempotent: already-created suppliers/lanes/BOM lines
 * are recorded `already_present` and skipped, and every assign RPC is
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
    ...(r.product_id ? { product_id: r.product_id } : {}),
    ...(r.customer_name ? { customer_name: r.customer_name } : {}),
    ...(r.rate_method ? { rate_method: r.rate_method } : {}),
    ...(r.rate != null ? { rate: r.rate } : {}),
    ...(r.rate_low != null ? { rate_low: r.rate_low } : {}),
    ...(r.rate_high != null ? { rate_high: r.rate_high } : {}),
    evidence_ids: r.evidence_ids,
    ...(typeof r.why === "string" && r.why ? { why: r.why } : {}),
  }));
  const hasV2 = coreRows.some((r) => V2_OPS.has(String(r.op)));

  // §9 kill-switch discipline: a stored v2 payload does not apply once the
  // flag is off — flags gate existence, not just drafting.
  if (hasV2 && !productLevelEnabled()) {
    throw new ApplyFailure(
      "gate_blocked",
      "this proposal carries product-level rows (add_bom_line / add_outbound_lane) but CARTOGRAPHER_PRODUCT_LEVEL is disabled in this deployment",
    );
  }

  const normalized = normalizeMapRows(coreRows, { productLevel: hasV2 });
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

  // (2b) v2 only: the grader dataset + live defaults for rate recomputation
  // and the mass-balance re-run — the SAME rows the gate grades.
  let inputs: EstimatorInputs | null = null;
  let existingBomPairs = new Set<string>();
  let existingOutboundKeys = new Set<string>();
  if (hasV2) {
    const [dataset, defaults] = await Promise.all([
      loadGateDataset(db, args.projectId),
      loadPolicyDefaults(db, args.projectId),
    ]);
    inputs = { dataset, defaults };
    existingBomPairs = new Set(
      normalizeBomRows(dataset.bom)
        .map((b) => `${String(b.product_id ?? "")}|${String(b.material_id ?? "")}`),
    );
    existingOutboundKeys = new Set(
      dataset.outbound.map((o) => `${String(o.product_id ?? "")}|${String(o.customer_id ?? "")}`),
    );
  }

  interface VerifiedRow {
    row: MapRowInput;
    supplierId: string;
    lei: string | null;
    /** add_bom_line: the recomputed rate; add_outbound_lane: the derived
     * customer id (via the stored enriched row — recomputed here). */
    rate?: number;
    customerId?: string;
  }
  const verified: VerifiedRow[] = [];
  const proposedBomLines: Array<RatePair & { rate: number }> = [];
  for (const row of rows) {
    const check = verifyMapRow(row, evidence);
    if (!check.ok || !check.supplierId || !check.tally) {
      throw new ApplyFailure("stale_values", check.reason ?? "evidence re-verification failed");
    }
    const entry: VerifiedRow = { row, supplierId: check.supplierId, lei: check.lei ?? null };
    if (row.op === "add_supply_link" || row.op === "add_bom_line") {
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
    if (row.op === "add_bom_line" || row.op === "add_outbound_lane") {
      const productId = row.product_id!;
      if (!inputs!.dataset.products.some((p) => String(p.product_id ?? "") === productId)) {
        throw new ApplyFailure("stale_values", `product ${productId} no longer exists in this project`);
      }
    }
    if (row.op === "add_bom_line") {
      const rateCheck = verifyRateRow(
        {
          product_id: row.product_id!,
          material_id: row.material_id!,
          method: row.rate_method!,
          rate: row.rate!,
          low: row.rate_low!,
          high: row.rate_high!,
        },
        inputs!,
      );
      if (!rateCheck.ok || !rateCheck.estimate) {
        throw new ApplyFailure("stale_values", rateCheck.reason ?? "rate re-verification failed");
      }
      entry.rate = rateCheck.estimate.value;
      if (!existingBomPairs.has(`${row.product_id}|${row.material_id}`)) {
        proposedBomLines.push({
          product_id: row.product_id!,
          material_id: row.material_id!,
          rate: rateCheck.estimate.value,
        });
      }
    }
    if (row.op === "add_outbound_lane") {
      // Derive the customer id exactly as draft did (ext-slug — the object
      // side carries no LEI).
      entry.customerId = supplierIdFor(row.customer_name!, null);
    }
    verified.push(entry);
  }

  // (2b) Mass balance over LIVE flows + the not-yet-applied lines — drift
  // here (a vanished arc, grown demand) is stale grounding, not a write.
  if (proposedBomLines.length > 0) {
    const violations = checkMassBalance(inputs!, proposedBomLines);
    if (violations.length > 0) {
      const named = violations.map((v) =>
        `${v.material_id}: required ${v.required_weekly.toFixed(2)}/wk > available ${v.available_weekly.toFixed(2)}/wk`
      ).join("; ");
      throw new ApplyFailure(
        "stale_values",
        `mass balance no longer closes against the live dataset (${named}) — ask for a fresh draft; rates are never silently adjusted`,
      );
    }
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

  // (6) assign_bom_line per BOM row (§18.2 v2) — bom_single_level lane +
  // 'bom' edge, WHERE-NOT-EXISTS idempotent (20260728000001). The written
  // rate is the RECOMPUTED value; the interval/method/sources live on the
  // card (the §18.1 point-value precedent — the lane has no interval
  // columns, by design).
  let addedBomLines = 0;
  for (const v of verified) {
    if (v.row.op !== "add_bom_line") continue;
    const pairKey = `${v.row.product_id}|${v.row.material_id}`;
    if (existingBomPairs.has(pairKey)) {
      alreadyPresent.push(pairKey);
      continue;
    }
    const { error } = await db.rpc("assign_bom_line", {
      p_project_id: args.projectId,
      p_product_id: v.row.product_id,
      p_material_id: v.row.material_id,
      p_rate: v.rate,
      p_user_id: args.userId,
      p_user_email: args.userEmail,
    });
    if (error) {
      throw new ApplyFailure(
        "rpc_error",
        `bom line ${v.row.product_id} × ${v.row.material_id}: ${String(error.message ?? "failed")}`,
      );
    }
    addedBomLines += 1;
    evidenceStamp.push({
      op: "add_bom_line",
      supplier_id: v.supplierId,
      product_id: v.row.product_id,
      material_id: v.row.material_id,
      evidence_ids: v.row.evidence_ids,
    });
  }

  // (7) assign_outbound_customer per lane row (§18.2 v2) — structural
  // outbound_logistics lane (economics NULL, never estimated) + 'outbound'
  // edge, WHERE-NOT-EXISTS idempotent.
  let addedOutbound = 0;
  for (const v of verified) {
    if (v.row.op !== "add_outbound_lane") continue;
    const laneKey = `${v.row.product_id}|${v.customerId}`;
    if (existingOutboundKeys.has(laneKey)) {
      alreadyPresent.push(laneKey);
      continue;
    }
    const { error } = await db.rpc("assign_outbound_customer", {
      p_project_id: args.projectId,
      p_product_id: v.row.product_id,
      p_customer_id: v.customerId,
      p_user_id: args.userId,
      p_user_email: args.userEmail,
    });
    if (error) {
      throw new ApplyFailure(
        "rpc_error",
        `outbound lane ${v.row.product_id} → ${v.customerId}: ${String(error.message ?? "failed")}`,
      );
    }
    addedOutbound += 1;
    evidenceStamp.push({
      op: "add_outbound_lane",
      supplier_id: v.supplierId,
      product_id: v.row.product_id,
      customer_id: v.customerId,
      evidence_ids: v.row.evidence_ids,
    });
  }

  const result: NetworkMapApplyResult = {
    before: { suppliers: beforeSuppliers },
    added_suppliers: newSuppliers.length,
    added_links: addedLinks,
    added_bom_lines: addedBomLines,
    added_outbound_lanes: addedOutbound,
    already_present: alreadyPresent,
    evidence_ids: evidenceStamp,
  };

  // (8) G16 self-verification (blueprint §12, verbatim) — v2 payloads only:
  // confirm the outcome through the SAME read paths the app uses before the
  // card may say "done". Failures here never roll back the (idempotent)
  // writes; they are reported red on the card.
  if (hasV2) {
    result.verification = await verifyRunReadiness(db, {
      projectId: args.projectId,
      userId: args.userId,
      userEmail: args.userEmail,
    });
  }

  return result;
}

/** The three G16 read-path checks (blueprint §12): list_projects,
 * get_project_dataset_status, and the ONE shared pre-run grader. Exported so
 * the eval tier and the demo transcript run the identical verification. */
export async function verifyRunReadiness(
  db: Db,
  args: { projectId: string; userId: string; userEmail: string | null },
): Promise<RunReadinessVerification> {
  // (a) Org-correct visibility: the project appears in the acting
  // principal's own list_projects — G16's wrong-org-invisibility check.
  let orgVisible = false;
  try {
    const { data } = await db.rpc("list_projects", {
      p_user_id: args.userId,
      p_user_email: args.userEmail,
    });
    orgVisible = Array.isArray(data) &&
      data.some((p: Record<string, unknown>) => String(p.id) === args.projectId);
  } catch { /* stays false — reported red, never assumed */ }

  // (b) Dataset completeness through the app's own status read.
  let datasetStatus: Record<string, unknown> | null = null;
  try {
    const { data } = await db.rpc("get_project_dataset_status", {
      p_project_id: args.projectId,
      p_user_id: args.userId,
      p_user_email: args.userEmail,
    });
    if (data && typeof data === "object") datasetStatus = data as Record<string, unknown>;
  } catch { /* stays null — reported red, never assumed */ }

  // (c) The pre-run gate: the SAME grader sim-command dispatches through —
  // zero blocks is the G16 bar (warns are acknowledgeable, never blocking).
  let blocks = 0;
  let warns = 0;
  try {
    const [dataset, defaults] = await Promise.all([
      loadGateDataset(db, args.projectId),
      loadPolicyDefaults(db, args.projectId),
    ]);
    const gate = runValidationGate({
      dataset,
      snapshotDefaults: defaults,
      disruptionSchedule: [],
      acknowledgeWarnings: false,
    });
    if (gate) {
      blocks = gate.findings.filter((f) => f.severity === "block").length;
      warns = gate.findings.filter((f) => f.severity === "warn").length;
    }
  } catch {
    blocks = -1; // the gate could not run at all — reported red
  }
  const green = blocks === 0;
  return {
    org_visible: orgVisible,
    dataset: datasetStatus,
    gate: { blocks, warns, green },
    done: orgVisible && green && datasetStatus?.completed !== false,
  };
}
