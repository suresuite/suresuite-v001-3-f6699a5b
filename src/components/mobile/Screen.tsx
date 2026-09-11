// The mobile screen shell: the gutter, the gap between groups, and the page
// canvas.
//
// It holds no chrome of its own — the title lives in <PageHeader>, the tab bar
// in <MobileTabBar>, the action bar in <MobileActionBar>. What it owns is the
// rhythm every screen shares, so that a screen is assembled by stacking
// children in the order spec §13 fixes:
//
//   1. Title, and at most one counter or control beside it   (PageHeader)
//   2. Segmented control, if the screen has peer views       (MobileSegmented)
//   3. The one thing that changed or needs attention         (MobilePanel)
//   4. The numbers — one stat grid                           (MobileStatGrid)
//   5. The list — panels, ordered by what is acted on first  (MobilePanel)
//   6. Consequence or caveat                                 (MobileNote)
//   7. The action bar                                        (MobileActionBar)
//
// Skip a band with nothing to hold; never reorder. A screen needing more than
// four panels is two screens — raise it rather than cramming.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { M_LABEL } from './tokens';

export function MobileScreen({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `--m-canvas` is the skin's 93% ground (v2 §2). It is deliberately
        // not `--surface-dense` (92%): the desktop canvas keeps its own
        // value, and this must be additive at the mobile breakpoint rather
        // than a re-tint of the shared token.
        //
        // The gap is the gap between GROUPS, not between panels — 18-24px by
        // viewport. Panels inside a <MobileGroup> sit 8px apart. A screen
        // with no groups keeps the old rhythm by putting its panels in one
        // unlabelled group.
        'flex min-h-full flex-col gap-[var(--m-gap)] bg-[hsl(var(--m-canvas))] px-[var(--m-gutter)] pb-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A named band of panels (v2 §2).
 *
 * The label sits on the canvas — a 10px mono micro-label, 8px above its own
 * panel and a full group gap from the next band. It names a band without
 * spending a container on it, and that is precisely what lets the ink head
 * become rare: a screen used to reach for `tone="primary"` to say "this
 * group is about runs", when what it wanted was the two words.
 *
 * This is the sanctioned exception to §12's "no borderless sections": it is a
 * label, not a container. It carries no rule, no fill and no children of its
 * own beyond the panels beneath it.
 */
export function MobileGroup({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {label && <span className={cn(M_LABEL, 'pl-px text-[#525252]')}>{label}</span>}
      {children}
    </div>
  );
}

/**
 * The wide band's two-column arrangement (v2 §5.2).
 *
 * At 520px and up — tablet portrait, a fold opened, a large phone in
 * landscape — the skin stays the skin, but a single column of panels strands
 * half the width. Groups fill in order across two columns. Below 520 it is
 * exactly the column `MobileScreen` already lays out, so a screen can wrap
 * its groups in this unconditionally.
 *
 * Above `md` the desktop system takes over as it does today, so the grid is
 * released there — a converted surface's `md:` tree is untouched by this.
 */
export function MobileGroupGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `items-start` matters: without it two columns of unequal height
        // stretch to match, and a panel with three rows grows a field of
        // white to the height of one with nine.
        'grid grid-cols-1 gap-[var(--m-gap)]',
        'min-[520px]:grid-cols-2 min-[520px]:items-start md:grid-cols-1',
        className,
      )}
    >
      {children}
    </div>
  );
}
