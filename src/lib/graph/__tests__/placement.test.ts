/**
 * F-09 (audit 2026-09-22) — the same node, typed the same way on every page.
 *
 * Reproduced on the shape the audit measured (§15 run 35433474185): the deployed ETL
 * stamps `level = 2` on every BOM lane row. The integer ladder
 * `/interactive-network-space` ran is kept below VERBATIM as a frozen witness, so the
 * disagreement is shown rather than described; the gate is that both pages now call
 * `placeLaneNodes` and neither declares a ladder of its own.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { echelonToLegacyType, placeLaneNodes, type PlacementLaneRow } from '../placement';
import type { BomRow } from '../echelon';

// Witness: the classifier F-09 names, copied from InteractiveNetworkSpace.tsx before
// its deletion. Not used by any page.
function ladder(level: number, dataSource: string): string {
  if (level === -1) return 'customer';
  if (level === 0) return 'product';
  if (level === 5 && dataSource === 'inbound') return 'supplier';
  if (level >= 1 && level <= 5) return 'material';
  if (level >= 6) return 'supplier';
  return 'material';
}

// P1 is a finished product built from SA (a sub-assembly) and M1; SA is built from M2.
// Every bom row carries the literal 2 the deployed ETL writes.
const lanes: PlacementLaneRow[] = [
  { from_location: 'P1', to_location: 'C1', data_source: 'outbound', level: 0 },
  { from_location: 'SA', to_location: 'P1', data_source: 'bom', level: 2 },
  { from_location: 'M1', to_location: 'P1', data_source: 'bom', level: 2 },
  { from_location: 'M2', to_location: 'SA', data_source: 'bom', level: 2 },
  { from_location: 'S1', to_location: 'M2', data_source: 'inbound', level: 2 },
  { from_location: 'S2', to_location: 'M1', data_source: 'inbound', level: 5 },
];
const bom: BomRow[] = [
  { material_id: 'SA', higher_level_component_id: 'P1', level: 1 },
  { material_id: 'M1', higher_level_component_id: 'P1', level: 1 },
  { material_id: 'M2', higher_level_component_id: 'SA', level: 2 },
];

describe('F-09 — one placement rule for every lane page', () => {
  const placed = placeLaneNodes(lanes, bom);

  it('reproduces the defect: the ladder calls the finished product a material', () => {
    // The first row naming P1 as a `from` is its outbound row (level 0) — but the
    // page's first pass read the FIRST row overall, and a bom row names P1 at level 2.
    expect(ladder(2, 'bom')).toBe('material');
    expect(placed.get('P1')!.echelon).toBe('product');
  });

  it('types every node from its lane roles, not from `level`', () => {
    const got = Object.fromEntries([...placed].map(([id, p]) => [id, p.echelon]));
    expect(got).toEqual({
      P1: 'product', C1: 'customer', SA: 'subassembly', M1: 'material',
      M2: 'material', S1: 'supplier', S2: 'supplier',
    });
  });

  it('places by BOM depth, customers at -1, suppliers one beyond what they feed', () => {
    const lvl = (id: string) => placed.get(id)!.level;
    expect([lvl('C1'), lvl('P1'), lvl('SA'), lvl('M1'), lvl('M2')]).toEqual([-1, 0, 1, 1, 2]);
    expect(lvl('S1')).toBe(3); // feeds M2 at depth 2
    expect(lvl('S2')).toBe(2); // feeds M1 at depth 1 — NOT the lane's 5
  });

  it('never invents a depth outside the BOM (§4 D134)', () => {
    expect(placed.get('C1')!.bomDepth).toBeNull();
    expect(placed.get('S1')!.bomDepth).toBeNull();
  });

  it('with no BOM rows, depth is unknown and a BOM node keeps its lane ordinate', () => {
    const bare = placeLaneNodes(lanes);
    expect(bare.get('SA')!.bomDepth).toBeNull();
    expect(bare.get('SA')!.echelon).toBe('subassembly');
  });

  it('the legacy vocabulary is a mapping over the echelon', () => {
    expect(echelonToLegacyType('subassembly')).toBe('material');
    expect(echelonToLegacyType('product')).toBe('product');
    expect(echelonToLegacyType('unknown')).toBe('material');
  });

  it.each(['src/pages/InteractiveNetworkSpace.tsx', 'src/pages/ProcessLevelNetwork.tsx'])(
    '%s places nodes through `placeLaneNodes` and reads no ladder',
    (path) => {
      const src = readFileSync(path, 'utf8');
      expect(src).toMatch(/\bplaceLaneNodes\(/);
      expect(src).not.toMatch(/function\s+getNodeTypeFromLevel\b/);
      expect(src).not.toMatch(/function\s+echelonToLegacyType\b/);
    },
  );
});
