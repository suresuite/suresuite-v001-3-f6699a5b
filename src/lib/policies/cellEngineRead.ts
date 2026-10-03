/**
 * Does the engine read THIS /policies cell? — PLAN.md §23 WP 13.4, §4 D204 (b).
 *
 * Gate `page-equals-run`: a cell shows the value the engine receives, or it says,
 * at the point of display, that the engine does not read it. There is no third
 * state.
 *
 * The answer is per STAGE, not per field: `service_level_target` is read as the
 * project-wide default and NOT from a Supplier-stage row; every inventory field of
 * a Plant-stage row is dropped; `basis` is read nowhere.
 * A per-family list (`SCSIM_VISIBLE_FIELDS`) answered "yes" for all of them, so the
 * grid offered edits that were stored, versioned, hashed into the policy version —
 * and changed no result.
 *
 * GENERATED, not listed: the rule reads `POLICY_BUNDLE_KEYS[].scopes` from the
 * registry — where `project_map.py` reads each key — which
 * `test_declared_scopes_are_the_scopes_the_mapper_reads` proves by perturbing every
 * key at every scope. A key with no declaration reaches nothing. Nothing in this
 * file names a field.
 */
import type { ColSpec } from "./columnSpecs";
import type { StageKey } from "./stages";
import { policyBundleKeys } from "./registryAccess";
import { masterOverrideRule } from "./masterOverrides";

export type CellEngineRead =
  | { reaches: true; via: string }
  | { reaches: false; note: string; short: string };

interface ScopedKey {
  key: string;
  family: string;
  target: string;
  scopes?: string[];
}

const SCOPES = new Map<string, string[]>(
  (policyBundleKeys() as unknown as ScopedKey[]).map((k) => [`${k.family}.${k.key}`, k.scopes ?? []]),
);

const STAGE_NAME: Partial<Record<StageKey, string>> = {
  supplier: "Supplier",
  plant: "Plant",
  customer: "Customer",
};

/** Every (stage, family.field) the engine reads, as the registry declares it. */
export function declaredScopes(family: string, field: string): readonly string[] | undefined {
  return SCOPES.get(`${family}.${field}`);
}

export function cellEngineRead(
  stage: StageKey,
  col: Pick<ColSpec, "field" | "family" | "label" | "master" | "readOnly" | "engineStatus" | "synthetic">,
): CellEngineRead {
  if (col.synthetic) return { reaches: true, via: "a container for the parameters inside it" };
  if (col.engineStatus) {
    return {
      reaches: false,
      short: "not simulated yet",
      note: `Not simulated yet — stored and versioned; read once ${col.engineStatus.milestone} lands.`,
    };
  }
  if (col.master) {
    // The REAL stage: a Customer master cell was asked of the Supplier rows and
    // every one — distribution, mean, priority — read "not simulated" while the
    // engine read it (§4 D287).
    return masterOverrideRule(col.family, col.field, stage)
      ? { reaches: true, via: `your override, else ${col.master.table}.${col.master.field}` }
      : {
          reaches: false,
          short: "not simulated",
          note: `Not simulated — the engine declares no override of ${col.master.table}.${col.master.field} on this stage.`,
        };
  }
  // A read-only cell DISPLAYS a value the engine reads off the uploaded lanes
  // (the inbound price, the lead time); there is nothing to type that could be lost.
  if (col.readOnly) return { reaches: true, via: "the uploaded lane the engine reads" };
  const scopes = declaredScopes(col.family, col.field) ?? [];
  if (scopes.includes(stage)) return { reaches: true, via: `read from the ${STAGE_NAME[stage] ?? stage} row` };
  const name = STAGE_NAME[stage] ?? stage;
  return {
    reaches: false,
    short: "not simulated",
    note: scopes.includes("default")
      ? `Not simulated on a ${name} row — the engine reads ${col.label} only as the project-wide default. ` +
        "This cell is stored and versioned, and changes no result."
      : `Not simulated — the engine does not read ${col.label} on a ${name} row. ` +
        "This cell is stored and versioned, and changes no result.",
  };
}

/** The sentence a cell owes its reader when the engine does not read it, else
 *  undefined. (A helper rather than a narrowing at each call site: this codebase
 *  compiles without strictNullChecks, where the union does not narrow.) */
export function notSimulatedNote(read: CellEngineRead): string | undefined {
  return read.reaches === false ? (read as { note: string }).note : undefined;
}
