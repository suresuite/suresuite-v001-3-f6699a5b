/**
 * The network-lens desktop rules (§6 adaptive columns, §8 process focus, §9 search)
 * against the handoff's acceptance checklist, without a renderer.
 */
import { describe, expect, it } from 'vitest';
import {
  adaptiveColumnLayout,
  isExactHit,
  lensNodeSize,
  nodeSuggestions,
  planColumn,
  LENS_LAYOUT,
} from '../lensLayout';
import { directedFocusIds } from '../focus';

const OPTS = { canvasWidth: 1000, canvasHeight: 600, nodeWidth: 36, nodeHeight: 22 };
const idsOf = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`);

describe('adaptive column layout (§6)', () => {
  it('a class of 60+ nodes folds into staggered sub-columns that stay inside the height', () => {
    const materials = idsOf('M', 61);
    const pos = adaptiveColumnLayout([{ ids: materials, stagger: true }], OPTS);
    const plan = planColumn(61, true, OPTS);
    expect(plan.subColumns).toBeGreaterThan(1);
    const ys = materials.map((id) => pos.get(id)!.y + OPTS.nodeHeight / 2);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(LENS_LAYOUT.top - 0.001);
    expect(Math.max(...ys)).toBeLessThanOrEqual(OPTS.canvasHeight - LENS_LAYOUT.bottom + 0.001);
    // alternate sub-columns are offset by half a row
    const col0 = pos.get(materials[0])!.y;
    const col1 = pos.get(materials[1])!.y;
    expect(Math.abs(col1 - col0)).toBeCloseTo(plan.rowGap / 2, 6);
  });

  it('a class of 9 spreads with gaps of at most 36px and no stagger', () => {
    const products = idsOf('P', 9);
    const pos = adaptiveColumnLayout([{ ids: products }], OPTS);
    expect(planColumn(9, false, OPTS).subColumns).toBe(1);
    const ys = products.map((id) => pos.get(id)!.y);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeLessThanOrEqual(36 + 1e-9);
      expect(ys[i] - ys[i - 1]).toBeGreaterThan(0);
    }
  });

  it('classes run left to right, empty classes take no width, every id is placed once', () => {
    const cols = [
      { ids: idsOf('S', 24), stagger: true },
      { ids: [] as string[] },
      { ids: idsOf('M', 61), stagger: true },
      { ids: idsOf('P', 12) },
      { ids: idsOf('C', 18) },
    ];
    const pos = adaptiveColumnLayout(cols, OPTS);
    expect(pos.size).toBe(24 + 61 + 12 + 18);
    const maxX = (ids: string[]) => Math.max(...ids.map((id) => pos.get(id)!.x));
    const minX = (ids: string[]) => Math.min(...ids.map((id) => pos.get(id)!.x));
    expect(maxX(cols[0].ids)).toBeLessThan(minX(cols[2].ids));
    expect(maxX(cols[2].ids)).toBeLessThan(minX(cols[3].ids));
    expect(maxX(cols[3].ids)).toBeLessThan(minX(cols[4].ids));
    expect(minX(cols[3].ids) - maxX(cols[2].ids) - OPTS.nodeWidth).toBeGreaterThanOrEqual(LENS_LAYOUT.classGap.min - 1e-9);
  });

  it('keeps the product-level node size formula', () => {
    expect(lensNodeSize(1).width).toBeCloseTo(52.5, 6);
    const s = lensNodeSize(300);
    expect(s.height).toBeCloseTo(s.width * 0.62, 9);
    expect(lensNodeSize(1e9).width).toBeCloseTo(31.5, 6);
  });
});

describe('process focus — the path through the node, never its siblings (§8)', () => {
  // S1,S2 → M2a,M2b (depth 2) → M1 (depth 1) → P1 → C1 ; M1' is a sibling of M1.
  const EDGES = [
    { source: 'S1', target: 'M2a' },
    { source: 'S2', target: 'M2b' },
    { source: 'M2a', target: 'M1' },
    { source: 'M2b', target: 'M1' },
    { source: 'S2', target: 'M1x' },
    { source: 'M1x', target: 'P1' },
    { source: 'M1', target: 'P1' },
    { source: 'P1', target: 'C1' },
    { source: 'P1', target: 'C2' },
  ];

  it('a mid-level material brings upstream suppliers and downstream products/customers only', () => {
    expect([...directedFocusIds(EDGES, 'M1')].sort()).toEqual(['C1', 'C2', 'M1', 'M2a', 'M2b', 'P1', 'S1', 'S2']);
    expect(directedFocusIds(EDGES, 'M1').has('M1x')).toBe(false);
  });

  it('a supplier walks downstream only; a customer upstream only', () => {
    expect([...directedFocusIds(EDGES, 'S1')].sort()).toEqual(['C1', 'C2', 'M1', 'M2a', 'P1', 'S1']);
    expect(directedFocusIds(EDGES, 'C1').has('C2')).toBe(false);
  });

  it('terminates on a cycle', () => {
    expect([...directedFocusIds([{ source: 'A', target: 'B' }, { source: 'B', target: 'A' }], 'A')].sort()).toEqual(['A', 'B']);
  });
});

describe('search suggestions (§9)', () => {
  const C = idsOf('M-00', 20).map((id) => ({ id, label: id }));
  it('contains-match, case-insensitive, at most 8', () => {
    expect(nodeSuggestions(C, 'm-00')).toHaveLength(8);
    expect(nodeSuggestions(C, 'M-00-2').map((c) => c.id)).toEqual(['M-00-2', 'M-00-20']);
    expect(nodeSuggestions(C, '  ')).toEqual([]);
  });
  it('an exact typed id is a hit', () => {
    expect(isExactHit(C, 'M-00-3')).toBe(true);
    expect(isExactHit(C, 'm-00-3')).toBe(false);
  });
});
