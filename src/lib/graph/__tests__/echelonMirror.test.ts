/**
 * THE MIRROR CANNOT DRIFT FROM THE AUTHORITY — Phase 8 / WP 8.3 / §4 D127.
 *
 * `src/lib/graph/echelon.ts` implements the same rule as
 * `public.classify_node_echelon`, because a page cannot call a plpgsql function on
 * rows it holds in memory and the column that function fills is not in production
 * until this work merges.
 *
 * A restated rule is exactly the defect D127 is about, so the restatement is GATED
 * rather than trusted: this file reads the branch order out of the migration itself
 * and fails if the TypeScript order differs. The precedent is
 * `ingest_normalize_at_promotion()` — SQL restating the generated unit module
 * "because SQL cannot import" it — pinned the same way by `ingestSpecParity.test.ts`.
 *
 * MUTATIONS THAT MUST MAKE THIS FILE FAIL:
 *   * swap two branches in `echelonFor` → the order comparison goes red.
 *   * add a branch to the SQL without adding it here → the same.
 *   * make `subassembly` resolve to `product` → the behaviour test goes red.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ECHELON_PRIORITY, typedNodesFromLanes, type BomRow, type LaneRow } from '../echelon';
import { ECHELONS } from '../types';

const MIGRATION = 'supabase/migrations/20260920000001_one_node_classifier.sql';

/** The `RETURN '<echelon>'` sequence inside `classify_node_echelon`'s body. */
function sqlBranchOrder(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.classify_node_echelon');
  expect(start, `${MIGRATION} no longer defines classify_node_echelon`).toBeGreaterThan(-1);
  const end = sql.indexOf('$function$;', start);
  const body = sql.slice(start, end);
  // Skip the guard's early `RETURN 'unknown'` for a blank id — it is an input check,
  // not a branch of the priority order.
  const guard = body.indexOf('IF p_node_id IS NULL');
  const afterGuard = body.slice(body.indexOf('END IF;', guard));
  return [...afterGuard.matchAll(/RETURN\s+'([a-z]+)'/g)].map((m) => m[1]);
}

describe('the client mirror matches classify_node_echelon', () => {
  it('resolves the same branches, in the same order', () => {
    expect(
      [...ECHELON_PRIORITY],
      'the TypeScript priority order and the SQL function disagree. A node\'s echelon is ' +
        'authored ONCE (§4 D127) — change the migration and this array together, or the ' +
        'page and the database will type the same node differently, which is the defect ' +
        'this whole phase exists to end.',
    ).toEqual(sqlBranchOrder());
  });

  it('the SQL branch order is actually parsed, not assumed', () => {
    // A gate whose parser silently returns [] passes against an empty array too.
    const order = sqlBranchOrder();
    expect(order.length).toBeGreaterThan(5);
    expect(order).toContain('subassembly');
    expect(new Set(order).size).toBeLessThan(order.length); // customer/supplier appear twice
  });

  it('every value it can return is in the CHECK-constrained vocabulary', () => {
    for (const e of ECHELON_PRIORITY) expect(ECHELONS).toContain(e);
  });
});

// The fixture is the shape §15 measured on the reported project, in miniature: a
// 4-deep BOM whose lane rows all carry level 2, a sub-assembly, and a supplier whose
// material is absent from the BOM.
const LANES: LaneRow[] = [
  { data_source: 'outbound', from_location: 'PROD', to_location: 'CUST' },
  { data_source: 'bom', from_location: 'SUBASM', to_location: 'PROD' },
  { data_source: 'bom', from_location: 'RAW', to_location: 'SUBASM' },
  { data_source: 'bom', from_location: 'DEEP', to_location: 'RAW' },
  { data_source: 'inbound', from_location: 'SUP1', to_location: 'RAW' },
  { data_source: 'inbound', from_location: 'SUP2', to_location: 'LOOSE' },
  { data_source: 'inbound', from_location: 'DUAL', to_location: 'RAW' },
  { data_source: 'bom', from_location: 'DUAL', to_location: 'PROD' },
  { data_source: 'bom', from_location: '  ', to_location: '' },
];

const BOM: BomRow[] = [
  { material_id: 'SUBASM', higher_level_component_id: 'PROD', level: 1 },
  { material_id: 'RAW', higher_level_component_id: 'SUBASM', level: 2 },
  { material_id: 'DEEP', higher_level_component_id: 'RAW', level: 3 },
  { material_id: 'DUAL', higher_level_component_id: 'PROD', level: 1 },
];

describe('typedNodesFromLanes', () => {
  const typed = typedNodesFromLanes(LANES, BOM, 'PLANT-1');

  it('types a customer, a product, a supplier and a material from the LANES', () => {
    expect(typed.get('CUST')?.echelon).toBe('customer');
    expect(typed.get('PROD')?.echelon).toBe('product');
    expect(typed.get('SUP1')?.echelon).toBe('supplier');
    expect(typed.get('LOOSE')?.echelon).toBe('material');
  });

  it('types a SUB-ASSEMBLY, which no page classifier could express', () => {
    expect(typed.get('SUBASM')?.echelon).toBe('subassembly');
  });

  it('a node that is both an inbound source and a BOM source is not "whichever row was last"', () => {
    // `DUAL` supplies RAW and is itself consumed into PROD, so it is a BOM SOURCE and
    // not a BOM target — `material`, by the rule's own order, which is what the SQL
    // answers too. The point of this test is the SECOND assertion: it resolves the
    // same way whichever order the rows arrive in.
    //
    // That is the one property the eight render-time classifiers lack. §4 D127:
    // `buildGroupClassification` assigns by lane, LAST WRITE WINS, so this node is
    // group A or B depending on row order; `ProcessLevelNetwork`'s override calls it
    // `supplier`; the SQL calls it `material`; `MapView` drops it.
    const a = typedNodesFromLanes(LANES, BOM).get('DUAL')?.echelon;
    const b = typedNodesFromLanes([...LANES].reverse(), BOM).get('DUAL')?.echelon;
    expect(a).toBe(b);
    expect(a).toBe('material');
  });

  it('reads DEPTH from bom_multi_level, so a flattened lane `level` cannot reach it', () => {
    // This is the fix for the reported map. Every lane row above could say `level: 2`
    // and these four depths would be unchanged (§4 D140).
    expect(typed.get('PROD')?.bomDepth).toBe(0);   // parent of a level-1 row
    expect(typed.get('SUBASM')?.bomDepth).toBe(1);
    expect(typed.get('RAW')?.bomDepth).toBe(2);
    expect(typed.get('DEEP')?.bomDepth).toBe(3);
    expect(new Set([0, 1, 2, 3])).toEqual(
      new Set(['PROD', 'SUBASM', 'RAW', 'DEEP'].map((id) => typed.get(id)!.bomDepth)),
    );
  });

  it('a node in no BOM has depth null — not 0, which would be §4 D134 again', () => {
    expect(typed.get('SUP1')?.bomDepth).toBeNull();
    expect(typed.get('CUST')?.bomDepth).toBeNull();
    expect(typed.get('LOOSE')?.bomDepth).toBeNull();
  });

  it('no BOM rows at all means every depth is unknown, not zero', () => {
    const t = typedNodesFromLanes(LANES, []);
    for (const v of t.values()) expect(v.bomDepth).toBeNull();
  });

  it('takes the SHALLOWEST depth when a material is used at two depths', () => {
    // `RAW`, because the map is keyed on nodes the LANES contain: a node that exists
    // only in `bom_multi_level` is not part of the graph a page draws, and inventing a
    // row for it would put a node on screen no edge reaches.
    const t = typedNodesFromLanes(LANES, [
      { material_id: 'RAW', higher_level_component_id: 'A', level: 4 },
      { material_id: 'RAW', higher_level_component_id: 'B', level: 2 },
    ]);
    expect(t.get('RAW')?.bomDepth).toBe(2);
  });

  it('a node that exists only in the BOM gets no row — it is on no edge', () => {
    const t = typedNodesFromLanes(LANES, [
      { material_id: 'BOM-ONLY', higher_level_component_id: 'PROD', level: 1 },
    ]);
    expect(t.has('BOM-ONLY')).toBe(false);
  });

  it('ignores blank and whitespace-only ids rather than creating a node for them', () => {
    expect(typed.has('')).toBe(false);
    expect(typed.has('  ')).toBe(false);
  });

  it('names the plant when it is told which one it is, and guesses otherwise never', () => {
    const withPlant = typedNodesFromLanes(
      [...LANES, { data_source: 'other', from_location: 'PLANT-1', to_location: null }],
      BOM,
      'PLANT-1',
    );
    expect(withPlant.get('PLANT-1')?.echelon).toBe('plant');
    const without = typedNodesFromLanes(
      [...LANES, { data_source: 'other', from_location: 'PLANT-1', to_location: null }],
      BOM,
    );
    expect(without.get('PLANT-1')?.echelon).toBe('unknown');
  });

  it('an unrecognised lane leaves a node UNKNOWN rather than defaulting it to supplier', () => {
    // `ProductLevelNetwork` defaults an unrecognised group to Supplier today. That is
    // a value displayed for data that does not carry it (T1).
    const t = typedNodesFromLanes([{ data_source: 'mystery', from_location: 'Z', to_location: 'Y' }]);
    expect(t.get('Z')?.echelon).toBe('unknown');
    expect(t.get('Y')?.echelon).toBe('unknown');
  });
});
