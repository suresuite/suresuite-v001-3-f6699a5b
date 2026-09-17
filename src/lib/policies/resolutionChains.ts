/**
 * WP 6.1 — THE RESOLUTION CHAIN, COMPUTED RATHER THAN WRITTEN DOWN.
 *
 * §13 asks for "CSV column → DB column → RPC → hook → substitution → engine
 * field → unit at each hop" for every grid field, pinned with parity fixtures,
 * and it says the thing that decides the shape of this module:
 *
 *     "A chain you cannot write down is a bug — list those rather than
 *      inventing prose; the list feeds WP 6.2."
 *
 * A document of ~120 hand-written chains is a document that is true on the day
 * it is written. Every hop it describes already exists as data — the column
 * specs, the contract, the engine registry, the resolver's own ordering — so
 * the chain is DERIVED here and asserted by `resolutionChains.test.ts`. What a
 * person writes is the exception list, and even that is computed: a chain is
 * "unwritable" when a hop it needs is missing, and the missing hop is the
 * finding.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT CLAIM ─────────────────────────────────
 *
 * The RESOLVER'S ORDER is transcribed from `resolveEffective.ts` rather than
 * executed. `getEffectiveValue` takes eight arguments' worth of live React
 * state, and constructing that here would be a second implementation of it —
 * `single-source` (I1) broken to document `single-source`. So `RESOLUTION_ORDER`
 * is prose with a `file:line`, the test asserts the file still contains the
 * branches in that order, and a change to the resolver that does not update this
 * list fails there rather than being silently wrong here.
 */

import { STAGE_TABLE_SPEC, type ColSpec } from "./columnSpecs";
import type { StageKey } from "./stages";

/** One hop, with where the claim can be checked. */
export interface Hop {
  kind:
    | "csv"        // an upload column lands here
    | "db"         // the tier-2 column the value lives in
    | "rpc"        // the write path
    | "hook"       // what puts it on screen
    | "substitution" // a named rule that supplies a value no upload contained
    | "engine"     // what the simulation reads
    | "unit";      // the unit at this point, and who fixes it
  detail: string;
  /** `path:line`, or null when the hop is a contract fact rather than a code site. */
  evidence: string | null;
}

export interface Chain {
  stage: StageKey;
  field: string;
  family: string;
  hops: Hop[];
  /** Why this chain cannot be written end to end. Empty means it can. */
  breaks: string[];
}

/**
 * The resolver's precedence, transcribed from `resolveEffective.ts`'s
 * `getEffectiveValue`. ORDER IS THE WHOLE MEANING — the first branch that
 * matches wins, so a value that appears twice is decided here and nowhere else.
 */
export const RESOLUTION_ORDER: ReadonlyArray<{ step: string; meaning: string }> = [
  { step: "draft", meaning: "an unsaved edit in this session wins over everything" },
  { step: "master", meaning: "an item-master value (materials/products/suppliers) for a `master:` column" },
  { step: "derived", meaning: "the master column's logistics-derived fallback, when the master row has no value" },
  { step: "dataRow", meaning: "the value on the stage row itself — this is BEFORE the override bundle (see D-note below)" },
  { step: "bundle.family", meaning: "the effective policy bundle's own family" },
  { step: "bundle.families", meaning: "the first of the row's other families that carries the key" },
  { step: "undefined", meaning: "nothing resolves it; the cell's own default decides what is shown" },
];

/** Where each of those branches lives, so the transcription above is checkable. */
export const RESOLUTION_ORDER_SOURCE = "src/lib/policies/resolveEffective.ts";

export interface ContractLike {
  tables: Record<string, {
    columns?: Array<{
      name: string;
      unit?: string | null;
      unit_source?: string;
      engine?: { consumed_by?: string | null; missing_default?: unknown };
      substitutions?: unknown[];
    }>;
  }>;
}

export interface RegistryLike {
  policies: Array<{
    id: string;
    data_requirements?: Array<{ field: string; level: string; fallback: string | null }>;
    params_schema?: { properties?: Record<string, unknown> };
  }>;
  base_data_requirements?: Array<{ field: string; level: string; fallback: string | null }>;
}

/**
 * THE ENGINE HAS THREE DOORS AND THE FIRST DRAFT OF THIS FILE KNEW ONE.
 *
 * Looking only at the registry's `data_requirements` reported 28 of 40 chains as
 * reaching no engine field — including `safety_stock_days`, which §4 D1 is
 * entirely about the engine reading. `data_requirements` names the TABLE columns
 * a policy needs; a policy PARAMETER is a different thing and arrives by a
 * different route:
 *
 *   1. `data_requirements`  — `table.column` the engine reads from the dataset
 *   2. `params_schema`      — a declared policy parameter (80 of them)
 *   3. `project_map.py`     — the bundle-to-engine mapping, which reads keys the
 *                             registry never mentions
 *
 * Door 3 is a text scan and says so. It is the weakest of the three and it is
 * also the only evidence some fields have, which is itself the finding: a
 * parameter whose only proof of being read is a string literal in a Python file
 * has no declared contract at all.
 */
export interface EngineDoors {
  /** `table.column` → level, from the registry's data requirements. */
  dataRequirements: Map<string, string>;
  /** Declared policy parameter names, from every policy's `params_schema`. */
  params: Set<string>;
  /** Source text of `project_map.py`, for door 3. */
  projectMapSrc: string;
}

export function engineDoors(registry: RegistryLike, projectMapSrc: string): EngineDoors {
  const params = new Set<string>();
  for (const p of registry.policies ?? []) {
    for (const k of Object.keys(p.params_schema?.properties ?? {})) params.add(k);
  }
  return { dataRequirements: engineReads(registry), params, projectMapSrc };
}

/** Which door, if any, this field goes through — in descending strength. */
export function engineDoorFor(field: string, doors: EngineDoors): Hop | null {
  const dr = [...doors.dataRequirements.keys()].filter((k) => k.endsWith(`.${field}`));
  if (dr.length) {
    return {
      kind: "engine",
      detail: `registry data_requirements: ${dr.map((k) => `${k} (${doors.dataRequirements.get(k)})`).join(", ")}`,
      evidence: null,
    };
  }
  if (doors.params.has(field)) {
    return {
      kind: "engine",
      detail: `declared policy parameter (\`params_schema\`) — the registry export is the single source for policy schemas (§6.2)`,
      evidence: null,
    };
  }
  // Door 3. A bare word would match a comment or an unrelated identifier, so the
  // scan requires the field as a QUOTED key, which is how `project_map.py` reads
  // a bundle.
  const quoted = new RegExp(`["']${field}["']`);
  if (quoted.test(doors.projectMapSrc)) {
    return {
      kind: "engine",
      detail:
        "read by `project_map.py` as a bundle key — and by NOTHING that declares it. " +
        "The registry neither requires it as data nor declares it as a parameter, so " +
        "the only evidence it reaches the engine is a string literal (WP 6.1).",
      evidence: "scsim/scsim/io/project_map.py",
    };
  }
  return null;
}

/** Every `table.column` the engine registry says it reads, with its level. */
export function engineReads(registry: RegistryLike): Map<string, string> {
  const out = new Map<string, string>();
  const add = (r: { field: string; level: string }) => {
    // `required` beats `recommended` beats `defaulted` — a field read by two
    // policies at two levels is as strict as its strictest reader.
    const rank = { required: 3, recommended: 2, defaulted: 1 } as Record<string, number>;
    const prev = out.get(r.field);
    if (!prev || (rank[r.level] ?? 0) > (rank[prev] ?? 0)) out.set(r.field, r.level);
  };
  for (const r of registry.base_data_requirements ?? []) add(r);
  for (const p of registry.policies ?? []) for (const r of p.data_requirements ?? []) add(r);
  return out;
}

/**
 * Build the chain for one grid column.
 *
 * A BREAK IS NOT AN ERROR HERE — it is the output. §13 asks for the list of
 * chains that cannot be written down, so this function's job is to be honest
 * about what it could not resolve rather than to paper over it.
 */
export function chainFor(
  stage: StageKey,
  spec: ColSpec,
  contract: ContractLike,
  doors: EngineDoors,
): Chain {
  const hops: Hop[] = [];
  const breaks: string[] = [];

  hops.push({
    kind: "hook",
    detail: `rendered by the ${stage} grid as \`${spec.field}\` (family \`${spec.family}\`)`,
    evidence: "src/lib/policies/columnSpecs.ts",
  });

  // ── the DB hop ──────────────────────────────────────────────────────────
  if (spec.master) {
    const { table, field } = spec.master;
    const col = contract.tables[table]?.columns?.find((c) => c.name === field);
    if (!col) {
      breaks.push(
        `master-backed by \`${table}.${field}\`, and the contract has no such column — ` +
          `either the spec names a column that does not exist, or the table is not described`,
      );
    } else {
      hops.push({
        kind: "db",
        detail: `\`${table}.${field}\` (item master, keyed from \`${spec.master.idFrom}\`)`,
        evidence: null,
      });
      hops.push({
        kind: "unit",
        detail: col.unit
          ? `\`${col.unit}\`, fixed by \`${col.unit_source ?? "unstated"}\``
          : "dimensionless",
        evidence: null,
      });
      if (col.engine?.consumed_by) {
        hops.push({ kind: "engine", detail: String(col.engine.consumed_by), evidence: null });
      }
    }
    hops.push({
      kind: "rpc",
      detail: "item-master upsert (NOT a policy override) — `bulk_upsert_materials` / `_products` / `_suppliers`",
      evidence: null,
    });
  } else {
    // A non-master column lives in the policy bundle, which is `policy_defaults`
    // seeded and `policy_overrides` patched.
    hops.push({
      kind: "db",
      detail: "`policy_overrides.patch` → `policy_defaults.bundle` (the effective bundle)",
      evidence: null,
    });
    hops.push({
      kind: "rpc",
      detail: "`bulk_upsert_policy_overrides` (stamps `seeded_from_hash` when the value was seeded, WP 4.4)",
      evidence: null,
    });
  }

  // ── substitutions ───────────────────────────────────────────────────────
  if (spec.defaultWhenMissing !== undefined) {
    hops.push({
      kind: "substitution",
      detail: `\`defaultWhenMissing: ${JSON.stringify(spec.defaultWhenMissing)}\` — shown when nothing above resolves`,
      evidence: "src/lib/policies/columnSpecs.ts",
    });
  }

  // ── the engine hop, for a non-master column ─────────────────────────────
  if (!spec.master) {
    const door = engineDoorFor(spec.field, doors);
    if (door) {
      hops.push(door);
    } else if (spec.engineStatus?.state === "pending") {
      hops.push({
        kind: "engine",
        detail: `NOT CONSUMED YET — shown disabled against milestone ${spec.engineStatus.milestone}`,
        evidence: null,
      });
    } else if (!spec.readOnly) {
      // The chain that stops before the engine. This is the shape D18 is, and
      // the WP 0.1 gap check found seven more of it.
      breaks.push(
        `reaches no engine field through ANY of the three doors — not the registry's ` +
          `\`data_requirements\`, not a policy's \`params_schema\`, and not a quoted key ` +
          `in \`project_map.py\`. The spec has no \`engineStatus\` and is not read-only, ` +
          `so it is editable, stored, and hashed into \`policy_hash\` — and read by nothing.`,
      );
    }
  }

  return { stage, field: spec.field, family: String(spec.family), hops, breaks };
}

/** Every chain, for every stage, in declaration order. */
export function allChains(
  contract: ContractLike,
  registry: RegistryLike,
  projectMapSrc: string,
): Chain[] {
  const doors = engineDoors(registry, projectMapSrc);
  const out: Chain[] = [];
  for (const [stage, spec] of Object.entries(STAGE_TABLE_SPEC)) {
    for (const col of spec.cols as ColSpec[]) {
      // A SYNTHETIC column is not a field. `__inv_params` is the grouping cell
      // that renders a row's replenishment parameters as one vector (§II.3) —
      // it has no value of its own, so asking which engine field it reaches is
      // a question about nothing, and the first draft reported two of them as
      // broken chains.
      if ((col as ColSpec & { synthetic?: boolean }).synthetic) continue;
      out.push(chainFor(stage as StageKey, col, contract, doors));
    }
  }
  return out;
}

/**
 * The reverse direction — and the claim had to be sharpened twice before it was
 * true.
 *
 * "An engine-read field the policy grid does not render" is NOT a defect on its
 * own: `inbound_logistics.volume` is uploaded and edited through the Data
 * Manager, and the policy grid is not where anybody would look for it. Reporting
 * those five as findings would be the third over-claim this package caught in
 * itself.
 *
 * What IS a defect is a field with NO DATA-ENTRY SURFACE AT ALL — neither a grid
 * column nor a CSV header any upload supplies. The engine reads it, the fallback
 * decides it, and nobody can change that. This is blueprint gap G4 stated
 * precisely, so the surface test is against the contract's own
 * `ingest.csv_header`, which is the authority for what an upload can set.
 */
export function engineFieldsWithNoEntrySurface(
  registry: RegistryLike,
  contract: ContractLike,
): string[] {
  const uploadable = new Set<string>();
  for (const [table, t] of Object.entries(contract.tables)) {
    for (const c of t.columns ?? []) {
      const ing = (c as { ingest?: { csv_header?: string | null } }).ingest;
      if (ing?.csv_header) uploadable.add(`${table}.${c.name}`);
    }
  }
  return engineFieldsWithNoColumn(registry).filter((k) => !uploadable.has(k)).sort();
}

/**
 * Engine-read fields the POLICY GRID does not render. Informational: most are
 * uploaded columns, and `engineFieldsWithNoEntrySurface` is the one that names
 * a defect.
 */
export function engineFieldsWithNoColumn(registry: RegistryLike): string[] {
  // TWO NAMESPACES, AND THE FIRST DRAFT COMPARED ONLY ONE. The engine names a
  // field `table.column`; the grid names it by its own `field` id, and for a
  // master-backed column the two differ on purpose — `materials.cost` is
  // rendered as `material_cost`. Comparing bare names reported `materials.cost`
  // and `materials.moq` as invisible when both are on screen.
  const renderedFields = new Set<string>();
  const renderedMasters = new Set<string>();
  for (const spec of Object.values(STAGE_TABLE_SPEC)) {
    for (const col of spec.cols as ColSpec[]) {
      renderedFields.add(col.field);
      // A vector cell renders its members without declaring them as columns, so
      // the params it groups ARE on screen and must not count as unrendered.
      for (const t of (col as ColSpec & { tags?: string[] }).tags ?? []) renderedFields.add(t);
      if (col.master) renderedMasters.add(`${col.master.table}.${col.master.field}`);
    }
  }
  return [...engineReads(registry).keys()]
    .filter((k) => !renderedMasters.has(k) && !renderedFields.has(k.split(".").pop() as string))
    .sort();
}
