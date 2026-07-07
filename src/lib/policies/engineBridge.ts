// The UI-family -> engine-plugin vocabulary bridge (Phase A / G1 / §6.2).
//
// The /policies forms speak the 7-family vocabulary; the engine speaks the
// plugin vocabulary. `project_map.py` translates between them at run time.
// This module is the frontend's single, validated copy of that translation
// (data in supabase/functions/_shared/engineBridge.json — canonical there so
// the edge gate's grading shares the same tables), so the two vocabularies
// cannot silently drift: scripts/check_registry_bridge.mjs asserts every
// engine target below exists in the registry snapshot (a CI gate). Phase B
// removes this bridge when the forms render engine plugin params directly.

import bridge from "../../../supabase/functions/_shared/engineBridge.json";
import { catalogRef, policyById } from "./registryAccess";

const RESPONSE_TO_POLICY = bridge.recovery_response_to_policy as Record<string, string>;
const TYPE_TO_POLICY_TYPE = bridge.inventory_type_to_policy_type as Record<string, string>;
const SS_METHOD_TO_CLASSIFICATION = bridge.safety_stock_method_to_classification as Record<string, string>;

/** Engine policy id a recovery response activates (e.g. "reroute" -> "expedited_shipments"). */
export const enginePolicyForResponse = (response: string): string | undefined =>
  RESPONSE_TO_POLICY[response];

/** Engine inventory_control.policy_type for a UI inventory `type` value. */
export const enginePolicyTypeFor = (uiType: string): string | undefined =>
  TYPE_TO_POLICY_TYPE[uiType];

/** Engine safety_stock_materials.classification for a UI safety_stock_method. */
export const engineClassificationFor = (method: string): string | undefined =>
  SS_METHOD_TO_CLASSIFICATION[method];

/**
 * Registry-backed helper text for a recovery response: the engine policy it
 * maps to, named with its catalog ref pulled live from the registry (so a
 * renumbering or a planned->implemented change shows through automatically).
 * Returns e.g. "expedited shipments (P-T.2)".
 */
export const responseEngineEffect = (response: string): string | undefined => {
  const policyId = RESPONSE_TO_POLICY[response];
  if (!policyId) return undefined;
  const ref = catalogRef(policyId);
  const name = (policyById(policyId)?.id ?? policyId).replace(/_/g, " ");
  return ref ? `${name} (${ref})` : name;
};
