import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * §4 D178 — the Supplier grid can never silently blank, pinned at the source.
 *
 * The behaviour spans a hook and a 2000-line component; this repo has no DOM
 * test tooling (`loudFailure.test.ts` states the precedent), so the logic
 * lives in `stageGridState.ts` (unit-tested) and `bomTreeView.ts`
 * (unit-tested), and THESE assertions pin the wiring between them — that no
 * one quietly restores the swallow, the label-keyed gate, or an unguarded
 * tree render, which are the three ways 2026-09-24's blank grid happened.
 */

const root = resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const HOOK = "src/hooks/useStageRows.tsx";
const TABLE = "src/components/policies/StagePolicyTable.tsx";
const MOBILE = "src/components/policies/MobileStagePolicyList.tsx";

describe("useStageRows fails loudly (D178)", () => {
  it("the catch routes the failure to state, not only to the console", () => {
    const src = read(HOOK);
    expect(src).toMatch(/catch \(err\) \{[\s\S]{0,600}setLoadError\(/);
  });

  it("the canonical RPC's error is thrown WITH the RPC's name", () => {
    expect(read(HOOK)).toMatch(/`get_supply_chain_data: \$\{/);
  });

  it("the deep-lane read's failure reaches state too — a console line is not a display", () => {
    const src = read(HOOK);
    expect(src).toMatch(/if \(mtErr\) \{[\s\S]{0,800}setDeepError\(/);
  });

  it("the BOM sweeps and the tree are gated on the rows' SHAPE, never on projects.bom_level", () => {
    const src = read(HOOK);
    expect(src).toMatch(/hasMultiShape = lanes\.bom\.some\(/);
    // the two gates that read the label in D176/D177's first cut
    expect(src).toMatch(/stage === "supplier" && hasMultiShape/);
    expect(src).toMatch(/if \(!hasMultiShape\) \{/);
    expect(
      /lanes\.bomLevel\.includes\("multi"\)/.test(src),
      "a gate keys on the declared bom_level again — a mislabelled project " +
        "then loses its BOM materials with nothing saying so (§4 D178)",
    ).toBe(false);
  });
});

describe("StagePolicyTable can never render a blank body (D178)", () => {
  const src = read(TABLE);

  it("the tree build is guarded — no error boundary protects this render path", () => {
    expect(src).toMatch(/try \{[\s\S]{0,400}buildBomTreeView\(/);
  });

  it("the tree renders only when treeFallbackReason allows it, and the reason is shown", () => {
    expect(src).toMatch(/treeActive = treeWanted && treeFallback === null/);
    expect(src).toMatch(/\{treeFallback && \(/);
  });

  it("the empty body's sentence comes from stageEmptyMessage, with the failed read's retry", () => {
    expect(src).toMatch(/stageEmptyMessage\(\{/);
    expect(src).toMatch(/loadError: stageRows\.loadError/);
    expect(src).toMatch(/stageRows\.loadError && \([\s\S]{0,400}retry/);
  });

  it("the toolbar names a failed load even before anyone scrolls to the body", () => {
    expect(src).toMatch(/lines could not be loaded — \{stageRows\.loadError\}/);
  });
});

describe("the mobile list tells a failed read from an empty stage (D178)", () => {
  it("its empty state reads loadError before claiming there are no lines", () => {
    expect(read(MOBILE)).toMatch(/stageRows\.loadError[\s\S]{0,120}Lines could not be loaded/);
  });
});
