import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VALIDATION_SCENARIO_NAME,
  findValidationBaseline,
  isValidationBaseline,
} from "../validationBaseline";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("the validated baseline is found by role, not by name (§4 D225)", () => {
  it("a renamed baseline is still the baseline", () => {
    const rows = [
      { id: "a", name: "Scenario 1", role: "experiment" },
      { id: "b", name: "My renamed validation", role: "validation_baseline" },
    ];
    expect(findValidationBaseline(rows)?.id).toBe("b");
    expect(isValidationBaseline(rows[1])).toBe(true);
  });

  it("once roles exist, the old name alone is not a baseline", () => {
    const rows = [
      { id: "a", name: VALIDATION_SCENARIO_NAME, role: "experiment" },
      { id: "b", name: "x", role: "experiment" },
    ];
    expect(findValidationBaseline(rows)).toBeNull();
    expect(isValidationBaseline(rows[0])).toBe(false);
  });

  it("before the column deploys, the name is the fallback", () => {
    const rows = [{ id: "a", name: VALIDATION_SCENARIO_NAME }, { id: "b", name: "x" }];
    expect(findValidationBaseline(rows)?.id).toBe("a");
  });

  it("Run & Validate no longer matches its scenario by name", () => {
    const src = readFileSync(join(ROOT, "src/components/policies/RunValidateStage.tsx"), "utf8");
    expect(src).not.toMatch(/s\.name === VALIDATION_SCENARIO_NAME/);
    expect(src).toContain("findValidationBaseline(scenarios)");
  });
});
