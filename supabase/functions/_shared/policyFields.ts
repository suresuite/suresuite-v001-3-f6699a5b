// B2 Policy Configurator deterministic surface — Phase B / §12 / AI agents
// (design: docs/design/ai-agents.md §5.2 hard gates, §4.4 policy_bundle_diff).
//
// The ONE diff-vocabulary/validation module consumed by BOTH agent surfaces:
//   * the draft tool handler (project-ai-chat/configuratorTools.ts) — draft-time
//     schema validation (`invalid_params` / `dependency_missing` on violation)
//   * the apply function (agent-apply/policyBundleApply.ts) — apply-time
//     re-validation of the stored payload before the transactional wrapper runs
// so a patch field can never reach `apply_policy_bundle` unless it is a field a
// human can configure on /policies today (§13.3 same-as-UI law).
//
// Vocabulary provenance (kept in lockstep; ai-agents.md §10 Q22 records this
// as-built decision):
//   * The DIFF vocabulary is the v2 snapshot STORAGE vocabulary — the seven
//     family bundles of src/lib/policies/schemas.ts (Zod), which is what
//     policy_defaults / policy_overrides store and what _build_policy_snapshot
//     (20260612000001) hashes. Types/ranges/enums below mirror those Zod
//     schemas; enum sets are the SCSIM-narrowed options the UI offers
//     (schemas.ts::SCSIM_ENUM_OPTIONS / MULTI_SELECT_OPTIONS).
//   * `editable` marks exactly the fields a human can set on /policies —
//     the scsim-consumed defaults (schemas.ts::SCSIM_VISIBLE_FIELDS), the
//     registry-driven grid columns (columnSpecs.ts::STAGE_TABLE_SPEC incl. the
//     §II.3 inventory vector params), and the run-readiness selections
//     (primary_source / sourcing_firm). Everything else is stored-but-pending
//     and is REFUSED with the milestone of the catalog policy that will consume
//     it (§5.2 refusal: never configure planned policies; honest catalog A3).
//   * Where the engine registry declares a same-named param, its schema is
//     overlaid from registry.generated.json at module load (blueprint §6.2
//     SSOT law) — the registry wins over the mirrored constraint.
//   * Planned-policy milestones are read LIVE from the registry snapshot: when
//     a planned policy ships (status flips to "implemented"), the refusal
//     dissolves without a code change.
//
// Like grading.ts, this module is dependency-free pure TypeScript over the
// generated registry snapshot: no Deno.*, no supabase client — the
// deterministic eval tier runs it byte-identically offline.

import registry from "./registry.generated.json" with { type: "json" };

export const POLICY_FAMILIES = [
  "sourcing",
  "inventory",
  "transport",
  "fulfillment",
  "production",
  "recovery",
  "demand",
] as const;
export type PolicyFamily = (typeof POLICY_FAMILIES)[number];

/** §4.5 size limits for policy_bundle_diff (DEFAULT). */
export const MAX_OVERRIDE_ROWS = 200;
export const MAX_PATCH_PROPERTIES = 40;
export const MAX_TARGET_KEY_LEN = 200;
export const MAX_SCOPE_LEN = 40;

interface RegistryParamProp {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}

interface RegistryPolicyEntry {
  id: string;
  catalog_ref: string;
  stage: string;
  status: string;
  milestone: string | null;
  summary: string;
  params_schema?: { properties?: Record<string, RegistryParamProp> };
  data_requirements?: Array<{ field: string; level: string; reason: string }>;
}

const REGISTRY_POLICIES: RegistryPolicyEntry[] =
  (registry as unknown as { policies: RegistryPolicyEntry[] }).policies ?? [];

const POLICY_BY_ID = new Map(REGISTRY_POLICIES.map((p) => [p.id, p]));

/** Engine registry snapshot version — stamped into proposal grounding. */
export const REGISTRY_VERSION = String(
  (registry as { engine_version?: string }).engine_version ?? "unknown",
);

export type FieldValueKind =
  | "number"
  | "integer"
  | "string"
  | "boolean"
  | "enum"
  | "enum_array" // recovery.response
  | "ratio_map"; // sourcing.ratios / fulfillment.tier_overrides (id → 0..1)

export interface PolicyFieldSpec {
  kind: FieldValueKind;
  enum?: readonly string[];
  min?: number;
  max?: number;
  /** true ⇒ a human can configure it on /policies today (proposable). */
  editable: boolean;
  /** For pending fields: the registry policy id that will consume it. */
  pendingPolicy?: string;
  /** Registry param to overlay schema facts from (blueprint §6.2 SSOT). */
  registryRef?: { policy: string; param: string };
}

const n = (min?: number, max?: number, editable = false): PolicyFieldSpec => ({
  kind: "number",
  min,
  max,
  editable,
});
const en = (options: readonly string[], editable = false): PolicyFieldSpec => ({
  kind: "enum",
  enum: options,
  editable,
});
const b = (editable = false): PolicyFieldSpec => ({ kind: "boolean", editable });
const s = (editable = false): PolicyFieldSpec => ({ kind: "string", editable });

/**
 * The storage-bundle field vocabulary (mirror of schemas.ts, see header).
 * Editability = /policies grid + defaults-card reality at the time of writing;
 * a field flipped editable in the UI must flip here in the same change.
 */
export const FAMILY_FIELDS: Record<PolicyFamily, Record<string, PolicyFieldSpec>> = {
  sourcing: {
    // scsim-consumed (SCSIM_VISIBLE_FIELDS.sourcing) + grid columns
    strategy: en(["single", "multi", "primary_backup", "dual_sourcing", "tiered"], true),
    ratios: { kind: "ratio_map", editable: true },
    supply_share: n(0, 1, true),
    primary_source: b(true), // run-readiness: primary supplier per material (grid)
    material_price: n(0, undefined, true), // grid supplier-stage column
    // stored, pending an engine consumer
    primary_supplier: s(),
    backup_supplier: s(),
    tertiary_supplier: s(),
    failover_trigger: en(["stockout", "lead_time_breach", "cost_threshold", "manual"]),
    failover_threshold_pct: n(0, 100),
    failover_cooldown_days: n(0),
    min_reliability: n(0, 1),
    max_lead_time_variance_days: n(0),
    contract_type: en(["spot", "contract", "vmi", "consignment"]),
    order_consolidation: en(["none", "daily", "weekly", "monthly"]),
  },
  inventory: {
    // Policy Type → dynamic params (§II.1–II.4; registry-driven picker)
    type: en(["min_max", "base_stock", "rop", "periodic_review"], true),
    basis: {
      kind: "enum",
      enum: ["days_of_supply", "forward_visible"],
      editable: true,
      registryRef: { policy: "inventory_control", param: "basis" },
    },
    reorder_point: n(0, undefined, true),
    order_up_to: n(0, undefined, true),
    rop_q_quantity: {
      kind: "number",
      min: 0,
      editable: true,
      registryRef: { policy: "inventory_control", param: "rop_q_quantity" },
    },
    review_period_days: n(0, undefined, true),
    // scsim-consumed defaults
    safety_stock_method: en(["fixed_days", "service_level", "king_method"], true),
    // max mirrors the registry's safety_stock_materials.fixed_days_cover bound
    safety_stock_days: n(0, 84, true),
    service_level_target: n(0, 1, true),
    holding_cost_pct: n(0, 2, true),
    fg_safety_stock: en(["none", "service_level", "fixed_days"], true),
    fg_service_level_target: n(0.8, 0.999, true),
    fg_safety_stock_days: n(0, 12, true),
    // stored, pending
    min_stock: n(0),
    max_stock: n(0),
    moq: n(0),
    abc_class: en(["A", "B", "C"]),
    rotation: en(["FIFO", "LIFO", "FEFO"]),
    shelf_life_days: n(0),
    stockout_cost_per_unit: n(0),
    ordering_cost: n(0),
  },
  transport: {
    // Entire family pending the P-T.x catalog policies (fieldStatus.ts):
    // stored + versioned, consumed when they land — never configurable here.
    mode: { ...en(["road", "rail", "sea", "air", "intermodal"]), pendingPolicy: "multimodal_lane_portfolio" },
    lead_time_mean_days: { ...n(0), pendingPolicy: "leadtime_hedging" },
    lead_time_std_days: { ...n(0), pendingPolicy: "leadtime_hedging" },
    lead_time_distribution: { ...en(["normal", "lognormal", "gamma", "triangular"]), pendingPolicy: "leadtime_hedging" },
    lead_time_shape: { ...n(0), pendingPolicy: "leadtime_hedging" },
    lead_time_scale: { ...n(0), pendingPolicy: "leadtime_hedging" },
    lead_time_min: { ...n(0), pendingPolicy: "leadtime_hedging" },
    lead_time_mode: { ...n(0), pendingPolicy: "leadtime_hedging" },
    lead_time_max: { ...n(0), pendingPolicy: "leadtime_hedging" },
    vehicles: { ...n(0), pendingPolicy: "multimodal_lane_portfolio" },
    capacity_weight_kg: { ...n(0), pendingPolicy: "multimodal_lane_portfolio" },
    capacity_volume_m3: { ...n(0), pendingPolicy: "multimodal_lane_portfolio" },
    load_type: { ...en(["LTL", "FTL", "parcel", "container"]), pendingPolicy: "multimodal_lane_portfolio" },
    min_fill_pct: { ...n(0, 100), pendingPolicy: "multimodal_lane_portfolio" },
    cost_per_unit: { ...n(0), pendingPolicy: "multimodal_lane_portfolio" },
    cost_per_km: { ...n(0), pendingPolicy: "multimodal_lane_portfolio" },
    fixed_dispatch_cost: { ...n(0), pendingPolicy: "multimodal_lane_portfolio" },
    routing: { ...en(["direct", "milk_run", "cross_dock", "hub_spoke"]), pendingPolicy: "multimodal_lane_portfolio" },
    carbon_intensity_kg_per_tkm: { ...n(0), pendingPolicy: "multimodal_lane_portfolio" },
  },
  fulfillment: {
    allocation: en(["priority", "fair_share", "proportional", "revenue_max", "sla_tier"], true),
    backorder_allowed: b(true),
    max_backorder_days: n(0, undefined, true),
    backorder_cost_per_day: n(0, undefined, true),
    tier_overrides: { kind: "ratio_map", editable: true },
    // run-readiness: primary sourcing firm per customer×product (grid)
    sourcing_firm: s(true),
    primary_source: b(true),
    // stored, pending
    lost_sales_cost_per_unit: n(0),
    service_level_alpha: n(0, 1),
    service_level_beta: n(0, 1),
    order_batching_window_hours: n(0),
    price: n(0),
  },
  production: {
    capacity_units_per_day: n(0, undefined, true),
    allocation_priority_weight: n(0, undefined, true),
    // P-P.2 lot sizing is a PLANNED catalog policy — configuring it is refused
    // with the milestone (§5.2 refusal rules; pinned by pc-04).
    lot_policy: { ...en(["fixed", "epq", "lot_for_lot", "pohm"]), pendingPolicy: "lot_sizing" },
    setup_time_hours: { ...n(0), pendingPolicy: "lot_sizing" },
    setup_cost: { ...n(0), pendingPolicy: "lot_sizing" },
    // stored, pending (no named consumer yet)
    utilization_cap_pct: n(0, 100),
    scheduling: en(["fifo", "edd", "spt", "critical_ratio"]),
    capacity_machine_per_day: n(0),
    capacity_labor_per_day: n(0),
    production_cost_per_unit: n(0),
    production_lead_time_mean_days: n(0),
    production_lead_time_std_days: n(0),
    lead_time_distribution: en(["normal", "lognormal", "gamma", "triangular"]),
    production_lead_time_shape: n(0),
    production_lead_time_scale: n(0),
    production_lead_time_min: n(0),
    production_lead_time_mode: n(0),
    production_lead_time_max: n(0),
  },
  recovery: {
    // Restricted to the responses the engine maps (schemas.ts::MULTI_SELECT_OPTIONS)
    response: {
      kind: "enum_array",
      enum: ["reroute", "dual_source_activate", "mode_shift", "capacity_flex", "early_warning", "allocate_materials"],
      editable: true,
    },
    detection_lag_days: n(0, undefined, true),
    // stored, pending (P-X.1 recovery playbooks productize the trigger shape)
    enabled: { ...b(), pendingPolicy: "recovery_playbook" },
    trigger_magnitude_pct: { ...n(0, 100), pendingPolicy: "recovery_playbook" },
    trigger_duration_days: { ...n(0), pendingPolicy: "recovery_playbook" },
    trigger_geography: { ...s(), pendingPolicy: "recovery_playbook" },
    recovery_target_days: { ...n(0), pendingPolicy: "recovery_playbook" },
    cost_cap: { ...n(0), pendingPolicy: "recovery_playbook" },
  },
  demand: {
    // Demand shape comes from product/graph data; the family is stored and
    // pending P-C.3 demand shaping (fieldStatus.ts::PENDING_FAMILY_POLICY).
    pattern: { ...en(["stationary", "trend", "seasonal", "intermittent", "lumpy"]), pendingPolicy: "demand_shaping" },
    mean_per_day: { ...n(0), pendingPolicy: "demand_shaping" },
    cv: { ...n(0, 5), pendingPolicy: "demand_shaping" },
    seasonality_period_days: { ...n(0), pendingPolicy: "demand_shaping" },
    seasonality_amplitude_pct: { ...n(0, 200), pendingPolicy: "demand_shaping" },
    trend_pct_per_period: { ...n(), pendingPolicy: "demand_shaping" },
    forecast_method: { ...en(["naive", "moving_avg", "exp_smoothing", "croston", "ml"]), pendingPolicy: "demand_shaping" },
    forecast_horizon_days: { ...n(1), pendingPolicy: "demand_shaping" },
    forecast_bias_pct: { ...n(), pendingPolicy: "demand_shaping" },
    order_size_distribution: { ...en(["poisson", "normal", "negbin", "empirical"]), pendingPolicy: "demand_shaping" },
    priority_tier: { ...en(["A", "B", "C"]), pendingPolicy: "demand_shaping" },
    delivery_window_days: { ...n(0), pendingPolicy: "demand_shaping" },
    late_penalty_per_day: { ...n(0), pendingPolicy: "demand_shaping" },
    delivery_schedule: { ...s(), pendingPolicy: "demand_shaping" },
  },
};

// Registry overlay (§6.2 SSOT): where the engine declares a same-named param,
// its enum/range wins over the mirrored constant above.
for (const fields of Object.values(FAMILY_FIELDS)) {
  for (const spec of Object.values(fields)) {
    if (!spec.registryRef) continue;
    const prop = POLICY_BY_ID.get(spec.registryRef.policy)?.params_schema?.properties?.[spec.registryRef.param];
    if (!prop) continue;
    if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      spec.kind = "enum";
      spec.enum = prop.enum.map(String);
    }
    if (typeof prop.minimum === "number") spec.min = prop.minimum;
    if (typeof prop.maximum === "number") spec.max = prop.maximum;
    if (prop.type === "integer") spec.kind = spec.kind === "enum" ? spec.kind : "integer";
  }
}

/** The planned catalog policy that will consume a pending field, read live
 * from the registry snapshot — null when the field is editable today or its
 * named consumer has shipped (status "implemented"). */
export function plannedPolicyFor(
  family: PolicyFamily,
  field: string,
): { id: string; catalog_ref: string; milestone: string | null } | null {
  const spec = FAMILY_FIELDS[family]?.[field];
  if (!spec || spec.editable) return null;
  if (!spec.pendingPolicy) return null;
  const pol = POLICY_BY_ID.get(spec.pendingPolicy);
  if (!pol || pol.status === "implemented") return null;
  return { id: pol.id, catalog_ref: pol.catalog_ref, milestone: pol.milestone };
}

export interface DiffOverride {
  scope: string;
  target_key: string;
  family: PolicyFamily;
  patch: Record<string, unknown>;
}

export interface PolicyDiff {
  defaults?: Partial<Record<PolicyFamily, Record<string, unknown>>>;
  overrides?: DiffOverride[];
}

export type DiffErrorCode = "invalid_params" | "dependency_missing" | "too_large";

export interface DiffValidation {
  ok: boolean;
  code?: DiffErrorCode;
  reason?: string;
  /** Families the diff touches (context/citation building). */
  families: PolicyFamily[];
  /** Qualified fields the diff sets, e.g. "inventory.review_period_days". */
  fields: string[];
}

function fail(code: DiffErrorCode, reason: string): DiffValidation {
  return { ok: false, code, reason, families: [], fields: [] };
}

function checkValue(family: PolicyFamily, field: string, value: unknown): string | null {
  const spec = FAMILY_FIELDS[family][field];
  switch (spec.kind) {
    case "number":
    case "integer": {
      const v = typeof value === "number" ? value : Number(value);
      if (typeof value === "boolean" || !Number.isFinite(v)) {
        return `${family}.${field}: expected a number, got ${JSON.stringify(value)}`;
      }
      if (spec.kind === "integer" && !Number.isInteger(v)) {
        return `${family}.${field}: expected a whole number, got ${v}`;
      }
      if (spec.min != null && v < spec.min) return `${family}.${field}: ${v} is below the minimum ${spec.min}`;
      if (spec.max != null && v > spec.max) return `${family}.${field}: ${v} exceeds the maximum ${spec.max}`;
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : `${family}.${field}: expected true/false`;
    case "string":
      return typeof value === "string" && value.length <= 200
        ? null
        : `${family}.${field}: expected a string (max 200 chars)`;
    case "enum":
      return typeof value === "string" && spec.enum!.includes(value)
        ? null
        : `${family}.${field}: "${String(value)}" is not allowed — accepted: ${spec.enum!.join(", ")}`;
    case "enum_array": {
      if (!Array.isArray(value)) return `${family}.${field}: expected an array of values`;
      for (const v of value) {
        if (typeof v !== "string" || !spec.enum!.includes(v)) {
          return `${family}.${field}: "${String(v)}" is not allowed — accepted: ${spec.enum!.join(", ")}`;
        }
      }
      return null;
    }
    case "ratio_map": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return `${family}.${field}: expected an object of id → share`;
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const share = Number(v);
        if (!Number.isFinite(share) || share < 0 || share > 1) {
          return `${family}.${field}: share for "${k}" must be within 0..1`;
        }
      }
      return null;
    }
  }
}

function checkPatch(family: PolicyFamily, patch: Record<string, unknown>): DiffValidation | null {
  if (Object.keys(patch).length === 0) {
    return fail("invalid_params", `the ${family} patch is empty`);
  }
  if (Object.keys(patch).length > MAX_PATCH_PROPERTIES) {
    return fail("too_large", `the ${family} patch exceeds ${MAX_PATCH_PROPERTIES} properties`);
  }
  for (const [field, value] of Object.entries(patch)) {
    const spec = FAMILY_FIELDS[family][field];
    if (!spec) {
      // §5.2 hard gate 1: unknown field ⇒ invalid_params (Pydantic
      // extra="forbid" mirrored — asset A2).
      return fail("invalid_params", `unknown field "${field}" in the ${family} family`);
    }
    if (!spec.editable) {
      const planned = plannedPolicyFor(family, field);
      if (planned) {
        // §5.2 refusal: planned-but-unimplemented policy — name the milestone.
        return fail(
          "dependency_missing",
          `${family}.${field} is consumed by ${planned.catalog_ref} (${planned.id}), which is not implemented yet` +
            (planned.milestone ? ` — planned for milestone ${planned.milestone}` : "") +
            ". The engine would silently ignore this setting, so it cannot be proposed.",
        );
      }
      return fail(
        "dependency_missing",
        `${family}.${field} is stored but not yet consumed by the engine (no /policies surface edits it) — it cannot be proposed until its catalog policy lands.`,
      );
    }
    const err = checkValue(family, field, value);
    if (err) return fail("invalid_params", err);
  }
  return null;
}

/**
 * Validate a policy_bundle_diff against the storage vocabulary (§5.2 hard
 * gates 1–2 + the §4.5 size limits). Scope/entity resolution (gate 3) needs
 * project data and stays in the tool handler.
 */
export function validatePolicyDiff(diff: unknown): DiffValidation {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) {
    return fail("invalid_params", "diff must be an object with defaults and/or overrides");
  }
  const d = diff as Record<string, unknown>;
  for (const k of Object.keys(d)) {
    if (k !== "defaults" && k !== "overrides") {
      return fail("invalid_params", `unknown diff property "${k}"`);
    }
  }
  const families = new Set<PolicyFamily>();
  const fields = new Set<string>();

  const defaults = d.defaults as Record<string, unknown> | undefined;
  if (defaults !== undefined) {
    if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
      return fail("invalid_params", "diff.defaults must be an object keyed by family");
    }
    for (const [family, patch] of Object.entries(defaults)) {
      if (!(POLICY_FAMILIES as readonly string[]).includes(family)) {
        return fail("invalid_params", `unknown policy family "${family}"`);
      }
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        return fail("invalid_params", `defaults.${family} must be a patch object`);
      }
      const err = checkPatch(family as PolicyFamily, patch as Record<string, unknown>);
      if (err) return err;
      families.add(family as PolicyFamily);
      for (const f of Object.keys(patch as Record<string, unknown>)) fields.add(`${family}.${f}`);
    }
  }

  const overrides = d.overrides as unknown;
  if (overrides !== undefined) {
    if (!Array.isArray(overrides)) {
      return fail("invalid_params", "diff.overrides must be an array");
    }
    if (overrides.length > MAX_OVERRIDE_ROWS) {
      return fail("too_large", `overrides exceed the ${MAX_OVERRIDE_ROWS}-row limit — narrow the ask`);
    }
    for (const raw of overrides) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return fail("invalid_params", "each override must be an object");
      }
      const o = raw as Record<string, unknown>;
      for (const k of Object.keys(o)) {
        if (!["scope", "target_key", "family", "patch"].includes(k)) {
          return fail("invalid_params", `unknown override property "${k}"`);
        }
      }
      const scope = String(o.scope ?? "");
      if (!scope || scope.length > MAX_SCOPE_LEN) {
        return fail("invalid_params", `override scope must be a non-empty string (max ${MAX_SCOPE_LEN} chars)`);
      }
      const targetKey = String(o.target_key ?? "");
      if (!targetKey || targetKey.length > MAX_TARGET_KEY_LEN) {
        return fail("invalid_params", `override target_key must be a non-empty string (max ${MAX_TARGET_KEY_LEN} chars)`);
      }
      const family = String(o.family ?? "");
      if (!(POLICY_FAMILIES as readonly string[]).includes(family)) {
        return fail("invalid_params", `unknown policy family "${family}" on override ${targetKey}`);
      }
      if (!o.patch || typeof o.patch !== "object" || Array.isArray(o.patch)) {
        return fail("invalid_params", `override ${targetKey} needs a patch object`);
      }
      const err = checkPatch(family as PolicyFamily, o.patch as Record<string, unknown>);
      if (err) return err;
      families.add(family as PolicyFamily);
      for (const f of Object.keys(o.patch as Record<string, unknown>)) fields.add(`${family}.${f}`);
    }
  }

  if (families.size === 0) {
    return fail("invalid_params", "the diff changes nothing — provide defaults and/or overrides");
  }
  return { ok: true, families: [...families], fields: [...fields] };
}

/** Family-level shallow merge of diff.defaults onto the live policy_defaults
 * row — the exact jsonb `||` semantics apply_policy_bundle uses, so the
 * draft-time manifest recompile grades the same defaults apply will write. */
export function mergeDefaults(
  current: Record<string, unknown>,
  diffDefaults: Partial<Record<PolicyFamily, Record<string, unknown>>> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const [family, patch] of Object.entries(diffDefaults ?? {})) {
    const base = (current[family] ?? {}) as Record<string, unknown>;
    out[family] = { ...base, ...(patch as Record<string, unknown>) };
  }
  return out;
}

/** Catalog rows for the get_policy_catalog read tool (§5.2 tool surface):
 * one row per registry policy — the honest catalog, planned entries included
 * with their milestone. */
export function policyCatalogRows(): Array<{
  id: string;
  catalog_ref: string;
  stage: string;
  status: string;
  milestone: string | null;
  summary: string;
  params: string;
  required_data: string;
}> {
  return REGISTRY_POLICIES.map((p) => ({
    id: p.id,
    catalog_ref: p.catalog_ref,
    stage: p.stage,
    status: p.status,
    milestone: p.milestone ?? null,
    summary: p.summary,
    params: Object.entries(p.params_schema?.properties ?? {})
      .map(([name, prop]) => {
        const parts: string[] = [prop.type ?? "any"];
        if (Array.isArray(prop.enum)) parts.push(`∈ {${prop.enum.join(", ")}}`);
        if (prop.minimum != null || prop.maximum != null) {
          parts.push(`[${prop.minimum ?? "-∞"}..${prop.maximum ?? "∞"}]`);
        }
        return `${name}: ${parts.join(" ")}`;
      })
      .join("; "),
    required_data: (p.data_requirements ?? [])
      .map((r) => `${r.field} (${r.level})`)
      .join("; "),
  }));
}

/** The registry catalog slice for the families a diff/intent touches — the
 * §5.2 grounding-context block (schemas + ranges + allowed values). */
export function catalogSlice(families: PolicyFamily[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const family of families) {
    const fields: Record<string, unknown> = {};
    for (const [field, spec] of Object.entries(FAMILY_FIELDS[family] ?? {})) {
      if (!spec.editable) continue;
      fields[field] = {
        kind: spec.kind,
        ...(spec.enum ? { allowed: spec.enum } : {}),
        ...(spec.min != null ? { min: spec.min } : {}),
        ...(spec.max != null ? { max: spec.max } : {}),
      };
    }
    out[family] = fields;
  }
  return out;
}
