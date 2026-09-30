/**
 * The graph state the three lenses share (network-lenses handoff "State
 * management"): the laid-out node set, selection, subgraph focus and the search
 * highlight, derived in the handoff's order —
 *
 *   prefilter (process's Level 1 filter) → focus set → search highlight
 *
 * WHAT CHANGED FROM THE PAGES' OWN VERSIONS. Each page kept `nodes` and `allNodes`
 * and patched one from the other in four effects that raced: a search effect
 * restyled whatever `nodes` held, the focus effect then replaced `nodes` from
 * `allNodes` and dropped the highlight, and the selection effect restyled
 * `allEdges` and so re-showed every edge a focus had hidden. Here there is ONE
 * source, `allNodes` (drags persist into it), and what React Flow renders is a
 * pure function of it and the three pieces of state.
 *
 * Nodes are never dimmed: a selection restyles EDGES only, via the page's
 * `styleEdge`, and focus removes what is outside the set rather than greying it.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import { GRAPH_INK } from '@/lib/graph';

export type EdgeState = 'idle' | 'connected' | 'other';

interface Options<N extends Node> {
  /** Nodes a filter keeps before focus applies (process's Level 1 filter); null = all. */
  prefilter?: Set<string> | null;
  /** The ids a focus on `id` keeps, over the already-prefiltered graph. */
  focusSet: (id: string, nodes: N[], edges: Edge[]) => Set<string>;
  /** What an exact search term is compared against: the id, or a firm's name. */
  searchLabel: (node: N) => string;
  styleEdge: (edge: Edge, state: EdgeState) => Edge;
}

const HIT_SCALE = 1.1;

function numeric(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** How far a search hit's top-left moves so it grows around its centre. */
function hitOffset(node: Node): { dx: number; dy: number } {
  const w = numeric(node.style?.width) ?? 0;
  const h = numeric(node.style?.height) ?? 0;
  return { dx: (w * (HIT_SCALE - 1)) / 2, dy: (h * (HIT_SCALE - 1)) / 2 };
}

export function useLensGraph<N extends Node>({ prefilter = null, focusSet, searchLabel, styleEdge }: Options<N>) {
  const [allNodes, setAllNodes] = useState<N[]>([]);
  const [allEdges, setAllEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // ── prefilter → focus: the visible set ──────────────────────────────────
  const visible = useMemo(() => {
    let nodes = allNodes;
    let edges = allEdges;
    if (prefilter && prefilter.size > 0) {
      nodes = nodes.filter((n) => prefilter.has(n.id));
      edges = edges.filter((e) => prefilter.has(e.source) && prefilter.has(e.target));
    }
    if (focusedId && nodes.some((n) => n.id === focusedId)) {
      const keep = focusSet(focusedId, nodes, edges);
      nodes = nodes.filter((n) => keep.has(n.id));
      edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
    }
    return { nodes, edges };
  }, [allNodes, allEdges, prefilter, focusedId, focusSet]);

  // ── search highlight: exact match within the visible set ────────────────
  const term = searchTerm.trim();
  const hitId = useMemo(
    () => (term ? visible.nodes.find((n) => searchLabel(n) === term)?.id ?? null : null),
    [visible.nodes, term, searchLabel],
  );

  const nodes = useMemo(
    () =>
      visible.nodes.map((n) => {
        const selected = n.id === selectedId;
        if (n.id !== hitId) return selected === !!n.selected ? n : { ...n, selected };
        const { dx, dy } = hitOffset(n);
        const w = numeric(n.style?.width);
        const h = numeric(n.style?.height);
        return {
          ...n,
          selected,
          position: { x: n.position.x - dx, y: n.position.y - dy },
          style: {
            ...n.style,
            background: GRAPH_INK.searchHit,
            ...(w !== null ? { width: w * HIT_SCALE } : {}),
            ...(h !== null ? { height: h * HIT_SCALE } : {}),
          },
        };
      }),
    [visible.nodes, selectedId, hitId],
  );

  const edges = useMemo(
    () =>
      visible.edges.map((e) =>
        styleEdge(
          e,
          !selectedId ? 'idle' : e.source === selectedId || e.target === selectedId ? 'connected' : 'other',
        ),
      ),
    [visible.edges, selectedId, styleEdge],
  );

  // Drags land in `allNodes`. A drag of the highlighted node reports the GROWN
  // box's position, so the offset is put back before it is stored — otherwise the
  // node would creep by 5% of its size on every pointer move.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const kept = changes.filter((c) => c.type === 'position' || c.type === 'dimensions');
      if (kept.length === 0) return;
      setAllNodes((current) => {
        const fixed = kept.map((c) => {
          if (c.type !== 'position' || c.id !== hitId || !c.position) return c;
          const base = current.find((n) => n.id === c.id);
          if (!base) return c;
          const { dx, dy } = hitOffset(base);
          return { ...c, position: { x: c.position.x + dx, y: c.position.y + dy } };
        });
        return applyNodeChanges(fixed, current) as N[];
      });
    },
    [hitId],
  );

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => setSelectedId(node.id), []);
  const onNodeDoubleClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedId(node.id);
    setFocusedId((prev) => (prev === node.id ? null : node.id));
  }, []);
  const onNodeDragStart: OnNodeDrag = useCallback((_, node) => setSelectedId(node.id), []);
  const onPaneClick = useCallback(() => setSelectedId(null), []);

  const selectedNode = useMemo(
    () => (selectedId ? allNodes.find((n) => n.id === selectedId) ?? null : null),
    [allNodes, selectedId],
  );

  /** Everything a project switch or reload has to forget. */
  const reset = useCallback(() => {
    setSelectedId(null);
    setFocusedId(null);
    setSearchTerm('');
    setSearchOpen(false);
  }, []);

  return {
    allNodes,
    setAllNodes,
    allEdges,
    setAllEdges,
    visibleNodes: visible.nodes,
    nodes,
    edges,
    onNodesChange,
    onNodeClick,
    onNodeDoubleClick,
    onNodeDragStart,
    onPaneClick,
    selectedId,
    setSelectedId,
    selectedNode,
    focusedId,
    setFocusedId,
    searchTerm,
    setSearchTerm,
    searchOpen,
    setSearchOpen,
    reset,
  };
}
