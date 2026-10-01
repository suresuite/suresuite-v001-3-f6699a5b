import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLevelStates } from "../graphLevels";

// WP 11.1 · §4 D258 — each level has its own version, read from the same state RPC
// as the composite. These pin the reading; `rehearsal/660` pins what the database
// says.

const ROOT = join(__dirname, "../../../..");

describe("graph level versions: the state's levels block", () => {
  // The shape `get_graph_version_state` returns after a deep-tier edit and before
  // its capture (rehearsal/660 §4): product and process current, firm unsaved.
  const state = {
    product: { level: "product", hash: "aaa", version_count: 3, unsaved: false,
      current_version: { id: "p3", version_no: 3, created_at: "2026-10-01T10:00:00Z" },
      latest_version: { id: "p3", version_no: 3, level_hash: "aaa", created_at: "2026-10-01T10:00:00Z" } },
    process: { level: "process", hash: "bbb", version_count: 2, unsaved: false,
      current_version: { id: "r2", version_no: 2, created_at: "2026-10-01T09:00:00Z" },
      latest_version: { id: "r2", version_no: 2, level_hash: "bbb", created_at: "2026-10-01T09:00:00Z" } },
    firm: { level: "firm", hash: "ccc", version_count: 1, unsaved: true,
      current_version: null,
      latest_version: { id: "f1", version_no: 1, level_hash: "old", created_at: "2026-10-01T08:00:00Z" } },
  };

  it("names the version each level IS, independently of the others", () => {
    const l = parseLevelStates(state);
    expect(l.product?.currentVersion?.version_no).toBe(3);
    expect(l.process?.currentVersion?.version_no).toBe(2);
    expect(l.firm?.currentVersion).toBeNull();
  });

  it("an unsaved level says unsaved and still knows its latest version", () => {
    const l = parseLevelStates(state);
    expect(l.firm?.unsaved).toBe(true);
    expect(l.firm?.latestVersion?.version_no).toBe(1);
    expect(l.product?.unsaved).toBe(false);
  });

  it("a database before WP 11.1 (no levels block) reads as no levels, not as a guess", () => {
    expect(parseLevelStates(undefined)).toEqual({});
    expect(parseLevelStates(null)).toEqual({});
  });

  it("a level with no hash has no version and is not called unsaved", () => {
    const l = parseLevelStates({ firm: { hash: null, current_version: null, latest_version: null, version_count: 0, unsaved: false } });
    expect(l.firm).toMatchObject({ hash: null, currentVersion: null, unsaved: false, versionCount: 0 });
  });

  it("the hook reads the levels from the ONE state call (D233), not a second RPC", () => {
    const src = readFileSync(join(ROOT, "src/hooks/useDatasetVersion.tsx"), "utf8");
    expect(src).toMatch(/parseLevelStates\(row\?\.levels\)/);
    expect(src.match(/\.rpc\(/g)?.length ?? 0).toBe(2); // the state read and the snapshot
  });
});

// WP 11.3 · §4 D258 — each page names ITS level. A deep-tier upload moves the firm
// chip and leaves the product and process chips where they were.
import { vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { graphVersionText } from "@/components/trust/GraphVersionChip";
import { levelVersionText, snapshotTupleTitle, tupleNumbers, tupleText } from "../graphLevels";

describe("the chip names the level the page shows", () => {
  const afterDeepTier = parseLevelStates({
    product: { hash: "aaaaaaa1", current_version: { id: "p3", version_no: 3, created_at: "" }, latest_version: null, version_count: 3, unsaved: false },
    process: { hash: "bbbbbbb2", current_version: { id: "r2", version_no: 2, created_at: "" }, latest_version: null, version_count: 2, unsaved: false },
    firm: { hash: "ccccccc3", current_version: null, latest_version: { id: "f4", version_no: 4, created_at: "" }, version_count: 4, unsaved: true },
    simulation: { hash: "ddddddd4", current_version: { id: "s4", version_no: 4, created_at: "" }, latest_version: null, version_count: 4, unsaved: false },
  });

  it("the composite text is unchanged when no level is named (WP 10.1's chip)", () => {
    expect(graphVersionText({ versionNo: 7, graphHash: "f00dbab99", metricsComputedAt: null })).toBe(
      "Graph v7 · f00dbab · no stored metrics",
    );
    expect(graphVersionText({ versionNo: null, graphHash: null })).toBe("Graph unsaved · no stored metrics");
  });

  it("a level page says its level's version and hash", () => {
    expect(graphVersionText({ level: "product", versionNo: 3, graphHash: "aaaaaaa1", outcome: "reused" }))
      .toBe("Product graph v3 · aaaaaaa · no stored metrics · reused");
    expect(levelVersionText("product", afterDeepTier.product)).toBe("Product graph v3");
    expect(levelVersionText("process", afterDeepTier.process)).toBe("Process graph v2");
  });

  it("only the firm level reads unsaved after a deep-tier upload", () => {
    expect(levelVersionText("firm", afterDeepTier.firm)).toBe("Firm graph unsaved");
    expect(graphVersionText({ level: "firm", versionNo: null, graphHash: "ccccccc3" }))
      .toBe("Firm graph unsaved · ccccccc · no stored metrics");
  });

  it("the title is the snapshot and its whole tuple, naming what is unsaved", () => {
    expect(snapshotTupleTitle(null, afterDeepTier)).toBe(
      "Snapshot unsaved · P3 · R2 · F? · S4 — unsaved: firm graph",
    );
    expect(snapshotTupleTitle(9, parseLevelStates({}))).toBe("Snapshot v9 · P? · R? · F? · S?");
  });

  it("a tuple payload reads to its numbers; a missing level is '?', never dropped", () => {
    const t = tupleNumbers({ version_no: 9, product: { version_no: 3 }, process: { version_no: 2 }, firm: null, simulation: { version_no: 4 } });
    expect(t).toEqual({ snapshot: 9, product: 3, process: 2, firm: null, simulation: 4 });
    expect(tupleText(t)).toBe("P3 · R2 · F? · S4");
  });
});
