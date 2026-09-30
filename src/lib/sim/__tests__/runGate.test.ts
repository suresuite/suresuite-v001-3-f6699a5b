import { describe, expect, it } from "vitest";
import { runGateState, type RunGateInput } from "../runGate";

const base: RunGateInput = {
  permitted: true,
  isBaseline: false,
  blocks: 0,
  warns: 0,
  acknowledged: false,
  needsSave: false,
  running: false,
};

// Every combination the page can hold — the gate's surfaces must agree on all of them.
const grid: RunGateInput[] = [];
for (const permitted of [true, false])
  for (const isBaseline of [false, true])
    for (const blocks of [0, 2])
      for (const warns of [0, 1, 3])
        for (const acknowledged of [false, true])
          for (const needsSave of [false, true])
            grid.push({ ...base, permitted, isBaseline, blocks, warns, acknowledged, needsSave });

describe("one run-gate state (WP 9.4 slice 2 · §4 D147)", () => {
  it("the button, the reason and the readout never disagree", () => {
    for (const g of grid) {
      const s = runGateState(g);
      expect(s.canRun, JSON.stringify(g)).toBe(s.reason === null);
      expect(s.canRun, JSON.stringify(g)).toBe(s.kind === "clear");
      // "clear" on the rail is only ever said of a run that can dispatch
      if (s.readout.value === "clear") expect(s.canRun).toBe(true);
    }
  });

  it("D147's fourth state: no capability never reads clear, never asks for an ack", () => {
    const s = runGateState({ ...base, permitted: false });
    expect(s.kind).toBe("capability");
    expect(s.canRun).toBe(false);
    expect(s.readout.value).not.toContain("clear");
    expect(s.stageSub).not.toMatch(/ack/);
  });

  it("an acknowledgement is never asked for zero warnings", () => {
    for (const g of grid) {
      const s = runGateState(g);
      expect(s.stageSub, JSON.stringify(g)).not.toMatch(/^ack 0 /);
      expect(s.reason ?? "", JSON.stringify(g)).not.toMatch(/Acknowledge 0 /);
    }
  });

  it("blocking wins over warnings; warnings need the tick", () => {
    expect(runGateState({ ...base, blocks: 2, warns: 3 }).kind).toBe("blocked");
    expect(runGateState({ ...base, warns: 1 }).kind).toBe("ack_required");
    expect(runGateState({ ...base, warns: 1, acknowledged: true }).kind).toBe("clear");
  });

  it("the validated baseline is not run from the Lab", () => {
    const s = runGateState({ ...base, isBaseline: true });
    expect(s.kind).toBe("baseline");
    expect(s.canRun).toBe(false);
  });

  it("labels stay terse", () => {
    for (const g of grid) {
      const s = runGateState(g);
      expect(s.stageSub.length, s.stageSub).toBeLessThanOrEqual(18);
      expect(s.readout.value.length, s.readout.value).toBeLessThanOrEqual(18);
    }
  });
});
