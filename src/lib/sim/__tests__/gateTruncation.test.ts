import { describe, expect, it } from "vitest";
import fixture from "../../../../supabase/functions/_shared/fixtures/validation_parity/dataset.json";
import { GATE_ROW_CEILING, runValidationGate } from "../../../../supabase/functions/_shared/validationGate.ts";
import type { GradingDataset } from "../../../../supabase/functions/_shared/grading.ts";

// Audit F-19(b). `loadGateDataset` reports `dataset.truncated` when a table
// comes back at the 50 000-row ceiling, and `runValidationGate` never read it —
// so a large project passed the pre-run gate on a SLICE while the run row
// recorded a clean pass. A graded slice is now a `warn`: the run needs the
// same acknowledgement any other warn needs, and the finding names the tables.
const f = fixture as unknown as { dataset: GradingDataset; defaults: Record<string, unknown> };

const gate = (dataset: GradingDataset, acknowledgeWarnings = false) =>
  runValidationGate({ dataset, snapshotDefaults: f.defaults ?? {}, disruptionSchedule: [], acknowledgeWarnings });

describe("the pre-run gate says when it graded a slice", () => {
  it("a truncated dataset is a warn finding naming the tables and the ceiling", () => {
    const res = gate({ ...f.dataset, truncated: ["inbound_logistics"] }, false);
    expect(res?.status).toBe("ack_required");
    const w = res!.findings.find((x) => x.field === "dataset.truncated");
    expect(w?.severity).toBe("warn");
    expect(w?.rows).toEqual(["inbound_logistics"]);
    expect(w?.message).toContain(String(GATE_ROW_CEILING));
  });

  it("acknowledging it lets the run through, as for any warn", () => {
    expect(gate({ ...f.dataset, truncated: ["inbound_logistics"] }, true)).toBeNull();
  });

  it("a complete dataset adds no such finding", () => {
    const res = gate(f.dataset, false);
    expect(res?.findings.some((x) => x.field === "dataset.truncated") ?? false).toBe(false);
  });
});
