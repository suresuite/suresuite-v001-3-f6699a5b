// Public marketing landing at `/`. No sidebar, no auth required.
// Authenticated users are redirected to `/app` (their app home).

import { Link, Navigate } from 'react-router-dom';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import NetworkVisualization3D from '@/components/NetworkVisualization3D';
import {
  ArrowRight,
  Network,
  Crosshair,
  Shuffle,
  MapPin,
  Layers3,
  Share2,
} from 'lucide-react';

// Canonical micro-label style — the only uppercase label treatment on this page.
const KICKER = 'font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground';

const SIGNAL_STRIP = [
  { label: 'Network layers', value: 'Firm · Product · Process' },
  { label: 'Training corpus', value: '5,000+ simulation runs' },
  { label: 'Resilience tactics', value: '5 comparable strategies' },
  { label: 'Scenario library', value: 'Known & unknown disruptions' },
];

const CAPABILITIES = [
  {
    icon: Network,
    tag: 'Interactive network graph',
    title: 'See disruption impact fast',
    body: 'Explore your network at three levels—firm, product, and process—to spot propagation paths and critical dependencies.',
  },
  {
    icon: Shuffle,
    tag: 'Strategy simulation',
    title: 'Test tactics side-by-side',
    body: 'Compare dual sourcing, buffers, and capacity shifts under known & unknown disruptions with real-time analysis.',
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
  // Always-dark viewport, matching the 3D visualization panel.
  return (
    <div className="relative min-h-[320px] lg:h-[500px] bg-black">
      <div className="grid h-full place-content-center p-8">
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

export default function Landing() {
  const { user, loading } = useAuth();
  const [activeTech, setActiveTech] = useState<TechKey>('network');

  if (loading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background">
        <div className="h-8 w-8 rounded-full border-b-2 border-primary animate-spin" />
      </div>
    );
  }

  if (user) return <Navigate to="/app" replace />;

  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="SuReSuite" className="h-6 object-contain" />
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/help">Docs</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/auth">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pt-20 pb-24">
          {/* Top meta line */}
          <div className="mb-12 flex items-center gap-4">
            <div className="h-px flex-1 bg-border" />
            <span className={KICKER}>System: SuReSuite-v2.0 // Active</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Eyebrow */}
          <span className="inline-flex items-center rounded-sm border border-border bg-card px-3 py-1.5">
            <span className="mr-2 h-1.5 w-1.5 rounded-full bg-foreground animate-pulse" />
            <span className={KICKER}>Resilience-grade supply chain simulator</span>
          </span>

          {/* Headline block */}
          <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-12">
            <div className="md:col-span-8">
              <h1 className="text-4xl font-semibold tracking-tight leading-[1.1] sm:text-5xl md:text-6xl">
                Design supply chains that survive{' '}
                <span className="font-serif italic">the next shock.</span>
              </h1>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="group rounded-sm">
                  <Link to="/auth">
                    Get started
                    <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Marginalia subhead */}
            <div className="flex flex-col justify-end md:col-span-4">
              <div className="border-l border-border pl-6 py-2">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Build a digital twin of your network, run rigorous experiments, and pick the strategy that holds up under pressure.
                </p>
              </div>
            </div>
          </div>

          {/* Signal strip */}
          <div className="mt-16 border-t border-border pt-6">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              {SIGNAL_STRIP.map((item) => (
                <div key={item.label} className="space-y-1.5">
                  <span className={`block ${KICKER}`}>{item.label}</span>
                  <span className="block text-sm font-medium text-foreground tabular-nums">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Core Capabilities */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="max-w-2xl">
              <span className={KICKER}>01 / 03 — Capabilities</span>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">Core capabilities</h2>
              <p className="mt-4 text-base text-muted-foreground">
                Model your network, simulate disruptions, and decide with evidence — one workspace from data import to strategy comparison.
              </p>
            </div>

            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {/* Featured capability */}
              <div className="flex flex-col rounded-sm border border-border bg-card p-8 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Crosshair className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className={KICKER}>Hidden critical detection</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight">
                  Surface nexus nodes automatically
                </h3>
                <p className="mt-2 mb-6 max-w-xl text-sm text-muted-foreground leading-relaxed">
                  ML trained on 5,000 simulations highlights critical suppliers/materials and cascading risks before they occur.
                </p>
                <p className="mt-auto border-t border-border/60 pt-4 font-serif italic text-sm text-muted-foreground">
                  The nodes that break your network are rarely the ones you watch.
                </p>
              </div>

              {/* Compact capabilities */}
              <div className="flex flex-col gap-8">
                {CAPABILITIES.map((cap) => {
                  const Icon = cap.icon;
                  return (
                    <div key={cap.title} className="flex-1 rounded-sm border border-border bg-card p-6">
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className={KICKER}>{cap.tag}</span>
                      </div>
                      <h3 className="mt-4 text-base font-semibold">{cap.title}</h3>
                      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                        {cap.body}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Quick Start with SuReSuite — KEPT VERBATIM */}
        <section className="border-t border-border/60 bg-black text-white">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="mb-8">
              <h2 className="text-3xl font-bold tracking-tight mb-2 text-[#BF2330]">
                Quick Start with SuReSuite
              </h2>
              <p className="text-lg text-white/70">
                Transform your supply chain resilience analysis in three simple steps.
              </p>
            </div>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-white/10 pb-8 mb-12 gap-6">
              <div>
                <h3 className="text-2xl font-bold text-white mb-2">
                  Ready to strengthen your supply chain?
                </h3>
                <p className="text-white/70 text-lg">
                  Upload data → Analyze vulnerabilities → Simulate strategies
                </p>
              </div>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="rounded-full bg-background/10 border-white/20 text-white hover:bg-background/20 transition-all duration-200 hover:scale-105"
              >
                <Link to="/auth">
                  Launch SuReSuite <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
              <div className="group py-8 md:px-6 transition-all duration-300 hover:transform hover:scale-105">
                <div className="mb-4 flex items-center gap-3 text-sm text-white/60">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-[#F8D448] to-[#F8D448]/80 text-foreground font-bold shadow-lg">
                    1
                  </span>
                  <span className="uppercase tracking-wider font-medium">Data Upload</span>
                </div>
                <h3 className="text-2xl font-bold mb-3 text-white">Import Supply Chain Data</h3>
                <p className="text-white font-semibold mb-2">Use SuReSuite's structured CSV template.</p>
                <p className="text-white/80 leading-relaxed">
                  Define firms, materials, and connections with precise sourcing ratios for comprehensive network mapping.
                </p>
              </div>

              <div className="group py-8 md:px-6 transition-all duration-300 hover:transform hover:scale-105">
                <div className="mb-4 flex items-center gap-3 text-sm text-white/60">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-[#F8D448] to-[#F8D448]/80 text-foreground font-bold shadow-lg">
                    2
                  </span>
                  <span className="uppercase tracking-wider font-medium">AI Analysis</span>
                </div>
                <h3 className="text-2xl font-bold mb-3 text-white">Discover Critical Vulnerabilities</h3>
                <p className="text-white font-semibold mb-2">Advanced ML algorithms identify hidden nexus points.</p>
                <p className="text-white/80 leading-relaxed">
                  Network topology analysis reveals critical nodes and potential disruption cascades before they occur.
                </p>
              </div>

              <div className="group py-8 md:px-6 transition-all duration-300 hover:transform hover:scale-105">
                <div className="mb-4 flex items-center gap-3 text-sm text-white/60">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-[#F8D448] to-[#F8D448]/80 text-foreground font-bold shadow-lg">
                    3
                  </span>
                  <span className="uppercase tracking-wider font-medium">Strategy Testing</span>
                </div>
                <h3 className="text-2xl font-bold mb-3 text-white">Simulate Resilience Strategies</h3>
                <p className="text-white font-semibold mb-2">Compare multiple mitigation tactics simultaneously.</p>
                <p className="text-white/80 leading-relaxed">
                  Test dual sourcing, inventory buffers, and capacity adjustments under diverse disruption scenarios.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Technical Architecture */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="max-w-2xl">
              <span className={KICKER}>02 / 03 — Architecture</span>
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
                className="inline-flex rounded-sm border border-border bg-card p-1"
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
                    className={`px-4 py-2 rounded-sm text-sm font-medium transition-colors ${
                      activeTech === key
                        ? 'bg-secondary text-foreground'
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
                  <div className="grid lg:grid-cols-3 gap-0">
                    {/* Left: Info Panel */}
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

                    {/* Right: 3D Visualization — kept. Always-dark viewport: the canvas is
                        transparent and its legend is white, so this surface must not follow
                        the theme. */}
                    <div className="lg:col-span-2 h-[500px] relative bg-black">
                      <div className="absolute inset-0 opacity-[0.15] [background-image:linear-gradient(to_right,rgba(255,255,255,0.15)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.15)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
                      <div className="relative h-full">
                        <NetworkVisualization3D />
                      </div>
                    </div>
                  </div>
                )}

                {activeTech === 'nexus' && (
                  <div className="grid lg:grid-cols-3 gap-0">
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
                  <div className="grid lg:grid-cols-3 gap-0">
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

        {/* CTA band */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <span className={KICKER}>Next step</span>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight">
                  Put your supply chain under pressure — on purpose.
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Upload data, analyze vulnerabilities, and simulate strategies in one workspace.
                </p>
              </div>
              <Button asChild size="lg" className="group shrink-0 rounded-sm">
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
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="max-w-2xl">
              <span className={KICKER}>03 / 03 — Roadmap</span>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">Roadmap</h2>
              <p className="mt-4 text-base text-muted-foreground">What we're building next.</p>
            </div>

            <div className="mt-12 border-t border-border/60">
              {ROADMAP.map((item) => (
                <div
                  key={item.title}
                  className="grid gap-2 border-b border-border/60 py-6 md:grid-cols-12 md:gap-6"
                >
                  <span className={`${KICKER} pt-1 md:col-span-2`}>{item.phase}</span>
                  <div className="md:col-span-8">
                    <h3 className="text-base font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{item.body}</p>
                  </div>
                  <span className="pt-1 text-xs text-muted-foreground md:col-span-2 md:justify-self-end">
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Funding & attribution — content KEPT VERBATIM; layout on the shared 12-col rail */}
        <section className="border-t border-border/60 bg-black text-white">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="grid grid-cols-1 gap-y-10 md:grid-cols-12 md:gap-x-6 items-start">
              {/* Left: Developer / Digital SC Lab */}
              <div className="md:col-span-4">
                <img src="/logo3.png" alt="Digital SC Lab" className="h-12 w-auto mb-4" />
                <p className="text-sm text-white/80">
                  Developer: <span className="text-white">Phu Nguyen</span><br />
                  Supervisor: <span className="text-white">Prof. Dmitry Ivanov</span><br />
                  Digital SC Lab @ HWR Berlin
                </p>
              </div>
              {/* Right: ACCURATE / EU */}
              <div className="md:col-span-7 md:col-start-6">
                <img src="/logo2.png" alt="EU / ACCURATE logo" className="h-12 w-auto mb-4" />
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
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} SuReSuite</span>
          <div className="flex items-center gap-4">
            <Link to="/help" className="hover:text-foreground">Docs</Link>
            <Link to="/auth" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
