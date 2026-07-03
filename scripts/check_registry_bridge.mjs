// Assert the UI->engine vocabulary bridge stays consistent with the engine
// registry snapshot (Phase A / G1 / §6.2). Dependency-free (Node built-ins
// only) so it runs in the existing scsim-tests CI job without extra tooling.
//
//   node scripts/check_registry_bridge.mjs
//
// Fails (exit 1) if src/lib/policies/engineBridge.json references an engine
// policy id or enum value that does not exist in
// src/lib/policies/registry.generated.json — i.e. if the engine changed and
// the bridge (or the snapshot) was not updated to match.

import { readFileSync } from "node:fs";

const load = (rel) =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

const registry = load("../src/lib/policies/registry.generated.json");
const bridge = load("../src/lib/policies/engineBridge.json");

const byId = new Map(registry.policies.map((p) => [p.id, p]));
const errors = [];

const paramEnum = (policyId, field) =>
  byId.get(policyId)?.params_schema?.properties?.[field]?.enum;

// 1. Every recovery response maps to a real engine policy id.
for (const [response, policyId] of Object.entries(bridge.recovery_response_to_policy)) {
  if (!byId.has(policyId)) {
    errors.push(`recovery_response "${response}" -> unknown engine policy "${policyId}"`);
  }
}

// 2. Every UI inventory type maps to a real inventory_control.policy_type value.
const policyTypeEnum = paramEnum("inventory_control", "policy_type") ?? [];
for (const [uiType, engineValue] of Object.entries(bridge.inventory_type_to_policy_type)) {
  if (!policyTypeEnum.includes(engineValue)) {
    errors.push(
      `inventory type "${uiType}" -> "${engineValue}" is not in inventory_control.policy_type ` +
        `[${policyTypeEnum.join(", ")}]`,
    );
  }
}

// 3. Every UI safety-stock method maps to a real classification value.
const classificationEnum = paramEnum("safety_stock_materials", "classification") ?? [];
for (const [method, engineValue] of Object.entries(bridge.safety_stock_method_to_classification)) {
  if (!classificationEnum.includes(engineValue)) {
    errors.push(
      `safety_stock_method "${method}" -> "${engineValue}" is not in ` +
        `safety_stock_materials.classification [${classificationEnum.join(", ")}]`,
    );
  }
}

if (errors.length > 0) {
  console.error("REGISTRY BRIDGE DRIFT — engineBridge.json disagrees with the engine:");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nUpdate src/lib/policies/engineBridge.json (and regenerate registry.generated.json " +
      "if the engine changed).",
  );
  process.exit(1);
}

console.log(`registry bridge OK (${byId.size} engine policies; all bridge targets valid)`);
