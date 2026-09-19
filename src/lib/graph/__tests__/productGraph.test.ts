/**
 * The product view is FOUR echelons, and the quantities survive the collapse.
 * Phase 8 / WP 8.4.
 *
 * Supplier → purchased Material → finished Product → Customer. Everything the plant
 * builds in between is collapsed away, and the material→product edge carries the
 * demand propagated down the whole BOM rather than one hop of it.
 */
import { describe, expect, it } from 'vitest';
import { buildProductLevelGraph, type FlatLaneRow } from '../productGraph';

/**
 * A 3-deep BOM with one purchased material at the bottom.
 *
 *   SUP -> MAT           (inbound, 100 units delivered)
 *   MAT -> ASM-2 -> ASM-1 -> PROD     (bom: 2 × 3 × 4 = 24 MAT per PROD)
 *   PROD -> CUST         (outbound, demand 10)
 *
 * So PROD's demand of 10 needs 240 MAT. A view that drew one BOM hop would have said
 * 2, or 20, depending on which hop it picked.
 */
const CHAIN: FlatLaneRow[] = [
  { data_source: 'inbound', from_location: 'SUP', to_location: 'MAT', weighted: 100 },
  { data_source: 'bom', from_location: 'MAT', to_location: 'ASM-2', material_consumption_rate: 2 },
  { data_source: 'bom', from_location: 'ASM-2', to_location: 'ASM-1', material_consumption_rate: 3 },
  { data_source: 'bom', from_location: 'ASM-1', to_location: 'PROD', material_consumption_rate: 4 },
  { data_source: 'outbound', from_location: 'PROD', to_location: 'CUST', weighted: 10 },
];

describe('buildProductLevelGraph — the four echelons', () => {
  const g = buildProductLevelGraph(CHAIN);

  it('draws exactly four kinds of node', () => {
    expect([...g.nodes.entries()].map(([k, v]) => `${k}:${v.echelon}`).sort()).toEqual([
      'CUST:customer', 'MAT:material', 'PROD:product', 'SUP:supplier',
    ]);
  });

  it('the sub-assemblies are NOT nodes — that is the abstraction', () => {
    expect(g.nodes.has('ASM-1')).toBe(false);
    expect(g.nodes.has('ASM-2')).toBe(false);
    expect(g.collapsedIntermediates).toBe(2);
  });

  it('connects the purchased material STRAIGHT to the finished product', () => {
    const bom = g.edges.filter((e) => e.lane === 'bom');
    expect(bom).toHaveLength(1);
    expect([bom[0].source, bom[0].target]).toEqual(['MAT', 'PROD']);
  });

  it('propagates the demand through every hop — 10 × 2 × 3 × 4 = 240', () => {
    // The whole point of "the edges logic considered appropriately". One hop would
    // have given 20 (10 × 2); the deployed ETL gives `outbound_total × that row's own
    // rate`, which is also one hop.
    expect(g.edges.find((e) => e.lane === 'bom')!.flow).toBe(240);
  });

  it('keeps the inbound and outbound flows as uploaded', () => {
    expect(g.edges.find((e) => e.lane === 'inbound')!.flow).toBe(100);
    expect(g.edges.find((e) => e.lane === 'outbound')!.flow).toBe(10);
  });

  it('draws the chain in one direction, supplier to customer', () => {
    expect(g.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      'MAT->PROD', 'PROD->CUST', 'SUP->MAT',
    ]);
  });
});

describe('a material reached by two paths', () => {
  // MAT goes into PROD twice: directly (rate 5) and through ASM (rate 2 × 3 = 6).
  // It is needed for both, so the requirement SUMS to 11 per unit.
  const g = buildProductLevelGraph([
    { data_source: 'inbound', from_location: 'SUP', to_location: 'MAT', weighted: 1 },
    { data_source: 'bom', from_location: 'MAT', to_location: 'PROD', material_consumption_rate: 5 },
    { data_source: 'bom', from_location: 'MAT', to_location: 'ASM', material_consumption_rate: 2 },
    { data_source: 'bom', from_location: 'ASM', to_location: 'PROD', material_consumption_rate: 3 },
    { data_source: 'outbound', from_location: 'PROD', to_location: 'CUST', weighted: 100 },
  ]);

  it('sums the paths rather than drawing two edges or keeping one', () => {
    const bom = g.edges.filter((e) => e.lane === 'bom');
    expect(bom).toHaveLength(1);
    expect(bom[0].flow).toBe(1100); // 100 × (5 + 2×3)
  });
});

describe('a material feeding two different products', () => {
  const g = buildProductLevelGraph([
    { data_source: 'inbound', from_location: 'SUP', to_location: 'MAT', weighted: 1 },
    { data_source: 'bom', from_location: 'MAT', to_location: 'P1', material_consumption_rate: 2 },
    { data_source: 'bom', from_location: 'MAT', to_location: 'P2', material_consumption_rate: 5 },
    { data_source: 'outbound', from_location: 'P1', to_location: 'C', weighted: 10 },
    { data_source: 'outbound', from_location: 'P2', to_location: 'C', weighted: 3 },
  ]);

  it('draws one edge per product, each with its own product’s demand', () => {
    const bom = g.edges.filter((e) => e.lane === 'bom').sort((a, b) => a.target.localeCompare(b.target));
    expect(bom.map((e) => [e.target, e.flow])).toEqual([['P1', 20], ['P2', 15]]);
  });
});

describe('what it refuses to invent', () => {
  it('a purchased material that reaches no product is REPORTED, not dropped silently', () => {
    const g = buildProductLevelGraph([
      { data_source: 'inbound', from_location: 'SUP', to_location: 'ORPHAN', weighted: 5 },
      { data_source: 'outbound', from_location: 'PROD', to_location: 'CUST', weighted: 1 },
    ]);
    expect(g.unreachedMaterials).toEqual(['ORPHAN']);
    // It is still a node with its supplier edge — the user can see it and see that it
    // connects to nothing, which is the finding. Hiding it would hide the finding.
    expect(g.nodes.get('ORPHAN')?.echelon).toBe('material');
    expect(g.edges.some((e) => e.target === 'ORPHAN')).toBe(true);
  });

  it('survives a BOM cycle instead of hanging the page', () => {
    const g = buildProductLevelGraph([
      { data_source: 'inbound', from_location: 'S', to_location: 'M', weighted: 1 },
      { data_source: 'bom', from_location: 'M', to_location: 'A', material_consumption_rate: 2 },
      { data_source: 'bom', from_location: 'A', to_location: 'B', material_consumption_rate: 2 },
      { data_source: 'bom', from_location: 'B', to_location: 'A', material_consumption_rate: 2 },
      { data_source: 'bom', from_location: 'A', to_location: 'P', material_consumption_rate: 1 },
      { data_source: 'outbound', from_location: 'P', to_location: 'C', weighted: 1 },
    ]);
    expect(g.nodes.has('P')).toBe(true);
    expect(g.edges.some((e) => e.source === 'M' && e.target === 'P')).toBe(true);
  });

  it('ignores blank endpoints rather than creating a node for them', () => {
    const g = buildProductLevelGraph([
      { data_source: 'bom', from_location: 'X', to_location: '' },
      { data_source: 'bom', from_location: '  ', to_location: 'Y' },
    ]);
    expect(g.nodes.size).toBe(0);
  });

  it('a node that is both purchased AND built is a material here, and still collapses through', () => {
    // A plant can buy a sub-assembly AND make it. Both are true, so it appears as a
    // material (a supplier delivers it) and the walk still descends through it to
    // reach the materials underneath.
    const g = buildProductLevelGraph([
      { data_source: 'inbound', from_location: 'S1', to_location: 'ASM', weighted: 1 },
      { data_source: 'inbound', from_location: 'S2', to_location: 'RAW', weighted: 1 },
      { data_source: 'bom', from_location: 'RAW', to_location: 'ASM', material_consumption_rate: 2 },
      { data_source: 'bom', from_location: 'ASM', to_location: 'P', material_consumption_rate: 3 },
      { data_source: 'outbound', from_location: 'P', to_location: 'C', weighted: 10 },
    ]);
    expect(g.nodes.get('ASM')?.echelon).toBe('material');
    const bom = g.edges.filter((e) => e.lane === 'bom').sort((a, b) => a.source.localeCompare(b.source));
    expect(bom.map((e) => [e.source, e.flow])).toEqual([['ASM', 30], ['RAW', 60]]);
  });

  it('an empty project yields an empty graph, not a crash', () => {
    const g = buildProductLevelGraph([]);
    expect(g.nodes.size).toBe(0);
    expect(g.edges).toEqual([]);
    expect(g.unreachedMaterials).toEqual([]);
  });
});
