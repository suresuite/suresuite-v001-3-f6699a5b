/**
 * F-20 (audit 2026-09-22) — one currency on every supply-chain surface, read from
 * the engine's declaration.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyCompact, MONEY_SYMBOL } from '../money';
import { KPI_DISPLAY } from '../kpiDisplay';
import { resultLine } from '@/components/sim/runQueueLogic';

/** Files whose `$` is the AI provider's billing currency (USD), not a supply-chain value. */
const USD_BILLING = [
  'src/lib/capabilities.ts',
  'src/pages/Profile.tsx',
  'src/pages/admin/',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.generated\.|__tests__/.test(p)) out.push(p);
  }
  return out;
}

describe('F-20 — one money formatter', () => {
  it('the symbol is the one the engine declares (definitions.py, via the registry)', () => {
    const py = readFileSync('scsim/scsim/kpi/definitions.py', 'utf8');
    expect(py).toMatch(new RegExp(`KpiSpec\\("lost_sales_value"[^)]*"${MONEY_SYMBOL}"\\)`));
  });

  it('reproduces the defect site by site: Results and the run queue agree', () => {
    const revenue = KPI_DISPLAY.find((k) => k.key === 'revenue')!;
    const line = resultLine({ aggregate_kpis: { revenue: 1234567 } } as never);
    expect(revenue.format(1234567)).toBe(formatMoney(1234567));
    expect(line).toContain(formatMoney(1234567));
  });

  it('formats', () => {
    expect(formatMoney(-1500.4)).toBe(`-${MONEY_SYMBOL}${(1500).toLocaleString()}`);
    expect(formatMoneyCompact(2_500_000)).toBe(`${MONEY_SYMBOL}2.5M`);
    expect(formatMoneyCompact(45_200)).toBe(`${MONEY_SYMBOL}45K`);
  });

  it('no supply-chain surface writes its own currency formatter', () => {
    const offenders: string[] = [];
    for (const f of walk('src')) {
      if (f === join('src', 'lib', 'sim', 'money.ts')) continue;
      const text = readFileSync(f, 'utf8');
      const dollar = /`\$\$\{/.test(text) && !USD_BILLING.some((u) => f.startsWith(u.replace(/\//g, '/')));
      const euro = /`€\$\{|\? `€\$\{|=== "€" \? `€/.test(text);
      if (dollar || euro) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
