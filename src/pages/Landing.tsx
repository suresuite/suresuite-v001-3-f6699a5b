// Public marketing landing at `/`. No sidebar, no auth required.
// Authenticated users are redirected to `/app` (their app home).

import { Link, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import NetworkVisualization3D from '@/components/NetworkVisualization3D';
import {
  ArrowRight,
  Database,
  FlaskConical,
  LineChart,
  Network,
  Crosshair,
  Shuffle,
  Sparkles,
  MapPin,
  Layers3,
  Share2,
  CalendarDays,
} from 'lucide-react';

const VALUE_TILES = [
  {
    icon: Database,
    title: 'Model your network',
    body: 'Import suppliers, plants, and flows. One canonical graph across every scenario.',
  },
  {
    icon: FlaskConical,
    title: 'Simulate disruptions',
    body: 'Stress-test policies with the resilience-grade engine. Replications, warm-up, KPIs.',
  },
  {
    icon: LineChart,
    title: 'Decide with evidence',
    body: 'Compare strategies on cost, service, and resilience. Ship the plan with confidence.',
  },
];

const CREDIBILITY = [
  '3 network levels',
  '5k+ simulations',
  '5 resilience tactics',
  'Scenario library',
];

const CAPABILITIES = [
  {
    icon: Network,
    tag: 'Interactive network graph',
    title: 'See disruption impact fast',
    body: 'Explore your network at three levels—firm, product, and process—to spot propagation paths and critical dependencies.',
  },
  {
    icon: Crosshair,
    tag: 'Hidden critical detection',
    title: 'Surface nexus nodes automatically',
    body: 'ML trained on 5,000 simulations highlights critical suppliers/materials and cascading risks before they occur.',
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
    icon: Sparkles,
    title: 'Enhanced Training',
    body: 'Broaden simulation scenarios and industry datasets to improve model robustness.',
    status: 'In progress',
    when: 'Q4 2025',
  },
  {
    icon: MapPin,
    title: 'GIS Mapping',
    body: 'Geospatial visualization of suppliers/customers for location-based risk analysis.',
    status: 'Planned',
    when: 'Q1 2026',
  },
  {
    icon: Layers3,
    title: 'Deep-Tier Analysis',
    body: 'Extend to tier-2/3 suppliers to capture cascading dependencies across the network.',
    status: 'Planned',
    when: 'Q2 2026',
  },
];

type TechKey = 'network' | 'nexus' | 'simulation';

export default function Landing() {
  const { user, loading } = useAuth();
  const [activeTech, setActiveTech] = useState<TechKey>('network');

  // Auto-rotate through architecture tabs once
  useEffect(() => {
    const t1 = setTimeout(() => setActiveTech('nexus'), 3000);
    const t2 = setTimeout(() => setActiveTech('simulation'), 6000);
    const t3 = setTimeout(() => setActiveTech('network'), 9000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

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
        <section className="relative mx-auto max-w-6xl px-6 pt-24 pb-24">
          <div className="absolute inset-0 -z-10 bg-grid opacity-[0.35] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
          <div className="max-w-3xl">
            <span className="inline-flex items-center rounded-full border border-border bg-surface-elevated px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Resilience-grade supply chain simulator
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
              Design supply chains that survive the next shock.
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
              Build a digital twin of your network, run rigorous experiments, and pick the strategy that holds up.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/auth">
                  Get started <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/auth">Sign in</Link>
              </Button>
            </div>
            <ul className="mt-10 flex flex-wrap gap-2">
              {CREDIBILITY.map((c) => (
                <li
                  key={c}
                  className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground"
                >
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Value tiles */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="grid gap-4 md:grid-cols-3">
              {VALUE_TILES.map((tile) => {
                const Icon = tile.icon;
                return (
                  <div
                    key={tile.title}
                    className="rounded-lg border border-border bg-card p-6 shadow-xs transition-shadow hover:shadow-sharp-sm"
                  >
                    <div className="grid h-9 w-9 place-items-center rounded-md bg-secondary text-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold">{tile.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                      {tile.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Core Capabilities */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight">Core Capabilities</h2>
              <p className="mt-3 text-muted-foreground">
                Discover hidden vulnerabilities and test resilience strategies with SuReSuite's comprehensive supply chain analysis platform.
              </p>
            </div>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {CAPABILITIES.map((cap) => {
                const Icon = cap.icon;
                return (
                  <div
                    key={cap.title}
                    className="rounded-lg border border-border bg-card p-6 shadow-xs transition-shadow hover:shadow-sharp-sm"
                  >
                    <div className="grid h-9 w-9 place-items-center rounded-md bg-secondary text-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {cap.tag}
                    </div>
                    <h3 className="mt-1 text-base font-semibold">{cap.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                      {cap.body}
                    </p>
                  </div>
                );
              })}
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
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight">SuReSuite Technical Architecture</h2>
              <p className="mt-3 text-muted-foreground">
                Explore the advanced analytics engine and simulation capabilities that power comprehensive supply chain resilience analysis.
              </p>
            </div>

            {/* Tab Navigation */}
            <div className="mt-12 flex justify-center">
              <div className="inline-flex rounded-lg border border-border bg-card p-1">
                {([
                  ['network', 'Network'],
                  ['nexus', 'Nexus Detection'],
                  ['simulation', 'Simulation'],
                ] as [TechKey, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setActiveTech(key)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
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
            <div className="mt-10 rounded-lg border border-border bg-card overflow-hidden">
              {activeTech === 'network' && (
                <div className="grid lg:grid-cols-3 gap-0">
                  {/* Left: Info Panel */}
                  <div className="lg:col-span-1 p-8 border-b lg:border-b-0 lg:border-r border-border">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="grid h-10 w-10 place-items-center rounded-md bg-secondary text-foreground">
                        <Share2 className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">Network Graph</h3>
                        <p className="text-sm text-muted-foreground">Multi-layer topology</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="p-4 rounded-md border border-border bg-background">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Layers3 className="h-4 w-4 text-foreground" />
                          <span className="text-sm font-semibold text-foreground">3 Network Levels</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Process, Product, and Firm layers with interconnected dependencies.
                        </p>
                      </div>

                      <div className="p-4 rounded-md border border-border bg-background">
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

                  {/* Right: 3D Visualization — kept */}
                  <div className="lg:col-span-2 h-[500px] relative bg-neutral-950">
                    <div className="absolute inset-0 opacity-[0.15] [background-image:linear-gradient(to_right,rgba(255,255,255,0.15)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.15)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
                    <div className="relative h-full">
                      <NetworkVisualization3D />
                    </div>
                  </div>
                </div>
              )}

              {activeTech === 'nexus' && (
                <div className="p-12 text-center min-h-[500px] flex flex-col items-center justify-center">
                  <div className="grid h-14 w-14 place-items-center rounded-md bg-secondary text-foreground mb-6">
                    <Crosshair className="h-7 w-7" />
                  </div>
                  <h3 className="text-2xl font-semibold text-foreground mb-3">Nexus Node Detection</h3>
                  <p className="text-muted-foreground max-w-lg mx-auto">
                    ML algorithms trained on 5,000+ simulations identify critical suppliers and materials that could cause cascading failures across your network.
                  </p>
                </div>
              )}

              {activeTech === 'simulation' && (
                <div className="p-12 text-center min-h-[500px] flex flex-col items-center justify-center">
                  <div className="grid h-14 w-14 place-items-center rounded-md bg-secondary text-foreground mb-6">
                    <Shuffle className="h-7 w-7" />
                  </div>
                  <h3 className="text-2xl font-semibold text-foreground mb-3">Monte Carlo Simulation</h3>
                  <p className="text-muted-foreground max-w-lg mx-auto">
                    Test multiple resilience strategies side-by-side using advanced simulation scenarios to compare performance under various disruption conditions.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Ready to boost */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-8 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xl font-semibold tracking-tight">
                  Ready to boost the resilience of your supply chain?
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload data, analyze vulnerabilities, and simulate strategies in one workspace.
                </p>
              </div>
              <Button asChild size="lg">
                <Link to="/auth">
                  Start now <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Roadmap */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight">Roadmap</h2>
              <p className="mt-3 text-muted-foreground">What we're building next.</p>
            </div>

            <div className="relative mt-12 max-w-5xl">
              <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
              <ol className="space-y-3">
                {ROADMAP.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.title} className="relative pl-16">
                      <div className="absolute left-0 top-0 h-10 w-10 rounded-full border border-border bg-background grid place-items-center">
                        <Icon className="h-4 w-4 text-foreground" />
                      </div>
                      <div className="rounded-lg border border-border bg-card p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="text-sm">
                            <span className="font-semibold text-foreground">{item.title}.</span>{' '}
                            <span className="text-muted-foreground">{item.body}</span>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {item.status}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <CalendarDays className="h-3 w-3" /> {item.when}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>

        {/* Funding & attribution — KEPT VERBATIM */}
        <section className="border-t border-border/60 bg-black text-white">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="grid grid-cols-1 md:[grid-template-columns:30%_17%_53%] items-start gap-0">
              {/* Left: Developer / Digital SC Lab */}
              <div className="md:justify-self-start w-full">
                <img src="/logo3.png" alt="Digital SC Lab" className="h-12 w-auto mb-4" />
                <p className="text-sm text-white/80">
                  Developer: <span className="text-white">Phu Nguyen</span><br />
                  Supervisor: <span className="text-white">Prof. Dmitry Ivanov</span><br />
                  Digital SC Lab @ HWR Berlin
                </p>
              </div>
              {/* Middle spacer */}
              <div aria-hidden className="hidden md:block" />
              {/* Right: ACCURATE / EU */}
              <div className="md:justify-self-start">
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
