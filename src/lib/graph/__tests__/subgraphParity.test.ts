/**
 * The extraction is FAITHFUL — Phase 8 / WP 8.3.
 *
 * `src/lib/graph/subgraph.ts` was lifted out of `InteractiveNetworkSpace.tsx`, a
 * page that is in no menu and reachable only by URL. Nobody would notice if the
 * extraction changed its behaviour, which is exactly why it has to be proved.
 *
 * So the ORIGINAL implementation is reproduced verbatim below, from the page as it
 * stood at WP 8.3, and every case runs through both. A difference fails.
 *
 * It is a deliberate duplicate and it is the one place in this repository where
 * that is right: the copy is not a source of truth a reader might follow, it is a
 * FROZEN WITNESS. `single-source` (I1) is about a fact authored twice; this is a
 * measurement of one implementation against a recording of another.
 */
import { describe, expect, it } from 'vitest';
import { extractSubgraph, parseAdvancedQuery, DEFAULT_QUERY, type QueryParams } from '../subgraph';

// ─────────────────────────────────────────── the frozen witness, verbatim
//
// From `src/pages/InteractiveNetworkSpace.tsx` lines 206-329 as of WP 8.3,
// retyped against plain objects instead of React Flow's `Node`/`Edge` so it can
// run without a renderer. Only the field ACCESS changed (`node.data.label` →
// `node.label`, `edge.data.flowVolume` → `edge.flow`); no control flow did.

interface WitnessNode { id: string; label: string; level: number }
interface WitnessEdge { source: string; target: string; flow: number }

function originalExtractSubgraph(
  allNodes: WitnessNode[],
  allEdges: WitnessEdge[],
  queryParams: QueryParams,
): { nodes: WitnessNode[]; edges: WitnessEdge[] } {
  if (!queryParams.searchTerm) {
    return { nodes: allNodes, edges: allEdges };
  }

  const rootNodes = allNodes.filter((node) =>
    node.label?.toLowerCase().includes(queryParams.searchTerm.toLowerCase()),
  );

  if (rootNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const resultNodeIds = new Set<string>();

  const upstreamMap = new Map<string, string[]>();
  const downstreamMap = new Map<string, string[]>();

  allEdges.forEach((edge) => {
    if (!downstreamMap.has(edge.source)) downstreamMap.set(edge.source, []);
    if (!upstreamMap.has(edge.target)) upstreamMap.set(edge.target, []);
    downstreamMap.get(edge.source)!.push(edge.target);
    upstreamMap.get(edge.target)!.push(edge.source);
  });

  const traverse = (startNodeIds: string[], direction: 'up' | 'down', _maxHops: number) => {
    const queue: { nodeId: string; hops: number }[] = startNodeIds.map((id) => ({ nodeId: id, hops: 0 }));
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { nodeId, hops } = queue.shift()!;

      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      resultNodeIds.add(nodeId);

      const currentNode = allNodes.find((n) => n.id === nodeId);
      if (!currentNode) continue;

      const currentLevel = currentNode.level;
      if (direction === 'up' && queryParams.stopUp.includes(currentLevel)) {
        if (queryParams.includeTerminals) continue;
      }
      if (direction === 'down' && queryParams.stopDown.includes(currentLevel)) {
        if (queryParams.includeTerminals) continue;
      }

      if (queryParams.hops !== 'infinity' && hops >= queryParams.hops) continue;

      const neighbors = direction === 'up' ? upstreamMap.get(nodeId) || [] : downstreamMap.get(nodeId) || [];

      neighbors.forEach((neighborId) => {
        if (!visited.has(neighborId)) {
          const edge = allEdges.find(
            (e) =>
              (direction === 'up' && e.source === neighborId && e.target === nodeId) ||
              (direction === 'down' && e.source === nodeId && e.target === neighborId),
          );

          if (edge && queryParams.minFlow > 0) {
            const flowVolume = edge.flow || 0;
            if (flowVolume < queryParams.minFlow) return;
          }

          queue.push({ nodeId: neighborId, hops: hops + 1 });
        }
      });
    }
  };

  const rootNodeIds = rootNodes.map((n) => n.id);
  rootNodeIds.forEach((id) => resultNodeIds.add(id));

  if (queryParams.dir === 'both' || queryParams.dir === 'up') {
    traverse(rootNodeIds, 'up', queryParams.hops === 'infinity' ? 100 : (queryParams.hops as number));
  }
  if (queryParams.dir === 'both' || queryParams.dir === 'down') {
    traverse(rootNodeIds, 'down', queryParams.hops === 'infinity' ? 100 : (queryParams.hops as number));
  }

  const filteredNodes = allNodes.filter((node) => {
    if (!resultNodeIds.has(node.id)) return false;
    if (queryParams.levelRange) {
      const level = node.level;
      if (level < queryParams.levelRange.min || level > queryParams.levelRange.max) return false;
    }
    return true;
  });

  const filteredEdges = allEdges.filter(
    (edge) => resultNodeIds.has(edge.source) && resultNodeIds.has(edge.target),
  );

  return { nodes: filteredNodes, edges: filteredEdges };
}

// ─────────────────────────────────────────── the fixture graph
//
// A four-level BOM with a sub-assembly, two suppliers on one material, a
// zero-flow arc and a node that is both an inbound source and a BOM source — i.e.
// the shape §15 found on the project a user reported, in miniature.

const NODES: WitnessNode[] = [
  { id: 'CUST-1', label: 'CUST-1', level: -1 },
  { id: 'CUST-2', label: 'CUST-2', level: -1 },
  { id: 'PROD-1', label: 'PROD-1', level: 0 },
  { id: 'SUBASM', label: 'SUBASM-A', level: 1 },
  { id: 'MAT-1', label: 'MAT-1', level: 2 },
  { id: 'MAT-2', label: 'MAT-2', level: 3 },
  { id: 'MAT-3', label: 'MAT-3', level: 4 },
  { id: 'SUP-1', label: 'SUP-1', level: 5 },
  { id: 'SUP-2', label: 'SUP-2', level: 5 },
  { id: 'SUP-3', label: 'SUP-3', level: 6 },
  { id: 'DUAL', label: 'DUAL-ROLE', level: 5 },
  { id: 'ORPHAN', label: 'ORPHAN', level: 2 },
];

const EDGES: WitnessEdge[] = [
  { source: 'PROD-1', target: 'CUST-1', flow: 100 },
  { source: 'PROD-1', target: 'CUST-2', flow: 5 },
  { source: 'SUBASM', target: 'PROD-1', flow: 80 },
  { source: 'MAT-1', target: 'SUBASM', flow: 60 },
  { source: 'MAT-2', target: 'MAT-1', flow: 40 },
  { source: 'MAT-3', target: 'MAT-2', flow: 0 },
  { source: 'SUP-1', target: 'MAT-3', flow: 30 },
  { source: 'SUP-2', target: 'MAT-3', flow: 2 },
  { source: 'SUP-3', target: 'MAT-2', flow: 12 },
  { source: 'DUAL', target: 'MAT-1', flow: 7 },
  { source: 'DUAL', target: 'PROD-1', flow: 3 },
];

const CASES: Array<{ name: string; query: string }> = [
  { name: 'empty search returns everything', query: '' },
  { name: 'a single match, both directions, unlimited hops', query: 'MAT-1' },
  { name: 'substring match hits several nodes', query: 'MAT' },
  { name: 'no match at all', query: 'NOSUCHNODE' },
  { name: 'case-insensitive', query: 'mat-1' },
  { name: 'upstream only', query: 'PROD-1 dir:up' },
  { name: 'downstream only', query: 'SUP-1 dir:down' },
  { name: 'one hop', query: 'MAT-1 hops:1' },
  { name: 'two hops', query: 'MAT-1 hops:2' },
  { name: 'explicit infinity', query: 'MAT-1 hops:infinity' },
  { name: 'min flow prunes the thin arcs', query: 'PROD-1 minFlow:10' },
  { name: 'min flow above every arc', query: 'PROD-1 minFlow:1000' },
  { name: 'level range', query: 'MAT-1 level:0..3' },
  { name: 'level range excluding the root', query: 'MAT-1 level:4..6' },
  { name: 'terminals on — the flag that is inverted (D129)', query: 'MAT-1 includeTerminals:on' },
  { name: 'terminals on, upstream', query: 'PROD-1 dir:up includeTerminals:on' },
  { name: 'custom stopUp', query: 'PROD-1 dir:up stopUp:3,4 includeTerminals:on' },
  { name: 'custom stopDown', query: 'SUP-1 dir:down stopDown:0 includeTerminals:on' },
  { name: 'a dual-role node', query: 'DUAL' },
  { name: 'an orphan with no edges', query: 'ORPHAN' },
  { name: 'everything at once', query: 'MAT dir:both hops:3 minFlow:5 level:-1..5 includeTerminals:on' },
];

const ids = (r: { nodes: WitnessNode[]; edges: WitnessEdge[] }) => ({
  nodes: r.nodes.map((n) => n.id),
  edges: r.edges.map((e) => `${e.source}->${e.target}`),
});

describe('the extracted subgraph engine matches the page it came from', () => {
  it.each(CASES)('$name', ({ query }) => {
    const params = parseAdvancedQuery(query);
    const mine = extractSubgraph(NODES, EDGES, params);
    const theirs = originalExtractSubgraph([...NODES], [...EDGES], params);
    expect(ids(mine)).toEqual(ids(theirs));
  });

  it('every case is exercised and none of them is vacuous', () => {
    // A parity suite where both sides return nothing for every case proves nothing.
    // At least one case must return a strict subset, and at least one the whole graph.
    const results = CASES.map((c) => extractSubgraph(NODES, EDGES, parseAdvancedQuery(c.query)));
    expect(results.some((r) => r.nodes.length === NODES.length)).toBe(true);
    expect(results.some((r) => r.nodes.length > 0 && r.nodes.length < NODES.length)).toBe(true);
    expect(results.some((r) => r.nodes.length === 0)).toBe(true);
  });
});

describe('parseAdvancedQuery', () => {
  it('defaults every parameter when the query is a bare term', () => {
    expect(parseAdvancedQuery('MAT-1')).toEqual({ ...DEFAULT_QUERY, searchTerm: 'MAT-1' });
  });

  it('reads every parameter the DSL declares', () => {
    const p = parseAdvancedQuery(
      'MAT-1 dir:up hops:3 stopUp:7,8 stopDown:-2,-3 minFlow:12.5 level:-1..4 includeTerminals:on',
    );
    expect(p).toEqual({
      searchTerm: 'MAT-1',
      dir: 'up',
      hops: 3,
      stopUp: [7, 8],
      stopDown: [-2, -3],
      minFlow: 12.5,
      levelRange: { min: -1, max: 4 },
      includeTerminals: true,
    });
  });

  it('ignores a direction it does not recognise rather than guessing one', () => {
    expect(parseAdvancedQuery('X dir:sideways').dir).toBe('both');
  });

  it('accepts the ∞ glyph as well as the word', () => {
    expect(parseAdvancedQuery('X hops:∞').hops).toBe('infinity');
    expect(parseAdvancedQuery('X hops:infinity').hops).toBe('infinity');
  });
});

describe('D129 — includeTerminals is inverted, and the fix is opt-in', () => {
  it('the default does NOT stop at a terminal level, which is the defect', () => {
    // `stopUp` defaults to [5, 6]. Walking up from PROD-1 should stop at the
    // suppliers; with the original's inverted guard it walks straight past them,
    // which is why the whole mechanism has been inert.
    const params = parseAdvancedQuery('PROD-1 dir:up');
    const reached = extractSubgraph(NODES, EDGES, params).nodes.map((n) => n.id);
    expect(reached).toContain('SUP-3');
  });

  it('`respectTerminals` makes the parameter mean what its name says', () => {
    const params = parseAdvancedQuery('PROD-1 dir:up');
    const reached = extractSubgraph(NODES, EDGES, params, { respectTerminals: true }).nodes.map((n) => n.id);
    // SUP-3 is at level 6, reachable only THROUGH level-5 DUAL or through MAT-2.
    // With terminals respected the walk stops at each level-5 node it lands on.
    expect(reached).toContain('MAT-1');
    expect(reached).toContain('DUAL');
    // …and it does not expand past the terminal, so nothing upstream OF a level-5
    // node is pulled in through that node.
    const viaDualOnly = extractSubgraph(
      [
        { id: 'A', label: 'A', level: 0 },
        { id: 'T', label: 'T', level: 5 },
        { id: 'B', label: 'B', level: 6 },
      ],
      [
        { source: 'T', target: 'A', flow: 1 },
        { source: 'B', target: 'T', flow: 1 },
      ],
      parseAdvancedQuery('A dir:up'),
      { respectTerminals: true },
    ).nodes.map((n) => n.id);
    expect(viaDualOnly).toEqual(['A', 'T']);
  });
});
