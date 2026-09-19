/**
 * The role-aware focus walk — WP 8.3.
 *
 * Extracted from `ProductLevelNetwork`'s double-click handler and generalised from
 * four hardcoded groups to the echelon, so it works for `subassembly` (which the
 * four-group version could not express) and to any BOM depth (which four fixed sets
 * could not reach).
 */
import { describe, expect, it } from 'vitest';
import { focusSubgraphIds, type FocusEdge, type FocusNode } from '../focus';

// supplier → material → subassembly → product → customer, plus a second branch and
// a node whose role the data does not carry.
const NODES: FocusNode[] = [
  { id: 'SUP-1', echelon: 'supplier' },
  { id: 'SUP-2', echelon: 'supplier' },
  { id: 'MAT-1', echelon: 'material' },
  { id: 'MAT-2', echelon: 'material' },
  { id: 'SUBASM', echelon: 'subassembly' },
  { id: 'PROD-1', echelon: 'product' },
  { id: 'PROD-2', echelon: 'product' },
  { id: 'CUST-1', echelon: 'customer' },
  { id: 'CUST-2', echelon: 'customer' },
  { id: 'MYSTERY', echelon: null },
  { id: 'UNPLACED', echelon: 'unknown' },
];

const EDGES: FocusEdge[] = [
  { source: 'SUP-1', target: 'MAT-1' },
  { source: 'SUP-2', target: 'MAT-2' },
  { source: 'MAT-1', target: 'SUBASM' },
  { source: 'MAT-2', target: 'PROD-2' },
  { source: 'SUBASM', target: 'PROD-1' },
  { source: 'PROD-1', target: 'CUST-1' },
  { source: 'PROD-2', target: 'CUST-2' },
  { source: 'MYSTERY', target: 'MAT-1' },
  { source: 'UNPLACED', target: 'MAT-1' },
];

const ids = (s: Set<string>) => [...s].sort();

describe('focusSubgraphIds', () => {
  it('a SUPPLIER expands forward to its materials, their assemblies, products and customers', () => {
    expect(ids(focusSubgraphIds(NODES, EDGES, 'SUP-1'))).toEqual([
      'CUST-1',
      'MAT-1',
      'PROD-1',
      'SUBASM',
      'SUP-1',
    ]);
  });

  it('a CUSTOMER expands backward, and only along its own branch', () => {
    expect(ids(focusSubgraphIds(NODES, EDGES, 'CUST-2'))).toEqual(['CUST-2', 'MAT-2', 'PROD-2', 'SUP-2']);
  });

  it('a SUB-ASSEMBLY expands both ways — the case four hardcoded groups could not express', () => {
    expect(ids(focusSubgraphIds(NODES, EDGES, 'SUBASM'))).toEqual([
      'CUST-1',
      'MAT-1',
      'PROD-1',
      'SUBASM',
      'SUP-1',
    ]);
  });

  it('does not drag in siblings — it is a path, not a flood fill', () => {
    const reached = focusSubgraphIds(NODES, EDGES, 'SUP-1');
    expect(reached.has('SUP-2')).toBe(false);
    expect(reached.has('MAT-2')).toBe(false);
    expect(reached.has('CUST-2')).toBe(false);
  });

  it('never follows a node whose role the data does not carry', () => {
    // `MYSTERY` and `UNPLACED` both point at MAT-1. Walking up from MAT-1 must not
    // extend the path through them, because that would claim a position in the
    // chain that nothing states (T1).
    const reached = focusSubgraphIds(NODES, EDGES, 'MAT-1');
    expect(reached.has('MYSTERY')).toBe(false);
    expect(reached.has('UNPLACED')).toBe(false);
    expect(reached.has('SUP-1')).toBe(true);
  });

  it('focusing an UNKNOWN node returns just that node — a walk needs a direction', () => {
    expect(ids(focusSubgraphIds(NODES, EDGES, 'MYSTERY'))).toEqual(['MYSTERY']);
    expect(ids(focusSubgraphIds(NODES, EDGES, 'UNPLACED'))).toEqual(['UNPLACED']);
  });

  it('a focus id that is not in the graph returns itself and does not throw', () => {
    expect(ids(focusSubgraphIds(NODES, EDGES, 'NOPE'))).toEqual(['NOPE']);
  });

  it('follows a BOM of ANY depth — four fixed sets could reach exactly four steps', () => {
    const deep: FocusNode[] = [
      { id: 'S', echelon: 'supplier' },
      { id: 'M', echelon: 'material' },
      { id: 'A1', echelon: 'subassembly' },
      { id: 'A2', echelon: 'subassembly' },
      { id: 'A3', echelon: 'subassembly' },
      { id: 'P', echelon: 'product' },
      { id: 'C', echelon: 'customer' },
    ];
    // Three nested sub-assemblies: the same echelon, so the walk does NOT chain
    // through them (each step must ADVANCE along the chain). That is a real limit
    // and it is asserted rather than hidden — nesting inside one echelon needs
    // `bom_depth`, which is WP 8.4's when the page offers a depth-aware focus.
    const chain: FocusEdge[] = [
      { source: 'S', target: 'M' },
      { source: 'M', target: 'A1' },
      { source: 'A1', target: 'A2' },
      { source: 'A2', target: 'A3' },
      { source: 'A3', target: 'P' },
      { source: 'P', target: 'C' },
    ];
    expect(ids(focusSubgraphIds(deep, chain, 'S'))).toEqual(['A1', 'M', 'S']);
  });

  it('is symmetric: focusing either end of a path reaches the same path', () => {
    const fromSupplier = focusSubgraphIds(NODES, EDGES, 'SUP-2');
    const fromCustomer = focusSubgraphIds(NODES, EDGES, 'CUST-2');
    expect(ids(fromSupplier)).toEqual(ids(fromCustomer));
  });
});
