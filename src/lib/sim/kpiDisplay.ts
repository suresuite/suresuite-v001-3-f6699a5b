// One KPI display vocabulary for the Simulation Lab: label, formatter, and
// direction of improvement. The results table, the recovery-impact table and
// the compare table all read from here so a KPI never renders under two names
// or two precisions on the same page.
//
// ── THIS IS A LABEL CATALOG, NOT A LIST OF AVAILABLE MEASURES — §4 D113 ────
//
// It used to be both, and that was the defect. `KpiStatTable` mapped over
// `KPI_DISPLAY` and looked each key up on the replication rows, so the table could
// only ever show measures this list names. The list is the LEGACY engine's KPI shape
// (`sim-worker/sim_worker/kpi.py`); the canonical engine's `_kpi_row` emits a
// different set, and **the intersection was TWO names** — `fill_rate` and `revenue`.
// Eleven of thirteen rows could never appear, including every cost component and
// `cost_of_resilience`. Nothing wrong was ever DISPLAYED (a row with no data is
// dropped rather than shown as zero), which is exactly why it survived: this was
// measure LOSS, and neither file was wrong read alone.
//
// The table is now driven by the keys the replication rows CARRY and this catalog
// supplies the label. So a measure the engine adds appears immediately, under its
// raw key until somebody names it here — visible and slightly ugly, rather than
// invisible and tidy. `runKpiVocabulary.test.ts` fails when a key the canonical
// engine always emits has no label, so "slightly ugly" stays a transient state.
//
// TWO NAMES FOR ONE QUANTITY ARE KEPT, DELIBERATELY. `utilization` and
// `capacity_utilization` are the legacy and canonical names for the same measure;
// `ttr_days` and `ttr_weeks` likewise. Both engines are live — the legacy one is
// FROZEN, not retired — so a stored run from either must render, and collapsing the
// pair would make one of them fall back to its raw key. They are marked below.

export interface KpiDisplay {
  key: string;
  label: string;
  format: (n: number) => string;
  /** null when "better" is not defined for the KPI (pure descriptors). */
  higherIsBetter: boolean | null;
}

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;
const pct2 = (n: number) => `${(n * 100).toFixed(2)}%`;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fixed = (d: number) => (n: number) => n.toFixed(d);

const units = (n: number) => Math.round(n).toLocaleString();

export const KPI_DISPLAY: KpiDisplay[] = [
  // ── the canonical engine (`scsim/scsim/kpi/compute.py::_kpi_row`) ─────────
  { key: "fill_rate", label: "Fill rate (α)", format: pct2, higherIsBetter: true },
  { key: "revenue", label: "Revenue", format: money, higherIsBetter: true },
  { key: "demand_value", label: "Demand (value)", format: money, higherIsBetter: null },
  { key: "produced_value", label: "Produced (value)", format: money, higherIsBetter: null },
  { key: "lost_sales_value", label: "Lost sales (value)", format: money, higherIsBetter: false },
  { key: "lost_units", label: "Lost units", format: units, higherIsBetter: false },
  { key: "lost_inbound_units", label: "Lost inbound units", format: units, higherIsBetter: false },
  { key: "max_backlog", label: "Peak backlog (units)", format: units, higherIsBetter: false },
  // Inventory window averages (G19). A stock is averaged over the analysis
  // window, never summed — `WEEKLY_SERIES` calls these `level` for that reason.
  // `higherIsBetter` is null for all four on purpose: inventory is a trade-off
  // against service, not a thing to minimise on its own.
  { key: "avg_on_hand_value", label: "Average material inventory (value)", format: money, higherIsBetter: null },
  { key: "avg_fg_value", label: "Average finished-goods inventory (value)", format: money, higherIsBetter: null },
  { key: "avg_on_hand_units", label: "Average material inventory (units)", format: units, higherIsBetter: null },
  { key: "avg_fg_units", label: "Average finished-goods inventory (units)", format: units, higherIsBetter: null },
  // Capacity (WP 9.3 / §4 D165). `capacity_utilization` was named here from the
  // start and was NaN on every run that was not a full-debug inspection, so the
  // label described a row nobody ever saw. The three beside it are what turn
  // "how hard did it run" into "did it BIND, and for whom" — a utilization can
  // be 0.99 with nothing refused, and a count above zero is demand the capacity
  // actually turned away. `higherIsBetter` is null for the utilizations (high is
  // efficient AND fragile) and false for the counts, which are refusals.
  { key: "capacity_utilization", label: "Plant capacity utilization", format: pct1, higherIsBetter: null },
  { key: "supplier_capacity_utilization", label: "Supplier capacity utilization", format: pct1, higherIsBetter: null },
  { key: "products_capacity_bound", label: "Products capacity held back", format: units, higherIsBetter: false },
  { key: "suppliers_capacity_bound", label: "Suppliers capacity held back", format: units, higherIsBetter: false },
  // The total the ten components below sum to — P-X.1's own measure.
  { key: "cost_of_resilience", label: "Cost of resilience", format: money, higherIsBetter: false },
  // ── the ten cost components (`scsim/scsim/core/context.py::COST_COMPONENTS`) ──
  // Named here rather than rendered as raw keys because a reader scanning a cost
  // breakdown should not have to translate `fg_ss_holding`. The gate asserts the
  // set matches the engine's, so a component added there fails here.
  { key: "cost_ss_holding", label: "Cost · safety-stock holding", format: money, higherIsBetter: false },
  { key: "cost_backup_premium", label: "Cost · backup supplier premium", format: money, higherIsBetter: false },
  { key: "cost_multi_sourcing_premium", label: "Cost · multi-sourcing premium", format: money, higherIsBetter: false },
  { key: "cost_expediting", label: "Cost · expediting freight", format: money, higherIsBetter: false },
  { key: "cost_overtime", label: "Cost · overtime capacity", format: money, higherIsBetter: false },
  { key: "cost_lost_sales", label: "Cost · lost sales", format: money, higherIsBetter: false },
  { key: "cost_allocation_labor", label: "Cost · allocation labour", format: money, higherIsBetter: false },
  { key: "cost_fg_ss_holding", label: "Cost · finished-goods safety stock", format: money, higherIsBetter: false },
  { key: "cost_backorder_penalty", label: "Cost · backorder penalty", format: money, higherIsBetter: false },
  { key: "cost_monitoring", label: "Cost · supplier monitoring", format: money, higherIsBetter: false },
  // ── present only on a run that had a disruption event ─────────────────────
  { key: "ttr_weeks", label: "Time to recover (weeks)", format: fixed(1), higherIsBetter: false },
  { key: "tts_weeks", label: "Time to survive (weeks)", format: fixed(1), higherIsBetter: true },
  { key: "pre_disruption_fill_rate", label: "Fill rate before the disruption", format: pct2, higherIsBetter: true },
  // ── the LEGACY engine (`sim-worker/sim_worker/kpi.py`), frozen and still live ──
  // A stored run from it must still render. `utilization` is the legacy name for
  // `capacity_utilization` and `ttr_days` for `ttr_weeks` — D21's shape, kept
  // because retiring a name a stored row carries would lose the row (§4 D113).
  { key: "fill_rate_beta", label: "Fill rate (β)", format: pct2, higherIsBetter: true },
  { key: "otif", label: "OTIF", format: pct2, higherIsBetter: true },
  { key: "lead_time_days", label: "Lead time (days)", format: fixed(2), higherIsBetter: false },
  { key: "lead_time_p95", label: "Lead time p95", format: fixed(2), higherIsBetter: false },
  { key: "cost", label: "Cost", format: money, higherIsBetter: false },
  { key: "profit", label: "Profit", format: money, higherIsBetter: true },
  { key: "utilization", label: "Utilization (avg) · legacy", format: pct1, higherIsBetter: true },
  { key: "inventory_turns", label: "Inventory turns", format: fixed(2), higherIsBetter: true },
  { key: "backorder_days", label: "Backorder days", format: fixed(1), higherIsBetter: false },
  { key: "ttr_days", label: "Time-to-recover (days) · legacy", format: fixed(1), higherIsBetter: false },
  // `resilience_index` IS DELIBERATELY ABSENT — §4 D113, and it is not a naming
  // problem. scsim's `resilience_index()` is called only by
  // `scsim/scsim/stress/battery.py`, inside the library D111 established the product
  // never calls, and the legacy `network_metrics.resilience_index()` has no caller
  // at all. NO RUN PRODUCES IT. A label here would have promised a measure nothing
  // computes, in a catalog a reader takes for the list of what is available. Making
  // it a run measure is an engine change and it is an RFC in §14, not a row here.
];

/**
 * The order rows are shown in. A key the engine emits that this catalog does not
 * name still renders — after the named ones, alphabetically — so a new measure is
 * visible immediately rather than waiting for a label.
 */
export const KPI_ORDER: Map<string, number> = new Map(KPI_DISPLAY.map((k, i) => [k.key, i]));

export const KPI_BY_KEY: Record<string, KpiDisplay> = Object.fromEntries(
  KPI_DISPLAY.map((k) => [k.key, k]),
);

/** Fallback for KPIs the engine emits that the catalog above doesn't name. */
export const kpiDisplay = (key: string): KpiDisplay =>
  KPI_BY_KEY[key] ?? { key, label: key, format: fixed(3), higherIsBetter: null };

/** "+1.2%" / "−0.4 d" — a delta always carries its sign. */
export const signedDelta = (delta: number, format: (n: number) => string) =>
  `${delta > 0 ? "+" : ""}${format(delta)}`;
