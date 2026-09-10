// The authenticated home, phone composition (demo shot 03-home, page book 04).
//
// WHY THIS IS A SEPARATE TREE
// `GettingStarted.tsx` is the legacy visual generation - gradients, icon tiles,
// `rounded-2xl`, six accent colours - which the design system documents as
// legacy (§3.10) rather than house style. The mobile skin rebuilds this route
// in the current sharp vocabulary instead of reproducing it, and the page book
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
// The reference's resume card carries a relative timestamp, node/echelon counts
// and a three-row readiness checklist (data imported / policies configured /
// validated run). Every one of those needs a query this route does not make.
// Adding them would be a behaviour change, not a UI change, so this card is
// built strictly from `useGlobalProject()` - app-wide context that is already
// mounted, already populated by whichever page last selected a project, and
// costs no request. Nothing here is invented: a field the context does not hold
// is not rendered at all.
//
// THE SKIN (docs/mobile-skin-spec.md). Two panels and one pinned action, in
// §13's order. "Continue" leaves the card it used to sit inside and becomes the
// screen's single primary action; the section rule above Quick start goes, and
// its label becomes that panel's head — the skin has no borderless section.

import { Link, useNavigate } from 'react-router-dom';
import { User } from 'lucide-react';
import { useGlobalProject } from '@/hooks/useGlobalProject';
import { useAuth } from '@/hooks/useAuth';
import {
  M,
  MobileActionBar,
  MobileChip,
  MobilePanel,
  MobileRow,
} from '@/components/mobile';

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

export function MobileGettingStarted() {
  const { selectedProject } = useGlobalProject();
  const { user } = useAuth();
  const navigate = useNavigate();

  const initial =
    (user?.display_name || user?.name || '')?.charAt(0).toUpperCase() || null;
  const meta = selectedProject ? projectMeta(selectedProject) : '';

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {/* §4's title band: a 19px title and one right-hand element. The avatar
          is that element — an icon-only control at the spec's 34px, with the
          label and title an icon-only control always carries. */}
      <div className="flex items-center justify-between gap-2.5 pt-1">
        <h1
          className="min-w-0 flex-1 truncate text-[19px] font-semibold leading-tight tracking-[-0.019em] text-[#18181b]"
          title="Getting started"
        >
          Getting started
        </h1>
        <Link
          to="/profile"
          aria-label="Your profile"
          title="Your profile"
          className="grid h-11 w-11 shrink-0 place-items-center"
        >
          <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#18181b] font-mono text-[11px] font-semibold text-white">
            {initial ?? <User className="h-4 w-4" />}
          </span>
        </Link>
      </div>

      {/* ── Where you left off ─────────────────────────────────────────── */}
      <MobilePanel
        label="Where you left off"
        counter={selectedProject ? undefined : 'none'}
      >
        {selectedProject ? (
          <div className="flex flex-col gap-1.5 p-3">
            <span
              className="truncate text-[14px] font-semibold tracking-[-0.006em] text-[#18181b]"
              title={selectedProject.name}
            >
              {selectedProject.name}
            </span>
            {meta && (
              <span className="font-mono text-[10.5px] leading-tight tracking-[0.04em] text-[#525252] [text-wrap:pretty]">
                {meta}
              </span>
            )}
          </div>
        ) : (
          // Cold load restores the project *id* from localStorage but not the
          // project row, so this state is common rather than exceptional - it
          // gets a real destination, not an apology.
          <div className="flex flex-col gap-1.5 p-3">
            <span className="text-[14px] font-semibold tracking-[-0.006em] text-[#18181b]">
              No project open
            </span>
            <span className="text-[12.5px] leading-[1.45] text-[#525252] [text-wrap:pretty]">
              Choose a project to pick up where you left off.
            </span>
          </div>
        )}
      </MobilePanel>

      {/* ── Quick start ────────────────────────────────────────────────── */}
      <MobilePanel label="Quick start" counter={`${QUICK_START.length}`}>
        {QUICK_START.map((step) => (
          <MobileRow
            key={step.to}
            onClick={() => navigate(step.to)}
            leading={
              // #F8D448 is "begin here", and only that — the template
              // download, the walkthrough, and these three markers (§3).
              <MobileChip fill={M.begin}>{step.n}</MobileChip>
            }
            label={step.title}
            sub={step.meta}
          />
        ))}
      </MobilePanel>

      {/* §8 — the one primary action, pinned. */}
      <MobileActionBar
        primary={{
          label: selectedProject ? 'Continue' : 'Choose a project',
          onClick: () => navigate('/project-manager'),
        }}
      />
    </div>
  );
}

export default MobileGettingStarted;
