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
  normalizeBomRows,
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

// ── Multi-level BOM golden variant (§8.2) ────────────────────────────────────
// The SAME BOM in bom_multi_level shape must grade exactly like the
// single-level fixture. Both the browser verification and the sim-command
// gate pass their BOM rows RAW into gradeManifest, which normalizes the shape
// itself (normalizeBomRows) — so these tests pin BOTH surfaces at once: the
// two can never again grade different BOMs.

const MULTI_BOM = fixture.multi_level_variant.bom as Row[];
const MULTI_UNSOURCED_BOM = fixture.multi_level_variant.unsourced_bom as Row[];

Deno.test("multi-level BOM grades identically to the same BOM in single-level shape", () => {
  const multi = flattenFindings(
    gradeManifest({ ...DATASET, bom: MULTI_BOM }, DEFAULTS, REG, BRIDGE),
  );
  const single = flattenFindings(gradeManifest(DATASET, DEFAULTS, REG, BRIDGE));
  assertEquals(multi, single, "the two BOM shapes graded differently");
  assertEquals(multi, expected, "multi-level grading drifted from the golden snapshot");
});

Deno.test("multi-level BOM: an unsourced material raises the same hard block", () => {
  const extraMaterials = fixture.unsourced_extra.materials as Row[];
  const multiVariant: GradingDataset = {
    ...DATASET,
    materials: [...DATASET.materials, ...extraMaterials],
    bom: [...MULTI_BOM, ...MULTI_UNSOURCED_BOM],
  };
  const findings = flattenFindings(gradeManifest(multiVariant, DEFAULTS, REG, BRIDGE));
  const blocks = findings.filter((f) => f.severity === "block");
  assertEquals(blocks.length, 1, "exactly one block expected");
  assertEquals(blocks[0].field, "materials.supplier_link", "block field");
  assertEquals(blocks[0].rows, ["M_UNSOURCED"], "blocked material");

  // Finding-for-finding parity with the single-level unsourced variant.
  const singleVariant: GradingDataset = {
    ...DATASET,
    materials: [...DATASET.materials, ...extraMaterials],
    bom: [...DATASET.bom, ...(fixture.unsourced_extra.bom as Row[])],
  };
  assertEquals(
    findings,
    flattenFindings(gradeManifest(singleVariant, DEFAULTS, REG, BRIDGE)),
    "multi- and single-level unsourced variants graded differently",
  );
});

Deno.test("gate: a multi-level unsourced BOM material blocks the dispatch", () => {
  const gate = runValidationGate({
    dataset: {
      ...DATASET,
      materials: [...DATASET.materials, ...(fixture.unsourced_extra.materials as Row[])],
      bom: [...MULTI_BOM, ...MULTI_UNSOURCED_BOM],
    },
    snapshotDefaults: DEFAULTS,
    disruptionSchedule: [],
    acknowledgeWarnings: true,
  });
  if (gate?.status !== "blocked") {
    throw new Error(`expected blocked, got ${JSON.stringify(gate?.status)}`);
  }
  const block = gate.findings.find((f) => f.severity === "block");
  assertEquals(block?.field, "materials.supplier_link", "block field");
  assertEquals(block?.rows, ["M_UNSOURCED"], "blocked material");
});

Deno.test("normalizeBomRows: parent stands in for product_id; single-level passes through", () => {
  const pairs = (rows: Row[]) =>
    rows.map((r) => ({ product_id: r.product_id, material_id: r.material_id }));
  assertEquals(
    pairs(normalizeBomRows(MULTI_BOM)),
    pairs(DATASET.bom),
    "normalized multi rows must carry the single-level (product_id, material_id) pairs",
  );
  assertEquals(
    normalizeBomRows(DATASET.bom),
    DATASET.bom,
    "single-level rows must pass through unchanged",
  );
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
