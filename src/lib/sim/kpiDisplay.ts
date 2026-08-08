// One KPI display vocabulary for the Simulation Lab: label, formatter, and
// direction of improvement. The results table, the recovery-impact table and
// the compare table all read from here so a KPI never renders under two names
// or two precisions on the same page.

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

export const KPI_DISPLAY: KpiDisplay[] = [
  { key: "fill_rate", label: "Fill rate (α)", format: pct2, higherIsBetter: true },
  { key: "fill_rate_beta", label: "Fill rate (β)", format: pct2, higherIsBetter: true },
  { key: "otif", label: "OTIF", format: pct2, higherIsBetter: true },
  { key: "lead_time_days", label: "Lead time (days)", format: fixed(2), higherIsBetter: false },
  { key: "lead_time_p95", label: "Lead time p95", format: fixed(2), higherIsBetter: false },
  { key: "revenue", label: "Revenue", format: money, higherIsBetter: true },
  { key: "cost", label: "Cost", format: money, higherIsBetter: false },
  { key: "profit", label: "Profit", format: money, higherIsBetter: true },
  { key: "utilization", label: "Utilization (avg)", format: pct1, higherIsBetter: true },
  { key: "inventory_turns", label: "Inventory turns", format: fixed(2), higherIsBetter: true },
  { key: "backorder_days", label: "Backorder days", format: fixed(1), higherIsBetter: false },
  { key: "ttr_days", label: "Time-to-recover", format: fixed(1), higherIsBetter: false },
  { key: "resilience_index", label: "Resilience index", format: fixed(3), higherIsBetter: true },
];

export const KPI_BY_KEY: Record<string, KpiDisplay> = Object.fromEntries(
  KPI_DISPLAY.map((k) => [k.key, k]),
);

/** Fallback for KPIs the engine emits that the catalog above doesn't name. */
export const kpiDisplay = (key: string): KpiDisplay =>
  KPI_BY_KEY[key] ?? { key, label: key, format: fixed(3), higherIsBetter: null };

/** "+1.2%" / "−0.4 d" — a delta always carries its sign. */
export const signedDelta = (delta: number, format: (n: number) => string) =>
  `${delta > 0 ? "+" : ""}${format(delta)}`;
