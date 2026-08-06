// Line-level guardrail: which lines in a stage still need the user's input.
//
// One line = one real row (supplier × material, plant × product, customer ×
// product) — never an aggregate. The step track in PolicySetupBar counts these
// lines per stage, and StagePolicyTable flags the same lines in the grid, so
// both surfaces answer "what is unresolved?" from ONE definition.
//
// Derived per render from the rows — never stored.
import type { StageKey } from "./stages";

export type ResolveField = (
  row: Record<string, unknown>,
  field: string,
) => unknown;

/** The group a line competes in for the single primary source. */
export function groupKeyFor(
  stage: StageKey,
  r: Record<string, unknown>,
): string | null {
  if (stage === "supplier") return r.material_id ? `mat::${r.material_id}` : null;
  if (stage === "customer")
    return r.customer_id && r.product_id ? `cp::${r.customer_id}::${r.product_id}` : null;
  return null;
}

/** Does this line's primary-source group already have a primary picked? */
export function groupHasPrimary(
  stage: StageKey,
  r: Record<string, unknown>,
  rows: Record<string, unknown>[],
  resolve: ResolveField,
): boolean {
  const gk = groupKeyFor(stage, r);
  if (!gk) return true;
  return rows.some(
    (o) => groupKeyFor(stage, o) === gk && resolve(o, "primary_source") === true,
  );
}

/**
 * A line needs input when the project data cannot answer it:
 *  - the material has no supplier at all,
 *  - it is multi-source and no primary has been picked,
 *  - (customer) no sourcing firm is known and none has been set.
 */
export function lineNeedsInput(
  stage: StageKey,
  r: Record<string, unknown>,
  rows: Record<string, unknown>[],
  resolve: ResolveField,
): boolean {
  if (r.__needs_supplier) return true;
  if (
    (stage === "supplier" || stage === "customer") &&
    Number(r.__lane_count ?? 0) > 1 &&
    !groupHasPrimary(stage, r, rows, resolve)
  ) {
    return true;
  }
  if (stage === "customer") {
    const firms = (r.__firms_available as string[] | undefined) ?? [];
    if (firms.length === 0 && !resolve(r, "sourcing_firm")) return true;
  }
  return false;
}

/** How many lines in a stage still need input. */
export function stageNeedsCount(
  stage: StageKey,
  rows: Record<string, unknown>[],
  resolve: ResolveField,
): number {
  return rows.filter((r) => lineNeedsInput(stage, r, rows, resolve)).length;
}
