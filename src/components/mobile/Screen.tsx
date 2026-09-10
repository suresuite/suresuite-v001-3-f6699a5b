// The mobile screen shell: the 16px gutter, the 12px gap between panels, and
// the page canvas.
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
        // `--m-canvas` is the skin's 96% ground. It is deliberately not
        // `--surface-dense` (92%): the desktop canvas keeps its own value,
        // and this must be additive at the mobile breakpoint rather than a
        // re-tint of the shared token.
        'flex min-h-full flex-col gap-3 bg-[hsl(var(--m-canvas))] px-4 pb-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
