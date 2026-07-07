// Per-field engine provenance — "which gap in which policy" (G1 visibility).
//
// Every policy field the UI shows is in exactly one state:
//   reaches-engine    consumed by scsim (SCSIM_VISIBLE_FIELDS, kept in sync
//                     with project_map.py::_map_policies by the parity tests)
//   pending           stored and versioned, but not consumed until the named
//                     catalog policy lands — shown, disabled, badged with its
//                     milestone instead of being silently hidden/dropped.
//
// The milestone names come from the engine registry's planned entries
// (P-T.x etc.) so the badge always names the policy that will consume the
// field — the blueprint's honest-catalog property (§6.2, A3).

import { isScsimVisible, type PolicyFamily } from "./schemas";
import { policyCatalog } from "./registryAccess";

export type FieldEngineStatus =
  | { state: "reaches-engine" }
  | { state: "pending"; milestone: string };

/** Planned catalog policies that will consume each not-yet-wired family. */
const PENDING_FAMILY_POLICY: Partial<Record<PolicyFamily, string[]>> = {
  transport: ["multimodal_lane_portfolio", "mode_shift", "leadtime_hedging"],
  production: ["lot_sizing"],
  demand: ["demand_shaping"],
};

function milestoneFor(family: PolicyFamily): string {
  const ids = PENDING_FAMILY_POLICY[family] ?? [];
  const rows = policyCatalog().filter((p) => ids.includes(p.id));
  if (rows.length === 0) return "engine catalog — planned";
  const refs = rows.map((p) => p.catalog_ref).join("/");
  const milestone = rows.find((p) => p.milestone)?.milestone;
  return milestone ? `${refs} · ${milestone}` : refs;
}

export function fieldEngineStatus(family: PolicyFamily, field: string): FieldEngineStatus {
  if (isScsimVisible(family, field)) return { state: "reaches-engine" };
  return { state: "pending", milestone: milestoneFor(family) };
}

/** Header tooltip for a pending field. */
export function pendingTooltip(family: PolicyFamily, field: string): string {
  const st = fieldEngineStatus(family, field);
  if (st.state === "reaches-engine") return "Consumed by the simulation engine.";
  return (
    `Not yet consumed by the engine — this field is stored and versioned, and ` +
    `becomes active when its catalog policy lands (${st.milestone}).`
  );
}
