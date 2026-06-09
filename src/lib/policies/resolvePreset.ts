import {
  DEFAULT_BUNDLE,
  parseFamily,
  type FulfillmentStrategy,
  type PolicyBundle,
  type PolicyFamily,
} from "./schemas";

/** Read-only project context that presets derive concrete values from. */
export interface ProjectContext {
  project_id: string;
  plant_name: string;
  supply_chain_model: string; // 'distribution' | 'production' | etc
  bom_level: string; // 'single' | 'multi_level'
  industry?: string;
  // Network counts
  supplier_count: number;
  plant_count: number;
  customer_count: number;
  // Demand stats (from outbound_logistic)
  demand_mean_per_day?: number;
  demand_cv?: number;
  top_customer?: string;
  // Supplier stats (from inbound_logistic)
  supplier_lt_mean_days?: number;
  supplier_lt_cv?: number;
  top_supplier?: string;
  // Strategy chosen at project level
  fulfillment_strategy: FulfillmentStrategy;
}

/** A single resolved field with its derivation explanation. */
export interface DerivedField {
  value: unknown;
  why: string;
}

/** Per-family map of field → derivation. Cells may be omitted to use schema defaults. */
export type FamilyDerivation = Record<string, DerivedField>;

/** A preset definition: derivation function per family + meta. */
export interface PresetDefinition {
  slug: string;
  name: string;
  description: string;
  is_system: true;
  derive: (ctx: ProjectContext) => Partial<Record<PolicyFamily, FamilyDerivation>>;
}

/** Output of resolvePreset: full bundle + per-field "why" map. */
export interface ResolvedPreset {
  bundle: PolicyBundle;
  why: Partial<Record<PolicyFamily, Record<string, string>>>;
  slug: string;
  name: string;
}

/**
 * Take a preset + project context → fully populated PolicyBundle with derivation
 * strings for every overridden field. Unmodified fields fall back to schema defaults.
 */
export function resolvePreset(
  preset: PresetDefinition,
  ctx: ProjectContext,
): ResolvedPreset {
  const derivation = preset.derive(ctx);
  const bundle: PolicyBundle = { ...DEFAULT_BUNDLE };
  const why: Partial<Record<PolicyFamily, Record<string, string>>> = {};

  for (const family of Object.keys(derivation) as PolicyFamily[]) {
    const fields = derivation[family] ?? {};
    const raw: Record<string, unknown> = {
      ...(DEFAULT_BUNDLE[family] as Record<string, unknown>),
    };
    const familyWhy: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      raw[k] = v.value;
      familyWhy[k] = v.why;
    }
    // Re-validate through the schema so types are sound.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bundle as any)[family] = parseFamily(family, raw);
    why[family] = familyWhy;
  }

  return { bundle, why, slug: preset.slug, name: preset.name };
}

/** Compute diff between current bundle and resolved bundle. */
export interface BundleDiff {
  family: PolicyFamily;
  field: string;
  before: unknown;
  after: unknown;
  why: string;
}

export function diffBundles(
  before: PolicyBundle,
  resolved: ResolvedPreset,
  familyFilter?: PolicyFamily[],
): BundleDiff[] {
  const out: BundleDiff[] = [];
  const families = (familyFilter ?? (Object.keys(resolved.why) as PolicyFamily[]));
  for (const family of families) {
    const fam = resolved.bundle[family] as Record<string, unknown>;
    const cur = before[family] as Record<string, unknown>;
    const whyMap = resolved.why[family] ?? {};
    for (const [field, after] of Object.entries(fam)) {
      const beforeVal = cur?.[field];
      const changed = JSON.stringify(beforeVal) !== JSON.stringify(after);
      if (!changed) continue;
      out.push({
        family,
        field,
        before: beforeVal,
        after,
        why: whyMap[field] ?? "default for this preset",
      });
    }
  }
  return out;
}
