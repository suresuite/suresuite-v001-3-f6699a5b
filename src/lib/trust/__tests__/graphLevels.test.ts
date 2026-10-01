import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLevelStates } from "../graphLevels";

// WP 11.1 · §4 D257 — each level has its own version, read from the same state RPC
// as the composite. These pin the reading; `rehearsal/650` pins what the database
// says.

const ROOT = join(__dirname, "../../../..");

describe("graph level versions: the state's levels block", () => {
  // The shape `get_graph_version_state` returns after a deep-tier edit and before
  // its capture (rehearsal/650 §4): product and process current, firm unsaved.
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
