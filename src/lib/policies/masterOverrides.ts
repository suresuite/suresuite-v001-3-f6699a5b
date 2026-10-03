/**
 * /policies OVERRIDES of item-master values — PLAN.md §23 WP 13.1, §4 D280.
 *
 * THE OWNER'S RULE (2026-10-02): /policies never writes the item masters. A
 * cost, MOQ, capacity, price or demand changed there is a POLICY OVERRIDE on
 * the grid row, saved in the policy version, and the engine reads it in one
 * order:
 *
 *     override → item master → derived from lanes → default
 *
 * The RULE is the engine's. `POLICY_BUNDLE_KEYS` (`scsim/scsim/io/project_map.py`)
 * declares, for each such key, the master column it overrides (`master`), the
 * stage whose rows carry it (`rows`) and the values it accepts (`domain`); this
 * module reads those three from the registry and restates nothing. HOW the
 * mapper reads a row key is `supabase/functions/_shared/entityOverrides.ts`,
 * shared with the grader, and `masterOverrides.test.ts` holds it to the mapper on
 * the cases where they could disagree (sorted order, first-wins vs last-wins, an
 * unusable value). This module adds the grid's half: planning a save.
 */
import type { OverrideRow } from "./resolve";
import type { PolicyFamily } from "./schemas";
import { policyBundleKeys } from "./registryAccess";
import {
  entityOverride as entityOverrideShared,
  isUsableOverride,
  overrideDecls,
  type OverrideDecl,
  type OverrideDomain,
  type OverrideEntity,
  type ResolvedOverride,
} from "../../../supabase/functions/_shared/entityOverrides.ts";

export { isUsableOverride };
export type { OverrideDomain, OverrideEntity, ResolvedOverride };

export interface MasterOverrideRule extends OverrideDecl {
  family: PolicyFamily;
}

const RULES: MasterOverrideRule[] = overrideDecls(
  policyBundleKeys() as unknown as Record<string, unknown>[],
) as MasterOverrideRule[];

/** Every declared override of an item-master value, as the engine declares it. */
export const masterOverrideRules = (): readonly MasterOverrideRule[] => RULES;

/** The rule for a grid column, matched by family AND key — a name shared across
 *  families (or stages) never borrows another's rule. */
export function masterOverrideRule(
  family: PolicyFamily,
  key: string,
  stage?: "supplier" | "plant" | "customer" | "run_validate",
): MasterOverrideRule | undefined {
  return RULES.find(
    (r) => r.family === family && r.key === key && (stage === undefined || r.rows === stage),
  );
}

/** The override the ENGINE reads for one entity — the shared module's rule
 *  (`_shared/entityOverrides.ts`), typed for the grid's override rows. */
export function entityOverride(
  overrides: readonly OverrideRow[],
  rule: MasterOverrideRule,
  entityId: string,
  productIds?: ReadonlySet<string>,
): ResolvedOverride | undefined {
  return entityOverrideShared(
    overrides as unknown as Record<string, unknown>[],
    rule,
    entityId,
    productIds,
  );
}

/**
 * ONE SAVE, AS PATCHES (§4 D281).
 *
 * `bulk_upsert_policy_overrides` REPLACES a row's patch (`patch =
 * excluded.patch`), and the grid used to send only the fields drafted in this
 * save — so editing one cell of a row deleted every other value saved on that
 * row and family. A save is therefore planned as FULL patches: the saved patch,
 * with this save's changes applied on top. Keyed by target key AND family.
 */
export type SavePlan = Map<string, { target_key: string; family: PolicyFamily; patch: Record<string, unknown>; saved: boolean }>;

export const planKey = (targetKey: string, family: PolicyFamily): string => `${family}\u0001${targetKey}`;

/** The plan's working patch for a row+family, seeded from what is saved. */
export function planPatch(
  plan: SavePlan,
  overrides: readonly OverrideRow[],
  scope: "node" | "edge",
  targetKey: string,
  family: PolicyFamily,
): Record<string, unknown> {
  const k = planKey(targetKey, family);
  const hit = plan.get(k);
  if (hit) return hit.patch;
  const saved = overrides.find((o) => o.scope === scope && o.target_key === targetKey && o.family === family);
  const entry = {
    target_key: targetKey,
    family,
    patch: { ...((saved?.patch ?? {}) as Record<string, unknown>) },
    saved: !!saved,
  };
  plan.set(k, entry);
  return entry.patch;
}

/**
 * Plan an override of an item-master value so that the engine reads `value`
 * for this entity and nothing else: the edited row carries it, and every OTHER
 * row of the same entity drops the key — two rows of one material can never
 * disagree (the mapper would keep the first and warn). `value === null` removes
 * the key everywhere, which is *reset to master*.
 *
 * `rowKeysOfEntity` are the target keys of every grid row of this entity in the
 * stage (the edited one included). Rows the plan leaves untouched are not in it.
 */
export function planEntityOverride(args: {
  plan: SavePlan;
  overrides: readonly OverrideRow[];
  rule: MasterOverrideRule;
  editedKey: string;
  rowKeysOfEntity: readonly string[];
  /** A number, or an enum token for an enum domain (WP 14.2's distribution). */
  value: number | string | null;
}): void {
  const { plan, overrides, rule, editedKey, rowKeysOfEntity, value } = args;
  for (const key of new Set([editedKey, ...rowKeysOfEntity])) {
    const k = planKey(key, rule.family);
    const already = plan.has(k);
    const saved = overrides.find((o) => o.scope === "node" && o.target_key === key && o.family === rule.family);
    const had = !!saved && rule.key in (saved.patch ?? {});
    if (key !== editedKey && !had && !already) continue;
    const patch = planPatch(plan, overrides, "node", key, rule.family);
    if (key === editedKey && value !== null) patch[rule.key] = value;
    else delete patch[rule.key];
  }
}

/** Split a plan into the rows to upsert (full patches) and the rows to delete
 *  (a saved row whose patch is now empty). An unsaved row with an empty patch is
 *  nothing to do. */
export function settlePlan(
  plan: SavePlan,
  scope: "node" | "edge",
): { upserts: OverrideRow[]; deletes: Array<{ scope: "node" | "edge"; target_key: string; family: PolicyFamily }> } {
  const upserts: OverrideRow[] = [];
  const deletes: Array<{ scope: "node" | "edge"; target_key: string; family: PolicyFamily }> = [];
  for (const e of plan.values()) {
    if (Object.keys(e.patch).length > 0) upserts.push({ scope, target_key: e.target_key, family: e.family, patch: e.patch });
    else if (e.saved) deletes.push({ scope, target_key: e.target_key, family: e.family });
  }
  return { upserts, deletes };
}
