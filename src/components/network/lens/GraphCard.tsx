/**
 * The graph card shared by the three network lenses on desktop — network-lenses
 * handoff §2 and §7.
 *
 *   legend bar   the classes in flow order with their real counts; wraps, never clips
 *   canvas       React Flow on a dot grid: drag, pan, wheel zoom, pane-click clears
 *   overlays     zoom stack (in, out, fit, reset layout), zoom %, hint, minimap
 *   resize       a bottom handle; height clamps to 360–1200px and is remembered
 *
 * "100%" is the FIT zoom, not React Flow's 1:1, and wheel zoom is clamped to
 * 0.3×–4× of it. Both follow from `fitView`, so every fit (auto after a project
 * load or a focus change, or the Fit button) re-anchors them.
 *
 * The page owns the graph — which nodes exist, where the layout puts them, what is
 * focused — and this card owns only how it is shown. `GraphCardHandle` is the
 * narrow way back in: a page's search needs to centre on a node, and its layout
 * needs the canvas size.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Maximize, Minus, Plus, RotateCcw } from 'lucide-react';
import { GRAPH_INK } from '@/lib/graph';
import { cn } from '@/lib/utils';
import { LENS } from './tokens';

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  count: number;
}

export interface GraphCardHandle {
  /** Fit the visible graph and re-anchor 100% and the zoom clamp to it. */
  fit: () => void;
  /** Centre on a node at `max(current zoom, 1.4 × fit zoom)`. */
  centerOn: (id: string) => void;
  /** The canvas's current size in px, for the page's layout. */
  canvasSize: () => { width: number; height: number };
}

interface GraphCardProps {
  legend: LegendItem[];
  /** Firm draws round swatches; the column lenses draw 3px-radius squares. */
  legendShape?: 'square' | 'round';
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onNodeClick: NodeMouseHandler;
  onNodeDoubleClick: NodeMouseHandler;
  onNodeDragStart?: OnNodeDrag;
  onPaneClick?: () => void;
  /** Re-run the page's layout, discarding dragged positions. The card refits after. */
  onResetLayout: () => void;
  /** Any change refits: a new project, focus on or off. */
  fitKey: string;
  hint: string;
  /** localStorage key for the user's graph height. */
  storageKey: string;
  minimapNodeColor?: (node: Node) => string;
  /** Replaces the canvas (the map view); the legend bar stays. */
  replaceCanvas?: ReactNode;
  /** Drawn over the canvas: a loading or empty state. */
  overlay?: ReactNode;
}

const HEIGHT = { min: 360, max: 1200, initial: 640 } as const;
const LEGEND_MIN = 44;
const FIT_PADDING = 0.12;

const clampHeight = (h: number) => Math.max(HEIGHT.min, Math.min(HEIGHT.max, Math.round(h)));

function readHeight(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? clampHeight(n) : HEIGHT.initial;
  } catch {
    return HEIGHT.initial;
  }
}

const defaultMinimapColor = (n: Node) => String(n.style?.background ?? GRAPH_INK.edge);

export const GraphCard = forwardRef<GraphCardHandle, GraphCardProps>(function GraphCard(props, ref) {
  return (
    <ReactFlowProvider>
      <GraphCardInner {...props} ref={ref} />
    </ReactFlowProvider>
  );
});

const GraphCardInner = forwardRef<GraphCardHandle, GraphCardProps>(function GraphCardInner(
  {
    legend,
    legendShape = 'square',
    nodes,
    edges,
    onNodesChange,
    onNodeClick,
    onNodeDoubleClick,
    onNodeDragStart,
    onPaneClick,
    onResetLayout,
    fitKey,
    hint,
    storageKey,
    minimapNodeColor = defaultMinimapColor,
    replaceCanvas,
    overlay,
  },
  ref,
) {
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(() => readHeight(storageKey));
  const [fitZoom, setFitZoom] = useState(1);
  const zoom = useStore((s) => s.transform[2]);

  const fit = useCallback(() => {
    // Two frames: the first lets React Flow mount the new node set, the second lets
    // it measure it. `fitView` resolves after the viewport moves, which is when the
    // zoom it chose becomes the new 100%.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void flow
          .fitView({ padding: FIT_PADDING, minZoom: 0.01, maxZoom: 8 })
          .then(() => {
            const z = flow.getZoom();
            if (Number.isFinite(z) && z > 0) setFitZoom(z);
          });
      }),
    );
  }, [flow]);

  const canvasSize = useCallback(() => {
    const el = canvasRef.current;
    return {
      width: el?.clientWidth || 900,
      height: el?.clientHeight || height - LEGEND_MIN,
    };
  }, [height]);

  const centerOn = useCallback(
    (id: string) => {
      const n = flow.getInternalNode(id);
      if (!n) return;
      const w = n.measured?.width ?? Number(n.style?.width ?? 0);
      const h = n.measured?.height ?? Number(n.style?.height ?? 0);
      const p = n.internals.positionAbsolute;
      void flow.setCenter(p.x + w / 2, p.y + h / 2, {
        zoom: Math.max(flow.getZoom(), 1.4 * fitZoom),
        duration: 300,
      });
    },
    [flow, fitZoom],
  );

  useImperativeHandle(ref, () => ({ fit, centerOn, canvasSize }), [fit, centerOn, canvasSize]);

  useEffect(() => {
    if (!replaceCanvas) fit();
    // `fit` is stable per flow instance; the key is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, !!replaceCanvas]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(height));
    } catch {
      /* a private window or blocked storage keeps the default next time */
    }
  }, [storageKey, height]);

  const zoomBy = (factor: number) => {
    const next = Math.max(0.3 * fitZoom, Math.min(4 * fitZoom, flow.getZoom() * factor));
    void flow.zoomTo(next, { duration: 150 });
  };

  const startResize = (ev: React.PointerEvent) => {
    ev.preventDefault();
    const startY = ev.clientY;
    const startH = height;
    const move = (m: PointerEvent) => setHeight(clampHeight(startH + (m.clientY - startY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const zoomPct = fitZoom > 0 ? Math.round((zoom / fitZoom) * 100) : 100;

  const stackButton =
    'grid h-7 w-7 place-items-center bg-white text-[var(--brand-ink)] ' + LENS.hoverControl;

  return (
    <div
      className={cn('relative flex flex-col overflow-hidden rounded-[4px] border bg-white', LENS.border)}
      style={{ height }}
    >
      {/* §2.1 legend bar — flow order, real counts, wraps rather than clipping. */}
      <div className={cn('flex-none border-b bg-white py-2 pl-4 pr-2', LENS.hairline)} style={{ minHeight: LEGEND_MIN }}>
        <div className="flex min-h-[28px] flex-wrap items-center gap-x-[10px] gap-y-1.5">
          {legend.map((item, i) => (
            <span key={item.key} className="contents">
              {i > 0 && (
                <span aria-hidden className={cn('text-[12px]', LENS.quiet)}>
                  →
                </span>
              )}
              <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px]">
                <span
                  aria-hidden
                  className={cn('h-2.5 w-2.5 flex-none', legendShape === 'round' ? 'rounded-full' : 'rounded-[3px]')}
                  style={{ background: item.color }}
                />
                <span className={LENS.ink}>{item.label}</span>
                <span className={cn('rounded-[3px] px-[5px] py-px font-mono text-[10px] tabular-nums', LENS.chip)}>
                  {item.count}
                </span>
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* §2.2 canvas */}
      <div ref={canvasRef} className="relative min-h-0 flex-1">
        {replaceCanvas ?? (
          <>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeDragStart={onNodeDragStart}
              onPaneClick={onPaneClick}
              nodesDraggable
              nodesConnectable={false}
              edgesFocusable={false}
              panOnDrag
              zoomOnDoubleClick={false}
              minZoom={0.3 * fitZoom}
              maxZoom={4 * fitZoom}
              attributionPosition="top-right"
              // The selected ring (§3): React Flow's own is 0.5px and reads as nothing
              // against a 1px outline. Nodes are never dimmed; the ring is the cue.
              className="[&_.react-flow__node.selected]:shadow-[0_0_0_1.5px_var(--brand-ink)]"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={GRAPH_INK.dotGrid} />
              <MiniMap
                pannable
                nodeColor={minimapNodeColor}
                nodeStrokeWidth={0}
                maskColor="rgba(255,255,255,0.55)"
                maskStrokeColor="var(--brand-ink)"
                maskStrokeWidth={1}
                position="bottom-right"
                className={cn(
                  '!m-0 !bottom-[18px] !right-3 overflow-hidden rounded-[4px] border !bg-[rgba(255,255,255,.95)]',
                  LENS.border,
                  '[&_.react-flow__minimap-node]:opacity-80',
                )}
                style={{ width: 160, height: 96 }}
              />
            </ReactFlow>

            {/* §2.3 zoom stack */}
            <div
              className={cn(
                'absolute bottom-[18px] left-3 z-10 flex flex-col overflow-hidden rounded-[4px] border bg-white',
                LENS.border,
              )}
            >
              {[
                { label: 'Zoom in', Icon: Plus, run: () => zoomBy(1.25) },
                { label: 'Zoom out', Icon: Minus, run: () => zoomBy(0.8) },
                { label: 'Fit view', Icon: Maximize, run: fit },
                {
                  label: 'Reset layout',
                  Icon: RotateCcw,
                  run: () => {
                    onResetLayout();
                    fit();
                  },
                },
              ].map(({ label, Icon, run }, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={run}
                  title={label}
                  aria-label={label}
                  className={cn(stackButton, i > 0 && 'border-t', LENS.hairline)}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </button>
              ))}
            </div>

            <span
              className={cn('pointer-events-none absolute bottom-5 left-12 z-10 font-mono text-[10px] tabular-nums', LENS.muted)}
              aria-label="Zoom level, relative to fit"
            >
              {zoomPct}%
            </span>

            <p
              className={cn(
                'pointer-events-none absolute bottom-5 left-24 right-[184px] z-10 truncate text-center text-[10px]',
                LENS.muted,
              )}
            >
              {hint}
            </p>
          </>
        )}
        {overlay}
      </div>

      {/* §7.6 resize handle */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize"
        title="Drag to resize"
        onPointerDown={startResize}
        className="absolute inset-x-0 bottom-0 z-20 flex h-2.5 cursor-ns-resize items-center justify-center"
      >
        <span aria-hidden className="h-[3px] w-10 rounded-[2px] bg-[var(--hair-border)]" />
      </div>
    </div>
  );
});
