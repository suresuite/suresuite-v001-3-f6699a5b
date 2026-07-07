// The ONE data-completeness grader — Phase A / G6 / §8.1–8.2.
//
// Canonical module consumed by BOTH platform surfaces:
//   * the edge pre-dispatch gate (supabase/functions/_shared/validationGate.ts)
//   * the browser verification service (src/lib/policies/validationService.ts)
// It lives under supabase/functions/_shared/ because Supabase bundles only
// this tree; the frontend imports it by relative path. To stay isomorphic it
// is DEPENDENCY-FREE pure TypeScript: no `npm:` / `Deno.*` / `@/` imports —
// registry payload and engine-bridge tables are passed in as data.
//
// Severity law (mirrors the engine, scsim/scsim/io/project_map.py — the
// validation-parity fixtures pin this):
//   engine hard failure (unsourced BOM material)          → block
//   `required` field that nothing resolves                → block
//   fallback to a NEUTRAL CONSTANT (price→1.0, lt→2w)     → warn (ack-able)
//   fallback DERIVED FROM DATA (cheapest inbound, …)      → info
//   `defaulted` manifest level                            → info
//
// Fallback chains are NOT hand-coded here: they come from the registry's
// machine-readable `fallback_spec` (base.py::FallbackStep), resolved against
// the named-reducer library below. Adding a fallback to the engine therefore
// updates every grader through the generated snapshot.

// ── Types ────────────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

/** Raw project tables — the exact shapes loadGateDataset / the hooks fetch. */
export interface GradingDataset {
  materials: Row[];
  products: Row[];
  suppliers: Row[];
  inbound: Row[];
  outbound: Row[];
  /** bom_single_level rows — powers the unsourced-BOM hard block. */
  bom: Row[];
}

export interface FallbackStep {
  grade: "info" | "warn";
  reducer: string | null;
  constant: number | null;
}

export interface RegistryRequirement {
  field: string;
  level: "required" | "recommended" | "defaulted";
  reason: string;
  fallback: string | null;
  condition: string | null;
  fallback_spec?: FallbackStep[];
}

/** The slice of registry.generated.json this module reads. */
export interface RegistryPayload {
  base_data_requirements: RegistryRequirement[];
  policies: Array<{
    id: string;
    catalog_ref: string;
    data_requirements: RegistryRequirement[];
  }>;
}

/** The slice of engineBridge.json this module reads. */
export interface BridgeTables {
  recovery_response_to_policy: Record<string, string>;
}

export interface CompiledRequirement extends RegistryRequirement {
  policyRef: string; // "engine" for base requirements, else catalog ref
  policyName: string;
}

/** Per-entity resolution of one requirement. */
export interface GradedField {
  field: string;
  level: RegistryRequirement["level"];
  policyRef: string;
  policyName: string;
  reason: string;
  fallbackProse: string | null;
  /** false when the surface could not evaluate this field (no such input). */
  evaluable: boolean;
  /** Entity ids whose master value is set (> 0). */
  set: string[];
  /** Entity ids resolved by a fallback step, with that step's grade. */
  resolved: Array<{ id: string; grade: "info" | "warn"; value?: number; via: string }>;
  /** Entity ids nothing resolves — the level decides the severity. */
  missing: string[];
}

export type Severity = "block" | "warn" | "info";

/** Flat finding shared by the gate response and the UI adapters. */
export interface GradedFinding {
  severity: Severity;
  field: string;
  policy: string;
  rows: string[];
  message: string;
  reason: string;
}

// ── Unit normalization (project_map.py::_UNIT_DAYS, kept in lockstep) ───────

export const UNIT_DAYS: Record<string, number> = {
  day: 1, days: 1, d: 1, daily: 1,
  week: 7, weeks: 7, wk: 7, w: 7, weekly: 7,
  month: 30.4375, months: 30.4375, mo: 30.4375, m: 30.4375, monthly: 30.4375,
  quarter: 91.3125, quarters: 91.3125, quarterly: 91.3125,
  year: 365.25, years: 365.25, yr: 365.25, y: 365.25,
  yearly: 365.25, annual: 365.25, annually: 365.25,
};

export function unitDays(unit: string | null | undefined): number | undefined {
  if (!unit) return undefined;
  return UNIT_DAYS[String(unit).trim().toLowerCase()];
}

/** project_map.py `_rate_to_weekly`: quantity per unit-period → per week. */
export function rateToWeekly(
  value: number,
  unit: string | null | undefined,
  defaultDays = 7,
): number {
  const days = unitDays(unit) ?? defaultDays;
  return (value * 7) / days;
}

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const ENGINE_DEFAULT_PRICE = 1.0;

// ── Reducer library (the engine's exact fallback derivations) ───────────────

/**
 * Cheapest inbound unit_price per material — engine fallback for
 * materials.cost. Matches project_map.py: every arc contributes, with
 * missing/≤0 prices defaulted to 1.0 BEFORE taking the min, so a material
 * with any arc always resolves (the missing arc price itself is graded
 * separately on inbound_logistics.unit_price).
 */
export function cheapestInboundCost(inbound: Row[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const arc of inbound) {
    const mat = String(arc.material_id ?? "");
    if (!mat) continue;
    let cost = num(arc.unit_price);
    if (cost <= 0) cost = ENGINE_DEFAULT_PRICE;
    out.set(mat, Math.min(out.get(mat) ?? cost, cost));
  }
  return out;
}

/**
 * Demand-weighted average outbound unit_price per product — engine fallback
 * for products.sell_price. Rows with falsy prices are skipped (engine:
 * `if o.unit_price:`); weight = weekly volume rate, floor 1e-9.
 */
export function demandWeightedSellPrice(outbound: Row[]): Map<string, number> {
  const numer = new Map<string, number>();
  const denom = new Map<string, number>();
  for (const o of outbound) {
    const prod = String(o.product_id ?? "");
    if (!prod) continue;
    const price = num(o.unit_price);
    if (!price) continue;
    const weekly = rateToWeekly(num(o.volume), o.time_unit as string | null);
    const wgt = Math.max(weekly, 1e-9);
    numer.set(prod, (numer.get(prod) ?? 0) + price * wgt);
    denom.set(prod, (denom.get(prod) ?? 0) + wgt);
  }
  const out = new Map<string, number>();
  for (const [prod, n] of numer) {
    const d = denom.get(prod) ?? 0;
    if (d > 0) out.set(prod, n / d);
  }
  return out;
}

/** Σ weekly outbound volume per product — engine fallback for demand_mean. */
export function weeklyDemand(outbound: Row[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of outbound) {
    const prod = String(o.product_id ?? "");
    if (!prod) continue;
    const weekly = rateToWeekly(num(o.volume), o.time_unit as string | null);
    out.set(prod, (out.get(prod) ?? 0) + weekly);
  }
  return out;
}

interface ReducerCtx {
  cheapestInbound: Map<string, number>;
  weightedPrice: Map<string, number>;
  weeklyDemand: Map<string, number>;
  /** master demand_mean (>0) else weekly outbound — feeds the capacity default. */
  effectiveDemand: Map<string, number>;
  /** production policy capacity_units_per_day × 7 × utilization, 0 when unset. */
  policyCapacity: number;
}

/** Named reducers — the shared vocabulary of registry `fallback_spec`. */
const REDUCERS: Record<string, (id: string, ctx: ReducerCtx) => number | undefined> = {
  cheapest_inbound_price: (id, c) => c.cheapestInbound.get(id),
  demand_weighted_outbound_price: (id, c) => c.weightedPrice.get(id),
  weekly_outbound_volume: (id, c) => {
    const v = c.weeklyDemand.get(id) ?? 0;
    return v > 0 ? v : undefined;
  },
  production_policy_capacity: (_id, c) =>
    c.policyCapacity > 0 ? c.policyCapacity : undefined,
  // Engine default when no capacity source exists: max(2·demand, 1000) —
  // always resolves (that is why its registry step carries grade "warn").
  twice_demand_floor_1000: (id, c) =>
    Math.max((c.effectiveDemand.get(id) ?? 0) * 2, 1000),
};

// ── Policy activation (mirror of project_map.py::_map_policies keys) ────────

const ALWAYS_ACTIVE = [
  "inventory_control",
  "safety_stock_materials",
  "unmet_demand_handling",
];
const BACKUP_STRATEGIES = new Set(["primary_backup", "dual_sourcing", "multi"]);

export function activeEnginePolicies(
  defaults: Row,
  nCustomers: number,
  bridge: BridgeTables,
): string[] {
  const active = new Set<string>(ALWAYS_ACTIVE);
  const sourcing = (defaults.sourcing ?? {}) as Row;
  const fulfil = (defaults.fulfillment ?? {}) as Row;
  const recovery = (defaults.recovery ?? {}) as Row;

  const responses = Array.isArray(recovery.response)
    ? (recovery.response as string[])
    : [];
  for (const r of responses) {
    const pid = bridge.recovery_response_to_policy[r];
    if (pid) active.add(pid);
  }
  if (BACKUP_STRATEGIES.has(String(sourcing.strategy ?? "single"))) {
    active.add("backup_supplier");
  }
  if (String(fulfil.allocation ?? "") && nCustomers >= 2) {
    active.add("customer_allocation");
  }
  return [...active];
}

// ── Manifest compilation ─────────────────────────────────────────────────────

export function compileManifest(
  registry: RegistryPayload,
  defaults: Row,
  nCustomers: number,
  bridge: BridgeTables,
): CompiledRequirement[] {
  const out: CompiledRequirement[] = (registry.base_data_requirements ?? []).map(
    (r) => ({ ...r, policyRef: "engine", policyName: "engine mechanics" }),
  );
  const byId = new Map(registry.policies.map((p) => [p.id, p]));
  for (const pid of activeEnginePolicies(defaults, nCustomers, bridge)) {
    const pol = byId.get(pid);
    for (const r of pol?.data_requirements ?? []) {
      out.push({ ...r, policyRef: pol?.catalog_ref ?? pid, policyName: pid });
    }
  }
  return out;
}

// ── Grading ──────────────────────────────────────────────────────────────────

interface FieldBinding {
  rows: (ds: GradingDataset) => Row[];
  id: (r: Row) => string;
  master: (r: Row) => number;
}

const arcId = (r: Row) => `${r.supplier_id ?? "?"}→${r.material_id ?? "?"}`;
const laneId = (r: Row) => `${r.product_id ?? "?"}→${r.customer_id ?? "?"}`;

/** Which table/column each manifest field grades — data plumbing only; the
 * fallback semantics live in the registry `fallback_spec`. */
const FIELD_BINDINGS: Record<string, FieldBinding> = {
  "materials.cost": { rows: (d) => d.materials, id: (r) => String(r.material_id ?? ""), master: (r) => num(r.cost) },
  "materials.moq": { rows: (d) => d.materials, id: (r) => String(r.material_id ?? ""), master: (r) => num(r.moq) },
  "materials.holding_cost_pct": { rows: (d) => d.materials, id: (r) => String(r.material_id ?? ""), master: (r) => num(r.holding_cost_pct) },
  "products.sell_price": { rows: (d) => d.products, id: (r) => String(r.product_id ?? ""), master: (r) => num(r.sell_price) },
  "products.demand_mean": { rows: (d) => d.products, id: (r) => String(r.product_id ?? ""), master: (r) => num(r.demand_mean) },
  "products.production_capacity": { rows: (d) => d.products, id: (r) => String(r.product_id ?? ""), master: (r) => num(r.production_capacity) },
  "products.demand_cv": { rows: (d) => d.products, id: (r) => String(r.product_id ?? ""), master: (r) => num(r.demand_cv) },
  "suppliers.capacity_per_week": { rows: (d) => d.suppliers, id: (r) => String(r.supplier_id ?? ""), master: (r) => num(r.capacity_per_week) },
  "suppliers.reliability_score": { rows: (d) => d.suppliers, id: (r) => String(r.supplier_id ?? ""), master: (r) => num(r.reliability_score) },
  "inbound_logistics.unit_price": { rows: (d) => d.inbound, id: arcId, master: (r) => num(r.unit_price) },
  "inbound_logistics.lead_time": { rows: (d) => d.inbound, id: arcId, master: (r) => num(r.lead_time) },
  "inbound_logistics.volume": { rows: (d) => d.inbound, id: arcId, master: (r) => num(r.volume) },
  "outbound_logistics.volume": { rows: (d) => d.outbound, id: laneId, master: (r) => num(r.volume) },
  "outbound_logistics.unit_price": { rows: (d) => d.outbound, id: laneId, master: (r) => num(r.unit_price) },
};

function buildReducerCtx(dataset: GradingDataset, defaults: Row): ReducerCtx {
  const weekly = weeklyDemand(dataset.outbound);
  const effectiveDemand = new Map<string, number>();
  for (const p of dataset.products) {
    const id = String(p.product_id ?? "");
    if (!id) continue;
    const master = num(p.demand_mean);
    effectiveDemand.set(id, master > 0 ? master : weekly.get(id) ?? 0);
  }
  const prodPolicy = (defaults.production ?? {}) as Row;
  const daily = num(prodPolicy.capacity_units_per_day);
  const util = num(prodPolicy.utilization_cap_pct ?? 85) / 100;
  return {
    cheapestInbound: cheapestInboundCost(dataset.inbound),
    weightedPrice: demandWeightedSellPrice(dataset.outbound),
    weeklyDemand: weekly,
    effectiveDemand,
    policyCapacity: daily > 0 ? daily * 7 * util : 0,
  };
}

/**
 * Grade the compiled manifest against raw project tables. Pure; identical
 * output in the browser and at the edge for identical input — the
 * validation-parity fixture is the contract test.
 */
export function gradeManifest(
  dataset: GradingDataset,
  defaults: Row,
  registry: RegistryPayload,
  bridge: BridgeTables,
): GradedField[] {
  const customers = new Set(
    dataset.outbound.map((o) => String(o.customer_id ?? "")).filter(Boolean),
  );
  const manifest = compileManifest(registry, defaults, customers.size, bridge);
  const ctx = buildReducerCtx(dataset, defaults);

  const out: GradedField[] = [];
  const seen = new Set<string>();
  for (const req of manifest) {
    // A condition names a parameterization the grader cannot resolve —
    // grade one level softer rather than over-block (same rule on every
    // surface; the engine re-checks at instantiation).
    const level =
      req.condition && req.level === "required" ? "recommended" : req.level;
    const key = `${req.field}:${level}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const binding = FIELD_BINDINGS[req.field];
    const graded: GradedField = {
      field: req.field,
      level,
      policyRef: req.policyRef,
      policyName: req.policyName,
      reason: req.reason,
      fallbackProse: req.fallback ?? null,
      evaluable: !!binding,
      set: [],
      resolved: [],
      missing: [],
    };
    if (binding) {
      const steps = req.fallback_spec ?? [];
      for (const row of binding.rows(dataset)) {
        const id = binding.id(row);
        if (!id) continue;
        if (binding.master(row) > 0) {
          graded.set.push(id);
          continue;
        }
        let resolved = false;
        for (const step of steps) {
          if (step.reducer != null) {
            const value = REDUCERS[step.reducer]?.(id, ctx);
            if (value !== undefined) {
              graded.resolved.push({ id, grade: step.grade, value, via: step.reducer });
              resolved = true;
              break;
            }
          } else if (step.constant != null) {
            graded.resolved.push({
              id, grade: step.grade, value: step.constant, via: `constant:${step.constant}`,
            });
            resolved = true;
            break;
          }
        }
        if (!resolved) graded.missing.push(id);
      }
    }
    out.push(graded);
  }

  // Engine hard failure (project_map.py raises ValueError): a BOM material
  // with no supplier link cannot be simulated at all — always a block.
  const productIds = new Set(
    dataset.products.map((p) => String(p.product_id ?? "")).filter(Boolean),
  );
  const arcMaterials = new Set(
    dataset.inbound.map((a) => String(a.material_id ?? "")).filter(Boolean),
  );
  const unsourced = [
    ...new Set(
      dataset.bom
        .filter((b) => productIds.has(String(b.product_id ?? "")))
        .map((b) => String(b.material_id ?? ""))
        .filter((m) => m && !arcMaterials.has(m)),
    ),
  ].sort();
  if (unsourced.length > 0) {
    out.push({
      field: "materials.supplier_link",
      level: "required",
      policyRef: "engine",
      policyName: "engine mechanics",
      reason:
        "A BOM material with no supplier link cannot be simulated — the engine " +
        "fails hard (no fallback exists).",
      fallbackProse: null,
      evaluable: true,
      set: [],
      resolved: [],
      missing: unsourced,
    });
  }

  return out;
}

// ── Flattening (shared finding shape for the gate + UI adapters) ────────────

const LEVEL_WHEN_MISSING: Record<string, Severity> = {
  required: "block",
  recommended: "warn",
  defaulted: "info",
};

export function flattenFindings(graded: GradedField[]): GradedFinding[] {
  const out: GradedFinding[] = [];
  for (const g of graded) {
    if (!g.evaluable) continue;
    const demandedBy = g.policyRef === "engine" ? "the engine" : g.policyRef;

    if (g.missing.length > 0) {
      out.push({
        severity: LEVEL_WHEN_MISSING[g.level] ?? "info",
        field: g.field,
        policy: g.policyRef,
        rows: g.missing.slice(0, 25),
        message:
          `${g.field} is missing for ${g.missing.length} row(s) ` +
          `(required by ${demandedBy}): ${g.reason}` +
          (g.fallbackProse ? ` Fallback: ${g.fallbackProse}.` : ""),
        reason: g.reason,
      });
    }

    // Neutral-constant fallbacks are the engine's WARN class — surfaced as
    // one acknowledgeable finding per field.
    const warns = g.resolved.filter((r) => r.grade === "warn");
    if (warns.length > 0) {
      out.push({
        severity: "warn",
        field: g.field,
        policy: g.policyRef,
        rows: warns.slice(0, 25).map((r) => r.id),
        message:
          `${g.field} is unset for ${warns.length} row(s) — the engine will ` +
          `apply its neutral default (${warns[0].via.startsWith("constant:")
            ? warns[0].via.slice("constant:".length)
            : warns[0].via}). ${g.reason}`,
        reason: g.reason,
      });
    }

    const infos = g.resolved.filter((r) => r.grade === "info");
    if (infos.length > 0) {
      out.push({
        severity: "info",
        field: g.field,
        policy: g.policyRef,
        rows: infos.slice(0, 25).map((r) => r.id),
        message:
          `${g.field} is derived for ${infos.length} row(s) via ` +
          `${g.fallbackProse ?? infos[0].via} — set the master value only to override.`,
        reason: g.reason,
      });
    }
  }
  // Blocks first, then warns, then infos — stable for UI + gate truncation.
  const rank: Record<Severity, number> = { block: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
