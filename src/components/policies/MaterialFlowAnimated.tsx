// Animated material-flow diagram for single-run validation.
// Pure SVG + requestAnimationFrame. Dot radius encodes shipment quantity,
// emission rate encodes flow rate. Deterministic — same (seed, horizon)
// yields the same animation.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pause, Play, RotateCcw } from "lucide-react";

interface Props {
  suppliers: any[];
  plants: any[];
  customers: any[];
  seed: number;
  horizonDays: number;
}

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface EdgeDef {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx1: number;
  cx2: number;
  // baseline qty in units per day for this edge
  baseQty: number;
  // emissions per simulated day
  rate: number;
  color: string;
}

interface Packet {
  edgeIdx: number;
  t0: number; // simulation day when dispatched
  duration: number; // simulated days in transit
  qty: number;
}

// cubic-bezier helper
function cubic(t: number, p0: number, c1: number, c2: number, p1: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p1;
}

const FAMILY_COLORS = [
  "hsl(210 80% 55%)",
  "hsl(270 70% 60%)",
  "hsl(35 90% 55%)",
  "hsl(150 60% 45%)",
  "hsl(340 70% 55%)",
  "hsl(190 70% 45%)",
];

export function MaterialFlowAnimated({
  suppliers,
  plants,
  customers,
  seed,
  horizonDays,
}: Props) {
  const sup = suppliers.slice(0, 6);
  const pl = plants.slice(0, 4);
  const cu = customers.slice(0, 6);
  const empty = sup.length + pl.length + cu.length === 0;

  const W = 760;
  const H = 280;

  const { edges, sY, pY, cY, colX } = useMemo(() => {
    const colX = [60, W / 2, W - 60];
    const rowsY = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        50 + (i * (H - 100)) / Math.max(1, n - 1 || 1),
      );
    const sY = rowsY(Math.max(1, sup.length));
    const pY = rowsY(Math.max(1, pl.length));
    const cY = rowsY(Math.max(1, cu.length));
    const r = rng(seed * 7919 + 13);

    const edges: EdgeDef[] = [];
    sup.forEach((_, i) =>
      pl.forEach((_, j) => {
        const baseQty = Math.round(20 + r() * 180);
        edges.push({
          id: `sp-${i}-${j}`,
          x1: colX[0] + 60,
          y1: sY[i],
          x2: colX[1] - 40,
          y2: pY[j],
          cx1: (colX[0] + colX[1]) / 2,
          cx2: (colX[0] + colX[1]) / 2,
          baseQty,
          rate: 0.6 + r() * 1.2, // packets per day
          color: FAMILY_COLORS[(i + j) % FAMILY_COLORS.length],
        });
      }),
    );
    pl.forEach((_, i) =>
      cu.forEach((_, j) => {
        const baseQty = Math.round(15 + r() * 140);
        edges.push({
          id: `pc-${i}-${j}`,
          x1: colX[1] + 40,
          y1: pY[i],
          x2: colX[2] - 60,
          y2: cY[j],
          cx1: (colX[1] + colX[2]) / 2,
          cx2: (colX[1] + colX[2]) / 2,
          baseQty,
          rate: 0.5 + r() * 1.3,
          color: FAMILY_COLORS[(i + j + 2) % FAMILY_COLORS.length],
        });
      }),
    );
    return { edges, sY, pY, cY, colX };
  }, [sup.length, pl.length, cu.length, seed]);

  const [playing, setPlaying] = useState(true);
  const [simDay, setSimDay] = useState(0);
  const [cumulativeUnits, setCumulativeUnits] = useState(0);
  const packetsRef = useRef<Packet[]>([]);
  const lastDispatchRef = useRef<number[]>(edges.map(() => 0));
  const rngRef = useRef(rng(seed * 31 + horizonDays));
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // reset state when inputs change
  useEffect(() => {
    packetsRef.current = [];
    lastDispatchRef.current = edges.map(() => 0);
    rngRef.current = rng(seed * 31 + horizonDays);
    setSimDay(0);
    setCumulativeUnits(0);
    lastTsRef.current = null;
  }, [seed, horizonDays, edges]);

  // animation loop — 1 simulated day per 60ms wall-clock
  const SIM_DAYS_PER_SECOND = 16;
  useEffect(() => {
    if (empty) return;
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      return;
    }
    const tick = (ts: number) => {
      const last = lastTsRef.current ?? ts;
      const dt = (ts - last) / 1000;
      lastTsRef.current = ts;
      let next = 0;
      setSimDay((prev) => {
        next = prev + dt * SIM_DAYS_PER_SECOND;
        if (next >= horizonDays) next = 0;
        return next;
      });
      // dispatch packets
      const r = rngRef.current;
      let unitsAdded = 0;
      edges.forEach((e, i) => {
        const interval = 1 / e.rate; // sim days between packets
        while (next - lastDispatchRef.current[i] >= interval) {
          lastDispatchRef.current[i] += interval;
          const qty = Math.max(1, Math.round(e.baseQty * (0.6 + r() * 0.8)));
          const duration = 4 + r() * 6;
          packetsRef.current.push({
            edgeIdx: i,
            t0: lastDispatchRef.current[i],
            duration,
            qty,
          });
          unitsAdded += qty;
        }
        if (next < lastDispatchRef.current[i]) {
          lastDispatchRef.current[i] = next;
        }
      });
      // prune finished packets
      packetsRef.current = packetsRef.current.filter(
        (p) => next - p.t0 <= p.duration + 0.5,
      );
      if (unitsAdded > 0) setCumulativeUnits((u) => u + unitsAdded);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, edges, horizonDays, empty]);

  // pause when tab hidden
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) lastTsRef.current = null;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // re-render at ~30fps for packet positions even while RAF mutates refs
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => forceTick((x) => x + 1), 33);
    return () => window.clearInterval(id);
  }, [playing]);

  if (empty) {
    return (
      <div className="rounded-md border border-dashed p-3 text-[11px] text-muted-foreground">
        Material flow diagram will appear once supplier / plant / customer data is loaded.
      </div>
    );
  }

  const qtyToRadius = (q: number) => 3 + Math.min(12, Math.sqrt(q) * 0.7);

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => {
            packetsRef.current = [];
            lastDispatchRef.current = edges.map(() => 0);
            rngRef.current = rng(seed * 31 + horizonDays);
            setSimDay(0);
            setCumulativeUnits(0);
          }}
          aria-label="Reset"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Material flow · day {Math.floor(simDay)} / {horizonDays}
        </div>
        <input
          type="range"
          min={0}
          max={horizonDays}
          value={Math.floor(simDay)}
          onChange={(e) => {
            setSimDay(parseInt(e.target.value, 10));
            packetsRef.current = [];
          }}
          className="flex-1 h-1 accent-primary"
        />
        <span className="text-[10px] font-mono text-muted-foreground">
          {cumulativeUnits.toLocaleString()} u shipped
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[280px]">
        {/* column labels */}
        <text x={colX[0]} y={20} fontSize={10} fill="hsl(var(--muted-foreground))" fontWeight={600}>SUPPLIERS</text>
        <text x={colX[1] - 30} y={20} fontSize={10} fill="hsl(var(--muted-foreground))" fontWeight={600}>FOCAL PLANT</text>
        <text x={colX[2] - 80} y={20} fontSize={10} fill="hsl(var(--muted-foreground))" fontWeight={600}>CUSTOMERS</text>

        {/* edges */}
        {edges.map((e) => (
          <path
            key={e.id}
            d={`M ${e.x1} ${e.y1} C ${e.cx1} ${e.y1}, ${e.cx2} ${e.y2}, ${e.x2} ${e.y2}`}
            fill="none"
            stroke={e.color}
            strokeOpacity={0.18}
            strokeWidth={1.5}
          />
        ))}

        {/* packets */}
        {packetsRef.current.map((p, idx) => {
          const e = edges[p.edgeIdx];
          if (!e) return null;
          const u = Math.min(1, Math.max(0, (simDay - p.t0) / p.duration));
          const x = cubic(u, e.x1, e.cx1, e.cx2, e.x2);
          const y = cubic(u, e.y1, e.y1, e.y2, e.y2);
          return (
            <circle
              key={idx}
              cx={x}
              cy={y}
              r={qtyToRadius(p.qty)}
              fill={e.color}
              fillOpacity={0.85}
              stroke="hsl(var(--background))"
              strokeWidth={0.8}
            />
          );
        })}

        {/* supplier nodes */}
        {sup.map((s, i) => (
          <g key={`s-${i}`}>
            <rect x={colX[0]} y={sY[i] - 11} width={60} height={22} rx={4} fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
            <text x={colX[0] + 30} y={sY[i] + 4} textAnchor="middle" fontSize={9} fill="hsl(var(--foreground))">
              {String((s as any).supplier_id ?? (s as any).key ?? `S${i + 1}`).slice(0, 8)}
            </text>
          </g>
        ))}
        {/* plant nodes */}
        {pl.map((p, i) => (
          <g key={`p-${i}`}>
            <rect x={colX[1] - 40} y={pY[i] - 13} width={80} height={26} rx={4} fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" />
            <text x={colX[1]} y={pY[i] + 4} textAnchor="middle" fontSize={9} fontWeight={600} fill="hsl(var(--foreground))">
              {String((p as any).plant_name ?? (p as any).key ?? `P${i + 1}`).slice(0, 10)}
            </text>
          </g>
        ))}
        {/* customer nodes */}
        {cu.map((c, i) => (
          <g key={`c-${i}`}>
            <rect x={colX[2] - 60} y={cY[i] - 11} width={60} height={22} rx={4} fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
            <text x={colX[2] - 30} y={cY[i] + 4} textAnchor="middle" fontSize={9} fill="hsl(var(--foreground))">
              {String((c as any).customer_id ?? (c as any).key ?? `C${i + 1}`).slice(0, 8)}
            </text>
          </g>
        ))}
      </svg>

      {/* legend */}
      <div className="flex items-center gap-4 border-t px-3 py-2 text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-widest">Legend</span>
        <div className="flex items-center gap-1.5">
          <svg width={42} height={16}>
            <circle cx={6} cy={8} r={3} fill="hsl(var(--primary))" />
            <circle cx={20} cy={8} r={6} fill="hsl(var(--primary))" />
            <circle cx={36} cy={8} r={10} fill="hsl(var(--primary))" />
          </svg>
          <span>dot size → shipment qty</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>emission rate → flow rate</span>
        </div>
        <div className="ml-auto font-mono">
          active packets: {packetsRef.current.length}
        </div>
      </div>
    </div>
  );
}
