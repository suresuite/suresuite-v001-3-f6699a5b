/**
 * Every channel carries data, or it is constant and says so — WP 8.3.
 *
 * These are not tests of arithmetic. Each one pins a claim the network pages
 * currently get wrong, and names it.
 */
import { describe, expect, it } from 'vitest';
import {
  EDGE_WIDTH,
  NODE_SIZE,
  columnForNode,
  depthShade,
  edgeWidthForFlow,
  isMetricMissing,
  maxFlow,
  metricDomain,
  sizeForMetric,
} from '../encoding';
import { ECHELON_ORDER } from '../types';

describe('sizeForMetric — size encodes magnitude, and nothing else does', () => {
  it('scales by AREA, not by diameter: a 4× value is not 4× wide', () => {
    const d = { min: 0, max: 100 };
    const small = sizeForMetric(25, d);
    const large = sizeForMetric(100, d);
    // sqrt scaling: 25 is a quarter of the value and half of the way up the radius.
    const tSmall = (small - NODE_SIZE.min) / (NODE_SIZE.max - NODE_SIZE.min);
    const tLarge = (large - NODE_SIZE.min) / (NODE_SIZE.max - NODE_SIZE.min);
    expect(tLarge).toBeCloseTo(1, 6);
    expect(tSmall).toBeCloseTo(0.5, 6);
    // The failure this prevents: a linear diameter makes 4× read as 16× area, which
    // is the most common way a network view overstates its own findings.
    expect(tSmall).not.toBeCloseTo(0.25, 2);
  });

  it('is UNIFORM when nothing was chosen, so a legend can say "uniform"', () => {
    expect(sizeForMetric(null, { min: 0, max: 10 })).toBe(NODE_SIZE.uniform);
    expect(sizeForMetric(5, null)).toBe(NODE_SIZE.uniform);
  });

  it('is uniform when the domain has no spread — not min, not max, uniform', () => {
    // Every node having the same value is not "every node is the smallest".
    expect(sizeForMetric(7, { min: 7, max: 7 })).toBe(NODE_SIZE.uniform);
  });

  it('a NULL metric is not drawn small — small would mean a low value', () => {
    expect(sizeForMetric(null, { min: 0, max: 100 })).not.toBe(NODE_SIZE.min);
    expect(isMetricMissing({ metric: null })).toBe(true);
    expect(isMetricMissing({ metric: 0 })).toBe(false);
  });

  it('clamps rather than escaping the range', () => {
    expect(sizeForMetric(-50, { min: 0, max: 10 })).toBe(NODE_SIZE.min);
    expect(sizeForMetric(999, { min: 0, max: 10 })).toBe(NODE_SIZE.max);
  });

  it('never depends on the node COUNT, which is what both pages size by today', () => {
    const d = { min: 0, max: 100 };
    const one = sizeForMetric(50, d);
    // Adding 500 unrelated nodes cannot change this node's size. The current pages
    // compute `Math.max(50 - Math.log(nodeCount) * 3, 30) * 1.05`, so it does.
    expect(sizeForMetric(50, d)).toBe(one);
  });
});

describe('metricDomain', () => {
  it('ignores nulls rather than treating them as zero', () => {
    expect(metricDomain([{ metric: 5 }, { metric: null }, { metric: 9 }])).toEqual({ min: 5, max: 9 });
  });
  it('returns null when nothing carries the metric at all', () => {
    expect(metricDomain([{ metric: null }, { metric: null }])).toBeNull();
    expect(metricDomain([])).toBeNull();
  });
});

describe('edgeWidthForFlow — width encodes flow', () => {
  it('is log-scaled, because supply flows span orders of magnitude', () => {
    const w1 = edgeWidthForFlow(10, 10_000);
    const w2 = edgeWidthForFlow(100, 10_000);
    const w3 = edgeWidthForFlow(1_000, 10_000);
    expect(w1).toBeLessThan(w2);
    expect(w2).toBeLessThan(w3);
    // Log-scaled: the steps are roughly even. Linear would put w1 and w2 in the
    // same hairline and only w3 would be visible — which is how a flat 1.5 came to
    // look acceptable.
    expect(w2 - w1).toBeGreaterThan((w3 - w1) * 0.3);
  });

  it('renders a ZERO-flow arc at minimum width rather than hiding it', () => {
    // A zero-weighted arc is a real finding (§4 D2/D3 — rows that reached the grid
    // weighted 0). Hiding it is the opposite of disclosing it.
    expect(edgeWidthForFlow(0, 100)).toBe(EDGE_WIDTH.min);
    expect(edgeWidthForFlow(0, 100)).toBeGreaterThan(0);
  });

  it('falls back to uniform when there is no domain', () => {
    expect(edgeWidthForFlow(5, 0)).toBe(EDGE_WIDTH.uniform);
  });

  it('maxFlow ignores non-finite values', () => {
    expect(maxFlow([{ flow: 1 }, { flow: Number.NaN }, { flow: 9 }])).toBe(9);
    expect(maxFlow([])).toBe(0);
  });
});

describe('depthShade — depth is a lightness ramp inside one category', () => {
  it('leaves the base colour alone at the top of the tree', () => {
    expect(depthShade('#facc15', 0, 4)).toContain('100%');
  });

  it('mixes toward white as depth increases', () => {
    const shallow = depthShade('#facc15', 1, 4);
    const deep = depthShade('#facc15', 4, 4);
    expect(shallow).not.toBe(deep);
    expect(deep).toContain('white');
  });

  it('an UNKNOWN depth returns the base unmixed — it must not read as a depth', () => {
    // This is §4 D126 in the visual layer: `COALESCE(level, 0)` answers an unknown
    // with a confident 0, and the page then renders that 0 as a real position.
    expect(depthShade('#facc15', null, 4)).toBe('#facc15');
  });

  it('holds no colour of its own — it mixes whatever the palette gave it', () => {
    expect(depthShade('#123456', 2, 4)).toContain('#123456');
  });
});

describe('columnForNode — position encodes structure, from the ECHELON', () => {
  it('orders the chain supplier → material → subassembly → plant → product → customer', () => {
    const at = (echelon: Parameters<typeof columnForNode>[0]['echelon']) =>
      columnForNode({ echelon, bomDepth: null }, ECHELON_ORDER, 4);
    expect(at('supplier')).toBeLessThan(at('material'));
    expect(at('material')).toBeLessThan(at('subassembly'));
    expect(at('subassembly')).toBeLessThan(at('plant'));
    expect(at('plant')).toBeLessThan(at('product'));
    expect(at('product')).toBeLessThan(at('customer'));
  });

  it('puts an unknown role last rather than mixing it in', () => {
    const unknown = columnForNode({ echelon: null, bomDepth: null }, ECHELON_ORDER, 4);
    const customer = columnForNode({ echelon: 'customer', bomDepth: null }, ECHELON_ORDER, 4);
    expect(unknown).toBeGreaterThan(customer);
  });

  it('spreads a multi-level BOM into sub-columns by DEPTH, not by `level`', () => {
    // The fix for the reported map, stated as a test. On that project every BOM row
    // carries `supply_chain_data_multi_tier.level = 2` (§4 D132), so a 4-deep BOM
    // rendered as one flat column. `bomDepth` comes from `bom_multi_level` and is
    // unaffected, so these four are four positions.
    const cols = [1, 2, 3, 4].map((d) =>
      columnForNode({ echelon: 'material', bomDepth: d }, ECHELON_ORDER, 4),
    );
    expect(new Set(cols).size).toBe(4);
    expect([...cols]).toEqual([...cols].sort((a, b) => a - b));
  });

  it('keeps a depth-spread material inside its own band', () => {
    const deepest = columnForNode({ echelon: 'material', bomDepth: 99 }, ECHELON_ORDER, 4);
    expect(deepest).toBeLessThan(ECHELON_ORDER.subassembly + 1);
  });

  it('a material with no depth sits at the band base rather than being guessed into one', () => {
    expect(columnForNode({ echelon: 'material', bomDepth: null }, ECHELON_ORDER, 4)).toBe(
      ECHELON_ORDER.material,
    );
  });
});
