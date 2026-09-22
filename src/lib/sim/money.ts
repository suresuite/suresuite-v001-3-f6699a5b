/**
 * ONE money formatter for supply-chain values — audit 2026-09-22 · F-20.
 *
 * The same run's revenue read `$` on the Results panel (`kpiDisplay.money`) and
 * `€` in the run queue (`resultLine`), while the engine's KPI dictionary and every
 * policy parameter declared `€`. A currency label is part of the number (A7).
 *
 * The symbol is READ from the engine's declaration — the unit of its money KPIs in
 * the registry export (`scsim/scsim/kpi/definitions.py` → `registry.generated.json`)
 * — so it cannot drift from the engine and is not authored here.
 *
 * KNOWN LIMIT (T3): no currency is stored with the data. Prices are uploaded as
 * plain numbers ("currency per unit" in the contract), so `€` is the unit the
 * engine DECLARES, not one read from the project. A project-level currency is a
 * product decision recorded in PLAN.md §16 · audit WP 9.
 *
 * Out of scope on purpose: the admin AI-usage pages' `$`, which is the provider's
 * billing currency (USD) and genuinely dollars.
 */
import registry from '@/lib/policies/registry.generated.json';

type KpiEntry = { name: string; unit: string };

const MONEY_KPIS = ['revenue', 'lost_sales_value', 'cost_of_resilience'] as const;

function declaredSymbol(): string {
  const kpis = (registry as { kpis: KpiEntry[] }).kpis;
  const units = new Set(kpis.filter((k) => (MONEY_KPIS as readonly string[]).includes(k.name)).map((k) => k.unit));
  if (units.size !== 1) {
    throw new Error(`money: the engine declares ${units.size} currency units for its money KPIs`);
  }
  return [...units][0];
}

/** The currency symbol the engine declares for every money KPI. */
export const MONEY_SYMBOL: string = declaredSymbol();

/** `€1,234` — whole units, grouped. Negative values keep their sign. */
export function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}${MONEY_SYMBOL}${Math.round(Math.abs(n)).toLocaleString()}`;
}

/** `€1.2M` / `€45K` / `€900` — for dense tables. */
export function formatMoneyCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}${MONEY_SYMBOL}${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}${MONEY_SYMBOL}${(a / 1_000).toFixed(0)}K`;
  return `${sign}${MONEY_SYMBOL}${a.toFixed(0)}`;
}
