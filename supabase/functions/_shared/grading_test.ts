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
// The SAME BOM in bom_multi_level shape — P_OK's materials routed through the
// intermediate assembly SUB_OK — must grade exactly like the single-level
// fixture. Both the browser verification and the sim-command gate pass their
// BOM rows RAW into gradeManifest, which flattens the multi-level shape
// itself (normalizeBomRows, the datamap._flatten_multi_level_bom port) — so
// these tests pin BOTH surfaces at once: the two can never again grade
// different BOMs, intermediates are never flagged unsourced (the engine
// demands supplier links only for leaf materials), and an unsourced leaf
// under an intermediate still blocks.

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

Deno.test("normalizeBomRows: flattens to root→leaf pairs; single-level passes through", () => {
  const pairs = (rows: Row[]) =>
    rows
      .map((r) => `${r.product_id}→${r.material_id}`)
      .sort();
  assertEquals(
    pairs(normalizeBomRows(MULTI_BOM)),
    pairs(DATASET.bom),
    "flattened multi rows must carry the single-level (product_id, material_id) pairs",
  );
  // The intermediate assembly is collapsed away — it is neither a product
  // nor a material in any flattened pair (the engine never sources it).
  const flat = normalizeBomRows([...MULTI_BOM, ...MULTI_UNSOURCED_BOM]);
  if (flat.some((r) => r.product_id === "SUB_OK" || r.material_id === "SUB_OK")) {
    throw new Error("intermediate SUB_OK leaked into the flattened BOM");
  }
  // The deep leaf traces up to its root product.
  if (!flat.some((r) => r.product_id === "P_OK" && r.material_id === "M_UNSOURCED")) {
    throw new Error("deep leaf M_UNSOURCED did not flatten up to P_OK");
  }
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

// ── §4 D75 — per-product capacity must grade the way the engine resolves it ──
// The plant grid keys its production patches "<plant>::<product>". Before the
// engine learned that spelling the grader agreed with it by accident: both
// ignored the row. Now the engine applies it, so a grader that still reports
// "defaulted" tells the user the opposite of what the run will do.

const PLANT = fixture.plant_override_variant;
const CAP_FIELD = "products.production_capacity";
const CAP_TARGET = PLANT.target_product as string;

/** Rows still reported as capacity-defaulted for `overrides`. */
function capacityWarnRows(overrides: Row[]): string[] {
  const variant: GradingDataset = { ...DATASET, overrides };
  const findings = flattenFindings(gradeManifest(variant, DEFAULTS, REG, BRIDGE));
  const warn = findings.find((f) => f.field === CAP_FIELD && f.severity === "warn");
  return warn ? warn.rows : [];
}

/** The weekly capacity the grader resolved for `id`, or undefined. */
function resolvedCapacity(overrides: Row[], id: string): number | undefined {
  const variant: GradingDataset = { ...DATASET, overrides };
  const graded = gradeManifest(variant, DEFAULTS, REG, BRIDGE)
    .find((g) => g.field === CAP_FIELD);
  return graded?.resolved.find((r) => r.id === id)?.value;
}

Deno.test("D75: a dataset with no overrides grades exactly as before", () => {
  // The no-regression guard. The golden snapshot test above already pins the
  // absent-field case; this pins the present-but-empty one.
  assertEquals(capacityWarnRows([]), ["P_PRICE_FALLBACK", "P_NO_DEMAND"],
    "an empty overrides array must change nothing");
});

Deno.test("D75: a composite <plant>::<product> override resolves capacity", () => {
  const rows = capacityWarnRows(PLANT.composite as Row[]);
  assertEquals(rows.includes(CAP_TARGET), false,
    `${CAP_TARGET} has a line capacity — the engine uses it, so the grader may not call it defaulted`);
  assertEquals(rows, ["P_NO_DEMAND"], "the product without an override still warns");
  assertEquals(
    resolvedCapacity(PLANT.composite as Row[], CAP_TARGET),
    PLANT.expected_weekly_capacity.composite,
    "capacity_units_per_day x 7 x utilization — the engine's own arithmetic",
  );
});

Deno.test("D75: the bare node:<product> spelling still resolves", () => {
  assertEquals(
    resolvedCapacity(PLANT.bare as Row[], CAP_TARGET),
    PLANT.expected_weekly_capacity.bare,
    "the bare key must keep working — no writer is required to use the composite form",
  );
});

Deno.test("D75: composite beats bare, matching the engine's precedence", () => {
  const both = [...(PLANT.bare as Row[]), ...(PLANT.composite as Row[])];
  assertEquals(
    resolvedCapacity(both, CAP_TARGET),
    PLANT.expected_weekly_capacity.composite,
    "defaults < node:<product> < node:<owner>::<product>",
  );
});

Deno.test("D75: an override on a product with a master capacity is not consulted", () => {
  // Master precedence is the engine's (project_map.py) and gradeManifest's
  // short-circuit on binding.master(row) > 0 — P_OK carries 900 units/week.
  const rows = capacityWarnRows([{
    scope: "node", target_key: "Focal plant::P_OK", family: "production",
    patch: { capacity_units_per_day: 1 },
  }] as Row[]);
  assertEquals(rows, ["P_PRICE_FALLBACK", "P_NO_DEMAND"],
    "P_OK has a master capacity, so it is neither warned nor policy-resolved");
});

Deno.test("D75: a non-production or non-node override is ignored", () => {
  const rows = capacityWarnRows([
    { scope: "node", target_key: `Focal plant::${CAP_TARGET}`, family: "inventory",
      patch: { capacity_units_per_day: 20 } },
    { scope: "edge", target_key: `Focal plant::${CAP_TARGET}`, family: "production",
      patch: { capacity_units_per_day: 20 } },
    { scope: "node", target_key: "Focal plant::P_NOT_A_PRODUCT", family: "production",
      patch: { capacity_units_per_day: 20 } },
  ] as Row[]);
  assertEquals(rows, ["P_PRICE_FALLBACK", "P_NO_DEMAND"],
    "only a node-scoped production patch naming a real product may resolve capacity");
});
