/**
 * F-34 (audit 2026-09-22) — no fabricated KPI ever reaches the realtime channel.
 *
 * `sim-command` answered `scenario.changed` / `policy.changed` by broadcasting
 * `kpi.delta` with hard-coded figures (`fill_rate: 0.94`, `revenue: 1_000_000`, …)
 * tagged `source: "stub"`. No browser surface subscribed, so no user saw them — but
 * `kpi.delta` is the same event the worker publishes with REAL figures, and a
 * subscriber that did not check `source` would display an invented number (T1).
 * The worker is the only thing that computes KPIs, so it is the only publisher.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SIM_COMMAND = 'supabase/functions/sim-command/index.ts';
const WORKER = 'sim-worker/sim_worker/worker.py';

describe('F-34 — only the worker publishes kpi.delta', () => {
  const src = readFileSync(SIM_COMMAND, 'utf8');

  it('sim-command broadcasts no kpi.delta', () => {
    expect(src).not.toMatch(/["']kpi\.delta["']/);
  });

  it('sim-command carries no stub KPI generator or stub-tagged payload', () => {
    expect(src).not.toMatch(/stub\w*KpiDelta/i);
    expect(src).not.toMatch(/source:\s*["']stub["']/);
  });

  it('the worker still publishes it, tagged as its own (the gate is not vacuous)', () => {
    const worker = readFileSync(WORKER, 'utf8');
    expect(worker).toMatch(/"kpi\.delta"/);
    expect(worker).toMatch(/"source":\s*"worker"/);
  });
});
