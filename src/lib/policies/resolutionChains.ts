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
  { step: "dataRow", meaning: "the value on the stage row itself — BEFORE the override bundle (see D-note below). A field the row carries only as a routing SUGGESTION (`__decided`) is excluded here and resolved two steps down" },
  { step: "savedOverride", meaning: "§4 D23 — for a `__decided` field only: the raw override PATCH, read without the schema defaults merged under it, so `somebody saved false` is distinguishable from `nobody saved anything and the default is false`" },
  { step: "suggestion", meaning: "the stage's own routing suggestion on the row, once no saved override has replaced it" },
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
export interface EngineSources {
  /** `scsim/scsim/io/project_map.py` — the strategic engine's bundle mapper. */
  projectMap: string;
  /**
   * `sim-worker/sim_worker/*.py`, keyed by path so a citation carries a LINE.
   * NOT a door: the legacy engine is FROZEN (§3, "never add capability to it"),
   * so a field only it reads has no future and must not be reported as reaching
   * the engine. It is read here so a break can say WHICH shape it is.
   */
  legacyEngine: Record<string, string>;
  /**
   * `src/`, keyed by path — so an app-level routing decision (a field the
   * PRODUCT reads and the engine deliberately excludes) is distinguishable from
   * a field nothing reads at all. They are not the same defect.
   */
  appSrc: Record<string, string>;
}

export interface EngineDoors {
  /** `table.column` → level, from the registry's data requirements. */
  dataRequirements: Map<string, string>;
  /** Declared policy parameter names, from every policy's `params_schema`. */
  params: Set<string>;
  /** The source texts doors 3 and the break CLASSIFIER read. */
  src: EngineSources;
}

export function engineDoors(registry: RegistryLike, src: EngineSources): EngineDoors {
  const params = new Set<string>();
  for (const p of registry.policies ?? []) {
    for (const k of Object.keys(p.params_schema?.properties ?? {})) params.add(k);
  }
  return { dataRequirements: engineReads(registry), params, src };
}

/**
 * DOOR 3 IS A READ, NOT A MENTION — and the first draft accepted a mention.
 *
 * `order_up_to` passed door 3 on this line:
 *
 *     w.append(MappingWarning("info", "policy:inventory_control", "order_up_to",
 *              "legacy absolute order_up_to replaced by coverage-based κ (≈8 weeks)"))
 *
 * — a warning whose TEXT says the engine drops the field. The scan reported it as
 * reaching the engine on the strength of the string that says it does not, so the
 * chain resolved and the ratchet was one name short. A door must therefore be a
 * dict READ (`inv.get("f")` / `families["f"]`), which is how `project_map.py`
 * consumes a bundle key, and never a bare quoted occurrence.
 */
function readsKey(src: string, field: string): boolean {
  return new RegExp(`\\.get\\(\\s*["']${field}["']|\\[\\s*["']${field}["']\\s*\\]`).test(src);
}

/** Where a field is read across a set of files, as `path:line` citations. */
function citeReads(files: Record<string, string>, field: string, limit = 2): string[] {
  const out: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      if (readsKey(lines[i], field)) out.push(`${path}:${i + 1}`);
    }
  }
  return out;
}

/**
 * A field that passes no door is not automatically a dead field, and calling all
 * of them dead is the over-claim this classifier exists to stop. Five shapes,
 * and the remedy differs for every one:
 *
 *   legacy-only   read by the FROZEN engine and by no scsim mapping. Not dead —
 *                 but it has no future either, because §3 forbids adding
 *                 capability to the engine that reads it.
 *   app-routing   the PRODUCT reads it to decide something, and `project_map.py`
 *                 excludes it on purpose. Correct as it stands; what is missing
 *                 is a declaration saying so.
 *   overridden    stored and editable while the engine COMPUTES the same
 *                 quantity and never consults the field. The worst of the five,
 *                 because the cell accepts a number and the run ignores it.
 *   no-target     the chain's storage hop points at a column that does not exist.
 *   unread        read by nothing, anywhere. Only this one is §4 D18's shape.
 */
export type BreakClass = "legacy-only" | "app-routing" | "overridden" | "no-target" | "unread";

export function classifyBreak(
  field: string,
  doors: EngineDoors,
): { klass: BreakClass; evidence: string[] } {
  const legacy = citeReads(doors.src.legacyEngine, field);
  const app = citeAppReads(doors.src.appSrc, field);
  // `project_map.py` naming a field OUTSIDE a read is the mapper saying it knows
  // the field and drops it — either an exclusion note or a "replaced by" warning.
  const namedNotRead =
    new RegExp(`["']${field}["']|\\b${field}\\b`).test(doors.src.projectMap) &&
    !readsKey(doors.src.projectMap, field);

  if (legacy.length) return { klass: "legacy-only", evidence: legacy };
  if (namedNotRead && app.length) return { klass: "app-routing", evidence: app };

  // DECLARED AND NEVER CONSULTED. `reorder_point: float = 50` is a field of the
  // legacy `InventoryPolicy` schema, so the value is accepted, validated and
  // carried all the way into the run — and `engine.py` computes
  // `RP = avg_lt * avg_d + ss` for itself and never reads it. A declaration is
  // not a read, which is why `readsKey` above does not match it and why this
  // has to be its own test.
  const declared = citeDeclarations(doors.src.legacyEngine, field);
  if (declared.length) return { klass: "overridden", evidence: declared };
  if (namedNotRead) return { klass: "overridden", evidence: ["scsim/scsim/io/project_map.py"] };
  // NO EVIDENCE, DELIBERATELY. The app citations `citeAppReads` collects are
  // RENDERS, not consumers — `material_price` is on screen, which is the whole of
  // §4 D18 — and attaching them to this sentence made it cite the grid as proof
  // that nothing reads the field. An absence has no `file:line`.
  return { klass: "unread", evidence: [] };
}

/**
 * The app reads a field in TypeScript shapes `readsKey` cannot see —
 * `getEffective(rowKey, r, "primary_source")`, `col.field === "sourcing_firm"`,
 * an object key in a row literal. `readsKey` is Python-shaped (`.get("f")`), and
 * pointing it at `src/` returned nothing, which classified both routing hints as
 * `overridden` — a WRONGER answer than the one WP 6.1 gave. So the app scan is a
 * quoted-or-identifier match, which is loose; it is confined to the three
 * modules that actually resolve a policy cell, and it only ever decides between
 * two BREAK classes — never whether a chain resolves.
 */
function citeAppReads(files: Record<string, string>, field: string, limit = 2): string[] {
  const out: string[] = [];
  const re = new RegExp(`["']${field}["']|\\b${field}\\s*[:,)]`);
  for (const [path, text] of Object.entries(files)) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      if (re.test(lines[i])) out.push(`${path}:${i + 1}`);
    }
  }
  return out;
}

/** A pydantic/dataclass FIELD declaration — `name: type = default`. */
function citeDeclarations(files: Record<string, string>, field: string, limit = 2): string[] {
  const out: string[] = [];
  const decl = new RegExp(`^\\s*${field}\\s*:\\s*\\S`);
  for (const [path, text] of Object.entries(files)) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      if (decl.test(lines[i])) out.push(`${path}:${i + 1}`);
    }
  }
  return out;
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
  // Door 3 — a READ in `project_map.py`, not a mention of the name. See
  // `readsKey` for the `order_up_to` warning that made the difference matter.
  const cite = citeReads({ "scsim/scsim/io/project_map.py": doors.src.projectMap }, field, 1);
  if (cite.length) {
    return {
      kind: "engine",
      detail:
        "read by `project_map.py` as a bundle key — and by NOTHING that declares it. " +
        "The registry neither requires it as data nor declares it as a parameter, so " +
        "the only evidence it reaches the engine is a dict read in a Python file (WP 6.1, §4 D90).",
      evidence: cite[0],
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
 * One sentence per shape, written so a reader can act on it without opening this
 * file. The test asserts every break is longer than 40 characters precisely so
 * these cannot degrade back into "reaches no engine field".
 */
const BREAK_REASON: Record<BreakClass, string> = {
  "legacy-only":
    "reaches NO scsim field, and is read only by the FROZEN legacy engine " +
    "(`sim-worker/sim_worker/`). §3 forbids adding capability there, so this field " +
    "is editable, stored and hashed into `policy_hash` while the strategic engine " +
    "ignores it — and no catalog policy is planned that would change that.",
  "app-routing":
    "is an APPLICATION routing decision, not an engine parameter: `project_map.py` " +
    "excludes it deliberately and the product reads it to decide a lane. The chain " +
    "is unwritable only because nothing DECLARES that, so a reader cannot tell it " +
    "apart from a field the engine forgot.",
  overridden:
    "is accepted, stored and hashed while the engine COMPUTES the same quantity and " +
    "never consults it — the grid takes a number that changes no run. The worst of " +
    "the five shapes, because the cell looks exactly like one that works.",
  "no-target":
    "the contract has no such column, so the chain has no storage hop: the value " +
    "falls silently through the resolver to the policy bundle while the column " +
    "header claims it is item-master data.",
  unread:
    "is read by NO consumer anywhere — not scsim, not the frozen legacy engine, " +
    "and by nothing in the product beyond the grid that renders it. Editable, " +
    "stored, versioned and hashed into `policy_hash`, and the only thing that ever " +
    "happens to the value is that it is shown back. This is §4 D18's exact shape.",
};

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
      breaks.push(`is master-backed by \`${table}.${field}\` and ${BREAK_REASON["no-target"]}`);
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
      // The chain that stops before the engine — and WHICH WAY it stops decides
      // the remedy. WP 6.2 re-derived this after the WP 6.1 scan proved too
      // narrow in one direction and too loose in the other (§4 D90, D91).
      const { klass, evidence } = classifyBreak(spec.field, doors);
      breaks.push(`${BREAK_REASON[klass]}${evidence.length ? ` Evidence: ${evidence.join(", ")}.` : ""}`);
    }
  }

  return { stage, field: spec.field, family: String(spec.family), hops, breaks };
}

/** Every chain, for every stage, in declaration order. */
export function allChains(
  contract: ContractLike,
  registry: RegistryLike,
  src: EngineSources,
): Chain[] {
  const doors = engineDoors(registry, src);
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
