// Public marketing landing at `/`. No sidebar, no auth required.
// Authenticated users are redirected to `/app` (their app home).

import { Link, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
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
    body: 'Explore firm, product, and process layers to spot propagation paths and critical dependencies.',
  },
  {
    icon: Crosshair,
    tag: 'Hidden critical detection',
    title: 'Surface nexus nodes automatically',
    body: 'ML trained on 5,000+ simulations highlights critical suppliers and cascading risks before they occur.',
  },
  {
    icon: Shuffle,
    tag: 'Strategy simulation',
    title: 'Test tactics side-by-side',
    body: 'Compare dual sourcing, buffers, and capacity shifts under known and unknown disruptions.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Import supply chain data',
    body: 'Structured CSV templates for firms, materials, and sourcing ratios.',
  },
  {
    n: '02',
    title: 'Detect vulnerabilities',
    body: 'Topology analysis surfaces nexus nodes and likely disruption cascades.',
  },
  {
    n: '03',
    title: 'Simulate resilience strategies',
    body: 'Compare mitigation tactics under diverse disruption scenarios in parallel.',
  },
];

const ARCHITECTURE = [
  {
    icon: Layers3,
    title: 'Network graph',
    bullets: ['3 layers: process, product, firm', 'Centrality & betweenness metrics'],
  },
  {
    icon: Crosshair,
    title: 'Nexus detection',
    bullets: ['ML on 5,000+ simulations', 'Cascade-risk scoring per node'],
  },
  {
    icon: Shuffle,
    title: 'Monte Carlo engine',
    bullets: ['Replications with warm-up', 'Side-by-side KPI comparison'],
  },
];

const ROADMAP = [
  {
    icon: Sparkles,
    title: 'Enhanced training',
    body: 'Broaden simulation scenarios and industry datasets for more robust models.',
    status: 'In progress',
    when: 'Q4 2025',
  },
  {
    icon: MapPin,
    title: 'GIS mapping',
    body: 'Geospatial visualization of suppliers and customers for location-based risk.',
    status: 'Planned',
    when: 'Q1 2026',
  },
  {
    icon: Layers3,
    title: 'Deep-tier analysis',
    body: 'Extend to tier-2/3 suppliers to capture cascading dependencies across the network.',
    status: 'Planned',
    when: 'Q2 2026',
  },
];

export default function Landing() {
  const { user, loading } = useAuth();

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
        <section className="relative mx-auto max-w-6xl px-6 pt-24 pb-20">
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
        <section className="mx-auto max-w-6xl px-6 pb-24">
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
        </section>

        {/* Core capabilities */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight">Core capabilities</h2>
              <p className="mt-3 text-muted-foreground">
                A focused toolkit for uncovering hidden risk and testing resilience strategies.
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

        {/* How it works */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
              <p className="mt-3 text-muted-foreground">
                Three steps from raw data to a defensible resilience plan.
              </p>
            </div>
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.n} className="relative pl-14">
                  <span className="absolute left-0 top-0 grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-sm font-semibold tabular-nums">
                    {step.n}
                  </span>
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Platform architecture */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight">Platform architecture</h2>
              <p className="mt-3 text-muted-foreground">
                The analytics engine and simulation stack behind every experiment.
              </p>
            </div>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {ARCHITECTURE.map((arch) => {
                const Icon = arch.icon;
                return (
                  <div
                    key={arch.title}
                    className="rounded-lg border border-border bg-card p-6"
                  >
                    <div className="grid h-9 w-9 place-items-center rounded-md bg-secondary text-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold">{arch.title}</h3>
                    <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                      {arch.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-2">
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/60 shrink-0" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
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
            <ol className="mt-12 divide-y divide-border/60 rounded-lg border border-border bg-card">
              {ROADMAP.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.title} className="flex items-center gap-4 p-5">
                    <div className="grid h-9 w-9 place-items-center rounded-md bg-secondary text-foreground shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{item.title}</div>
                      <p className="text-sm text-muted-foreground">{item.body}</p>
                    </div>
                    <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {item.status}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <CalendarDays className="h-3 w-3" /> {item.when}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* CTA strip */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-8 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xl font-semibold tracking-tight">
                  Ready to strengthen your supply chain?
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload data, analyze vulnerabilities, and simulate strategies in one workspace.
                </p>
              </div>
              <Button asChild size="lg">
                <Link to="/auth">
                  Get started <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Funding & attribution — KEPT VERBATIM */}
        <section className="border-t border-border/60 bg-black text-white">
          <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-12 py-16">
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
