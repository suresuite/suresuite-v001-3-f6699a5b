// Hero graphic for the About page: the three-echelon network, with a disruption
// walking it one hop at a time. See the notes in the PR description before
// changing the walk generation — the fixed seed and the closed tour are both
// load-bearing.
import { useEffect, useRef } from 'react';

const LAYERS = ['#e0930b', '#7c3aed', '#14b8c4']; // firm / product / process
const SIZES = [5, 4, 3];
const OFF = [0, 25, 41];
const NODE_ALPHA = [1, 0.92, 0.84];
const EDGE_ALPHA = [0.13, 0.11, 0.09];
const STEP = 0.9; // seconds per hop
const TAIL = 6;   // hops that stay warm, and the no-revisit window

export default function HeroLattice() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    let raf = 0;

    const paint = (t: number) => {
      const W = cvs.clientWidth, H = cvs.clientHeight;
      if (!W || !H) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cvs.width !== Math.round(W * dpr)) {
        cvs.width = Math.round(W * dpr);
        cvs.height = Math.round(H * dpr);
      }
      const ctx = cvs.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const R = Math.min(W, H) * 0.42;
      // Size from the band right of the text column, then cap so the widest
      // plane (5x5) can't clip — a bled edge reads as a hard cut on a filled plane.
      const pad = 10;
      const ux = Math.min(Math.max(17.1, (W - W * 0.64 - 24) / 7.35), (W - pad) / 5.6);
      const uy = ux * 0.5, gap = ux * 1.97;
      const cx = W - pad - ux * 4.35 + W * 0.05;
      // Clamp the top so the topmost node square (NODE_HALF = 2.2) cannot clip out
      // of the canvas — a bled edge reads as a hard cut on a filled plane.
      const NODE_HALF = 2.2;
      const cyTop = 1.5 + NODE_HALF + ux * 2;
      const cy = Math.max(cyTop, H * 0.16 - gap + uy);
      const stackR = Math.max(ux * 4, uy * 3 + gap);
      const sway = Math.sin(t / 31) * R * 0.018;

      type N = { L: number; i: number; j: number; x: number; y: number };
      const nodes: N[] = [];
      for (let L = 0; L < 3; L++) {
        const n = SIZES[L], c = (n - 1) / 2;
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++)
            nodes.push({
              L, i, j,
              x: cx + ((i - c) - (j - c)) * ux + sway,
              y: cy + ((i - c) + (j - c)) * uy + L * gap - Math.cos(t / 27 + L) * R * 0.012,
            });
      }
      const key = (L: number, i: number, j: number) => OFF[L] + i * SIZES[L] + j;
      const at = (L: number, i: number, j: number) => nodes[key(L, i, j)];
      const idx = (n: N) => key(n.L, n.i, n.j);

      // adjacency: 4-neighbour inside a plane, plus the single (1,1) door
      const nb = (k: number) => {
        const n = nodes[k], s = SIZES[n.L], out: number[] = [];
        if (n.i > 0) out.push(key(n.L, n.i - 1, n.j));
        if (n.i < s - 1) out.push(key(n.L, n.i + 1, n.j));
        if (n.j > 0) out.push(key(n.L, n.i, n.j - 1));
        if (n.j < s - 1) out.push(key(n.L, n.i, n.j + 1));
        if (n.i === 1 && n.j === 1) {
          if (n.L > 0) out.push(key(n.L - 1, 1, 1));
          if (n.L < 2) out.push(key(n.L + 1, 1, 1));
        }
        return out;
      };

      const srcIdx = key(0, 0, 0);
      const homeHop = nodes.map(() => Infinity);
      homeHop[srcIdx] = 0;
      let ring = [srcIdx];
      while (ring.length) {
        const next: number[] = [];
        ring.forEach(u => nb(u).forEach(v => {
          if (homeHop[v] === Infinity) { homeHop[v] = homeHop[u] + 1; next.push(v); }
        }));
        ring = next;
      }

      let seed = 20240601;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const pick = (a: number[]) => a[Math.min(a.length - 1, Math.floor(rnd() * a.length))];
      const dd = (k: number) => Math.abs(nodes[k].i - 1) + Math.abs(nodes[k].j - 1);
      const inPlane = (k: number, L: number) => nb(k).filter(o => nodes[o].L === L);

      const walk = [srcIdx];
      const cur = () => walk[walk.length - 1];
      const wander = (L: number, count: number) => {
        for (let s = 0; s < count; s++) {
          const opts = inPlane(cur(), L);
          if (!opts.length) return;
          const recent = walk.slice(Math.max(0, walk.length - TAIL), walk.length - 1);
          const pool = opts.filter(o => recent.indexOf(o) < 0);
          walk.push(pick(pool.length ? pool : opts));
        }
      };
      const toDoor = (L: number) => {
        for (let g = 0; dd(cur()) > 0 && g < 12; g++) {
          const opts = inPlane(cur(), L).filter(o => dd(o) < dd(cur()));
          if (!opts.length) return;
          walk.push(pick(opts));
        }
      };
      const cross = (L: number) => walk.push(key(L, 1, 1));

      wander(0, 7); toDoor(0); cross(1);
      wander(1, 5); toDoor(1); cross(2);
      wander(2, 5); toDoor(2); cross(1);
      wander(1, 4); toDoor(1); cross(0);
      wander(0, 6); toDoor(0); cross(1);
      wander(1, 5); toDoor(1); cross(2);
      wander(2, 4); toDoor(2); cross(1);
      wander(1, 4); toDoor(1); cross(0);
      for (let g = 0; homeHop[cur()] > 1 && g < 24; g++) {
        const opts = nb(cur()).filter(o => homeHop[o] === homeHop[cur()] - 1);
        if (!opts.length) break;
        walk.push(pick(opts));
      }
      const WALK = walk.length;

      // negative-safe: the first rAF stamp can precede t0
      const tw = Math.max(0, t);
      const step = ((Math.floor(tw / STEP) % WALK) + WALK) % WALK;
      const p = (tw / STEP) % 1;

      const ekey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
      const nodeHeat = nodes.map(() => 0);
      const edgeHeat: Record<string, number> = {};
      for (let s = 0; s <= TAIL; s++) {
        const si = (step - s + WALK) % WALK;   // wraps: the tour is closed
        const decay = Math.exp(-(s + p) / 2.2);
        nodeHeat[walk[si]] = Math.max(nodeHeat[walk[si]], decay);
        const k = ekey(walk[si], walk[(si + 1) % WALK]);
        const amt = s === 0 ? Math.min(1, p * 1.7) : Math.exp(-(s - 1 + p) / 2);
        edgeHeat[k] = Math.max(edgeHeat[k] || 0, amt);
      }

      // layer focus: the plane holding the disruption lifts, the others recede
      const dim = 0.4;
      const rawFocus = [0, 0, 0];
      nodes.forEach((n, k) => { rawFocus[n.L] = Math.max(rawFocus[n.L], nodeHeat[k]); });
      const top = Math.max(rawFocus[0], rawFocus[1], rawFocus[2], 1e-4);
      const vis = (L: number) => dim + (1 - dim) * (rawFocus[L] / top);

      // faint tinted plane per echelon
      for (let L = 0; L < 3; L++) {
        const s = SIZES[L], v = vis(L);
        const corners = [at(L, 0, 0), at(L, s - 1, 0), at(L, s - 1, s - 1), at(L, 0, s - 1)];
        const mid = { x: 0, y: 0 };
        corners.forEach(n => { mid.x += n.x / 4; mid.y += n.y / 4; });
        const grow = 1 + (ux * 0.55) / Math.max(1, ux * (s - 1));
        ctx.beginPath();
        corners.forEach((n, q) => {
          const x = mid.x + (n.x - mid.x) * grow, y = mid.y + (n.y - mid.y) * grow;
          q === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.globalAlpha = 0.014 * v; ctx.fillStyle = LAYERS[L]; ctx.fill();
        ctx.globalAlpha = 0.06 * v; ctx.strokeStyle = LAYERS[L]; ctx.lineWidth = 0.75; ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.lineCap = 'round';
      for (let L = 0; L < 3; L++) {
        const s = SIZES[L], v = vis(L);
        for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) {
          const draw = (b: N) => {
            const a = at(L, i, j);
            ctx.lineWidth = 0.75;
            ctx.strokeStyle = `rgba(23,23,23,${(EDGE_ALPHA[L] * v).toFixed(3)})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            const h = (edgeHeat[ekey(idx(a), idx(b))] || 0) * v;
            if (h > 0.02) {
              ctx.lineWidth = 1.2;
              ctx.strokeStyle = `rgba(191,35,48,${Math.min(0.95, 1.5 * h).toFixed(3)})`;
              ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
          };
          if (i < s - 1) draw(at(L, i + 1, j));
          if (j < s - 1) draw(at(L, i, j + 1));
        }
      }

      nodes.forEach((n, k) => {
        const v = vis(n.L);
        ctx.globalAlpha = Math.min(1, NODE_ALPHA[n.L] * v);
        ctx.fillStyle = LAYERS[n.L];
        ctx.fillRect(n.x - 2.2, n.y - 2.2, 4.4, 4.4);
        ctx.globalAlpha = 1;
        const h = nodeHeat[k] * v;
        if (h > 0.03) {
          ctx.fillStyle = `rgba(191,35,48,${(0.95 * h).toFixed(3)})`;
          ctx.fillRect(n.x - 2.6, n.y - 2.6, 5.2, 5.2);
        }
      });

      // the disruption itself, riding the hop it is making now
      const a = nodes[walk[step]], b = nodes[walk[(step + 1) % WALK]];
      if (a && b) {
        const e = p * p * (3 - 2 * p);
        const fade = Math.sin(Math.min(1, p) * Math.PI) * vis(p < 0.5 ? a.L : b.L);
        ctx.fillStyle = `rgba(191,35,48,${(0.85 * fade).toFixed(3)})`;
        ctx.fillRect(a.x + (b.x - a.x) * e - 1.6, a.y + (b.y - a.y) * e - 1.6, 3.2, 3.2);
      }

      // mask, so the headline and lead sit on plain white
      const mcy = cy + gap - uy;
      const m = ctx.createRadialGradient(cx, mcy, stackR * 0.8, cx, mcy, stackR * 1.95);
      m.addColorStop(0, 'rgba(0,0,0,1)');
      m.addColorStop(0.72, 'rgba(0,0,0,0.88)');
      m.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = m;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';

      // the haze goes in AFTER the mask — the mask is centred on the lattice,
      // so a corner haze drawn before it gets erased
      const bx = W * 0.88, by = H * 0.1;
      const gl = ctx.createRadialGradient(bx, by, 0, bx, by, Math.min(W, H) * 0.5);
      gl.addColorStop(0, 'rgba(191,35,48,0.11)');
      gl.addColorStop(0.45, 'rgba(191,35,48,0.035)');
      gl.addColorStop(1, 'rgba(191,35,48,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(0, 0, W, H);
    };

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      paint(3.2);
      return;
    }
    const t0 = performance.now();
    const loop = (now: number) => {
      paint(Math.max(0, (now - t0) / 1000));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
