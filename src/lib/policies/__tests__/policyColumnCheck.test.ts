import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STAGE_TABLE_SPEC } from "@/lib/policies/columnSpecs";
import { isScsimVisible, visibleFieldGroups } from "@/lib/policies/schemas";
import {
  COLUMN_CHECK,
  CUSTOMER_RULE_CHECK,
  FG_BUFFER_CHECK,
  GRID_STAGES,
  PROJECT_BACKORDER_CHECK,
  KEY_COLUMNS,
  NO_COLUMN_CHECK,
  PAGE_LEVEL_CHECK,
  RUN_VALIDATE_CHECK,
  stageColumnChecks,
  type ColumnCheck,
} from "@/lib/policies/policyColumnCheck";
import { CUSTOMER_RULE, FG_BUFFER_RULE } from "@/lib/policies/projectRules";

/**
 * The Data map's "Policies page, column by column" may not go stale by
 * omission: every column the grid renders has exactly one verdict, and no
 * verdict names a column the grid no longer has. A column added to
 * `STAGE_TABLE_SPEC` fails here until someone writes down what the engine
 * does with it.
 */
describe("policyColumnCheck — one verdict per /policies column", () => {
  it("every grid column has a verdict, and every verdict is a grid column", () => {
    const specKeys = new Set(
      GRID_STAGES.flatMap((s) => STAGE_TABLE_SPEC[s].cols.map((c) => `${s}:${c.field}`)),
    );
    expect(new Set(Object.keys(COLUMN_CHECK))).toEqual(specKeys);
    for (const s of GRID_STAGES) {
      for (const row of stageColumnChecks(s)) expect(row.check, `${s}:${row.field}`).toBeDefined();
    }
  });

  it("a column may only claim to change the run if the engine can reach it", () => {
    // Reaching the engine means master-backed (the engine reads the item
    // master) or in SCSIM_VISIBLE_FIELDS (the mapper reads the policy key).
    // `conditional` and `works` both claim reach; the reverse is not implied —
    // a visible field can still be dropped at row scope (safety_stock_days).
    for (const s of GRID_STAGES) {
      for (const c of STAGE_TABLE_SPEC[s].cols) {
        const v = COLUMN_CHECK[`${s}:${c.field}`].verdict;
        if (v !== "works" && v !== "conditional") continue;
        expect(
          Boolean(c.master) || isScsimVisible(c.family, c.field),
          `${s}:${c.field} is marked "${v}" but is neither master-backed nor engine-visible`,
        ).toBe(true);
      }
    }
  });

  it("a read-only or pending column never claims an edit changes the run", () => {
    for (const s of GRID_STAGES) {
      for (const c of STAGE_TABLE_SPEC[s].cols) {
        if (!c.readOnly || c.synthetic) continue;
        const v = COLUMN_CHECK[`${s}:${c.field}`].verdict;
        expect(["differs", "disabled", "info", "ignored"], `${s}:${c.field}`).toContain(v);
      }
    }
  });

  it("the Allocation section lists exactly the line's fields, and every old card field is accounted for", () => {
    const lineFields = CUSTOMER_RULE.fields.map((f) => f.field);
    expect(new Set(Object.keys(CUSTOMER_RULE_CHECK))).toEqual(new Set(lineFields));
    // Every scsim-visible fulfillment default the old card rendered is either on
    // the line or named as a no-control project value (WP 14.8).
    const cardFields = Object.values(visibleFieldGroups("fulfillment")).flat();
    expect(new Set([...lineFields, ...Object.keys(PROJECT_BACKORDER_CHECK)])).toEqual(new Set(cardFields));
  });

  it("the FG safety buffer section lists exactly the fields the line renders", () => {
    expect(new Set(Object.keys(FG_BUFFER_CHECK))).toEqual(new Set(FG_BUFFER_RULE.fields.map((f) => f.field)));
  });

  it("every §4 row a verdict cites exists in PLAN.md", () => {
    const plan = readFileSync(resolve(__dirname, "../../../../docs/PLAN.md"), "utf8");
    const all: ColumnCheck[] = [
      ...Object.values(COLUMN_CHECK),
      ...Object.values(CUSTOMER_RULE_CHECK),
      ...Object.values(FG_BUFFER_CHECK),
      ...Object.values(PROJECT_BACKORDER_CHECK),
      ...GRID_STAGES.flatMap((s) => KEY_COLUMNS[s].map((k) => k.check)),
      ...[PAGE_LEVEL_CHECK, RUN_VALIDATE_CHECK, NO_COLUMN_CHECK].flat().map((r) => r.check),
    ];
    for (const c of all) {
      for (const d of c.refs ?? []) {
        const hasRow = new RegExp(`^\\| \\*{0,2}${d}\\*{0,2} \\|`, "m").test(plan);
        expect(hasRow, `${d} is cited but has no §4 row`).toBe(true);
      }
    }
  });
});
