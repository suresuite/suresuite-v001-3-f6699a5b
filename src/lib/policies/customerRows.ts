/**
 * The customer × product rows' own demand spec, as the Customer stage's base
 * layer — PLAN.md §24 WP 14.2, ADR 0002 decision 2.
 *
 * Each `outbound_logistics` row may state its demand (distribution, mean,
 * variation, bounds — weekly after promotion) and may have a forecast series
 * (`demand_forecasts` buckets). This module turns the two into the one map the
 * grid's master-backed cells read (`MasterRowMaps.outbound_logistics`), keyed
 * exactly as the Customer stage and the engine key a row: `<customer>::<product>`.
 *
 * `demand_mode` is not uploaded: it is DERIVED, the way the engine derives it —
 * `forecast` when the row has a series, else `model` — and a /policies override
 * of it is what sets a series aside. `row_forecast` is the read-only summary the
 * grid shows beside it, with its source.
 */

export type Row = Record<string, unknown>;

/** A forecast bucket as `get_project_demand_forecasts` returns it. */
export interface ForecastBucket {
  customer_id: string;
  product_id: string;
  period_start: string;
  period_end?: string | null;
  time_unit?: string | null;
  quantity?: number | null;
  weekly_quantity?: number | null;
}

const rowKey = (customer: unknown, product: unknown) => `${String(customer)}::${String(product)}`;

/** One line for the read-only Forecast cell: how much was uploaded, from when,
 *  and the first weekly values — so the cell names its source (T1). */
export function forecastSummary(buckets: readonly ForecastBucket[]): string | undefined {
  if (!buckets.length) return undefined;
  const sorted = [...buckets].sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
  const units = [...new Set(sorted.map((b) => (b.time_unit ? String(b.time_unit) : "week")))].join("/");
  const first = sorted
    .slice(0, 3)
    .map((b) => {
      const n = Number(b.weekly_quantity);
      return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : "—";
    })
    .join(", ");
  return `${sorted.length} ${units} bucket${sorted.length === 1 ? "" : "s"} from ${sorted[0].period_start} · ${first}${sorted.length > 3 ? " …" : ""} /wk`;
}

/** `outbound_logistics` rows + forecast buckets → the Customer stage's master map. */
export function customerRowMasters(
  outbound: readonly Row[],
  forecasts: readonly ForecastBucket[] = [],
): Map<string, Row> {
  const byRow = new Map<string, ForecastBucket[]>();
  for (const f of forecasts) {
    const k = rowKey(f.customer_id, f.product_id);
    byRow.set(k, [...(byRow.get(k) ?? []), f]);
  }
  const out = new Map<string, Row>();
  for (const o of outbound) {
    if (o.customer_id == null || o.product_id == null) continue;
    const k = rowKey(o.customer_id, o.product_id);
    const buckets = byRow.get(k) ?? [];
    out.set(k, {
      ...o,
      demand_mode: buckets.length ? "forecast" : undefined,
      row_forecast: forecastSummary(buckets),
    });
  }
  // A forecast for a row no outbound lane names is still that row's demand.
  for (const [k, buckets] of byRow) {
    if (out.has(k)) continue;
    out.set(k, { customer_id: buckets[0].customer_id, product_id: buckets[0].product_id,
                 demand_mode: "forecast", row_forecast: forecastSummary(buckets) });
  }
  return out;
}

/** What the row's variation MEANS for its distribution — the cell's title. */
export function variationMeaning(distribution: unknown): string {
  const d = String(distribution ?? "").toLowerCase();
  if (d === "normal") return "CV — σ = variation × mean";
  if (d === "triangular_av" || d === "triangularav") return "± fraction — triangular(mean·(1−v), mean, mean·(1+v))";
  if (d === "triangular") return "not read — a triangular row's bounds are explicit (min / max)";
  if (d === "deterministic" || d === "poisson") return `not read by ${d}`;
  return "read by the distribution: CV for normal, ± fraction for triangularAV";
}

/** The note a Customer row's variation cell carries: what the number MEANS for
 *  the distribution this row runs on (ADR 0002 — CV for normal, ± fraction for
 *  triangularAV). Undefined for any other column. */
export function demandCellNote(field: string, rowDistribution: unknown): string | undefined {
  return field === "row_demand_variation" ? `Variation here is: ${variationMeaning(rowDistribution)}.` : undefined;
}
