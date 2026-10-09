/**
 * One drawn edge per lane pair, its weight summed — §4 D306.
 *
 * Both network pages draw `sumLaneEdges`. The deep lane writes a BOM edge once per ROOT
 * product it serves, and both pages used to keep the first row and drop the rest.
 */
import { describe, expect, it } from 'vitest';
import { flowLabel, sumLaneEdges, type LaneEdgeRow } from '../laneEdges';

/** ASM goes into two finished products, so the deep lane holds MAT → ASM twice. */
const SHARED: LaneEdgeRow[] = [
  { plant_name: 'P', data_source: 'bom', from_location: 'MAT', to_location: 'ASM', material_consumption_rate: 2, weighted: 20 },
  { plant_name: 'P', data_source: 'bom', from_location: 'MAT', to_location: 'ASM', material_consumption_rate: 2, weighted: 6 },
  { plant_name: 'P', data_source: 'bom', from_location: 'ASM', to_location: 'P1', material_consumption_rate: 1, weighted: 10 },
  { plant_name: 'P', data_source: 'bom', from_location: 'ASM', to_location: 'P2', material_consumption_rate: 1, weighted: 3 },
];

describe('sumLaneEdges', () => {
  it('sums the rows of one pair — the edge carries every root product’s share', () => {
    const e = sumLaneEdges(SHARED).find((x) => x.source === 'MAT' && x.target === 'ASM')!;
    expect(e.flow).toBe(26);
    expect(e.rows).toBe(2);
  });

  it('does not depend on which row arrives first', () => {
    const forward = sumLaneEdges(SHARED).map((e) => [e.source, e.target, e.flow]).sort();
    const backward = sumLaneEdges([...SHARED].reverse()).map((e) => [e.source, e.target, e.flow]).sort();
    expect(backward).toEqual(forward);
  });

  it('counts a consumption rate once per plant, not once per root product', () => {
    // The rate is a property of the BOM edge; two roots in one plant repeat it.
    const e = sumLaneEdges(SHARED).find((x) => x.source === 'MAT' && x.target === 'ASM')!;
    expect(e.consumptionRate).toBe(2);
    const twoPlants = sumLaneEdges([
      { plant_name: 'A', data_source: 'inbound', from_location: 'S', to_location: 'M', material_consumption_rate: 7, weighted: 7 },
      { plant_name: 'B', data_source: 'inbound', from_location: 'S', to_location: 'M', material_consumption_rate: 3, weighted: 3 },
    ]);
    expect(twoPlants).toEqual([
      { source: 'S', target: 'M', flow: 10, consumptionRate: 10, lane: 'inbound', rows: 2 },
    ]);
  });

  it('trims ids, and skips blank endpoints and self-loops', () => {
    const edges = sumLaneEdges([
      { from_location: ' A ', to_location: 'B', weighted: 1 },
      { from_location: 'A', to_location: 'B ', weighted: 2 },
      { from_location: '', to_location: 'B', weighted: 5 },
      { from_location: 'C', to_location: 'C', weighted: 5 },
      { from_location: 'D', to_location: null, weighted: 5 },
    ]);
    expect(edges.map((e) => [e.source, e.target, e.flow])).toEqual([['A', 'B', 3]]);
  });

  it('a missing or non-finite weight adds nothing', () => {
    const [e] = sumLaneEdges([
      { from_location: 'A', to_location: 'B', weighted: null },
      { from_location: 'A', to_location: 'B', weighted: Number.NaN },
      { from_location: 'A', to_location: 'B', weighted: 4 },
    ]);
    expect(e.flow).toBe(4);
  });
});

describe('flowLabel', () => {
  it('rounds and groups thousands', () => {
    expect(flowLabel(1234.6)).toBe('1,235');
    expect(flowLabel(7)).toBe('7');
  });

  it('is blank for no flow, and says <1 rather than 0 for a small one', () => {
    expect(flowLabel(0)).toBe('');
    expect(flowLabel(-3)).toBe('');
    expect(flowLabel(Number.NaN)).toBe('');
    expect(flowLabel(0.2)).toBe('<1');
  });
});
