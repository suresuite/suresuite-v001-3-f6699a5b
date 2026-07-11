// Registry-driven policy-type library (Phase D / 6.A PR-1 / §II.1–II.3, §6.2).
//
// The single access point the migrated grid uses to render "Policy Type →
// dynamic parameters". Every policy type, its parameters, and each parameter's
// unit/range/default/enum are read FROM the engine registry
// (registry.generated.json) — never hand-written (blueprint §6.2). The grid's
// dynamic parameter cell is generated from these accessors: the type's 1–3
// headline params become their own columns, the rest a chip list (§II.3).
//
// The one thing NOT in the registry is which param belongs to which type (the
// engine flattens all params onto one policy). That structural grouping is
// spec-defined (§III / §IV) and declared here; the param *schemas* still come
// from the registry.

import {
  paramProp,
  policyById,
  type RegistryParamProp,
} from "./registryAccess";

/** One editable policy parameter, resolved from the registry schema. */
export interface RegistryParam {
  field: string;
  label: string;
  type: "number" | "integer" | "string" | "object" | "boolean" | "unknown";
  unit?: string;
  enum?: string[];
  default?: unknown;
  min?: number;
  max?: number;
  notes?: string;
}

/** A selectable policy type within a category and its dynamic parameters. */
export interface PolicyTypeOption {
  /** Discriminator value stored in the family bundle (Zod-compatible). */
  value: string;
  /** The engine registry's policy_type value (may differ from the stored one). */
  registryValue: string;
  label: string;
  status: string; // "implemented" | "planned"
  summary?: string;
  /** 1–3 headline params → their own grid columns. */
  headline: RegistryParam[];
  /** Remaining params → the "more…" chip list. */
  rest: RegistryParam[];
}

/** A grid category (one table) and its selectable policy-type library. */
export interface PolicyCategory {
  key: string;
  label: string;
  /** Registry policy id the types + param schemas are read from. */
  policyId: string;
  /** Field in the stored family bundle that holds the chosen type. */
  discriminator: string;
  types: PolicyTypeOption[];
}

const TITLE_CASE = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function toParam(policyId: string, field: string): RegistryParam {
  const p: RegistryParamProp = paramProp(policyId, field) ?? {};
  const t = (p.type ?? "unknown") as RegistryParam["type"];
  return {
    field,
    label: p.title ?? TITLE_CASE(field),
    type: t === "number" || t === "integer" || t === "string" || t === "object" || t === "boolean" ? t : "unknown",
    unit: p.unit,
    enum: p.enum,
    default: p.default,
    min: p.minimum,
    max: p.maximum,
    notes: p.notes,
  };
}

// ── Inventory / replenishment (§III) ────────────────────────────────────────
// inventory_control (P-P.1) exposes policy_type ∈ {min_max, base_stock, rop_q,
// periodic}. Which params each type uses is spec-structure (§III.1–III.5); the
// param schemas are pulled from the registry. `review_cadence_weeks` and the
// periodic `Period` are surfaced as structural grid columns (Policy Basis /
// Periodic Check, §II.1), not as dynamic params, so they're excluded here.
const INVENTORY_POLICY = "inventory_control";

// registry policy_type  →  { stored Zod `type` value, headline params, chips }
const INVENTORY_TYPES: Array<{
  registryValue: string;
  storedValue: string;
  label: string;
  headline: string[];
  rest: string[];
}> = [
  { registryValue: "min_max", storedValue: "min_max", label: "Min-max (s, S)", headline: ["coverage_weeks"], rest: ["basis"] },
  { registryValue: "base_stock", storedValue: "base_stock", label: "Base stock (S)", headline: ["coverage_weeks"], rest: ["basis"] },
  { registryValue: "rop_q", storedValue: "rop", label: "(R, Q)", headline: ["rop_q_quantity", "coverage_weeks"], rest: ["basis"] },
  { registryValue: "periodic", storedValue: "periodic_review", label: "Periodic review (T, S)", headline: ["periodic_review_weeks", "coverage_weeks"], rest: ["basis"] },
];

function buildInventoryCategory(): PolicyCategory {
  const summary = policyById(INVENTORY_POLICY)?.summary;
  return {
    key: "inventory",
    label: "Inventory / replenishment",
    policyId: INVENTORY_POLICY,
    discriminator: "type",
    types: INVENTORY_TYPES.map((t) => ({
      value: t.storedValue,
      registryValue: t.registryValue,
      label: t.label,
      status: policyById(INVENTORY_POLICY)?.status ?? "implemented",
      summary,
      headline: t.headline.map((f) => toParam(INVENTORY_POLICY, f)),
      rest: t.rest.map((f) => toParam(INVENTORY_POLICY, f)),
    })),
  };
}

const CATEGORIES: Record<string, PolicyCategory> = {
  inventory: buildInventoryCategory(),
};

/** The policy-type library for a grid category, generated from the registry. */
export function policyCategory(key: string): PolicyCategory | undefined {
  return CATEGORIES[key];
}

/** All categories with a registry-driven policy-type library. */
export function policyCategories(): PolicyCategory[] {
  return Object.values(CATEGORIES);
}

/** The selected type's option (headline + chip params) within a category. */
export function policyTypeOption(categoryKey: string, storedValue: string): PolicyTypeOption | undefined {
  return CATEGORIES[categoryKey]?.types.find((t) => t.value === storedValue);
}

/** Feasibility for one param value against its registry range — the same gate
 *  the server applies, surfaced inline (§II.3). Returns null when valid. */
export function paramFeasibility(param: RegistryParam, value: unknown): string | null {
  if (value == null || value === "") return null; // empty → use default, not an error
  if (param.type === "number" || param.type === "integer") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return "must be a number";
    if (param.type === "integer" && !Number.isInteger(n)) return "must be a whole number";
    if (param.min != null && n < param.min) return `must be ≥ ${param.min}`;
    if (param.max != null && n > param.max) return `must be ≤ ${param.max}`;
  }
  if (param.enum && typeof value === "string" && !param.enum.includes(value)) {
    return `must be one of ${param.enum.join(", ")}`;
  }
  return null;
}
