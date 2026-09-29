import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { DATA_MAP_CONTRACT, DATASET_LABEL } from "@/lib/policies/dataMap";
import {
  COLUMN_CHECK,
  FULFILLMENT_CARD_CHECK,
  KEY_COLUMNS,
  NO_COLUMN_CHECK,
  PAGE_LEVEL_CHECK,
  RUN_VALIDATE_CHECK,
  STAGE_ROWS,
  STAGE_TITLE,
} from "@/lib/policies/policyColumnCheck";
import { ENGINE_VERSION, MAPPING_VERSIONS, type MappingTool } from "@/lib/policies/mappingVersions";

/**
 * A mapping's version number means something only if it CHANGES when the
 * mapping does. This test recomputes each mapping's content fingerprint and
 * fails when the latest version entry records a different one — i.e. when the
 * content moved without a new version (or a version was added without its
 * fingerprint). It also fails when the engine this build ships moves past the
 * version the latest entry was checked against.
 */
const fp = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 12);

const CONTENT: Record<MappingTool, unknown> = {
  columns: { COLUMN_CHECK, KEY_COLUMNS, FULFILLMENT_CARD_CHECK, PAGE_LEVEL_CHECK, RUN_VALIDATE_CHECK, NO_COLUMN_CHECK, STAGE_ROWS, STAGE_TITLE },
  uploads: { DATA_MAP_CONTRACT, DATASET_LABEL },
};

const cmp = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

describe.each(Object.keys(MAPPING_VERSIONS) as MappingTool[])("mapping versions — %s", (tool) => {
  const list = MAPPING_VERSIONS[tool];

  it("the content fingerprint matches the latest version — content changed ⇒ new version", () => {
    const actual = fp(CONTENT[tool]);
    expect(
      list[0].fingerprint,
      `${tool}: content fingerprint is ${actual}. If you changed the mapping, add a version entry at the top of MAPPING_VERSIONS.${tool} with fingerprint "${actual}".`,
    ).toBe(actual);
  });

  it("the latest version was checked against the engine this build ships", () => {
    expect(
      list[0].engine,
      `${tool}: the engine is now ${ENGINE_VERSION}. Re-check the mapping against it and add a version entry.`,
    ).toBe(ENGINE_VERSION);
  });

  it("versions are newest first, strictly increasing, with ISO dates that never go backwards", () => {
    for (let i = 1; i < list.length; i++) {
      expect(cmp(list[i - 1].version, list[i].version), `${list[i - 1].version} > ${list[i].version}`).toBeGreaterThan(0);
      expect(list[i - 1].updated >= list[i].updated).toBe(true);
    }
    for (const v of list) {
      expect(v.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(v.summary.length).toBeGreaterThan(0);
      expect(v.changes.length).toBeGreaterThan(0);
    }
  });
});
