// Grader contract tests (§8.2) — run with `deno test --allow-read`.
//
// Locks the shared grading module to the golden validation-parity fixture.
// The Python side of the same contract is sim-worker/tests/
// test_validation_parity.py: it feeds the SAME dataset.json through
// datamap → scsim's from_project_data and asserts the engine's WARN-level
// MappingWarnings coincide with the grader's warn findings. Together the two
// suites pin browser, edge gate, and engine to one semantic.

import registry from "./registry.generated.json" with { type: "json" };
import bridge from "./engineBridge.json" with { type: "json" };
import fixture from "./fixtures/validation_parity/dataset.json" with { type: "json" };
import expected from "./fixtures/validation_parity/expected_findings.json" with { type: "json" };
import {
  activeEnginePolicies,
  flattenFindings,
  gradeManifest,
  type BridgeTables,
  type GradingDataset,
  type RegistryPayload,
  type Row,
} from "./grading.ts";
import { runValidationGate } from "./validationGate.ts";

const REG = registry as unknown as RegistryPayload;
const BRIDGE = bridge as unknown as BridgeTables;
const DATASET = fixture.dataset as unknown as GradingDataset;
const DEFAULTS = fixture.defaults as Row;

function assertEquals(actual: unknown, expectedVal: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expectedVal);
  if (a !== b) {
    throw new Error(`${msg}\n  actual:   ${a}\n  expected: ${b}`);
  }
}

Deno.test("golden fixture grades to the committed expected findings", () => {
  const findings = flattenFindings(gradeManifest(DATASET, DEFAULTS, REG, BRIDGE));
  assertEquals(findings, expected, "grader output drifted from the golden snapshot");
});

Deno.test("the golden fixture never blocks — engine-warn fallbacks are ack-able", () => {
  const findings = flattenFindings(gradeManifest(DATASET, DEFAULTS, REG, BRIDGE));
  const blocks = findings.filter((f) => f.severity === "block");
  assertEquals(blocks, [], "no block may exist: every gap has an engine fallback");
});

Deno.test("an unsourced BOM material is the hard block (engine ValueError mirror)", () => {
  const variant: GradingDataset = {
    ...DATASET,
    materials: [...DATASET.materials, ...(fixture.unsourced_extra.materials as Row[])],
    bom: [...DATASET.bom, ...(fixture.unsourced_extra.bom as Row[])],
  };
  const findings = flattenFindings(gradeManifest(variant, DEFAULTS, REG, BRIDGE));
  const blocks = findings.filter((f) => f.severity === "block");
  assertEquals(blocks.length, 1, "exactly one block expected");
  assertEquals(blocks[0].field, "materials.supplier_link", "block field");
  assertEquals(blocks[0].rows, ["M_UNSOURCED"], "blocked material");
});

Deno.test("gate: warns require acknowledgment, acknowledged warns dispatch", () => {
  const unacknowledged = runValidationGate({
    dataset: DATASET,
    snapshotDefaults: DEFAULTS,
    disruptionSchedule: [],
    acknowledgeWarnings: false,
  });
  if (unacknowledged?.status !== "ack_required") {
    throw new Error(`expected ack_required, got ${JSON.stringify(unacknowledged?.status)}`);
  }
  const acknowledged = runValidationGate({
    dataset: DATASET,
    snapshotDefaults: DEFAULTS,
    disruptionSchedule: [],
    acknowledgeWarnings: true,
  });
  assertEquals(acknowledged, null, "acknowledged warns must dispatch");
});

Deno.test("policy activation matches the engine mapper (parity variant)", () => {
  // sim-worker/tests/test_validation_parity.py asserts the Python half:
  // _map_policies on the same defaults yields exactly expected_policies.
  const v = fixture.activation_variant;
  const active = activeEnginePolicies(v.defaults as Row, 1, BRIDGE, true).sort();
  assertEquals(active, v.expected_policies, "TS activation set diverged from _map_policies");
});

Deno.test("gate: partial-magnitude disruption on a capacity-less supplier warns", () => {
  const gate = runValidationGate({
    dataset: DATASET,
    snapshotDefaults: DEFAULTS,
    disruptionSchedule: [
      { target: "S1", magnitude_pct: 50, start_day: 30, duration_days: 14 },
    ],
    acknowledgeWarnings: false,
  });
  const hit = gate?.findings.find(
    (f) => f.field === "suppliers.capacity_per_week" && f.rows.includes("S1"),
  );
  if (!hit) throw new Error("expected the S1 capacity warn");
});
