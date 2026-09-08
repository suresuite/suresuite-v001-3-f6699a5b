// The authenticated home, phone composition (demo shot 03-home, page book 04).
//
// WHY THIS IS A SEPARATE TREE
// `GettingStarted.tsx` is the legacy visual generation - gradients, icon tiles,
// `rounded-2xl`, six accent colours - which the design system documents as
// legacy (§3.10) rather than house style. The prototype rebuilds this route in
// the current sharp vocabulary instead of reproducing it, and the page book
// (entry 04) records that as an open question: modernise desktop too, or accept
// the divergence deliberately and write it down.
//
// It is now written down. The decision is: mobile speaks the current dialect,
// desktop keeps the legacy page untouched. So this is a structural branch, not
// a `md:` reflow - which is also why `useIsMobile` is the right tool here per
// use-is-mobile.ts, and why it matters: rendering both trees would mount
// NetworkVisualization3D on phones, and the standing decision is no 3D on
// mobile.
//
// WHAT THIS RENDERS, AND WHAT IT DELIBERATELY DOES NOT
// The demo's resume card carries a relative timestamp, node/echelon counts and
// a three-row readiness checklist (data imported / policies configured /
// validated run). Every one of those needs a query this route does not make.
// Adding them would be a behaviour change, not a UI change, so this card is
// built strictly from `useGlobalProject()` - app-wide context that is already
// mounted, already populated by whichever page last selected a project, and
// costs no request. Nothing here is invented: a field the context does not hold
// is not rendered at all.

import { Link } from 'react-router-dom';
import { ChevronRight, User } from 'lucide-react';
import { KX_TIGHT, LAYER } from '@/components/intelligence/piUi';
import { useGlobalProject } from '@/hooks/useGlobalProject';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

/** Sharp-dialect card: 4px radius, 1px --hair-border, white. */
const CARD = 'overflow-hidden rounded-sm border border-[--hair-border] bg-card';

/**
 * The three steps. Display vocabulary only - each `to` is an existing route,
 * and the sub-line is a mono fact run, never a sentence (design system §3.5).
 */
const QUICK_START = [
  {
    n: '1',
    title: 'Import supply chain data',
    meta: 'CSV · nodes, edges, BOM',
    to: '/project-manager',
  },
  {
    n: '2',
    title: 'Discover critical vulnerabilities',
    meta: 'nexus nodes · single-source exposure',
    to: '/network/product-level',
  },
  {
    n: '3',
    title: 'Simulate resilience strategies',
    meta: 'replications · ±95 % CI',
    to: '/simulation-lab',
  },
] as const;

/**
 * The meta line under the project name. Built only from fields
 * `useGlobalProject` actually holds, and empty entries drop out - so a project
 * missing a model or a BOM level renders a shorter line rather than a line with
 * a hole in it.
 */
function projectMeta(p: {
  plant_name?: string | null;
  supply_chain_model?: string | null;
  bom_level?: string | null;
  deep_tier_enabled?: boolean;
}): string {
  return [
    p.plant_name,
    p.supply_chain_model,
    p.bom_level,
    p.deep_tier_enabled ? 'deep tier' : null,
  ]
    .filter((v): v is string => Boolean(v))
    .join(' · ');
}

/** Section kicker: brand-red mono label, hairline rule, right-hand count. */
function SectionRule({ label, right }: { label: string; right: string }) {
  return (
    // Neither text span may be `shrink-0` (spec §2.5 rule 2) - both take props,
    // so both are unbounded as far as the layout is concerned. The rule between
    // them is `flex-1`, so it surrenders its width first and the labels only
    // truncate once it has none left to give.
    <div className="mb-2 mt-5 flex items-center gap-2.5">
      <span
        className={cn(KX_TIGHT, 'min-w-0 truncate font-medium')}
        style={{ color: LAYER.brand }}
      >
        {label}
      </span>
      <span className="h-px min-w-0 flex-1 bg-[--hair-divider]" aria-hidden />
      <span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground">
        {right}
      </span>
    </div>
  );
}

export function MobileGettingStarted() {
  const { selectedProject } = useGlobalProject();
  const { user } = useAuth();

  const initial =
    (user?.display_name || user?.name || '')?.charAt(0).toUpperCase() || null;
  const meta = selectedProject ? projectMeta(selectedProject) : '';

  return (
    // The page's own gutter. PAGE_GUTTER is not used here because this screen
    // owns its vertical rhythm (the header sits flush at the top), but the
    // horizontal term is the same clamp, so it lines up with every other page.
    <div className="px-[clamp(0.75rem,4vw,1.125rem)] pb-6">
      <header className="flex items-center gap-3 py-3.5">
        <h1
          className="min-w-0 flex-1 truncate text-[length:var(--fs-page-title)] font-semibold leading-tight"
          title="Getting started"
        >
          Getting started
        </h1>
        <Link
          to="/profile"
          aria-label="Your profile"
          title="Your profile"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-[13px] font-semibold text-background">
            {initial ?? <User className="h-4 w-4" />}
          </span>
        </Link>
      </header>

      {/* ── Where you left off ─────────────────────────────────────────── */}
      <section className={CARD} aria-labelledby="home-resume">
        <div className="flex items-center gap-2 border-b border-[--hair-divider] px-3.5 py-2.5">
          <span id="home-resume" className={cn(KX_TIGHT, 'min-w-0 flex-1 font-medium')}>
            Where you left off
          </span>
        </div>

        {selectedProject ? (
          <div className="px-3.5 py-3.5">
            <h2
              className="truncate text-[17px] font-semibold leading-tight"
              title={selectedProject.name}
            >
              {selectedProject.name}
            </h2>
            {meta && (
              <p className="mt-1 font-mono text-[12px] leading-snug text-muted-foreground [text-wrap:pretty]">
                {meta}
              </p>
            )}
            <Link
              to="/project-manager"
              className="mt-3.5 flex min-h-12 w-full items-center justify-center rounded-sm
                         bg-foreground px-4 text-[14px] font-semibold text-background"
            >
              Continue
            </Link>
          </div>
        ) : (
          // Cold load restores the project *id* from localStorage but not the
          // project row, so this state is common rather than exceptional - it
          // gets a real destination, not an apology.
          <div className="px-3.5 py-3.5">
            <h2 className="text-[17px] font-semibold leading-tight">No project open</h2>
            <p className="mt-1 text-[length:var(--fs-body)] leading-snug text-muted-foreground [text-wrap:pretty]">
              Choose a project to pick up where you left off.
            </p>
            <Link
              to="/project-manager"
              className="mt-3.5 flex min-h-12 w-full items-center justify-center rounded-sm
                         bg-foreground px-4 text-[14px] font-semibold text-background"
            >
              Choose a project
            </Link>
          </div>
        )}
      </section>

      {/* ── Quick start ────────────────────────────────────────────────── */}
      <SectionRule label="Quick start" right="three steps" />

      <nav className={CARD} aria-label="Quick start">
        {QUICK_START.map((step, i) => (
          <Link
            key={step.to}
            to={step.to}
            className={cn(
              'flex min-h-11 items-center gap-3 px-3.5 py-3',
              i > 0 && 'border-t border-[--hair-divider]',
            )}
          >
            {/* Flat #F8D448 disc - the design system's sanctioned "begin here"
                use for Quick Start markers, without the legacy gradient. */}
            <span
              aria-hidden
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full
                         font-mono text-[12px] font-medium text-foreground"
              style={{ background: LAYER.accent }}
            >
              {step.n}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[length:var(--fs-body)] font-medium leading-snug [text-wrap:pretty]">
                {step.title}
              </span>
              <span className="mt-0.5 block font-mono text-[11.5px] leading-snug text-muted-foreground [text-wrap:pretty]">
                {step.meta}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </nav>
    </div>
  );
}

export default MobileGettingStarted;
