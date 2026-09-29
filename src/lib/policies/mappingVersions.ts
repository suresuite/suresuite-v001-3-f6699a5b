// Versions of the two mapping tools on /policies → Data map.
//
// Each mapping is a hand-maintained statement about what the engine does, so a
// reader needs to know WHICH statement they are reading and WHEN it was last
// checked against the engine. This file is that record, newest version first.
//
// HOW TO CHANGE A MAPPING (enforced by `mappingVersions.test.ts`):
//   1. Edit the mapping (`dataMap.ts` or `policyColumnCheck.ts`).
//   2. Add a version entry at the TOP of its list: next version number, today's
//      date, the engine version you checked it against
//      (`registry.generated.json :: engine_version`), a one-line summary and the
//      changes. Leave `commit` empty until the change is committed, or fill it in
//      a follow-up — it is shown, never trusted.
//   3. Run the test. It prints the new content fingerprint to paste into the
//      entry — a mapping whose content changed without a new version fails.
//
// The test ALSO fails when the engine's version moves past the one the latest
// entry was checked against: an engine release is exactly when a mapping goes
// stale, and the page says so too (see `staleAgainstEngine`).
import registry from "./registry.generated.json";

export interface MappingVersion {
  version: string;
  /** ISO date the mapping was last changed or re-checked. */
  updated: string;
  /** Engine (scsim) version the mapping was checked against, when recorded. */
  engine: string | null;
  /** Commit that shipped it, when known. */
  commit: string | null;
  /** sha256 (first 12 hex) of the mapping's content — the test recomputes it. */
  fingerprint: string | null;
  summary: string;
  changes: string[];
}

export type MappingTool = "columns" | "uploads";

export const MAPPING_TITLE: Record<MappingTool, string> = {
  columns: "Policies page · column by column",
  uploads: "Uploaded data → engine",
};

export const MAPPING_VERSIONS: Record<MappingTool, MappingVersion[]> = {
  columns: [
    {
      version: "1.2",
      updated: "2026-09-29",
      engine: "0.2.8",
      commit: "b8963782",
      fingerprint: "1b4fbf3c5d99",
      summary: "Qty / assy on a single-level BOM",
      changes: [
        "Added the flat view's Qty / assy key column for single-level BOM projects.",
      ],
    },
    {
      version: "1.1",
      updated: "2026-09-29",
      engine: "0.2.8",
      commit: "3444385b",
      fingerprint: null,
      summary: "Own tab; no contradictions with the uploaded-data tab",
      changes: [
        "Moved to its own tab of the Data map.",
        "Removed notes that contradicted the uploaded-data tab (demand distribution).",
      ],
    },
    {
      version: "1.0",
      updated: "2026-09-29",
      engine: "0.2.8",
      commit: "6fa4bf97",
      fingerprint: null,
      summary: "First version",
      changes: [
        "Every column of the Supplier, Plant and Customer grids, the Fulfillment card, the page-level controls, Run & validate, and the engine inputs with no column.",
        "Measured against production on 2026-09-29 (verification run 36629798467).",
      ],
    },
  ],
  uploads: [
    {
      version: "2.1",
      updated: "2026-09-29",
      engine: "0.2.8",
      commit: "0620e945",
      fingerprint: "a6b3d7181e1c",
      summary: "Re-checked line by line against the engine",
      changes: [
        "plant_name marked not read on every lane and BOM table.",
        "Identity rows for the masters; the sub-assembly rule on products.product_id.",
        "Outbound volume's second use: splitting demand across customers.",
        "Demand kinds the engine models, and what demand_cv does under each.",
        "A 0 counts as blank for cost, sell price, demand mean and capacity; supplier capacity must be > 0.",
        "bom_multi_level.level: fetched, never used.",
      ],
    },
    {
      version: "2.0",
      updated: "2026-09-29",
      engine: "0.2.8",
      commit: "3444385b",
      fingerprint: null,
      summary: "Reconciled with the engine",
      changes: [
        "Added bom_multi_level, customers and lead_time_unit.",
        "Corrected lead time (converted by its unit), inbound volume (cost-fallback weight only), the demand-distribution order (master first) and supplier reliability (no effect).",
        "Pinned to the worker's reads by a test.",
      ],
    },
    {
      version: "1.2",
      updated: "2026-09-20",
      engine: null,
      commit: "719afbda",
      fingerprint: null,
      summary: "Material cost: volume-weighted inbound price first",
      changes: ["materials.cost fallback chain updated (§4 D163)."],
    },
    {
      version: "1.1",
      updated: "2026-07-12",
      engine: null,
      commit: "86ab2984",
      fingerprint: null,
      summary: "Explicit triangular demand bounds",
      changes: ["Added products.demand_min and demand_max."],
    },
    {
      version: "1.0",
      updated: "2026-07-05",
      engine: null,
      commit: "f25effe8",
      fingerprint: null,
      summary: "First version",
      changes: ["Six datasets, with the engine's price fallbacks from uploaded logistics."],
    },
  ],
};

/** The engine version this build ships (generated from scsim's registry). */
export const ENGINE_VERSION: string = (registry as { engine_version: string }).engine_version;

export const latestVersion = (tool: MappingTool): MappingVersion => MAPPING_VERSIONS[tool][0];

/** Non-null when the engine has moved past the version the mapping was checked against. */
export function staleAgainstEngine(tool: MappingTool): string | null {
  const v = latestVersion(tool);
  if (v.engine === null || v.engine === ENGINE_VERSION) return null;
  return `This mapping was checked against engine ${v.engine}; this build runs engine ${ENGINE_VERSION}. Re-check it before relying on it.`;
}
