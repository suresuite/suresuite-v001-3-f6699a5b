// Per-field engine provenance — "which gap in which policy" (G1 visibility).
//
// Every policy field the UI shows is in exactly one state:
//   reaches-engine    consumed by scsim (SCSIM_VISIBLE_FIELDS, kept in sync
//                     with project_map.py::_map_policies by the parity tests)
//   pending           stored and versioned, but not consumed until the NAMED
//                     catalog policy lands — shown, disabled, badged with its
//                     milestone instead of being silently hidden/dropped.
//   stored-only       stored and versioned, consumed by nothing, and NO catalog
//                     policy is planned that would change that. See below: this
//                     state exists because `pending` was being used for it.
//
// The milestone names come from the engine registry's planned entries
// (P-T.x etc.) so the badge always names the policy that will consume the
// field — the blueprint's honest-catalog property (§6.2, A3).

import { isScsimVisible, type PolicyFamily } from "./schemas";
import { policyCatalog } from "./registryAccess";

export type FieldEngineStatus =
  | { state: "reaches-engine" }
  | { state: "pending"; milestone: string }
  | { state: "stored-only" };

/** Planned catalog policies that will consume each not-yet-wired family. */
const PENDING_FAMILY_POLICY: Partial<Record<PolicyFamily, string[]>> = {
  transport: ["multimodal_lane_portfolio", "mode_shift", "leadtime_hedging"],
  production: ["lot_sizing"],
  demand: ["demand_shaping"],
};

/**
 * THE FALLBACK USED TO BE A PROMISE NOBODY HAD MADE (§4 D92).
 *
 * This returned the literal string `"engine catalog — planned"` for any family
 * with no row in `PENDING_FAMILY_POLICY`, and every caller treated that as a
 * milestone. So the Parameter Sheet told the user, of `reorder_point`:
 *
 *     stored only · activates with engine catalog — planned
 *
 * — and nothing is planned. `inventory` and `sourcing` are not in the table
 * above, and WP 6.2 established what those fields actually are: `reorder_point`
 * is COMPUTED by both engines and never read, `review_period_days` and
 * `order_up_to` are read only by the frozen legacy engine, `material_price` is
 * read by nothing at all (§4 D18, D91). None of them is waiting for a policy.
 *
 * Returning `null` here is what makes the difference sayable: a field with a
 * milestone is `pending`, a field without one is `stored-only`, and the product
 * stops inventing a future for the second kind. T2 — a substitution is visible at
 * the point of display, and "we will consume this later" is a claim, not a plan.
 */
function milestoneFor(family: PolicyFamily): string | null {
  const ids = PENDING_FAMILY_POLICY[family] ?? [];
  const rows = policyCatalog().filter((p) => ids.includes(p.id));
  if (rows.length === 0) return null;
  const refs = rows.map((p) => p.catalog_ref).join("/");
  const milestone = rows.find((p) => p.milestone)?.milestone;
  return milestone ? `${refs} · ${milestone}` : refs;
}

export function fieldEngineStatus(family: PolicyFamily, field: string): FieldEngineStatus {
  if (isScsimVisible(family, field)) return { state: "reaches-engine" };
  const milestone = milestoneFor(family);
  return milestone ? { state: "pending", milestone } : { state: "stored-only" };
}

/** Header tooltip for a field the engine does not consume. */
export function pendingTooltip(family: PolicyFamily, field: string): string {
  const st = fieldEngineStatus(family, field);
  if (st.state === "reaches-engine") return "Consumed by the simulation engine.";
  if (st.state === "pending") {
    return (
      `Not yet consumed by the engine — this field is stored and versioned, and ` +
      `becomes active when its catalog policy lands (${st.milestone}).`
    );
  }
  return (
    `Stored and versioned, and NOT consumed by the simulation — no catalog policy ` +
    `is planned that would consume it. Editing it changes what is saved and hashed, ` +
    `and changes no result.`
  );
}
