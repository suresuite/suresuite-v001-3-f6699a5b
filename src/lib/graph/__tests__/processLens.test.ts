/**
 * F-10 and F-35 (audit 2026-09-22) — `/process-level-network`'s metric strip shows
 * no number that cannot move, and the page carries no developer diagnostics.
 *
 * F-10 is reproduced on the formula itself, kept here verbatim as a witness:
 * `0.4 + 0.3(1-h) + 0.3(1-min(h,1))` over an HHI `h ∈ [0,1]` is `0.4 + 0.6(1-h)`,
 * floored at exactly 0.4 — and the red alert fired on `< 0.4`, which no input can
 * reach. "Bottlenecks" counted `level === 1` nodes and called the top one "the
 * highest-flow assembly step"; nothing in the contract routes a level-1 BOM node
 * through an assembly step, so the label asserted a fact no table holds (T1). Both
 * tiles are DELETED rather than redefined: a resilience measure is the engine's to
 * compute (resilience index, P-X), not a page's to invent.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGE = 'src/pages/ProcessLevelNetwork.tsx';
const src = () => readFileSync(PAGE, 'utf8');

// Witness — the deleted formula, verbatim.
const resilience = (h: number) => 0.4 + 0.3 * (1 - h) + 0.3 * (1 - Math.min(h, 1));

describe('F-10 — no invented measure on the process lens', () => {
  it('reproduces the defect: the red alert was unreachable for every valid HHI', () => {
    for (let i = 0; i <= 100; i++) expect(resilience(i / 100) < 0.4).toBe(false);
    expect(resilience(1)).toBeCloseTo(0.4, 12); // the floor, exactly
  });

  it('the page no longer shows a Resilience figure or its alert', () => {
    expect(src()).not.toMatch(/label:\s*'Resilience'/);
    expect(src()).not.toMatch(/resilienceRed/);
  });

  it('the page no longer counts `level === 1` nodes as bottlenecks', () => {
    expect(src()).not.toMatch(/label:\s*'Bottlenecks'/);
    expect(src()).not.toMatch(/\bbottlenecks\b/);
    expect(src()).not.toMatch(/highest-flow assembly step/);
  });

  it('the node panel reads the echelon, not a ladder over `level`', () => {
    expect(src()).not.toMatch(/'Manufacturing'|'Direct Supplier'|'Upstream Supplier'/);
  });
});

describe('F-35 — no developer diagnostics on the page', () => {
  it('declares no diagnostics routine and reads no `supply_chain_data_multi_tier.level` of its own', () => {
    expect(src()).not.toMatch(/runDiagnostics/);
    expect(src()).not.toMatch(/from\('supply_chain_data_multi_tier'\)\s*\.select\('level/);
  });
});
