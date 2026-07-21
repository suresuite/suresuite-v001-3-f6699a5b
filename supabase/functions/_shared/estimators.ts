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
import ioSeed from "./ioCoefficientsSeed.json" with { type: "json" };
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

// ═══════════════════════════════════════════════════════════════════════════
// B8 v2 — BOM consumption-rate methods r_{p,m} (ai-agents.md §18.2 v2).
//
// The engine field is BomLine.rate ("units m / unit p", gt 0 — the hard
// production-feasibility constraint, scsim/scsim/entities/network.py). No
// external database publishes r_{p,m}; every value below is DERIVED from the
// project's own rows plus the checked-in IO-coefficient seed slice — the
// §18.1 posture (LLM selects, registry computes) applied to a graph edge
// instead of an item-master cell. Same laws: {value, low, high, basis} on
// every rate, hold-out by construction (no rate method ever reads the target
// pair's own observed rate — the observed BOM contributes set membership
// only), back-test demotion for prior-sourced methods, 1e-9 recomputation at
// draft AND apply.
// ═══════════════════════════════════════════════════════════════════════════

/** §18.2 v2 mass-balance tolerance (DEFAULT): the volumed inbound flow of a
 * material must cover the BOM-implied weekly consumption within this relative
 * slack; beyond it the draft is refused naming the imbalance — a rate is
 * never silently adjusted to fit. */
export const MASS_BALANCE_TOLERANCE = 0.10;

export interface RatePair {
  product_id: string;
  material_id: string;
}

interface IoCoefficientRow {
  id: string;
  sector: string;
  match_tokens: string[];
  dataset: string;
  vintage: number;
  role: string;
  license_tier: string;
  kind: string;
  value: number;
  low: number;
  high: number;
}

export const IO_SEED_VERSION: number = ioSeed.slice_version;
const IO_ROWS: IoCoefficientRow[] = ioSeed.rows as IoCoefficientRow[];

/** Deterministic sector match: first seed row (file order) with a
 * match_token contained in the normalized material name; the composite row
 * (empty match_tokens) is the declared fallback. Never fuzzy, never scored. */
export function matchIoCoefficient(materialName: string): IoCoefficientRow | undefined {
  const name = String(materialName ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  let composite: IoCoefficientRow | undefined;
  for (const row of IO_ROWS) {
    if (row.match_tokens.length === 0) {
      composite = composite ?? row;
      continue;
    }
    if (name && row.match_tokens.some((t) => name.includes(t))) return row;
  }
  return composite;
}

/** Weekly volumed inbound flow per material — Σ rateToWeekly(volume) over
 * arcs with volume > 0. Arcs without a volume are UNCONSTRAINED (they carry
 * no flow information); a material with zero volumed arcs is absent. */
export function weeklyInboundFlow(dataset: GradingDataset): Map<string, number> {
  const out = new Map<string, number>();
  for (const arc of dataset.inbound) {
    const mat = String(arc.material_id ?? "");
    if (!mat) continue;
    const vol = num(arc.volume);
    if (vol <= 0) continue;
    out.set(mat, (out.get(mat) ?? 0) + rateToWeekly(vol, arc.time_unit as string | null));
  }
  return out;
}

/** Consuming products per material from the normalized (single or flattened
 * multi-level) BOM — membership only, never the rate values (the hold-out
 * law). */
export function bomConsumers(dataset: GradingDataset): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const b of normalizeBomRows(dataset.bom)) {
    const product = String(b.product_id ?? "");
    const material = String(b.material_id ?? "");
    if (!product || !material) continue;
    if (!out.has(material)) out.set(material, new Set());
    out.get(material)!.add(product);
  }
  return out;
}

/** Resolved unit price of a material: master cost when set, else the
 * engine's own cheapest-inbound fallback (arc prices ≤ 0 default to 1.0
 * before the min — exactly the project_map.py chain). */
function materialUnitPrice(materialId: string, inputs: EstimatorInputs): number | undefined {
  const master = inputs.dataset.materials.find(
    (m) => String(m.material_id ?? "") === materialId,
  );
  if (!master) return undefined;
  const cost = num(master.cost);
  if (cost > 0) return cost;
  return reducerCtx(inputs).cheapestInbound.get(materialId);
}

/** Resolved unit price of a product: master sell_price when set, else the
 * engine's demand-weighted outbound fallback. */
function productUnitPrice(productId: string, inputs: EstimatorInputs): number | undefined {
  const master = inputs.dataset.products.find(
    (p) => String(p.product_id ?? "") === productId,
  );
  if (!master) return undefined;
  const price = num(master.sell_price);
  if (price > 0) return price;
  return reducerCtx(inputs).weightedPrice.get(productId);
}

export interface RateEstimatorMethod {
  id: string;
  version: number;
  family: MethodFamily;
  /** Fixed target: the BOM edge field the engine reads. */
  target: { table: "bom_single_level"; field: "consumption_rate" };
  params: Record<string, number | string>;
  /** Per-pair sources (the io method cites the MATCHED seed row's dataset +
   * vintage verbatim — §18.5 law 2). */
  sources(pair: RatePair, inputs: EstimatorInputs): EstimatorSource[];
  assumptions: string[];
  groundTables: string[];
  estimate(pair: RatePair, inputs: EstimatorInputs): Estimate | undefined;
}

export const rateMethodRef = (m: RateEstimatorMethod): string => `${m.id}@${m.version}`;

export const RATE_ESTIMATOR_METHODS: RateEstimatorMethod[] = [
  {
    id: "rate_observed_consumption",
    version: 1,
    family: "direct_from_project",
    target: { table: "bom_single_level", field: "consumption_rate" },
    params: {},
    sources: () => [GROUND_LIVE],
    assumptions: [
      "r = weekly volumed inbound flow of the material ÷ weekly effective " +
      "output of the product — valid only when the product is the material's " +
      "SOLE consumer (any other consuming product makes the allocation " +
      "ill-posed and the method returns undefined rather than guess).",
      "An exact quotient of two complete-data sums carries a degenerate " +
      "interval (basis direct_sum — the §18.1 law extended to quotients of " +
      "complete sums).",
    ],
    groundTables: ["inbound_logistics", "outbound_logistics", "bom_single_level"],
    estimate(pair, inputs) {
      const flow = weeklyInboundFlow(inputs.dataset).get(pair.material_id);
      if (!flow || flow <= 0) return undefined;
      const demand = reducerCtx(inputs).effectiveDemand.get(pair.product_id) ?? 0;
      if (demand <= 0) return undefined;
      const others = [...(bomConsumers(inputs.dataset).get(pair.material_id) ?? [])]
        .filter((p) => p !== pair.product_id);
      if (others.length > 0) return undefined;
      const value = flow / demand;
      return { value, low: value, high: value, basis: "direct_sum" };
    },
  },
  {
    id: "rate_spend_implied",
    version: 1,
    family: "benchmark_scaled",
    target: { table: "bom_single_level", field: "consumption_rate" },
    params: { benchmark: "asm_materials_share" },
    sources: () => [priorSource("asm_materials_share"), GROUND_LIVE],
    assumptions: [
      "Spend ÷ unit-price implied quantity: the firm materials budget (ASM " +
      "materials-cost share × annualized outbound revenue, the Talluri " +
      "scaling) is apportioned uniformly across the project's priceable " +
      "materials; dividing the material's budget slice by its unit price " +
      "implies an annual quantity, and dividing that by the annual output of " +
      "the material's consuming products (the candidate pair included) " +
      "yields units m per unit p.",
      "Uniform budget apportionment and uniform intensity across consumers " +
      "are declared crude priors — the interval carries the share row's " +
      "published range, and the human review gate sees it.",
    ],
    groundTables: ["outbound_logistics", "inbound_logistics", "materials", "bom_single_level"],
    estimate(pair, inputs) {
      const fig = benchmarkFigure("asm_materials_share");
      if (!fig) return undefined;
      const vos = annualValueOfShipments(inputs.dataset);
      if (vos <= 0) return undefined;
      const priceable = inputs.dataset.materials
        .map((m) => String(m.material_id ?? ""))
        .filter((id) => id && materialUnitPrice(id, inputs) !== undefined);
      if (priceable.length === 0 || !priceable.includes(pair.material_id)) return undefined;
      const price = materialUnitPrice(pair.material_id, inputs);
      if (!price || price <= 0) return undefined;
      const consumers = new Set(bomConsumers(inputs.dataset).get(pair.material_id) ?? []);
      consumers.add(pair.product_id);
      const ctx = reducerCtx(inputs);
      let annualOutput = 0;
      for (const p of consumers) annualOutput += (ctx.effectiveDemand.get(p) ?? 0) * 52;
      if (annualOutput <= 0) return undefined;
      const perShare = vos / priceable.length / price / annualOutput;
      return {
        value: fig.value * perShare,
        low: fig.low * perShare,
        high: fig.high * perShare,
        basis: "prior_range",
      };
    },
  },
  {
    id: "rate_io_technical_coefficient",
    version: 1,
    family: "benchmark_scaled",
    target: { table: "bom_single_level", field: "consumption_rate" },
    params: { seed: "ioCoefficientsSeed.json" },
    sources: (pair, inputs) => {
      const master = inputs.dataset.materials.find(
        (m) => String(m.material_id ?? "") === pair.material_id,
      );
      const row = matchIoCoefficient(String(master?.name ?? pair.material_id));
      return [
        {
          dataset: row?.dataset ?? "ioCoefficientsSeed.json",
          vintage: row?.vintage ?? "unknown",
          role: "prior",
        },
        GROUND_LIVE,
      ];
    },
    assumptions: [
      "Sector IO technical coefficient as a prior: a = EUR of the input " +
      "sector per EUR of the output sector's production (Eurostat " +
      "Supply-Use/IO, OECD ICIO, EXIOBASE — the checked-in seed slice), " +
      "converted to physical units via the price ratio: r = a × u_p ÷ c_m.",
      "Sector assignment is a deterministic token match of the material name " +
      "against the seed rows; the manufacturing-composite row is the " +
      "declared fallback.",
      "u_p = product master sell_price else the demand-weighted outbound " +
      "price; c_m = material master cost else the cheapest inbound price — " +
      "the engine's own fallback chains.",
    ],
    groundTables: ["materials", "products", "inbound_logistics", "outbound_logistics"],
    estimate(pair, inputs) {
      const master = inputs.dataset.materials.find(
        (m) => String(m.material_id ?? "") === pair.material_id,
      );
      if (!master) return undefined;
      const row = matchIoCoefficient(String(master.name ?? pair.material_id));
      if (!row) return undefined;
      const up = productUnitPrice(pair.product_id, inputs);
      const cm = materialUnitPrice(pair.material_id, inputs);
      if (!up || up <= 0 || !cm || cm <= 0) return undefined;
      const scale = up / cm;
      return {
        value: row.value * scale,
        low: row.low * scale,
        high: row.high * scale,
        basis: "prior_range",
      };
    },
  },
];

/** Resolve a rate-method `<id>@<version>` reference; exact version match
 * (the §18.1 loud-failure law — a bumped registry invalidates stored rows). */
export function findRateMethod(ref: string): RateEstimatorMethod | undefined {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return undefined;
  const id = ref.slice(0, at);
  const version = Number(ref.slice(at + 1));
  return RATE_ESTIMATOR_METHODS.find((m) => m.id === id && m.version === version);
}

/** Observed (product, material, rate) rows from the normalized BOM — the
 * back-test ground truth (§18.2 v2: held-out real BOM). */
export function observedBomRates(
  dataset: GradingDataset,
): Array<RatePair & { rate: number }> {
  const out: Array<RatePair & { rate: number }> = [];
  for (const b of normalizeBomRows(dataset.bom)) {
    const product = String(b.product_id ?? "");
    const material = String(b.material_id ?? "");
    const rate = num(b.consumption_rate);
    if (!product || !material || rate <= 0) continue;
    out.push({ product_id: product, material_id: material, rate });
  }
  return out;
}

/** Back-test a prior-sourced rate method against this project's observed BOM
 * rates: coverage = fraction of observed rates inside the method's declared
 * [low, high]. Hold-out is by construction — no rate method reads the target
 * pair's own observed rate (the BOM contributes consumer-set membership
 * only). Family (a) is exempt (its source IS the project's own flows).
 * Misses are reported per-row (§18.2 v2). */
export function backTestRateMethod(
  method: RateEstimatorMethod,
  inputs: EstimatorInputs,
): BackTestResult {
  const none: BackTestResult = { n: 0, covered: 0, coverage: 1, demoted: false, outliers: [] };
  if (method.family !== "benchmark_scaled") return none;
  let n = 0;
  let covered = 0;
  const outliers: BackTestResult["outliers"] = [];
  for (const obs of observedBomRates(inputs.dataset)) {
    const est = method.estimate(obs, inputs);
    if (!est) continue;
    n += 1;
    if (obs.rate >= est.low - ESTIMATE_TOLERANCE && obs.rate <= est.high + ESTIMATE_TOLERANCE) {
      covered += 1;
    } else if (outliers.length < 5) {
      outliers.push({ entity_id: `${obs.product_id}×${obs.material_id}`, actual: obs.rate });
    }
  }
  if (n === 0) return none;
  const coverage = covered / n;
  return { n, covered, coverage, demoted: coverage < BACKTEST_MIN_COVERAGE, outliers };
}

export interface RateCandidateRow {
  product_id: string;
  material_id: string;
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

/** One candidate per (missing BOM pair × applicable rate method). Pairs with
 * an existing BOM line are gaps already filled — nothing to estimate.
 * Demoted methods still appear, marked, so the agent can explain WHY a pair
 * stays open (the ce-09 discipline). */
export function rateCandidates(
  inputs: EstimatorInputs,
  pairs: RatePair[],
): RateCandidateRow[] {
  const existing = new Set(
    observedBomRates(inputs.dataset).map((o) => `${o.product_id}|${o.material_id}`),
  );
  // Pairs present in the BOM without a stored rate (rate defaulted) are
  // still existing lines — exclude on membership, not on rate.
  for (const b of normalizeBomRows(inputs.dataset.bom)) {
    const p = String(b.product_id ?? "");
    const m = String(b.material_id ?? "");
    if (p && m) existing.add(`${p}|${m}`);
  }
  const out: RateCandidateRow[] = [];
  for (const method of RATE_ESTIMATOR_METHODS) {
    const status = backTestRateMethod(method, inputs).demoted ? "demoted" : "ok";
    for (const pair of pairs) {
      if (existing.has(`${pair.product_id}|${pair.material_id}`)) continue;
      const est = method.estimate(pair, inputs);
      if (!est) continue;
      out.push({
        product_id: pair.product_id,
        material_id: pair.material_id,
        method: rateMethodRef(method),
        family: method.family,
        ...est,
        sources: method.sources(pair, inputs),
        assumptions: method.assumptions,
        status,
      });
    }
  }
  return out.sort((a, b) =>
    a.product_id.localeCompare(b.product_id) ||
    a.material_id.localeCompare(b.material_id) ||
    a.method.localeCompare(b.method)
  );
}

export interface RateRowInput {
  product_id: string;
  material_id: string;
  method: string;
  rate: number;
  low: number;
  high: number;
}

export interface RateVerification {
  ok: boolean;
  code?: "not_grounded" | "invalid_params";
  reason?: string;
  method?: RateEstimatorMethod;
  estimate?: Estimate;
}

/** The §18.1 hard gates applied to ONE BOM-rate row: named method exists,
 * is not demoted on this project, and re-derives {value, low, high} within
 * tolerance. Missingness-independent, so apply retries verify cleanly. */
export function verifyRateRow(
  row: RateRowInput,
  inputs: EstimatorInputs,
): RateVerification {
  const method = findRateMethod(row.method);
  if (!method) {
    return {
      ok: false,
      code: "not_grounded",
      reason: `unknown rate-estimation method "${row.method}" — use a method@version from get_bom_rate_estimates`,
    };
  }
  if (backTestRateMethod(method, inputs).demoted) {
    return {
      ok: false,
      code: "not_grounded",
      reason:
        `${row.method} is demoted on this project — its declared interval excludes ` +
        `the observed BOM consumption rates (back-test coverage < ${BACKTEST_MIN_COVERAGE})`,
    };
  }
  const est = method.estimate(
    { product_id: row.product_id, material_id: row.material_id },
    inputs,
  );
  if (!est) {
    return {
      ok: false,
      code: "not_grounded",
      reason:
        `${row.method} produces no grounded consumption rate for ` +
        `${row.product_id} × ${row.material_id}`,
    };
  }
  const off = (a: number, b: number) => Math.abs(a - b) > ESTIMATE_TOLERANCE;
  if (off(est.value, row.rate) || off(est.low, row.low) || off(est.high, row.high)) {
    return {
      ok: false,
      code: "not_grounded",
      reason:
        `consumption rate for ${row.product_id} × ${row.material_id}: proposed ` +
        `{${row.rate}, [${row.low}, ${row.high}]} does not match the recomputed ` +
        `${row.method} estimate {${est.value}, [${est.low}, ${est.high}]}`,
    };
  }
  return { ok: true, method, estimate: est };
}

// ── The mass-balance validator (§18.2 v2 — runs BEFORE drafting) ────────────

export interface MassBalanceViolation {
  material_id: string;
  /** Σ rate × weekly effective product output over ALL lines (existing
   * normalized BOM + the proposed lines). */
  required_weekly: number;
  /** Σ weekly volumed inbound flow of the material. */
  available_weekly: number;
  tolerance: number;
}

/**
 * §18.2 v2 mass-balance closure: for every material touched by a proposed
 * BOM line, the volumed inbound flow must cover the total BOM-implied weekly
 * consumption within MASS_BALANCE_TOLERANCE. Materials with no volumed arc
 * are unconstrained (no flow information exists — declared, not assumed).
 * A violation is a refusal naming the imbalance; a rate is NEVER silently
 * adjusted to close the balance.
 */
export function checkMassBalance(
  inputs: EstimatorInputs,
  proposedLines: Array<RatePair & { rate: number }>,
): MassBalanceViolation[] {
  if (proposedLines.length === 0) return [];
  const flow = weeklyInboundFlow(inputs.dataset);
  const ctx = reducerCtx(inputs);
  const touched = new Set(proposedLines.map((l) => l.material_id));

  const requiredByMat = new Map<string, number>();
  const addLine = (materialId: string, productId: string, rate: number) => {
    if (!touched.has(materialId)) return;
    const weekly = ctx.effectiveDemand.get(productId) ?? 0;
    if (weekly <= 0) return;
    requiredByMat.set(materialId, (requiredByMat.get(materialId) ?? 0) + rate * weekly);
  };
  for (const b of normalizeBomRows(inputs.dataset.bom)) {
    const product = String(b.product_id ?? "");
    const material = String(b.material_id ?? "");
    if (!product || !material) continue;
    addLine(material, product, num(b.consumption_rate) || 1.0);
  }
  for (const line of proposedLines) {
    addLine(line.material_id, line.product_id, line.rate);
  }

  const out: MassBalanceViolation[] = [];
  for (const material of [...touched].sort()) {
    const available = flow.get(material);
    if (available === undefined) continue; // no volumed arc — unconstrained
    const required = requiredByMat.get(material) ?? 0;
    if (required > available * (1 + MASS_BALANCE_TOLERANCE)) {
      out.push({
        material_id: material,
        required_weekly: required,
        available_weekly: available,
        tolerance: MASS_BALANCE_TOLERANCE,
      });
    }
  }
  return out;
}
