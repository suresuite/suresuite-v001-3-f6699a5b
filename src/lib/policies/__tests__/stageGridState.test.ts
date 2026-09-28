import { describe, expect, it } from "vitest";
import { stageEmptyMessage, treeFallbackReason } from "../stageGridState";

/**
 * §4 D178 — the grid's empty body and the D177 tree's right to render are
 * DECISIONS, and these are their tests. The invariant both serve: no read
 * failure and no view mode may ever leave the Supplier stage blank or lying
 * about why it is empty (§5.3 T2).
 */
describe("stageEmptyMessage (D178)", () => {
  const base = { stageLabel: "supplier", loading: false, loadError: null, totalRows: 0, filteredRows: 0 };

  it("rows will render → no message", () => {
    expect(stageEmptyMessage({ ...base, totalRows: 4, filteredRows: 4 })).toBeNull();
  });

  it("still loading → no message (the loading row owns that state)", () => {
    expect(stageEmptyMessage({ ...base, loading: true })).toBeNull();
  });

  it("a failed read names itself instead of claiming the project has no lines", () => {
    const msg = stageEmptyMessage({ ...base, loadError: "get_supply_chain_data: forbidden" });
    expect(msg).toContain("could not be loaded");
    expect(msg).toContain("get_supply_chain_data: forbidden");
    expect(msg).not.toContain("no supplier lines");
  });

  it("rows hidden by filters are reported as filtered, not as absent", () => {
    const msg = stageEmptyMessage({ ...base, totalRows: 7, filteredRows: 0 });
    expect(msg).toContain("hidden by the active filters");
    expect(msg).toContain("7");
  });

  it("genuinely empty → the honest sentence, with the stage's own label", () => {
    expect(stageEmptyMessage(base)).toBe("no supplier lines for this project");
    expect(stageEmptyMessage({ ...base, stageLabel: "focal plant" })).toBe(
      "no focal plant lines for this project",
    );
  });

  it("an empty body ALWAYS gets a sentence — no combination returns '' ", () => {
    for (const loadError of [null, "x: y"]) {
      for (const totalRows of [0, 3]) {
        const msg = stageEmptyMessage({ ...base, loadError, totalRows, filteredRows: 0 });
        expect(typeof msg).toBe("string");
        expect((msg as string).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("treeFallbackReason (D178)", () => {
  const base = { wanted: true, buildError: null, hasStructure: true, flatRowCount: 4, deepError: null };

  it("healthy tree renders — no fallback", () => {
    expect(treeFallbackReason(base)).toBeNull();
  });

  it("flat view chosen — the tree state is nobody's business", () => {
    expect(treeFallbackReason({ ...base, wanted: false, buildError: "boom" })).toBeNull();
  });

  it("a build crash falls back to flat WITH the message (no error boundary catches it otherwise)", () => {
    const msg = treeFallbackReason({ ...base, buildError: "Cannot read properties of null" });
    expect(msg).toContain("failed to build");
    expect(msg).toContain("showing the flat lanes");
  });

  it("no structure while flat rows exist → flat, naming the deep-lane failure when there was one", () => {
    const withDeep = treeFallbackReason({ ...base, hasStructure: false, deepError: "rpc: 404" });
    expect(withDeep).toContain("rpc: 404");
    expect(withDeep).toContain("showing the flat lanes");
    const noDeep = treeFallbackReason({ ...base, hasStructure: false });
    expect(noDeep).toContain("run Combine");
    expect(noDeep).toContain("showing the flat lanes");
  });

  it("no structure and no flat rows either → the empty-state message owns it, not the tree", () => {
    expect(treeFallbackReason({ ...base, hasStructure: false, flatRowCount: 0 })).toBeNull();
  });
});
