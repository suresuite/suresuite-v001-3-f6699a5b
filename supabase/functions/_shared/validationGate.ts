// Pre-dispatch validation gate — Phase A / G6 / §8.1–8.2.
//
// Server-side mirror of src/lib/policies/validationService.ts: compiles the
// required-data manifest from the SAME generated registry snapshot (kept in
// sync by scsim/scripts/gen_frontend_registry.py, CI-gated) and grades it
// against the live project tables before a run command is queued.
//
//   required     unresolvable → run rejected (block)
//   recommended  unresolvable → rejected unless payload.acknowledge_warnings
//   defaulted    informational only — never gates
//
// The engine's MappingWarning stream remains the final tripwire; a project
// that passes this gate maps with no warn-level fallbacks (gate E1, §3).

import registry from "./registry.generated.json" with { type: "json" };

export interface GateFinding {
  severity: "block" | "warn" | "info";
  field: string;
  policy: string;
  rows: string[];
  message: string;
}

export interface GateResult {
  status: "blocked" | "ack_required";
  findings: GateFinding[];
}

interface DataRequirement {
  field: string;
  level: "required" | "recommended" | "defaulted";
  reason: string;
  fallback: string | null;
  condition: string | null;
}

interface RegistryPayload {
  policies: Array<{ id: string; catalog_ref: string; data_requirements: DataRequirement[] }>;
  base_data_requirements: DataRequirement[];
}

const REG = registry as unknown as RegistryPayload;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// project_map.py::_UNIT_DAYS — volume-period normalization (rate → weekly).
const UNIT_DAYS: Record<string, number> = {
  day: 1, days: 1, d: 1, daily: 1,
  week: 7, weeks: 7, wk: 7, w: 7, weekly: 7,
  month: 30.4375, months: 30.4375, mo: 30.4375, m: 30.4375, monthly: 30.4375,
  quarter: 91.3125, quarters: 91.3125, quarterly: 91.3125,
  year: 365.25, years: 365.25, yr: 365.25, y: 365.25,
  yearly: 365.25, annual: 365.25, annually: 365.25,
};
const rateToWeekly = (value: number, unit: unknown): number => {
  const days = UNIT_DAYS[String(unit ?? "").trim().toLowerCase()] ?? 7;
  return (value * 7) / days;
};

// ── Activation mirror of project_map.py::_map_policies ──────────────────────

const ALWAYS_ACTIVE = ["inventory_control", "safety_stock_materials", "unmet_demand_handling"];
const BACKUP_STRATEGIES = new Set(["primary_backup", "dual_sourcing", "multi"]);
const RESPONSE_TO_POLICY: Record<string, string> = {
  reroute: "expedited_shipments",
  mode_shift: "expedited_shipments",
  expedite_freight: "expedited_shipments",
  dual_source_activate: "backup_supplier",
  capacity_flex: "short_term_capacity",
};

function activeEnginePolicies(defaults: Record<string, unknown>, nCustomers: number): string[] {
  const active = new Set<string>(ALWAYS_ACTIVE);
  const sourcing = (defaults.sourcing ?? {}) as Record<string, unknown>;
  const fulfil = (defaults.fulfillment ?? {}) as Record<string, unknown>;
  const recovery = (defaults.recovery ?? {}) as Record<string, unknown>;
  const responses = Array.isArray(recovery.response) ? (recovery.response as string[]) : [];
  for (const r of responses) {
    const pid = RESPONSE_TO_POLICY[r];
    if (pid) active.add(pid);
  }
  if (BACKUP_STRATEGIES.has(String(sourcing.strategy ?? "single"))) active.add("backup_supplier");
  if (String(fulfil.allocation ?? "") && nCustomers >= 2) active.add("customer_allocation");
  return [...active];
}

// ── Dataset shape the gate reads ─────────────────────────────────────────────

export interface GateDataset {
  materials: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  suppliers: Array<Record<string, unknown>>;
  inbound: Array<Record<string, unknown>>;
  outbound: Array<Record<string, unknown>>;
}

// deno-lint-ignore no-explicit-any
export async function loadGateDataset(sb: any, projectId: string): Promise<GateDataset> {
  const [materials, products, suppliers, inbound, outbound] = await Promise.all([
    sb.from("materials").select("material_id,cost,moq,holding_cost_pct").eq("project_id", projectId),
    sb.from("products").select("product_id,sell_price,demand_mean,production_capacity,demand_cv").eq("project_id", projectId),
    sb.from("suppliers").select("supplier_id,capacity_per_week,reliability_score").eq("project_id", projectId),
    sb.from("inbound_logistics").select("supplier_id,material_id,unit_price,lead_time,volume,time_unit").eq("project_id", projectId),
    sb.from("outbound_logistics").select("product_id,customer_id,unit_price,volume,time_unit").eq("project_id", projectId),
  ]);
  return {
    materials: materials.data ?? [],
    products: products.data ?? [],
    suppliers: suppliers.data ?? [],
    inbound: inbound.data ?? [],
    outbound: outbound.data ?? [],
  };
}

// ── Field grading (mirrors validationService.ts / project_map.py chains) ────

interface FieldStatus {
  missing: string[];
  evaluable: boolean;
}

function evalField(
  field: string,
  ds: GateDataset,
  defaults: Record<string, unknown>,
): FieldStatus {
  // Fallback economics — the exact project_map.py reducers.
  const cheapestInbound = new Map<string, number>();
  for (const a of ds.inbound) {
    const mat = String(a.material_id ?? "");
    const p = num(a.unit_price);
    if (mat && p > 0) cheapestInbound.set(mat, Math.min(cheapestInbound.get(mat) ?? p, p));
  }
  const sellNum = new Map<string, number>();
  const sellDen = new Map<string, number>();
  const weeklyDemand = new Map<string, number>();
  for (const o of ds.outbound) {
    const prod = String(o.product_id ?? "");
    if (!prod) continue;
    const weekly = rateToWeekly(num(o.volume), o.time_unit);
    weeklyDemand.set(prod, (weeklyDemand.get(prod) ?? 0) + weekly);
    const price = num(o.unit_price);
    if (price > 0) {
      const wgt = Math.max(weekly, 1e-9);
      sellNum.set(prod, (sellNum.get(prod) ?? 0) + price * wgt);
      sellDen.set(prod, (sellDen.get(prod) ?? 0) + wgt);
    }
  }
  const prodPolicy = (defaults.production ?? {}) as Record<string, unknown>;
  const policyCap = num(prodPolicy.capacity_units_per_day) > 0
    ? num(prodPolicy.capacity_units_per_day) * 7 * (num(prodPolicy.utilization_cap_pct ?? 85) / 100)
    : 0;

  const grade = (
    rows: Array<Record<string, unknown>>,
    idCol: string,
    valueCol: string,
    fallback?: (id: string) => number,
  ): FieldStatus => {
    const missing: string[] = [];
    for (const r of rows) {
      const id = String(r[idCol] ?? "");
      if (num(r[valueCol]) > 0) continue;
      if ((fallback?.(id) ?? 0) > 0) continue;
      missing.push(id);
    }
    return { missing, evaluable: true };
  };

  switch (field) {
    case "materials.cost":
      return grade(ds.materials, "material_id", "cost", (id) => cheapestInbound.get(id) ?? 0);
    case "materials.moq":
      return grade(ds.materials, "material_id", "moq");
    case "materials.holding_cost_pct":
      return grade(ds.materials, "material_id", "holding_cost_pct");
    case "products.sell_price":
      return grade(ds.products, "product_id", "sell_price",
        (id) => (sellDen.get(id) ?? 0) > 0 ? (sellNum.get(id) ?? 0) / (sellDen.get(id) ?? 1) : 0);
    case "products.demand_mean":
      return grade(ds.products, "product_id", "demand_mean", (id) => weeklyDemand.get(id) ?? 0);
    case "products.production_capacity":
      return grade(ds.products, "product_id", "production_capacity", () => policyCap);
    case "products.demand_cv":
      return grade(ds.products, "product_id", "demand_cv");
    case "suppliers.capacity_per_week":
      return grade(ds.suppliers, "supplier_id", "capacity_per_week");
    case "suppliers.reliability_score":
      return grade(ds.suppliers, "supplier_id", "reliability_score");
    case "inbound_logistics.unit_price":
      return grade(ds.inbound, "material_id", "unit_price");
    case "inbound_logistics.lead_time":
      return grade(ds.inbound, "material_id", "lead_time");
    case "inbound_logistics.volume":
      return grade(ds.inbound, "material_id", "volume");
    case "outbound_logistics.volume":
      return grade(ds.outbound, "product_id", "volume");
    case "outbound_logistics.unit_price":
      return grade(ds.outbound, "product_id", "unit_price");
    default:
      return { missing: [], evaluable: false };
  }
}

// ── The gate ─────────────────────────────────────────────────────────────────

export function runValidationGate(args: {
  dataset: GateDataset;
  snapshotDefaults: Record<string, unknown>;
  disruptionSchedule: Array<Record<string, unknown>>;
  acknowledgeWarnings: boolean;
}): GateResult | null {
  const { dataset, snapshotDefaults, disruptionSchedule, acknowledgeWarnings } = args;

  const customers = new Set(
    dataset.outbound.map((o) => String(o.customer_id ?? "")).filter(Boolean),
  );

  // Manifest = base requirements + the activated policies' requirements.
  const manifest: Array<DataRequirement & { policy: string }> =
    (REG.base_data_requirements ?? []).map((r) => ({ ...r, policy: "engine" }));
  const byId = new Map(REG.policies.map((p) => [p.id, p]));
  for (const pid of activeEnginePolicies(snapshotDefaults, customers.size)) {
    const pol = byId.get(pid);
    for (const r of pol?.data_requirements ?? []) {
      manifest.push({ ...r, policy: pol?.catalog_ref ?? pid });
    }
  }

  const findings: GateFinding[] = [];
  const seen = new Set<string>();
  for (const req of manifest) {
    // Conditions name parameterizations this gate cannot resolve — grade one
    // level softer rather than over-block (same rule as the client service).
    const level = req.condition && req.level === "required" ? "recommended" : req.level;
    if (level === "defaulted") continue; // informational — never gates
    const key = `${req.field}:${level}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const st = evalField(req.field, dataset, snapshotDefaults);
    if (!st.evaluable || st.missing.length === 0) continue;
    findings.push({
      severity: level === "required" ? "block" : "warn",
      field: req.field,
      policy: req.policy,
      rows: st.missing.slice(0, 25),
      message:
        `${req.field} is missing for ${st.missing.length} row(s) ` +
        `(required by ${req.policy === "engine" ? "the engine" : req.policy}): ${req.reason}` +
        (req.fallback ? ` Fallback: ${req.fallback}.` : ""),
    });
  }

  // Scenario-conditional: a partial-magnitude supplier disruption needs a
  // finite supplier capacity to throttle — else the mapper degrades it to a
  // full outage (project_map.py::_map_events).
  const capBySupplier = new Map(
    dataset.suppliers.map((s) => [String(s.supplier_id ?? ""), num(s.capacity_per_week)]),
  );
  for (const ev of disruptionSchedule ?? []) {
    const magnitude = num(ev.magnitude_pct ?? ev.magnitude ?? 100);
    if (magnitude >= 100) continue;
    const raw = String(ev.target ?? ev.target_id ?? "");
    const target = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
    if (!capBySupplier.has(target)) continue; // plant/unknown targets: not this check
    if ((capBySupplier.get(target) ?? 0) <= 0) {
      findings.push({
        severity: "warn",
        field: "suppliers.capacity_per_week",
        policy: "engine",
        rows: [target],
        message:
          `Scenario cuts supplier "${target}" to ${magnitude}% capacity, but the supplier ` +
          `has no capacity_per_week — the engine will degrade this to a full outage.`,
      });
    }
  }

  const blocks = findings.filter((f) => f.severity === "block");
  const warns = findings.filter((f) => f.severity === "warn");
  if (blocks.length > 0) return { status: "blocked", findings };
  if (warns.length > 0 && !acknowledgeWarnings) return { status: "ack_required", findings };
  return null;
}
