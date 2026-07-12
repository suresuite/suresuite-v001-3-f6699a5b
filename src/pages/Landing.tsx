// Public marketing landing at `/`. No sidebar, no auth required.
// Authenticated users are redirected to `/app` (their app home).

import { Link, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { ArrowRight, Database, FlaskConical, LineChart } from 'lucide-react';

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

      {/* Hero */}
      <main className="flex-1">
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
      </main>

      {/* Footer */}
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
