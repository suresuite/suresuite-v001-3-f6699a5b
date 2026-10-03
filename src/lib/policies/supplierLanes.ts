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
      lead_time: link.leadSource === "master" ? link.leadWeeks : null,
    });
  }
  return out;
}
