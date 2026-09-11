// The chrome contract's header (handoff v3 §1.1): the one component every
// mobile screen goes through, so a screen can no longer hand-roll a title row
// and drift from its neighbours the way `MobileGettingStarted` and
// `MobileIntelligence` had (grep for either pattern before adding a third).
//
// Two forms, no third:
//
//   root    — the tab-bar destinations. No back button, the 19px fluid
//             title is the destination name, the tab bar stays visible.
//   detail  — anything pushed on top (a run, a supplier, a thread, a step
//             of a track). A 32px back target, an 18px fixed title that is
//             the OBJECT's own name, and the caller hides the tab bar itself
//             — this component has no opinion on navigation.
//
// Render it as a SIBLING before a screen's padded content, never nested
// inside a `PAGE_GUTTER_SKIN`/`M_SCREEN` wrapper: it carries its own
// `var(--m-gutter)` gutter and its own vertical rhythm (`pt-0.5 pb-3`), and
// nesting it inside another gutter doubles the inset (v3 §1.1).
//
//   <MobilePageHeader variant="root" title="Policies" meta="24">
//     <ProjectChip .../>
//   </MobilePageHeader>
//   <div className={PAGE_GUTTER_SKIN}>…</div>
//
// The meta slot is a count (root) or a state (detail) — mono, never
// truncating, never a button, UNLESS the screen genuinely needs one header
// action, in which case that single action lives there at a 32px target.
// Everything else belongs in the footer action bar; a mobile header is not a
// toolbar (v3 §1.1).
//
// `children` is the optional second row — a project chip, a search field,
// segmented tabs, context chips — pinned with the title because it lives in
// the same fixed block.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { M_MICRO } from './tokens';

/**
 * True once the page has scrolled past its top edge. The header's only
 * scroll response (v3 §1.2): no rule at `scrollTop === 0`, a faded-in
 * `#d4d4d4` rule past it. No shrinking title, no swapping content, no blur,
 * no hide-on-scroll — this hook is the entire difference.
 *
 * The app has no separate scrolling body element (`PageLayout`'s wrapper is
 * `overflow-x-clip`, not a scrollport — see its own comment), so this reads
 * the document's own scroll position rather than a container ref.
 */
function useHeaderScrolled(): boolean {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    let frame = 0;
    const read = () =>
      (document.scrollingElement?.scrollTop ?? window.scrollY ?? 0) > 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrolled(read()));
    };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', sync);
    };
  }, []);

  return scrolled;
}

interface MobilePageHeaderProps {
  variant?: 'root' | 'detail';
  /** Root: the destination name. Detail: the object's own name. One line,
   *  ellipsis — never the project name (that is the chip's job, v3 §1.4). */
  title: string;
  /** A count (root) or a state (detail). Mono, 11px, never truncates. Pass
   *  a 32px-square button here for the one sanctioned header action. */
  meta?: React.ReactNode;
  /** Detail only. The caller owns navigation and hiding the tab bar. */
  onBack?: () => void;
  backLabel?: string;
  /** Detail only — mono 10px, naming the object's owner or kind (SC
   *  Intelligences handoff §3: `SM · simulation modeller`). */
  subtitle?: string;
  /** The optional second row: project chip, search, segmented tabs. */
  children?: React.ReactNode;
  className?: string;
}

export function MobilePageHeader({
  variant = 'root',
  title,
  meta,
  onBack,
  backLabel = 'Back',
  subtitle,
  children,
  className,
}: MobilePageHeaderProps) {
  const scrolled = useHeaderScrolled();
  const detail = variant === 'detail';

  return (
    <div
      className={cn(
        // Fixed to the top of the scroll flow, on the canvas — no white
        // ground, no blur, no tint of its own (v3 §1.1).
        'sticky top-0 z-40 flex flex-col gap-2.5 bg-[hsl(var(--m-canvas))]',
        'px-[var(--m-gutter)] pb-3 pt-0.5',
        'border-b border-b-transparent transition-[border-color] duration-200 motion-reduce:transition-none',
        scrolled && 'border-b-[#d4d4d4]',
        className,
      )}
    >
      <div className="flex min-h-8 items-center gap-2">
        {detail && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            title={backLabel}
            // 32px visual target (v3 §1.1), with the same transparent hit-area
            // expansion the toggle and stepper use to still clear the 44px
            // touch floor without growing the glyph itself.
            className="relative -ml-2 grid h-[32px] w-[32px] shrink-0 place-items-center text-[#18181b] after:absolute after:-inset-1.5 after:content-['']"
          >
            <span aria-hidden className="text-[19px] leading-none">
              ‹
            </span>
          </button>
        )}

        <span className="min-w-0 flex-1">
          <h1
            className={cn(
              'truncate font-semibold leading-tight tracking-[-0.019em] text-[#171717]',
              detail ? 'text-[18px]' : 'text-[length:var(--fs-title)]',
            )}
            title={title}
          >
            {title}
          </h1>
          {subtitle && (
            <span className="block truncate font-mono text-[10px] text-[#9a9a9a]">{subtitle}</span>
          )}
        </span>

        {meta != null && (
          <span
            className={cn(M_MICRO, 'shrink-0 whitespace-nowrap')}
          >
            {meta}
          </span>
        )}
      </div>

      {children && <div className="flex items-center gap-2.5">{children}</div>}
    </div>
  );
}
