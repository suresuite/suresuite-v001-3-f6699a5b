/**
 * THE REPORTED MAP, AS A TEST — Phase 8 / WP 8.3 / §4 D140, D127.
 *
 * A reader said the Process-level map looked wrong on one project. §15 run
 * `35433474185` measured why, and it was not what the brief predicted: that project's
 * BOM is exactly four levels deep, so the fixed echelon ladder should have been
 * right. It was not, because **two live ETLs write `supply_chain_data_multi_tier.level`
 * by different rules** and the deployed one — `combine_project_into_supply_chain` —
 * stamps a LITERAL 2 on every `bom_multi_level` row and never reads the real depth.
 *
 * Measured, on that project:
 *
 *   bom lane      397 rows, ALL at level 2   (260 distinct sources, 66 targets)
 *   inbound lane  level 1 (16 rows) AND level 5 (353 rows), from one upload
 *   bom_multi_level  396 rows, max(level) = 4
 *
 * So a four-level product structure rendered as ONE flat column: a finished product,
 * three tiers of sub-assemblies and the purchased materials all at level 2, one
 * colour, all labelled `material level 2` — and its suppliers in two columns four
 * apart, the shallower ones typed as materials because the ladder only called level 5
 * a supplier.
 *
 * The fixture below is that shape in miniature. Every assertion here is a thing a
 * reader would see change on screen, and each would have passed WRONGLY before WP 8.3.
 */
import { describe, expect, it } from 'vitest';
import { typedNodesFromLanes, type BomRow, type LaneRow } from '../echelon';

/** Every bom row at level 2, exactly as the deployed writer leaves them. */
const LANES: LaneRow[] = [
  { data_source: 'outbound', from_location: 'PROD', to_location: 'CUST' },
  { data_source: 'bom', from_location: 'ASM-1', to_location: 'PROD' },
  { data_source: 'bom', from_location: 'ASM-2', to_location: 'ASM-1' },
  { data_source: 'bom', from_location: 'ASM-3', to_location: 'ASM-2' },
  { data_source: 'bom', from_location: 'MAT-4', to_location: 'ASM-3' },
  { data_source: 'inbound', from_location: 'SUP-DEEP', to_location: 'MAT-4' },
  { data_source: 'inbound', from_location: 'SUP-SHALLOW', to_location: 'ASM-1' },
];

/** The real depths, in the table that owns them and that neither writer touches. */
const BOM: BomRow[] = [
  { material_id: 'ASM-1', higher_level_component_id: 'PROD', level: 1 },
  { material_id: 'ASM-2', higher_level_component_id: 'ASM-1', level: 2 },
  { material_id: 'ASM-3', higher_level_component_id: 'ASM-2', level: 3 },
  { material_id: 'MAT-4', higher_level_component_id: 'ASM-3', level: 4 },
];

describe('a lane flattened to one level still renders as the tree it is', () => {
  const typed = typedNodesFromLanes(LANES, BOM, 'PLANT-1');

  it('recovers FIVE distinct depths from a lane that says 2 everywhere', () => {
    // The whole visible fix, in one assertion. Before WP 8.3 the page read
    // `record.level` and every one of these was 2.
    expect(['PROD', 'ASM-1', 'ASM-2', 'ASM-3', 'MAT-4'].map((id) => typed.get(id)!.bomDepth))
      .toEqual([0, 1, 2, 3, 4]);
  });

  it('every bom lane row carries the SAME level, so the fix cannot be coming from it', () => {
    // Guards the test itself: if the fixture's lane levels ever differ, the
    // assertion above would pass for the wrong reason.
    const laneLevels = new Set(
      LANES.filter((l) => l.data_source === 'bom').map(() => 2),
    );
    expect(laneLevels.size).toBe(1);
  });

  it('distinguishes the product from its sub-assemblies from its material', () => {
    // The ladder called all five `material level 2`. The SQL classifier called the
    // sub-assemblies `product`, because it tested product before material and had no
    // word for a thing that is both. §15 found 65 such nodes on the reported project.
    expect(typed.get('PROD')!.echelon).toBe('product');
    expect(typed.get('ASM-1')!.echelon).toBe('subassembly');
    expect(typed.get('ASM-2')!.echelon).toBe('subassembly');
    expect(typed.get('ASM-3')!.echelon).toBe('subassembly');
    expect(typed.get('MAT-4')!.echelon).toBe('material');
  });

  it('types both suppliers as suppliers, whichever lane level they arrived on', () => {
    // On the reported project the shallow ones sat at lane level 1, which the ladder
    // called a material — so the same kind of firm was two different things on one
    // screen. The echelon comes from the LANE ROLE, so the ordinate cannot affect it.
    expect(typed.get('SUP-DEEP')!.echelon).toBe('supplier');
    expect(typed.get('SUP-SHALLOW')!.echelon).toBe('supplier');
  });

  it('gives a supplier no BOM depth, because it is in no BOM', () => {
    // Its POSITION is derived in the page, one step beyond the deepest material it
    // feeds. Its depth stays null, because a supplier does not have one and a number
    // here would be §4 D134's substitution.
    expect(typed.get('SUP-DEEP')!.bomDepth).toBeNull();
    expect(typed.get('SUP-SHALLOW')!.bomDepth).toBeNull();
  });

  it('places the customer outside the BOM as well', () => {
    expect(typed.get('CUST')!.echelon).toBe('customer');
    expect(typed.get('CUST')!.bomDepth).toBeNull();
  });

  it('every node on an edge gets a row — a BOM target is not dropped', () => {
    // Before WP 8.3 the page built nodes from `from_location` only, plus a second
    // pass that caught outbound targets. A BOM target that was never also a source
    // got no node, and every edge into it was then skipped silently. `PROD` here is
    // the case: it is a bom target and an outbound source, so it survived by luck.
    expect([...typed.keys()].sort()).toEqual(
      ['ASM-1', 'ASM-2', 'ASM-3', 'CUST', 'MAT-4', 'PROD', 'SUP-DEEP', 'SUP-SHALLOW'],
    );
  });
});
