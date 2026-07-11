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
