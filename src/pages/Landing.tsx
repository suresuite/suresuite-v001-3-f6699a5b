// Public marketing landing at `/`. No sidebar, no auth required.
// Authenticated users are redirected to their app home (`/app` when granted).

import { Link, Navigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';
import NetworkVisualization3D from '@/components/NetworkVisualization3D';
import {
  ArrowRight,
  Play,
  Sparkles,
  ShieldCheck,
  Eye,
  Link2,
  Layers,
  Activity,
  Lightbulb,
  Radar,
  Boxes,
  Crosshair,
  Shuffle,
  MapPin,
  Layers3,
  Share2,
} from 'lucide-react';

// Canonical micro-label style — the only uppercase label treatment on this page.
const KICKER = 'font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground';

// Swap in your real YouTube video id.
const YOUTUBE_ID = 'ScMzIvxBSi4';

// "Why teams choose SuReSuite" — the strong capability grid.
const WHY_TEAMS = [
  {
    icon: Sparkles,
    title: 'AI assist, end to end',
    body: 'Guided data mapping, vulnerability spotting, and strategy suggestions — from a blank sheet to a run.',
  },
  {
    icon: ShieldCheck,
    title: 'Production-grade, research-backed',
    body: 'A published discrete-event engine and peer-reviewed methods behind every result.',
  },
  {
    icon: Eye,
    title: 'One firm, three lenses',
    body: 'Trace risk across the firm, product, and process layers of a single supply chain.',
  },
  {
    icon: Link2,
    title: 'Connects to your stack',
    body: 'CSV in, structured results out — plug into ERP, BI, and your own models with ease.',
  },
  {
    icon: Layers,
    title: '20+ built-in SC policies',
    body: 'A library of ready-made ordering, sourcing, and inventory policies mirroring real practice.',
  },
  {
    icon: Activity,
    title: 'Stress-test at scale',
    body: 'An adaptive surrogate framework runs rigorous stress tests on large-scale models, fast.',
  },
  {
    icon: Lightbulb,
    title: 'Built-in decision support',
    body: 'Recommends resilience strategies for your network — not just charts, but a clear next move.',
  },
  {
    icon: Radar,
    title: 'Continuous monitoring',
    body: 'Keeps the network map current and raises quality-checked risk alerts as conditions shift.',
  },
  {
    icon: Boxes,
    title: 'Guided model building',
    body: 'Agents walk you through the build — recommending policies, parameters, and supply-chain cost estimates.',
  },
];

// The three lenses of the network model, colour-keyed to the 3D planes.
const LENSES = [
  {
    color: '#e0930b',
    title: 'Firm level',
    body: 'Who supplies whom — suppliers, customers, and the focal firm in one map.',
  },
  {
    color: '#7c3aed',
    title: 'Product level',
    body: 'Which materials feed which products, exposing single-source dependencies.',
  },
  {
    color: '#14b8c4',
    title: 'Process level',
    body: 'The steps that make each product — where capacity and lead time really bind.',
  },
];

const ROADMAP = [
  {
    phase: 'Now',
    title: 'Enhanced Training',
    body: 'Broaden simulation scenarios and industry datasets to improve model robustness.',
    status: 'In progress',
  },
  {
    phase: 'Next',
    title: 'GIS Mapping',
    body: 'Geospatial visualization of suppliers/customers for location-based risk analysis.',
    status: 'Planned',
  },
  {
    phase: 'Later',
    title: 'Deep-Tier Analysis',
    body: 'Extend to tier-2/3 suppliers to capture cascading dependencies across the network.',
    status: 'Planned',
  },
];

type TechKey = 'network' | 'nexus' | 'simulation';

const NEXUS_STATS = [
  { label: 'Training runs', value: '5,000+' },
  { label: 'Detection target', value: 'Nexus nodes' },
  { label: 'Signal', value: 'Cascade risk' },
  { label: 'Output', value: 'Ranked criticality' },
];

const SIMULATION_STATS = [
  { label: 'Method', value: 'Monte Carlo' },
  { label: 'Tactics compared', value: '5' },
  { label: 'KPIs tracked', value: 'Cost · Service · Resilience' },
  { label: 'Disruptions', value: 'Known & unknown' },
];

function StatViewport({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <div className="relative min-h-[220px] lg:h-[500px] bg-black">
      <div className="grid h-full place-content-center p-5 md:p-8">
        <div className="grid grid-cols-1 gap-px border border-white/10 bg-white/10 sm:grid-cols-2">
          {stats.map((s) => (
            <div key={s.label} className="bg-black p-6 sm:min-w-[180px]">
              <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
                {s.label}
              </span>
              <span className="mt-1.5 block text-lg font-medium text-white tabular-nums">
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Animated shockwave/ripple that sits in the hero's top-right corner.
// Animated square-pixel ripple that radiates slowly from the hero's top-right
// epicenter (an always-on round red dot). Canvas-based; respects reduced-motion.
function HeroRipple() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const reduce =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    const draw = (t: number) => {
      const W = cvs.clientWidth;
      const H = cvs.clientHeight;
      if (cvs.width !== W || cvs.height !== H) {
        cvs.width = W;
        cvs.height = H;
      }
      const ctx = cvs.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      const cx = W * 0.97;
      const cy = H * -0.02;
      const maxR = Math.min(W, H) * 0.42; // effect ~1/3 of the hero, top-right only

      // subtle ambient wash toward the epicenter
      const amb = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      amb.addColorStop(0, 'rgba(191,35,48,0.10)');
      amb.addColorStop(0.5, 'rgba(191,35,48,0.035)');
      amb.addColorStop(1, 'rgba(191,35,48,0)');
      ctx.fillStyle = amb;
      ctx.fillRect(0, 0, W, H);

      // two gentle expanding wavefronts, offset in phase
      const period = 9;
      const band = maxR * 0.16;
      for (let i = 0; i < 2; i++) {
        const phase = (t / period + i * 0.5) % 1;
        const ringR = phase * maxR;
        const strength = (1 - phase) * 0.28;
        const inner = Math.max(0, (ringR - band) / maxR);
        const outer = Math.min(1, (ringR + band) / maxR);
        const g = ctx.createRadialGradient(cx, cy, inner * maxR, cx, cy, outer * maxR + 1);
        g.addColorStop(0, 'rgba(191,35,48,0)');
        g.addColorStop(0.5, `rgba(233,80,90,${strength})`);
        g.addColorStop(1, 'rgba(191,35,48,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      // soft epicenter glow
      const gl = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90);
      gl.addColorStop(0, 'rgba(191,35,48,0.28)');
      gl.addColorStop(1, 'rgba(191,35,48,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(0, 0, W, H);
    };

    const start = performance.now();
    const loop = (now: number) => {
      draw((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    draw(0);
    if (reduce) draw(2.4);
    else raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* soft red haze at the epicenter */}
      <div
        className="absolute inset-0
                   bg-[radial-gradient(circle_230px_at_100%_-6%,rgba(191,35,48,0.13),rgba(191,35,48,0.03)_45%,transparent_72%)]
                   md:bg-[radial-gradient(circle_at_88%_7%,rgba(191,35,48,0.16),rgba(191,35,48,0.04)_26%,transparent_52%)]"
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

export default function Landing() {
  const { user, loading } = useAuth();
  const { homePath } = useCapabilities();
  const [activeTech, setActiveTech] = useState<TechKey>('network');

  if (loading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background">
        <div className="h-8 w-8 rounded-full border-b-2 border-primary animate-spin" />
      </div>
    );
  }

  if (user) return <Navigate to={homePath} replace />;

  return (
    <div className="min-h-dvh flex flex-col overflow-x-hidden bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 md:px-6">
          <Link to="/" className="flex items-center">
            <img
              src="/logo-mark.png"
              alt="SuReSuite — Supply Chain Resilience Suite"
              className="h-[19px] w-auto object-contain md:hidden"
            />
            <img
              src="/logo-lockup.png"
              alt="SuReSuite — Supply Chain Resilience Suite"
              className="hidden h-[58px] object-contain md:block"
            />
          </Link>
          <nav className="flex items-center gap-1 md:gap-2">
            <Button asChild variant="ghost" size="sm" className="h-11 md:h-8">
              <Link to="/about">About</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
              <a href="#video">Demo</a>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
              <Link to="/help">Docs</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
              <Link to="/auth">Log in</Link>
            </Button>
            <Button asChild size="sm" className="h-11 whitespace-nowrap md:h-8">
              <Link to="/auth">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border/60">
          <HeroRipple />
          <div className="relative mx-auto max-w-6xl px-5 pt-12 pb-9 md:px-6 md:pt-20 md:pb-24">
            {/* Eyebrow */}
            <span className="inline-flex items-center rounded-sm border border-border bg-card px-3 py-1.5">
              <span className="mr-2 h-1.5 w-1.5 rounded-full bg-[#BF2330]" />
              <span className={KICKER}>Resilience-grade supply chain simulator</span>
            </span>

            {/* Headline block */}
            <div className="mt-9 max-w-4xl">
              <h1 className="text-[31px] font-semibold leading-[1.08] tracking-[-0.024em] text-balance
                             md:text-6xl md:leading-[1.03] md:tracking-tight">
                Design supply chains that survive{' '}
                <span className="font-serif italic font-medium">the next shock.</span>
              </h1>
              <p className="mt-5 max-w-xl text-[16px] leading-[1.62] text-muted-foreground text-pretty
                            md:mt-7 md:text-lg md:leading-relaxed">
                Build a digital twin of your network, run rigorous experiments, and pick
                the strategy that holds up under pressure — from data import to
                side-by-side comparison, in one workspace.
              </p>
              <div className="mt-6 flex flex-col gap-2.5 md:mt-8 md:flex-row md:flex-wrap md:items-center md:gap-3">
                <Button asChild size="lg" className="group h-12 w-full rounded-sm md:w-auto">
                  <Link to="/auth">
                    Get started
                    <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 w-full rounded-sm md:w-auto">
                  <a href="#video">
                    <Play className="mr-1 h-3.5 w-3.5 fill-current" />
                    Watch 2-min demo
                  </a>
                </Button>
              </div>
            </div>

            {/* Why teams choose SuReSuite */}
            <div className="mt-14 border-t border-border pt-8 md:mt-20 md:pt-10">
              <div className="mb-7 max-w-xl">
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#BF2330]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#BF2330]" />
                  Why teams choose SuReSuite
                </span>
                <h2 className="mt-3.5 text-[28px] font-semibold tracking-tight leading-tight">
                  The depth of a research lab, the speed of a workspace.
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                {WHY_TEAMS.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.title}
                      className="flex flex-col gap-3 bg-card p-6 transition-colors hover:bg-secondary/40"
                    >
                      <div className="flex items-center justify-between">
                        <Icon className="h-[18px] w-[18px] text-[#BF2330]" />
                        <span className="font-mono text-[9px] tracking-[0.16em] text-muted-foreground">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <div>
                        <h3 className="text-base font-semibold leading-snug tracking-tight">
                          {item.title}
                        </h3>
                        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                          {item.body}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Deep network AI — the 3D model, three lenses */}
        <section className="border-b border-border/60 bg-black text-white">
          <div className="mx-auto max-w-6xl px-5 py-9 md:px-6 md:py-24">
            <div className="grid items-stretch gap-10 md:gap-14 lg:grid-cols-[0.85fr_1.15fr]">
              {/* Left: copy + lenses */}
              <div className="max-w-md">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#BF2330]">
                  Deep network AI
                </span>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight leading-[1.1] text-white">
                  One network, <span className="font-serif italic font-medium">three lenses.</span>
                </h2>
                <p className="mt-4 text-base leading-relaxed text-white/70">
                  SuReSuite models your supply chain as a multi-layer graph and reads all
                  three lenses at once — ranking the nodes that matter and predicting how a
                  shock on one layer cascades to the rest.
                </p>
                <div className="mt-7 flex flex-col border-t border-white/10">
                  {LENSES.map((lens, i) => (
                    <div
                      key={lens.title}
                      className={`flex gap-3.5 py-4 ${
                        i < LENSES.length - 1 ? 'border-b border-white/[0.09]' : ''
                      }`}
                    >
                      <span
                        className="mt-1.5 h-[11px] w-[11px] flex-none rounded-full"
                        style={{ background: lens.color, boxShadow: `0 0 10px ${lens.color}80` }}
                      />
                      <div>
                        <h4 className="text-[15px] font-semibold text-white">{lens.title}</h4>
                        <p className="mt-1 text-[13.5px] leading-relaxed text-white/60">
                          {lens.body}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: frameless 3D visualization with layer glows */}
              <div className="relative flex flex-col justify-center gap-5">
                <div className="relative">
                  <div
                    aria-hidden
                    className="absolute -inset-x-[4%] -inset-y-[6%]"
                    style={{
                      background:
                        'radial-gradient(ellipse 46% 22% at 54% 20%, rgba(224,147,11,0.18), transparent 70%),' +
                        'radial-gradient(ellipse 50% 24% at 50% 46%, rgba(124,58,237,0.18), transparent 70%),' +
                        'radial-gradient(ellipse 54% 26% at 46% 72%, rgba(214,168,20,0.16), transparent 70%)',
                    }}
                  />
                  <div className="relative h-[240px] md:h-[460px] lg:h-[560px]">
                    <NetworkVisualization3D />
                  </div>
                </div>
                <span className="font-mono text-[10px] tracking-[0.15em] text-white/35">
                  3-ECHELON MODEL · FIRM / PRODUCT / PROCESS
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* See SuReSuite in two minutes — intro video */}
        <section id="video" className="border-b border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-9 md:px-6 md:py-24">
            <div className="max-w-2xl">
              <span className={KICKER}>Introduction</span>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                See SuReSuite in <span className="font-serif italic font-medium">two minutes.</span>
              </h2>
              <p className="mt-4 text-base text-muted-foreground">
                A quick walkthrough — from importing your data to reading the resilience results.
              </p>
            </div>
            <div className="mt-10 overflow-hidden rounded-lg border border-border bg-black">
              <div className="relative w-full pt-[56.25%]">
                <iframe
                  title="SuReSuite introduction"
                  src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?rel=0`}
                  className="absolute inset-0 h-full w-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          </div>
        </section>

        {/* Technical Architecture */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-9 md:px-6 md:py-24">
            <div className="max-w-2xl">
              <span className={KICKER}>01 / 02 — Architecture</span>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                SuReSuite Technical Architecture
              </h2>
              <p className="mt-4 text-base text-muted-foreground">
                Explore the advanced analytics engine and simulation capabilities that power comprehensive supply chain resilience analysis.
              </p>
            </div>

            {/* Tab Navigation */}
            <div className="mt-12">
              <div
                role="tablist"
                aria-label="Technical architecture views"
                className="flex max-w-full items-stretch gap-0.5 overflow-x-auto rounded-sm border
                           border-border bg-card p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                           md:inline-flex md:overflow-visible"
              >
                {([
                  ['network', 'Network'],
                  ['nexus', 'Nexus Detection'],
                  ['simulation', 'Simulation'],
                ] as [TechKey, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={activeTech === key}
                    onClick={() => setActiveTech(key)}
                    className={`shrink-0 whitespace-nowrap min-h-11 px-4 py-2 rounded-sm text-[12.5px] md:min-h-0 md:text-sm font-medium transition-colors ${
                      activeTech === key
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content Panel */}
            <div className="relative isolate mt-10">
              <div
                aria-hidden
                className="absolute -inset-x-6 -inset-y-8 -z-10 bg-grid opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
              />
              <div role="tabpanel" className="rounded-sm border border-border bg-card overflow-hidden">
                {activeTech === 'network' && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
                    <div className="lg:col-span-1 p-8 border-b lg:border-b-0 lg:border-r border-border">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="grid h-10 w-10 place-items-center rounded-sm bg-secondary text-foreground">
                          <Share2 className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-foreground">Network Graph</h3>
                          <p className="text-sm text-muted-foreground">Multi-layer topology</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="p-4 rounded-sm border border-border bg-background">
                          <div className="flex items-center gap-2 mb-1.5">
                            <Layers3 className="h-4 w-4 text-foreground" />
                            <span className="text-sm font-semibold text-foreground">3 Network Levels</span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Process, Product, and Firm layers with interconnected dependencies.
                          </p>
                        </div>
                        <div className="p-4 rounded-sm border border-border bg-background">
                          <div className="flex items-center gap-2 mb-1.5">
                            <MapPin className="h-4 w-4 text-foreground" />
                            <span className="text-sm font-semibold text-foreground">Centrality Analysis</span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Betweenness and closeness metrics identify critical nodes.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="lg:col-span-2 h-[220px] md:h-[500px] relative bg-black">
                      <div className="absolute inset-0 opacity-[0.15] [background-image:linear-gradient(to_right,rgba(255,255,255,0.15)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.15)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
                      <div className="relative h-full">
                        <NetworkVisualization3D />
                      </div>
                    </div>
                  </div>
                )}

                {activeTech === 'nexus' && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
                    <div className="lg:col-span-1 p-8 border-b lg:border-b-0 lg:border-r border-border">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="grid h-10 w-10 place-items-center rounded-sm bg-secondary text-foreground">
                          <Crosshair className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-foreground">Nexus Detection</h3>
                          <p className="text-sm text-muted-foreground">ML-ranked criticality</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="p-4 rounded-sm border border-border bg-background">
                          <span className="block text-sm font-semibold text-foreground mb-1.5">
                            Trained on 5,000+ runs
                          </span>
                          <p className="text-sm text-muted-foreground">
                            ML algorithms learn which suppliers and materials drive cascading failures across your network.
                          </p>
                        </div>
                        <div className="p-4 rounded-sm border border-border bg-background">
                          <span className="block text-sm font-semibold text-foreground mb-1.5">
                            Early warning
                          </span>
                          <p className="text-sm text-muted-foreground">
                            Hidden single points of failure are flagged before disruptions occur.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="lg:col-span-2">
                      <StatViewport stats={NEXUS_STATS} />
                    </div>
                  </div>
                )}

                {activeTech === 'simulation' && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
                    <div className="lg:col-span-1 p-8 border-b lg:border-b-0 lg:border-r border-border">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="grid h-10 w-10 place-items-center rounded-sm bg-secondary text-foreground">
                          <Shuffle className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-foreground">Monte Carlo Simulation</h3>
                          <p className="text-sm text-muted-foreground">Strategy comparison</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="p-4 rounded-sm border border-border bg-background">
                          <span className="block text-sm font-semibold text-foreground mb-1.5">
                            Replications & warm-up
                          </span>
                          <p className="text-sm text-muted-foreground">
                            Statistically rigorous experiments with replications and warm-up periods.
                          </p>
                        </div>
                        <div className="p-4 rounded-sm border border-border bg-background">
                          <span className="block text-sm font-semibold text-foreground mb-1.5">
                            Side-by-side tactics
                          </span>
                          <p className="text-sm text-muted-foreground">
                            Dual sourcing, buffers, and capacity shifts compared under one experiment design.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="lg:col-span-2">
                      <StatViewport stats={SIMULATION_STATS} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* CTA band — black, highlighted */}
        <section className="relative overflow-hidden border-t border-border/60 bg-black text-white">
          <div
            aria-hidden
            className="absolute inset-0 opacity-50"
            style={{
              background:
                'radial-gradient(ellipse 50% 80% at 80% 50%, rgba(191,35,48,0.18), transparent 70%)',
            }}
          />
          <div className="relative mx-auto max-w-6xl px-5 py-9 md:px-6 md:py-24">
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
                  Next step
                </span>
                <h3 className="mt-3.5 max-w-2xl text-3xl font-semibold tracking-tight leading-tight text-white">
                  Put your supply chain under pressure —{' '}
                  <span className="font-serif italic font-medium">on purpose.</span>
                </h3>
                <p className="mt-3.5 max-w-xl text-base text-white/70">
                  Upload data, analyze vulnerabilities, and simulate strategies in one workspace.
                </p>
              </div>
              <Button asChild size="lg" className="group h-12 w-full shrink-0 rounded-sm bg-white text-black hover:bg-white/90 sm:w-auto">
                <Link to="/auth">
                  Start now
                  <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Roadmap */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-9 md:px-6 md:py-24">
            <div className="max-w-2xl">
              <span className={KICKER}>02 / 02 — Roadmap</span>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">Roadmap</h2>
              <p className="mt-4 text-base text-muted-foreground">What we're building next.</p>
            </div>

            <div className="mt-10 border-t border-border/60 md:mt-12">
              {ROADMAP.map((item) => (
                <div
                  key={item.title}
                  className="grid gap-2 border-b border-border/60 py-6 md:grid-cols-12 md:gap-6"
                >
                  <div className="flex items-center justify-between md:contents">
                    <span className={`${KICKER} md:col-span-2 md:pt-1`}>{item.phase}</span>
                    <span className="text-xs text-muted-foreground md:col-span-2 md:order-3 md:pt-1 md:justify-self-end">
                      {item.status}
                    </span>
                  </div>
                  <div className="md:col-span-8 md:order-2">
                    <h3 className="text-base font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Funding & attribution — content KEPT VERBATIM */}
        <section className="border-t border-border/60 bg-black text-white">
          <div className="mx-auto max-w-6xl px-5 py-9 md:px-6 md:py-16">
            <div className="grid grid-cols-1 gap-y-10 md:grid-cols-12 md:gap-x-6 items-start">
              <div className="md:col-span-4">
                <img src="/logo3.png" alt="Digital SC Lab" className="h-auto max-h-12 w-auto max-w-full mb-4" />
                <p className="text-sm text-white/80">
                  Developer: <span className="text-white">Phu Nguyen</span><br />
                  Supervisor: <span className="text-white">Prof. Dmitry Ivanov</span><br />
                  Digital SC Lab @ HWR Berlin
                </p>
              </div>
              <div className="md:col-span-7 md:col-start-6">
                <img src="/logo2.png" alt="EU / ACCURATE logo" className="h-auto max-h-12 w-auto max-w-full mb-4" />
                <p className="text-sm text-white/80">
                  The ACCURATE project is funded by the European Union, under Grant Agreement number 101138269. Views and opinions expressed are however those of the author(s) only and do not necessarily reflect those of the European Union or the European Health and Digital Executive Agency. Neither the European Union nor the granting authority can be held responsible for them.
                </p>
                <div className="mt-4 text-sm text-white/80">
                  <div><span className="font-medium text-white">Start:</span> 01/12/2023</div>
                  <div><span className="font-medium text-white">Finish:</span> 30/11/2026</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Slim footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 md:px-6 md:py-0 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} SuReSuite</span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a href="#video" className="hover:text-foreground md:hidden">Demo</a>
            <Link to="/help" className="hover:text-foreground">Docs</Link>
            <Link to="/auth" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
