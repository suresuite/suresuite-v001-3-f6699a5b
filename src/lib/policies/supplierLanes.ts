/**
 * The Supplier stage's LANE base — the value under a Supplier row's lead time.
 *
 * `inbound_logistics.lead_time` is the first lane column a /policies cell
 * overrides (the Customer row's `price` over `outbound_logistics.unit_price` set
 * the pattern). The override is saved on the row as `sourcing.lead_time_weeks`
 * and the engine reads it ahead of the lane; what the cell shows when nothing is
 * saved is THIS map — each supplier × material link's lead time exactly as the
 * mapper builds it (`engineSupplierLinks`: weeks by `lead_time_unit`, rounded
 * half to even, clamped 1–51, duplicate rows reduced to the cheapest). A lane
 * with no uploaded lead time carries `null`, so the cell falls through to the
 * engine's declared 2 weeks rather than to an average of other lanes (§4 D189).
 *
 * Keyed `<supplier>::<material>` — the row's own key and the engine's
 * `node:<supplier>::<material>`. The field is `lead_time`, the contract column
 * the `master:` pointer names, holding WEEKS.
 */
import { engineSupplierLinks } from "../../../supabase/functions/_shared/grading";

type Row = Record<string, unknown>;

export function supplierLaneMasters(inbound: readonly Row[]): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const [key, link] of engineSupplierLinks(inbound as Row[])) {
    out.set(key, {
      supplier_id: link.supplier,
      material_id: link.material,
      // A bounded lane's planning lead time is DERIVED from its bounds, not the
      // uploaded number (§25.2 rule 3) — the cell shows it as derived
      // (`rowBoundedLeadTime`), so the master slot is empty here.
      lead_time: link.leadSource === "master" ? link.leadWeeks : null,
      // PLAN.md §25 WP 15.2 — the lane's own spread, in weeks.
      lead_time_dist: link.spread.dist,
      lead_time_cv: link.spread.cv,
      lead_time_min: link.spread.min,
      lead_time_mode: link.spread.mode,
      lead_time_max: link.spread.max,
    });
  }
  return out;
}

/**
 * The MATERIAL's lead-time shape under each lane that states none of its own —
 * the derived step of the lane spread chain (row → lane → material →
 * deterministic, `project_map._lane_lead_time_spread`). Keyed like the lanes.
 * A material CV above the engine's bound is shown as the 1 the run uses (§4 D294).
 */
export function laneSpreadFromMaterials(
  inbound: readonly Row[],
  materials: readonly Row[],
): Map<string, { lead_time_dist?: string; lead_time_cv?: number }> {
  const byId = new Map(materials.map((m) => [String(m.material_id ?? m.id ?? ""), m]));
  const out = new Map<string, { lead_time_dist?: string; lead_time_cv?: number }>();
  for (const [key, link] of engineSupplierLinks(inbound as Row[])) {
    const m = byId.get(link.material);
    if (!m) continue;
    const entry: { lead_time_dist?: string; lead_time_cv?: number } = {};
    if (link.spread.dist === null && m.lead_time_dist) entry.lead_time_dist = String(m.lead_time_dist);
    const cv = Number(m.lead_time_cv);
    if (link.spread.cv === null && m.lead_time_cv != null && Number.isFinite(cv) && cv > 0) {
      entry.lead_time_cv = Math.min(cv, 1);
    }
    if (entry.lead_time_dist !== undefined || entry.lead_time_cv !== undefined) out.set(key, entry);
  }
  return out;
}
