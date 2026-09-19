/**
 * The subgraph query engine — Phase 8 / WP 8.3, EXTRACTED not rewritten.
 *
 * WHERE IT CAME FROM. `src/pages/InteractiveNetworkSpace.tsx` is not in the
 * sidebar and is reachable only by typing its URL. It already contained the best
 * asset in this area: a query-parameter shape with direction, hop budget,
 * per-direction terminal stops, min-flow pruning and a level range; a parsed query
 * DSL; and a real BFS implementing all of it. Two pages that need exactly that
 * were each going to grow their own worse version.
 *
 * THIS IS A FAITHFUL EXTRACTION AND THAT IS A DELIBERATE CONSTRAINT.
 * `subgraphParity.test.ts` runs the original and this side by side over a fixture
 * graph and fails on any difference. So the two DEFECTS below are reproduced here
 * rather than fixed — a refactor that also changes behaviour cannot be verified as
 * either, and the parity test is the only thing that makes "we did not break the
 * orphaned page" a fact instead of a hope.
 *
 * REPRODUCED DEFECTS, each named so the fix is a decision and not a discovery:
 *
 *   §4 D144 — `includeTerminals` is INVERTED. The traversal stops at a terminal
 *             level only `if (includeTerminals)`, so the default (`false`) does
 *             NOT stop and the whole `stopUp` / `stopDown` mechanism is inert
 *             unless the user opts into the flag whose name says the opposite.
 *             Guarded by `respectTerminals` below, default `false` = today's
 *             behaviour.
 *   §4 D145 — `traverse`'s `maxHops` parameter is never read; the body uses
 *             `params.hops` directly. Harmless today because both call sites pass
 *             the same value, and it is kept so the shapes match.
 *
 * Both are `GraphNode`/`GraphEdge` shaped rather than React Flow shaped, so the
 * engine is testable without a renderer — the original could only be exercised by
 * mounting a page.
 */
import type { GraphEdge, GraphNode } from './types';

export interface QueryParams {
  searchTerm: string;
  dir: 'both' | 'up' | 'down';
  hops: number | 'infinity';
  /** Levels at which an UPSTREAM walk stops. See D144: inert by default. */
  stopUp: number[];
  /** Levels at which a DOWNSTREAM walk stops. See D144: inert by default. */
  stopDown: number[];
  minFlow: number;
  levelRange: { min: number; max: number } | null;
  includeTerminals: boolean;
}

export const DEFAULT_QUERY: QueryParams = {
  searchTerm: '',
  dir: 'both',
  hops: 'infinity',
  stopUp: [5, 6],
  stopDown: [-1],
  minFlow: 0,
  levelRange: null,
  includeTerminals: false,
};

/**
 * Parse the query DSL: `MAT-1 dir:up hops:3 minFlow:100 level:1..4`.
 *
 * Byte-faithful to the original, including the search-term regex, which stops at
 * the first lower-case word followed by a colon. That means an id containing
 * `something:` is truncated — noted rather than changed, for the parity reason
 * in the header.
 */
export function parseAdvancedQuery(input: string): QueryParams {
  const paramMatch = input.match(/^([^a-z:]*?)(?:\s+[a-z]+:|$)/);
  const searchTerm = paramMatch ? paramMatch[1].trim() : input.trim();

  const params: QueryParams = { ...DEFAULT_QUERY, searchTerm };

  const dirMatch = input.match(/dir:\s*(\w+)/);
  if (dirMatch && ['both', 'up', 'down'].includes(dirMatch[1])) {
    params.dir = dirMatch[1] as 'both' | 'up' | 'down';
  }

  const hopsMatch = input.match(/hops:\s*(\d+|∞|infinity)/);
  if (hopsMatch) {
    params.hops =
      hopsMatch[1] === '∞' || hopsMatch[1] === 'infinity' ? 'infinity' : parseInt(hopsMatch[1]);
  }

  const stopUpMatch = input.match(/stopUp:\s*([\d,\s]+)/);
  if (stopUpMatch) {
    params.stopUp = stopUpMatch[1].split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
  }

  const stopDownMatch = input.match(/stopDown:\s*([\d,-\s]+)/);
  if (stopDownMatch) {
    params.stopDown = stopDownMatch[1].split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
  }

  const minFlowMatch = input.match(/minFlow:\s*(\d+(?:\.\d+)?)/);
  if (minFlowMatch) {
    params.minFlow = parseFloat(minFlowMatch[1]);
  }

  const levelMatch = input.match(/level:\s*(-?\d+)\.\.(-?\d+)/);
  if (levelMatch) {
    params.levelRange = { min: parseInt(levelMatch[1]), max: parseInt(levelMatch[2]) };
  }

  const terminalsMatch = input.match(/includeTerminals:\s*(on|off)/);
  if (terminalsMatch) {
    params.includeTerminals = terminalsMatch[1] === 'on';
  }

  return params;
}

/** The node fields the walk reads. `level` is the ordinate the stops key on. */
export interface SubgraphNode extends Pick<GraphNode, 'id' | 'label'> {
  level: number;
}

export interface ExtractOptions {
  /**
   * `true` makes `stopUp`/`stopDown` do what their names say. Default `false`,
   * which is the ORIGINAL behaviour and therefore what the parity test asserts.
   * §4 D144 owns flipping it; a caller may opt in today.
   */
  respectTerminals?: boolean;
}

/**
 * Extract the subgraph reachable from every node matching `searchTerm`.
 *
 * Substring, case-insensitive — which the original already was, and which
 * `ProductLevelNetwork`'s own search is not (it compares whole strings, exactly,
 * case-sensitively).
 *
 * An empty search term returns the whole graph rather than nothing: a filter must
 * always show the user how to get back.
 */
export function extractSubgraph<N extends SubgraphNode, E extends Pick<GraphEdge, 'source' | 'target' | 'flow'>>(
  allNodes: readonly N[],
  allEdges: readonly E[],
  params: QueryParams,
  options: ExtractOptions = {},
): { nodes: N[]; edges: E[] } {
  const respectTerminals = options.respectTerminals ?? false;

  if (!params.searchTerm) {
    return { nodes: [...allNodes], edges: [...allEdges] };
  }

  const needle = params.searchTerm.toLowerCase();
  const rootNodes = allNodes.filter((node) => node.label?.toLowerCase().includes(needle));

  if (rootNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const resultNodeIds = new Set<string>();

  // Adjacency, built once. The original rebuilt these maps per call and then did a
  // LINEAR SCAN of `allEdges` for every neighbour inside the BFS — O(V·E) on a
  // 638-node graph. The maps below carry the edge itself, so the walk is O(V+E)
  // and the results are identical; that is the one performance change here, and it
  // is invisible to the parity test by construction.
  const downstream = new Map<string, { to: string; edge: E }[]>();
  const upstream = new Map<string, { to: string; edge: E }[]>();
  for (const edge of allEdges) {
    if (!downstream.has(edge.source)) downstream.set(edge.source, []);
    if (!upstream.has(edge.target)) upstream.set(edge.target, []);
    downstream.get(edge.source)!.push({ to: edge.target, edge });
    upstream.get(edge.target)!.push({ to: edge.source, edge });
  }

  const byId = new Map(allNodes.map((n) => [n.id, n]));

  const traverse = (startNodeIds: string[], direction: 'up' | 'down') => {
    const queue: { nodeId: string; hops: number }[] = startNodeIds.map((id) => ({ nodeId: id, hops: 0 }));
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { nodeId, hops } = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      resultNodeIds.add(nodeId);

      const currentNode = byId.get(nodeId);
      if (!currentNode) continue;

      // D144 lives here. The original stops only when `includeTerminals` is TRUE,
      // which is backwards; `respectTerminals` lets a caller ask for the sane
      // reading without changing what the parity test measures.
      const currentLevel = currentNode.level;
      const atTerminal =
        (direction === 'up' && params.stopUp.includes(currentLevel)) ||
        (direction === 'down' && params.stopDown.includes(currentLevel));
      if (atTerminal && (respectTerminals || params.includeTerminals)) continue;

      if (params.hops !== 'infinity' && hops >= params.hops) continue;

      const neighbours = direction === 'up' ? upstream.get(nodeId) ?? [] : downstream.get(nodeId) ?? [];
      for (const { to, edge } of neighbours) {
        if (visited.has(to)) continue;
        if (params.minFlow > 0 && (edge.flow ?? 0) < params.minFlow) continue;
        queue.push({ nodeId: to, hops: hops + 1 });
      }
    }
  };

  const rootNodeIds = rootNodes.map((n) => n.id);
  for (const id of rootNodeIds) resultNodeIds.add(id);

  if (params.dir === 'both' || params.dir === 'up') traverse(rootNodeIds, 'up');
  if (params.dir === 'both' || params.dir === 'down') traverse(rootNodeIds, 'down');

  const nodes = allNodes.filter((node) => {
    if (!resultNodeIds.has(node.id)) return false;
    if (params.levelRange) {
      if (node.level < params.levelRange.min || node.level > params.levelRange.max) return false;
    }
    return true;
  });

  // Edges are filtered on the REACHED set, not on the level-filtered set — which
  // is the original's behaviour and means a level range can leave an edge whose
  // endpoint was filtered out. Reproduced, and it is why the pages must render
  // edges against the node set they actually draw.
  const edges = allEdges.filter((edge) => resultNodeIds.has(edge.source) && resultNodeIds.has(edge.target));

  return { nodes, edges };
}
