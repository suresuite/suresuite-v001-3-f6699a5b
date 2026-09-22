// Typed reader over the engine's registry snapshot (Phase A / G1+G6 / §6.2).
//
// `registry.generated.json` is produced FROM the scsim engine by
// `scsim/scripts/gen_frontend_registry.py`; a CI gate fails the build if it
// drifts from the engine. This module is the frontend's single point of access
// to it, so engine facts (the policy catalog, each policy's params/enums/
// ranges/defaults, implemented-vs-planned status) are read from the engine
// rather than re-typed by hand. Phase B's node-owned policy forms render from
// these accessors directly.

import registry from "./registry.generated.json";

export interface RegistryParamProp {
  type?: string;
  title?: string;
  unit?: string;
  notes?: string;
  scope?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

/**
 * Facet-5 data contract (§8.1): an entity field a policy (or the always-on
 * engine mechanics) reads, declared engine-side and exported here. `field`
 * uses the `dataset.column` vocabulary of dataMap.ts / the mapping contract.
 */
export interface RegistryDataRequirement {
  field: string;
  level: "required" | "recommended" | "defaulted";
  reason: string;
  fallback: string | null;
  condition: string | null;
  /** Machine-readable fallback chain (scsim base.py::FallbackStep) — resolved
   * by the shared grading module against its named-reducer library. */
  fallback_spec?: Array<{
    grade: "info" | "warn";
    reducer: string | null;
    constant: number | null;
  }>;
  /** What an EMPTY column MEANS, when the engine honours the blank rather than
   *  substituting for it (scsim base.py::EmptyMeaning). Mutually exclusive with
   *  `fallback_spec` — they are opposite answers to the same blank cell. */
  empty_means?: { token: string; meaning: string } | null;
}

/**
 * §4 D90 — a /policies bundle key and what it feeds in the engine, declared in
 * `project_map.py::POLICY_BUNDLE_KEYS` and published here.
 */
export interface RegistryBundleKey {
  key: string;
  family: string;
  target: string;
  catalog_ref: string | null;
  transform: string;
  /**
   * The entity field that makes this key's value unreachable when it is set
   * (§4 D167). Two keys carry it and both name `products.production_capacity`:
   * a product with a master capacity is built from that column and the plant
   * grid's line capacity is read by nothing — which the engine has warned about
   * since the mapper was written, and which no surface could act on while the
   * statement existed only inside `transform`'s prose.
   */
  shadowed_by?: string | null;
}

export interface RegistryPolicy {
  id: string;
  catalog_ref: string;
  stage: string;
  strategy_class: string;
  constraint_targeted: string | null;
  requires_predeployment: boolean;
  status: string; // "implemented" | "planned" | ...
  milestone: string | null;
  summary: string;
  hooks: Array<{ phase: string; priority: number; reads: string[]; writes: string[]; resolution: string | null }>;
  params_schema: { properties?: Record<string, RegistryParamProp>; [k: string]: unknown };
  data_requirements: RegistryDataRequirement[];
}

interface RegistryPayload {
  engine_version: string;
  policies: RegistryPolicy[];
  base_data_requirements: RegistryDataRequirement[];
  policy_bundle_keys?: RegistryBundleKey[];
  pipeline: unknown;
  kpis: Array<{ name: string; symbol: string; definition: string; unit: string }>;
  entities: Record<string, unknown>;
}

const REGISTRY = registry as unknown as RegistryPayload;

const BY_ID = new Map<string, RegistryPolicy>(REGISTRY.policies.map((p) => [p.id, p]));

export const engineVersion = (): string => REGISTRY.engine_version;

export const policyCatalog = (): RegistryPolicy[] => REGISTRY.policies;

export const policyById = (id: string): RegistryPolicy | undefined => BY_ID.get(id);

export const hasPolicy = (id: string): boolean => BY_ID.has(id);

export const catalogRef = (id: string): string | undefined => BY_ID.get(id)?.catalog_ref;

export const isImplemented = (id: string): boolean => BY_ID.get(id)?.status === "implemented";

/** Full JSON-Schema prop for a policy parameter (type/unit/range/default/…). */
export const paramProp = (policyId: string, field: string): RegistryParamProp | undefined =>
  BY_ID.get(policyId)?.params_schema?.properties?.[field];

/** Ordered param field names declared for a policy. */
export const paramFields = (policyId: string): string[] =>
  Object.keys(BY_ID.get(policyId)?.params_schema?.properties ?? {});

/** Enum values the engine accepts for a policy parameter, or undefined. */
export const paramEnum = (policyId: string, field: string): string[] | undefined =>
  BY_ID.get(policyId)?.params_schema?.properties?.[field]?.enum;

/** { min, max } the engine accepts for a numeric policy parameter, if declared. */
export const paramRange = (
  policyId: string,
  field: string,
): { min?: number; max?: number } | undefined => {
  const prop = BY_ID.get(policyId)?.params_schema?.properties?.[field];
  if (!prop) return undefined;
  return { min: prop.minimum, max: prop.maximum };
};

export const paramDefault = (policyId: string, field: string): unknown =>
  BY_ID.get(policyId)?.params_schema?.properties?.[field]?.default;

/** Entity fields the always-on engine mechanics read (§8.1 manifest base). */
export const baseDataRequirements = (): RegistryDataRequirement[] =>
  REGISTRY.base_data_requirements ?? [];

/** Entity fields a specific policy declares it reads (facet 5). */
export const policyDataRequirements = (policyId: string): RegistryDataRequirement[] =>
  BY_ID.get(policyId)?.data_requirements ?? [];

/** The /policies bundle keys the engine reads, as it declares them (§4 D90). */
export const policyBundleKeys = (): RegistryBundleKey[] =>
  REGISTRY.policy_bundle_keys ?? [];

const SHADOWED_BY = new Map<string, string>(
  (REGISTRY.policy_bundle_keys ?? [])
    .filter((k) => !!k.shadowed_by)
    .map((k) => [k.key, k.shadowed_by as string]),
);

/**
 * The `dataset.column` that outranks this bundle key, or undefined (§4 D167).
 *
 * A surface asks this to find out whether the cell it is about to render is one
 * the engine will read. Answered from the engine's own declaration, so the grid
 * cannot go on claiming an edit reaches the run after the engine stops reading
 * it — the failure mode §4 D18 is, with the extra twist that this one depends
 * on the ROW.
 */
export const shadowedBy = (bundleKey: string): string | undefined =>
  SHADOWED_BY.get(bundleKey);

/**
 * What an EMPTY value of a declared field MEANS, or undefined (§4 D167).
 *
 * The engine's own statement, so the token a cell renders in place of a number
 * and the sentence beside it have ONE author. `columnSpecs.ts` used to carry
 * both — which made the FRONTEND the only machine-readable statement of a fact
 * about the engine, while the registry said the same thing in prose one field
 * over. That is §2.1 `single-source` below markdown, the class §4 D101 and D127
 * name, and `check:docs` can see none of it.
 */
export const emptyMeansFor = (
  field: string,
): { token: string; meaning: string } | undefined =>
  baseDataRequirements().find((r) => r.field === field)?.empty_means ?? undefined;
