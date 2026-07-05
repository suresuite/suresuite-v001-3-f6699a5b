// Unified validation service — Phase A / G6 / §8.1–8.2.
//
// Compiles the required-data manifest: the union of the engine's base data
// requirements (always-on mechanics) and the data_requirements of every
// policy the current family configuration activates, all read from the
// generated registry snapshot (single source of truth — nothing here is
// hand-written per policy). Each requirement is graded against the project
// dataset with the engine's real fallback chains:
//
//   level=required     unresolvable → block · fallback resolves it → info
//   level=recommended  unresolvable → warn  · fallback resolves it → info
//   level=defaulted    unresolvable → info (aggregated, low-noise)
//
// The same registry payload drives the server-side pre-dispatch gate in
// supabase/functions/sim-command (which reads the mirrored snapshot in
// supabase/functions/_shared/), so the /policies verification stage, the
// project-manager completeness view, and the run gate cannot disagree.

import bridge from "./engineBridge.json";
import {
  baseDataRequirements,
  policyCatalog,
  policyDataRequirements,
  policyById,
  type RegistryDataRequirement,
} from "./registryAccess";
import type { PolicyBundle } from "./schemas";
import type { StageKey } from "./stages";
import type { StageRow } from "@/hooks/useStageRows";
import type {
  DerivedEconomics,
  MaterialRow,
  ProductRow,
  SupplierRow,
} from "@/hooks/useItemMasters";

export type Severity = "block" | "warn" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  stage: StageKey;
  rowKey?: string;
  field?: string;
  message: string;
  hint?: string;
  /** Catalog ref of the policy demanding the datum ("engine" for base reqs). */
  policy?: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Which engine policies does the family configuration activate? ───────────
// Mirrors scsim/scsim/io/project_map.py::_map_policies (activation only —
// the parameter translation stays in the mapper / engineBridge). The three
// always-on policies are unconditional there; the rest key off sourcing
// strategy, recovery responses, and the fulfillment allocation rule.

const ALWAYS_ACTIVE = ["inventory_control", "safety_stock_materials", "unmet_demand_handling"];
const BACKUP_STRATEGIES = new Set(["primary_backup", "dual_sourcing", "multi"]);

export function activeEnginePolicies(defaults: PolicyBundle, nCustomers: number): string[] {
  const active = new Set<string>(ALWAYS_ACTIVE);
  const sourcing = (defaults.sourcing ?? {}) as Record<string, unknown>;
  const fulfil = (defaults.fulfillment ?? {}) as Record<string, unknown>;
  const recovery = (defaults.recovery ?? {}) as Record<string, unknown>;

  const responses = Array.isArray(recovery.response) ? (recovery.response as string[]) : [];
  const responseMap = bridge.recovery_response_to_policy as Record<string, string>;
  for (const r of responses) {
    const pid = responseMap[r];
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

// ── Field evaluation ─────────────────────────────────────────────────────────

export interface ManifestInput {
  defaults: PolicyBundle;
  materials?: MaterialRow[];
  products?: ProductRow[];
  suppliers?: SupplierRow[];
  /** Engine-fallback economics (effectiveEconomics.ts, exact mapper mirror). */
  derived?: DerivedEconomics;
  supplierRows?: StageRow[];
  customerRows?: StageRow[];
}

interface FieldStatus {
  /** Per-entity ids whose master value is set. */
  set: string[];
  /** Per-entity ids resolved only through the engine's fallback chain. */
  viaFallback: Array<{ id: string; value?: number }>;
  /** Per-entity ids with no source at all — the terminal default applies. */
  missing: string[];
  /** false when the input needed to grade this field was not supplied. */
  evaluable: boolean;
}

const STAGE_BY_DATASET: Record<string, StageKey> = {
  materials: "supplier",
  suppliers: "supplier",
  inbound_logistics: "supplier",
  products: "plant",
  outbound_logistics: "customer",
};

function evalField(field: string, input: ManifestInput): FieldStatus {
  const { materials, products, suppliers, derived, defaults } = input;
  const none: FieldStatus = { set: [], viaFallback: [], missing: [], evaluable: false };

  const grade = <T>(
    rows: T[] | undefined,
    id: (r: T) => string,
    master: (r: T) => number,
    fallback?: (rid: string) => number | undefined,
  ): FieldStatus => {
    if (!rows) return none;
    const st: FieldStatus = { set: [], viaFallback: [], missing: [], evaluable: true };
    for (const r of rows) {
      const rid = id(r);
      if (master(r) > 0) st.set.push(rid);
      else {
        const fb = fallback?.(rid) ?? 0;
        if (fb > 0) st.viaFallback.push({ id: rid, value: fb });
        else st.missing.push(rid);
      }
    }
    return st;
  };

  switch (field) {
    case "materials.cost":
      return grade(materials, (m) => m.material_id, (m) => num(m.cost),
        (rid) => derived?.materialCost.get(rid));
    case "materials.moq":
      return grade(materials, (m) => m.material_id, (m) => num(m.moq));
    case "materials.holding_cost_pct":
      return grade(materials, (m) => m.material_id, (m) => num(m.holding_cost_pct));
    case "products.sell_price":
      return grade(products, (p) => p.product_id, (p) => num(p.sell_price),
        (rid) => derived?.sellPrice.get(rid));
    case "products.demand_mean":
      return grade(products, (p) => p.product_id, (p) => num(p.demand_mean),
        (rid) => derived?.demandMean.get(rid));
    case "products.production_capacity": {
      // Fallback: production policy capacity_units_per_day × 7 × utilization
      // (project_map.py) — a project-level policy value covers every product.
      const prod = (defaults.production ?? {}) as Record<string, unknown>;
      const daily = num(prod.capacity_units_per_day);
      const util = num(prod.utilization_cap_pct ?? 85) / 100;
      const policyCap = daily > 0 ? daily * 7 * util : 0;
      return grade(products, (p) => p.product_id, (p) => num(p.production_capacity),
        () => (policyCap > 0 ? policyCap : undefined));
    }
    case "products.demand_cv":
      return grade(products, (p) => p.product_id, (p) => num(p.demand_cv));
    case "suppliers.capacity_per_week":
      return grade(suppliers, (s) => s.supplier_id, (s) => num(s.capacity_per_week));
    case "suppliers.reliability_score":
      return grade(suppliers, (s) => s.supplier_id, (s) => num(s.reliability_score));
    case "inbound_logistics.unit_price":
      return gradeArcs(input.supplierRows, "material_price",
        (r) => `${r.supplier_id ?? "?"}→${r.material_id ?? "?"}`);
    case "inbound_logistics.lead_time":
      return gradeArcs(input.supplierRows, "lead_time",
        (r) => `${r.supplier_id ?? "?"}→${r.material_id ?? "?"}`);
    case "inbound_logistics.volume":
      return gradeArcs(input.supplierRows, "volume",
        (r) => `${r.supplier_id ?? "?"}→${r.material_id ?? "?"}`);
    case "outbound_logistics.volume":
      return gradeArcs(input.customerRows, "mean_per_day",
        (r) => `${r.product_id ?? "?"}→${r.customer_id ?? "?"}`);
    case "outbound_logistics.unit_price":
      return gradeArcs(input.customerRows, "price",
        (r) => `${r.product_id ?? "?"}→${r.customer_id ?? "?"}`);
    default:
      return none;
  }
}

// Arc-level fields live on the stage rows. A column absent from every row
// means this surface cannot grade it (the sim-command gate reads the table
// directly and still can) — skip rather than emit false findings.
function gradeArcs(
  rows: StageRow[] | undefined,
  column: string,
  label: (r: Record<string, unknown>) => string,
): FieldStatus {
  if (!rows || rows.length === 0) return { set: [], viaFallback: [], missing: [], evaluable: false };
  const present = rows.some((r) => column in (r as Record<string, unknown>));
  if (!present) return { set: [], viaFallback: [], missing: [], evaluable: false };
  const st: FieldStatus = { set: [], viaFallback: [], missing: [], evaluable: true };
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    if (num(rec[column]) > 0) st.set.push(label(rec));
    else st.missing.push(label(rec));
  }
  return st;
}

// ── Manifest compilation ─────────────────────────────────────────────────────

interface CompiledRequirement extends RegistryDataRequirement {
  policyRef: string; // "engine" for base requirements
  policyName: string;
}

/** The manifest itself: every entity field the selected configuration reads. */
export function compileManifest(defaults: PolicyBundle, nCustomers: number): CompiledRequirement[] {
  const out: CompiledRequirement[] = baseDataRequirements().map((r) => ({
    ...r,
    policyRef: "engine",
    policyName: "engine mechanics",
  }));
  for (const pid of activeEnginePolicies(defaults, nCustomers)) {
    const pol = policyById(pid);
    for (const r of policyDataRequirements(pid)) {
      out.push({ ...r, policyRef: pol?.catalog_ref ?? pid, policyName: pid });
    }
  }
  return out;
}

/**
 * Static view of the manifest for the Data map grid: every requirement any
 * catalog policy (or the engine) declares on a `dataset.column`, regardless
 * of the current policy selection. Conditional demands carry their condition.
 */
export interface FieldDemand {
  policyRef: string; // "engine" or a catalog ref like "P-P.5"
  policyName: string;
  level: RegistryDataRequirement["level"];
  condition: string | null;
}

export function requirementsByField(): Map<string, FieldDemand[]> {
  const out = new Map<string, FieldDemand[]>();
  const push = (field: string, d: FieldDemand) => {
    const list = out.get(field) ?? [];
    list.push(d);
    out.set(field, list);
  };
  for (const r of baseDataRequirements()) {
    push(r.field, { policyRef: "engine", policyName: "engine mechanics", level: r.level, condition: r.condition });
  }
  for (const p of policyCatalog()) {
    for (const r of p.data_requirements ?? []) {
      push(r.field, { policyRef: p.catalog_ref, policyName: p.id, level: r.level, condition: r.condition });
    }
  }
  return out;
}

const LEVEL_WHEN_MISSING: Record<string, Severity> = {
  required: "block",
  recommended: "warn",
  defaulted: "info",
};

/**
 * Grade the compiled manifest against the project dataset. One findings list
 * for all three §8.2 surfaces: the /policies verification stage, the
 * project-manager completeness view, and (mirrored server-side) sim-command.
 */
export function compileRequiredDataFindings(input: ManifestInput): Finding[] {
  const customers = new Set(
    (input.customerRows ?? []).map((r) => String((r as Record<string, unknown>).customer_id ?? "")),
  );
  customers.delete("");
  const manifest = compileManifest(input.defaults, customers.size);

  const out: Finding[] = [];
  const seen = new Set<string>(); // field+level dedupe across requiring policies
  for (const req of manifest) {
    // A condition names a parameterization this surface cannot resolve
    // client-side; grade one level softer instead of over-blocking.
    const level = req.condition && req.level === "required" ? "recommended" : req.level;
    const dedupeKey = `${req.field}:${level}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const st = evalField(req.field, input);
    if (!st.evaluable) continue;
    const dataset = req.field.split(".")[0];
    const stage = STAGE_BY_DATASET[dataset] ?? "run_validate";
    const demandedBy = req.policyRef === "engine"
      ? "the engine"
      : `${req.policyName} (${req.policyRef})`;

    if (st.missing.length > 0) {
      const severity = LEVEL_WHEN_MISSING[level] ?? "info";
      if (severity === "info") {
        // defaulted level: one aggregated note, not a row per entity
        out.push({
          id: `req-${req.field}`,
          severity,
          stage,
          field: req.field,
          policy: req.policyRef,
          message: `${req.field} is empty for ${st.missing.length} row(s) — the engine default applies (${req.fallback ?? "engine default"}).`,
          hint: req.reason,
        });
      } else {
        for (const id of st.missing.slice(0, 25)) {
          out.push({
            id: `req-${req.field}-${id}`,
            severity,
            stage,
            rowKey: id,
            field: req.field,
            policy: req.policyRef,
            message: `"${id}" has no ${req.field} — required by ${demandedBy}.`,
            hint: req.reason,
          });
        }
        if (st.missing.length > 25) {
          out.push({
            id: `req-${req.field}-more`,
            severity,
            stage,
            field: req.field,
            policy: req.policyRef,
            message: `…and ${st.missing.length - 25} more row(s) missing ${req.field}.`,
          });
        }
      }
    }
    // Fallback-resolved entities: provenance note so "not missing, derived"
    // is visible (the §8.3 effective-economics contract).
    for (const fb of st.viaFallback.slice(0, 25)) {
      out.push({
        id: `req-fb-${req.field}-${fb.id}`,
        severity: "info",
        stage,
        rowKey: fb.id,
        field: req.field,
        policy: req.policyRef,
        message: `"${fb.id}" has no master ${req.field} — the engine resolves it via ${req.fallback ?? "its fallback chain"}${fb.value !== undefined ? ` (≈${round2(fb.value)})` : ""}.`,
        hint: "Set the master value only to override the derived one.",
      });
    }
  }
  return out;
}
