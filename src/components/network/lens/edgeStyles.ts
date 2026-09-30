/**
 * Edge rendering per lens (network-lenses handoff §4).
 *
 * Product and process draw directed, flow-weighted edges with a fixed-size arrow
 * that turns blue with the edge. Firm draws undirected hairlines, as it always has.
 *
 * One deliberate departure from the handoff's table: while a node is selected, the
 * OTHER edges keep their flow width and only fade to 0.5, rather than all going to
 * a flat 1.2. A flat width there erased the flow encoding the moment anything was
 * clicked, which is the defect `42d1a82` fixed on the product page.
 */
import { MarkerType, type Edge } from '@xyflow/react';
import { EDGE_WIDTH, GRAPH_INK } from '@/lib/graph';
import type { EdgeState } from './useLensGraph';

const CONNECTED_WIDTH = 1.8;

export function styleColumnEdge(edge: Edge, state: EdgeState): Edge {
  const width = typeof edge.data?.width === 'number' ? (edge.data.width as number) : EDGE_WIDTH.uniform;
  const connected = state === 'connected';
  const stroke = connected ? GRAPH_INK.edgeHighlight : GRAPH_INK.edge;
  return {
    ...edge,
    type: 'straight',
    zIndex: connected ? 1 : 0,
    style: {
      stroke,
      strokeWidth: connected ? Math.max(CONNECTED_WIDTH, width) : width,
      strokeOpacity: state === 'idle' ? 0.65 : connected ? 0.8 : 0.5,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      // px, not stroke-width units, so a wide edge does not grow a huge arrowhead
      markerUnits: 'userSpaceOnUse',
      color: stroke,
    },
  };
}

export function styleFirmEdge(edge: Edge, state: EdgeState): Edge {
  const connected = state === 'connected';
  return {
    ...edge,
    type: 'straight',
    zIndex: connected ? 1 : 0,
    style: {
      stroke: connected ? GRAPH_INK.edgeHighlight : GRAPH_INK.edge,
      strokeWidth: state === 'idle' ? 1.5 : connected ? 2.5 : 1,
      strokeOpacity: state === 'idle' ? 0.6 : connected ? 0.9 : 0.25,
    },
  };
}
