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
import { ENUM_OPTIONS, FIELD_LABELS, InventoryPolicy, SCSIM_ENUM_OPTIONS } from "./schemas";

// Frontend Zod defaults for inventory params not (yet) in the engine registry —
// reorder_point/order_up_to/review_period_days are stored + versioned on the
// frontend ahead of the engine's coverage-based κ (§II.4), so their schema lives
// here, not in registry.generated.json.
const INVENTORY_DEFAULTS = InventoryPolicy.parse({}) as Record<string, unknown>;

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

// A param the engine registry doesn't declare (frontend-only stored field):
// resolve its label/enum/default from the frontend Zod schema instead.
function frontendParam(field: string): RegistryParam {
  const enumVals = SCSIM_ENUM_OPTIONS[field] ?? ENUM_OPTIONS[field];
  return {
    field,
    label: FIELD_LABELS[field] ?? TITLE_CASE(field),
    type: enumVals ? "string" : "number",
    enum: enumVals ? [...enumVals] : undefined,
    default: INVENTORY_DEFAULTS[field],
    min: 0,
  };
}

function toParam(policyId: string, field: string): RegistryParam {
  const p: RegistryParamProp | undefined = paramProp(policyId, field);
  // Fall back to the frontend schema for stored fields the engine doesn't expose.
  if (!p) return frontendParam(field);
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
// periodic}. Which params each type uses is spec-structure (§III.1–III.5). The
// grid stores absolute level/lot fields (reorder_point s, order_up_to S,
// rop_q_quantity Q, review_period_days T) ahead of the engine's coverage-based κ
// (§II.4); `basis` and `rop_q_quantity` schemas come from the registry, the
// remaining level fields from the frontend Zod schema (see frontendParam).
const INVENTORY_POLICY = "inventory_control";

// registry policy_type  →  { stored Zod `type` value, per-type param vector }.
// headline+rest are the params rendered in the row's "Replenishment parameters"
// vector cell — only the params that type actually needs (§II.3).
const INVENTORY_TYPES: Array<{
  registryValue: string;
  storedValue: string;
  label: string;
  headline: string[];
  rest: string[];
}> = [
  { registryValue: "min_max", storedValue: "min_max", label: "Min-max (s, S)", headline: ["reorder_point", "order_up_to"], rest: ["basis"] },
  { registryValue: "base_stock", storedValue: "base_stock", label: "Base stock (S)", headline: ["order_up_to"], rest: ["basis"] },
  { registryValue: "rop_q", storedValue: "rop", label: "(R, Q)", headline: ["rop_q_quantity", "reorder_point"], rest: ["basis"] },
  { registryValue: "periodic", storedValue: "periodic_review", label: "Periodic review (T, S)", headline: ["review_period_days", "order_up_to"], rest: ["basis"] },
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

/** The ordered inventory parameter vector for a stored policy-type value —
 *  exactly the params that type requires, in display order (§II.3). Falls back
 *  to the default (min_max) vector for an unknown/empty type. */
export function inventoryParamsForType(storedType: string): RegistryParam[] {
  const opt = policyTypeOption("inventory", storedType) ?? policyTypeOption("inventory", "min_max");
  return opt ? [...opt.headline, ...opt.rest] : [];
}

/** Human label for a stored policy-type value, from the registry library. */
export function policyTypeLabel(categoryKey: string, storedValue: string): string {
  return policyTypeOption(categoryKey, storedValue)?.label ?? storedValue;
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
