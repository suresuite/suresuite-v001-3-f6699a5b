// B7 Cost Estimator method registry — Phase D / G12 / AI agents
// (design: docs/design/ai-agents.md §18.1 v1.5, §18.5, decision §10 Q26).
//
// The ONE estimate/recomputation module consumed by BOTH agent surfaces:
//   * the estimator tool handlers (project-ai-chat/estimatorTools.ts) —
//     draft-time verification (`not_grounded` on mismatch)
//   * the apply function (agent-apply/parameterEstimateApply.ts) —
//     apply-time re-verification (`stale_values` on mismatch)
// so a value can never reach `bulk_upsert_*` unless the named method@version
// still derives the SAME {value, low, high} from the project's own rows plus
// the checked-in benchmark seed table, within ESTIMATE_TOLERANCE.
//
// Three method families (§10 Q26, the Talluri decision):
//   (a) direct_from_project  — delegates to grading.ts::REDUCERS (never
//       duplicated); the interval is the source range of the contributing rows
//   (b) benchmark_scaled     — firm_estimate = industry_figure × (firm value
//       of shipments ÷ industry capacity), currency figures PPI-escalated
//       from the benchmark row's vintage (§18.5)
//   (c) resilience_fixed_cost — the paper's 20 %/10 % adjustment factors as
//       declared, citable seed-table rows, mapped onto the engine's C^res
//       CostBreakdown components (P-S.1 → `coordination`, P-P.5 → `capacity`).
//       Firm-level, estimate-only in Phase 4a (no apply seam).
//
// Like grading.ts (which it wraps), it is dependency-free pure TypeScript over
// injected rows: no `Deno.*`, no supabase client — the deterministic eval tier
// runs it byte-identically offline. Benchmarks are NEVER fetched at runtime:
// estimatorBenchmarks.json is code (§18.5 law 1).

import benchmarks from "./estimatorBenchmarks.json" with { type: "json" };
import {
  buildReducerCtx,
  ENGINE_DEFAULT_PRICE,
  normalizeBomRows,
  num,
  rateToWeekly,
  REDUCERS,
  type GradingDataset,
  type ReducerCtx,
  type Row,
} from "./grading.ts";
import type { ItemTable } from "./itemMasterCandidates.ts";

/** §18.1 hard gate 1: recomputation tolerance on value, low AND high. */
export const ESTIMATE_TOLERANCE = 1e-9;
/** §18.1 back-test demotion threshold (DEFAULT): observed-coverage < 0.5
 * with ≥ 1 observation demotes a prior-sourced method for that field. */
export const BACKTEST_MIN_COVERAGE = 0.5;

export type MethodFamily =
  | "direct_from_project"
  | "benchmark_scaled"
  | "resilience_fixed_cost";

/** §10 Q26: how an interval was derived — never invented. */
export type EstimateBasis =
  | "source_range" // min/max of the contributing project rows
  | "direct_sum" // complete-data sum; the only basis allowed low = high
  | "prior_range" // the benchmark row's published [low, high], scaled
  | "factor_sensitivity"; // declared adjustment-factor range propagated

/** The §10 Q26 estimate contract. */
export interface Estimate {
  value: number;
  low: number;
  high: number;
  basis: EstimateBasis;
}

export interface EstimatorSource {
  dataset: string;
  vintage: number | string;
  role: "ground" | "prior"; // §18.5; `verify` is reserved, not wired
}

export interface EstimatorInputs {
  dataset: GradingDataset;
  defaults: Row;
}

export interface EstimatorMethod {
  id: string;
  version: number;
  family: MethodFamily;
  /** Item-master target; null for firm-level (family c) estimate-only rows. */
  target: { table: ItemTable; field: string } | null;
  /** Family (c) only: the C^res CostBreakdown mapping (§18.1). */
  firmLevel?: { label: string; catalogRef: string; cresComponent: string };
  params: Record<string, number | string>;
  sources: EstimatorSource[];
  assumptions: string[];
  /** Project tables the derivation reads (table_rows citation targets). */
  groundTables: string[];
  /** Deterministic derivation; undefined when the inputs cannot ground it.
   * Firm-level methods ignore entityId (callers pass "firm"). */
  estimate(entityId: string, inputs: EstimatorInputs): Estimate | undefined;
}

export const methodRef = (m: EstimatorMethod): string => `${m.id}@${m.version}`;

// ── Seed-table access (§18.5 laws) ──────────────────────────────────────────

interface BenchmarkRow {
  id: string;
  dataset: string;
  vintage: number;
  role: string;
  license_tier: string;
  kind: "rate" | "share" | "currency" | "factor";
  value: number;
  low: number;
  high: number;
}

const BENCHMARK_ROWS: BenchmarkRow[] = benchmarks.rows as BenchmarkRow[];
export const BENCHMARK_TABLE_VERSION: number = benchmarks.table_version;
export const BENCHMARK_TARGET_VINTAGE: number = benchmarks.target_vintage;

/** PPI escalation factor from a vintage year to the table's target vintage.
 * §18.5 law 1: a missing endpoint year ⇒ undefined — never extrapolate. */
export function ppiEscalation(fromVintage: number): number | undefined {
  const values = benchmarks.ppi.values as Record<string, number>;
  const from = values[String(fromVintage)];
  const to = values[String(BENCHMARK_TARGET_VINTAGE)];
  if (!from || !to || from <= 0) return undefined;
  return to / from;
}

/** One benchmark figure with escalation applied where the kind demands it
 * (`currency` only — rates/shares/factors are dimensionless, §18.5). */
export function benchmarkFigure(
  id: string,
): (BenchmarkRow & { escalation: number }) | undefined {
  const row = BENCHMARK_ROWS.find((r) => r.id === id);
  if (!row) return undefined;
  if (row.kind !== "currency") return { ...row, escalation: 1 };
  const esc = ppiEscalation(row.vintage);
  if (esc === undefined) return undefined;
  return {
    ...row,
    value: row.value * esc,
    low: row.low * esc,
    high: row.high * esc,
    escalation: esc,
  };
}

const priorSource = (id: string): EstimatorSource => {
  const row = BENCHMARK_ROWS.find((r) => r.id === id);
  return {
    dataset: row?.dataset ?? id,
    vintage: row?.vintage ?? "unknown",
    role: "prior",
  };
};

const GROUND_LIVE: EstimatorSource = {
  dataset: "project tables (live rows)",
  vintage: "live",
  role: "ground",
};

// ── Firm-side derivations (family b/c inputs, all from project rows) ────────

/** Firm value of shipments: annualized outbound revenue —
 * Σ weekly volume × unit_price × 52 over priced lanes. */
export function annualValueOfShipments(dataset: GradingDataset): number {
  let weekly = 0;
  for (const o of dataset.outbound) {
    const price = num(o.unit_price);
    if (price <= 0) continue;
    weekly += rateToWeekly(num(o.volume), o.time_unit as string | null) * price;
  }
  return weekly * 52;
}

/** Annual consumption units per material: normalized BOM (single or flattened
 * multi-level) × effective weekly product demand × 52. Rates default to 1
 * when the grader dataset carries none (declared method assumption). */
export function annualConsumptionUnits(
  dataset: GradingDataset,
  ctx: ReducerCtx,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of normalizeBomRows(dataset.bom)) {
    const product = String(b.product_id ?? "");
    const material = String(b.material_id ?? "");
    if (!product || !material) continue;
    const rate = num(b.consumption_rate) || 1.0;
    const weekly = ctx.effectiveDemand.get(product) ?? 0;
    if (weekly <= 0) continue;
    out.set(material, (out.get(material) ?? 0) + rate * weekly * 52);
  }
  return out;
}

/** Materials with ≥ 2 distinct qualified suppliers — the backup-capable links
 * the P-S.1 coordination estimate prices. */
export function multiSourcedMaterialCount(dataset: GradingDataset): number {
  const byMat = new Map<string, Set<string>>();
  for (const a of dataset.inbound) {
    const mat = String(a.material_id ?? "");
    const sup = String(a.supplier_id ?? "");
    if (!mat || !sup) continue;
    if (!byMat.has(mat)) byMat.set(mat, new Set());
    byMat.get(mat)!.add(sup);
  }
  return [...byMat.values()].filter((s) => s.size > 1).length;
}

const ctxCache = new WeakMap<GradingDataset, ReducerCtx>();
function reducerCtx(inputs: EstimatorInputs): ReducerCtx {
  let ctx = ctxCache.get(inputs.dataset);
  if (!ctx) {
    ctx = buildReducerCtx(inputs.dataset, inputs.defaults);
    ctxCache.set(inputs.dataset, ctx);
  }
  return ctx;
}

// ── The registry ────────────────────────────────────────────────────────────

export const ESTIMATOR_METHODS: EstimatorMethod[] = [
  {
    id: "direct_cheapest_inbound",
    version: 1,
    family: "direct_from_project",
    target: { table: "materials", field: "cost" },
    params: {},
    sources: [GROUND_LIVE],
    assumptions: [
      "The cheapest currently-quoted inbound unit price is the engine's own " +
      "fallback for materials.cost (docs/data-simulation-mapping.md §8); " +
      "arc prices ≤ 0 default to 1.0 before the min, exactly as the engine does.",
    ],
    groundTables: ["inbound_logistics"],
    estimate(entityId, inputs) {
      const value = REDUCERS.cheapest_inbound_price(entityId, reducerCtx(inputs));
      if (value === undefined) return undefined;
      let low = Infinity;
      let high = -Infinity;
      for (const arc of inputs.dataset.inbound) {
        if (String(arc.material_id ?? "") !== entityId) continue;
        let price = num(arc.unit_price);
        if (price <= 0) price = ENGINE_DEFAULT_PRICE;
        low = Math.min(low, price);
        high = Math.max(high, price);
      }
      if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
      return { value, low, high, basis: "source_range" };
    },
  },
  {
    id: "direct_demand_weighted_price",
    version: 1,
    family: "direct_from_project",
    target: { table: "products", field: "sell_price" },
    params: {},
    sources: [GROUND_LIVE],
    assumptions: [
      "The demand-weighted average outbound unit price is the engine's own " +
      "fallback for products.sell_price; unpriced lanes are skipped.",
    ],
    groundTables: ["outbound_logistics"],
    estimate(entityId, inputs) {
      const value = REDUCERS.demand_weighted_outbound_price(entityId, reducerCtx(inputs));
      if (value === undefined) return undefined;
      let low = Infinity;
      let high = -Infinity;
      for (const o of inputs.dataset.outbound) {
        if (String(o.product_id ?? "") !== entityId) continue;
        const price = num(o.unit_price);
        if (!price) continue;
        low = Math.min(low, price);
        high = Math.max(high, price);
      }
      if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
      return { value, low, high, basis: "source_range" };
    },
  },
  {
    id: "direct_weekly_demand",
    version: 1,
    family: "direct_from_project",
    target: { table: "products", field: "demand_mean" },
    params: {},
    sources: [GROUND_LIVE],
    assumptions: [
      "Σ weekly outbound volume is the engine's own fallback for " +
      "products.demand_mean; a complete-data sum carries a degenerate interval " +
      "(basis direct_sum).",
    ],
    groundTables: ["outbound_logistics"],
    estimate(entityId, inputs) {
      const value = REDUCERS.weekly_outbound_volume(entityId, reducerCtx(inputs));
      if (value === undefined) return undefined;
      return { value, low: value, high: value, basis: "direct_sum" };
    },
  },
  {
    id: "benchmark_holding_rate",
    version: 1,
    family: "benchmark_scaled",
    target: { table: "materials", field: "holding_cost_pct" },
    params: { benchmark: "holding_rate_annual" },
    sources: [priorSource("holding_rate_annual")],
    assumptions: [
      "Annual holding rate applied uniformly across materials.",
      "Rates are dimensionless — value-of-shipments scaling and PPI " +
      "escalation are identity for this method (declared).",
    ],
    groundTables: [],
    estimate(entityId, inputs) {
      const fig = benchmarkFigure("holding_rate_annual");
      if (!fig) return undefined;
      const known = inputs.dataset.materials.some(
        (m) => String(m.material_id ?? "") === entityId,
      );
      if (!known) return undefined;
      return { value: fig.value, low: fig.low, high: fig.high, basis: "prior_range" };
    },
  },
  {
    id: "benchmark_scaled_material_cost",
    version: 1,
    family: "benchmark_scaled",
    target: { table: "materials", field: "cost" },
    params: { benchmark: "asm_materials_share" },
    sources: [priorSource("asm_materials_share"), GROUND_LIVE],
    assumptions: [
      "firm_estimate = industry_figure × (firm value of shipments ÷ industry " +
      "capacity): the ASM materials-cost share × the firm's annualized " +
      "outbound revenue gives the firm materials budget (Talluri et al. 2013 " +
      "scaling).",
      "Blended-rate apportionment: absent any price signal for this material, " +
      "the budget is spread uniformly per consumed unit across BOM materials " +
      "(consumption rates default to 1 per BOM link in the grader dataset).",
      "Share figures are dimensionless — PPI escalation is identity for this " +
      "method (declared).",
    ],
    groundTables: ["outbound_logistics", "bom_single_level"],
    estimate(entityId, inputs) {
      const fig = benchmarkFigure("asm_materials_share");
      if (!fig) return undefined;
      const vos = annualValueOfShipments(inputs.dataset);
      if (vos <= 0) return undefined;
      const consumption = annualConsumptionUnits(inputs.dataset, reducerCtx(inputs));
      const totalUnits = [...consumption.values()].reduce((a, b) => a + b, 0);
      if (totalUnits <= 0 || !consumption.has(entityId)) return undefined;
      const perUnit = vos / totalUnits;
      return {
        value: fig.value * perUnit,
        low: fig.low * perUnit,
        high: fig.high * perUnit,
        basis: "prior_range",
      };
    },
  },
  {
    id: "resilience_backup_coordination",
    version: 1,
    family: "resilience_fixed_cost",
    target: null,
    firmLevel: {
      label: "annual standing coordination cost of backup sourcing",
      catalogRef: "P-S.1",
      cresComponent: "coordination",
    },
    params: {
      factor: "talluri_backup_coordination_factor",
      base: "procurement_admin_cost_per_supplier",
    },
    sources: [
      priorSource("talluri_backup_coordination_factor"),
      priorSource("procurement_admin_cost_per_supplier"),
      GROUND_LIVE,
    ],
    assumptions: [
      "20 % coordination adjustment factor (Talluri et al. 2013) applied to " +
      "the per-supplier procurement-administration base for each " +
      "backup-capable (multi-sourced) material link.",
      "Maps onto C^res component `coordination` beside P-S.1 " +
      "backup_supplier's activation-driven backup_premium — a standing " +
      "annual cost the engine does not simulate.",
      "Base figure PPI-escalated from its vintage to the seed table's target " +
      "vintage.",
    ],
    groundTables: ["inbound_logistics"],
    estimate(_entityId, inputs) {
      const factor = benchmarkFigure("talluri_backup_coordination_factor");
      const base = benchmarkFigure("procurement_admin_cost_per_supplier");
      if (!factor || !base) return undefined;
      const links = multiSourcedMaterialCount(inputs.dataset);
      if (links <= 0) return undefined;
      return {
        value: factor.value * base.value * links,
        low: factor.low * base.low * links,
        high: factor.high * base.high * links,
        basis: "factor_sensitivity",
      };
    },
  },
  {
    id: "resilience_flex_capacity",
    version: 1,
    family: "resilience_fixed_cost",
    target: null,
    firmLevel: {
      label: "annual standing cost of reserve/flexible capacity",
      catalogRef: "P-P.5",
      cresComponent: "capacity",
    },
    params: {
      factor: "talluri_flex_capacity_factor",
      share: "asm_materials_share",
    },
    sources: [
      priorSource("talluri_flex_capacity_factor"),
      priorSource("asm_materials_share"),
      GROUND_LIVE,
    ],
    assumptions: [
      "10 % flexible-capacity adjustment factor (Talluri et al. 2013) applied " +
      "to the firm's conversion-cost proxy: (1 − materials share) × " +
      "annualized outbound revenue.",
      "Maps onto C^res component `capacity` beside P-P.5 short_term_capacity's " +
      "activation-driven overtime premium — a standing annual cost the engine " +
      "does not simulate.",
    ],
    groundTables: ["outbound_logistics"],
    estimate(_entityId, inputs) {
      const factor = benchmarkFigure("talluri_flex_capacity_factor");
      const share = benchmarkFigure("asm_materials_share");
      if (!factor || !share) return undefined;
      const vos = annualValueOfShipments(inputs.dataset);
      if (vos <= 0) return undefined;
      return {
        value: factor.value * (1 - share.value) * vos,
        low: factor.low * (1 - share.high) * vos,
        high: factor.high * (1 - share.low) * vos,
        basis: "factor_sensitivity",
      };
    },
  },
];

/** Resolve a `<id>@<version>` reference; version must match exactly (a bumped
 * registry makes stored rows citing the old version fail loudly — §18.1). */
export function findMethod(ref: string): EstimatorMethod | undefined {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return undefined;
  const id = ref.slice(0, at);
  const version = Number(ref.slice(at + 1));
  return ESTIMATOR_METHODS.find((m) => m.id === id && m.version === version);
}

// ── Back-test demotion (§18.1) ──────────────────────────────────────────────

export interface BackTestResult {
  n: number;
  covered: number;
  coverage: number;
  demoted: boolean;
  /** Up to 5 failing observations, for the demotion evidence. */
  outliers: Array<{ entity_id: string; actual: number }>;
}

const TABLE_ID_COL: Record<ItemTable, string> = {
  materials: "material_id",
  products: "product_id",
  suppliers: "supplier_id",
};

/** Back-test a prior-sourced method against this project's observed values
 * for its target field. Family (a) is exempt (its source IS the project's own
 * data); family (c) is firm-level (no per-entity actuals exist). */
export function backTestMethod(
  method: EstimatorMethod,
  inputs: EstimatorInputs,
): BackTestResult {
  const none: BackTestResult = { n: 0, covered: 0, coverage: 1, demoted: false, outliers: [] };
  if (method.family !== "benchmark_scaled" || !method.target) return none;
  const { table, field } = method.target;
  const idCol = TABLE_ID_COL[table];
  let n = 0;
  let covered = 0;
  const outliers: BackTestResult["outliers"] = [];
  for (const row of inputs.dataset[table] as Row[]) {
    const id = String(row[idCol] ?? "");
    if (!id) continue;
    const actual = num(row[field]);
    if (actual <= 0) continue; // not observed — that is the gap to estimate
    const est = method.estimate(id, inputs);
    if (!est) continue;
    n += 1;
    if (actual >= est.low - ESTIMATE_TOLERANCE && actual <= est.high + ESTIMATE_TOLERANCE) {
      covered += 1;
    } else if (outliers.length < 5) {
      outliers.push({ entity_id: id, actual });
    }
  }
  if (n === 0) return none;
  const coverage = covered / n;
  return { n, covered, coverage, demoted: coverage < BACKTEST_MIN_COVERAGE, outliers };
}

// ── Candidate generation + row verification (the two agent surfaces) ────────

export interface CandidateRow {
  table: ItemTable;
  entity_id: string;
  field: string;
  method: string; // "<id>@<version>"
  family: MethodFamily;
  value: number;
  low: number;
  high: number;
  basis: EstimateBasis;
  sources: EstimatorSource[];
  assumptions: string[];
  status: "ok" | "demoted";
}

/** One candidate per (missing master value × applicable method). Missing =
 * the grader's own semantic (master ≤ 0). Demoted methods still appear,
 * marked, so the agent can explain WHY a gap stays open (ce-09). */
export function estimateCandidates(inputs: EstimatorInputs): CandidateRow[] {
  const out: CandidateRow[] = [];
  for (const method of ESTIMATOR_METHODS) {
    if (!method.target) continue;
    const { table, field } = method.target;
    const idCol = TABLE_ID_COL[table];
    const status = backTestMethod(method, inputs).demoted ? "demoted" : "ok";
    for (const row of inputs.dataset[table] as Row[]) {
      const id = String(row[idCol] ?? "");
      if (!id) continue;
      if (num(row[field]) > 0) continue; // set — nothing to estimate
      const est = method.estimate(id, inputs);
      if (!est) continue;
      out.push({
        table,
        entity_id: id,
        field,
        method: methodRef(method),
        family: method.family,
        ...est,
        sources: method.sources,
        assumptions: method.assumptions,
        status,
      });
    }
  }
  return out.sort((a, b) =>
    a.field.localeCompare(b.field) ||
    a.entity_id.localeCompare(b.entity_id) ||
    a.method.localeCompare(b.method)
  );
}

/** Family (c) firm-level rows — report-only (§18.1 refusal rule). */
export function firmLevelEstimates(inputs: EstimatorInputs): CandidateRow[] {
  const out: CandidateRow[] = [];
  for (const method of ESTIMATOR_METHODS) {
    if (method.target || !method.firmLevel) continue;
    const est = method.estimate("firm", inputs);
    if (!est) continue;
    out.push({
      table: "materials", // placeholder — firm rows are never draftable
      entity_id: "firm",
      field: `${method.firmLevel.catalogRef} ${method.firmLevel.label}`,
      method: methodRef(method),
      family: method.family,
      ...est,
      sources: method.sources,
      assumptions: [
        ...method.assumptions,
        `C^res component: ${method.firmLevel.cresComponent} (${method.firmLevel.catalogRef})`,
      ],
      status: "ok",
    });
  }
  return out;
}

export interface EstimateRowInput {
  table: ItemTable;
  entity_id: string;
  field: string;
  method: string;
  value: number;
  low: number;
  high: number;
}

export interface EstimateVerification {
  ok: boolean;
  /** §4.5 draft-time code the failure maps to (`not_grounded` /
   * `invalid_params`); apply reports the same failures as `stale_values`. */
  code?: "not_grounded" | "invalid_params";
  reason?: string;
  /** The recomputed estimate + method, for server-side payload enrichment. */
  method?: EstimatorMethod;
  estimate?: Estimate;
}

/** §18.1 hard gates 1/2/5/6 for ONE row: named method exists, targets this
 * table.field, is not demoted, and re-derives {value, low, high} within
 * tolerance. Missingness-independent, so apply retries verify cleanly. */
export function verifyEstimateRow(
  row: EstimateRowInput,
  inputs: EstimatorInputs,
): EstimateVerification {
  const method = findMethod(row.method);
  if (!method) {
    return {
      ok: false,
      code: "not_grounded",
      reason: `unknown estimation method "${row.method}" — use a method@version from get_parameter_estimates`,
    };
  }
  if (!method.target) {
    return {
      ok: false,
      code: "invalid_params",
      reason:
        `${row.method} is a firm-level resilience estimate — report-only in this phase, it has no apply path`,
    };
  }
  if (method.target.table !== row.table || method.target.field !== row.field) {
    return {
      ok: false,
      code: "invalid_params",
      reason:
        `${row.method} estimates ${method.target.table}.${method.target.field}, ` +
        `not ${row.table}.${row.field}`,
    };
  }
  if (backTestMethod(method, inputs).demoted) {
    return {
      ok: false,
      code: "not_grounded",
      reason:
        `${row.method} is demoted on this project — its declared interval excludes ` +
        `the observed ${row.table}.${row.field} values (back-test coverage < ${BACKTEST_MIN_COVERAGE})`,
    };
  }
  const est = method.estimate(row.entity_id, inputs);
  if (!est) {
    return {
      ok: false,
      code: "not_grounded",
      reason: `${row.method} produces no grounded estimate for ${row.table}.${row.field} on ${row.entity_id}`,
    };
  }
  const off = (a: number, b: number) => Math.abs(a - b) > ESTIMATE_TOLERANCE;
  if (off(est.value, row.value) || off(est.low, row.low) || off(est.high, row.high)) {
    return {
      ok: false,
      code: "not_grounded",
      reason:
        `${row.table}.${row.field} for ${row.entity_id}: proposed ` +
        `{${row.value}, [${row.low}, ${row.high}]} does not match the recomputed ` +
        `${row.method} estimate {${est.value}, [${est.low}, ${est.high}]}`,
    };
  }
  return { ok: true, method, estimate: est };
}
