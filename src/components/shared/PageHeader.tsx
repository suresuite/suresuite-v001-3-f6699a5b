import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAGE_GUTTER_BLEED } from './PageBody';

// The app header, published as three class constants.
//
// Two screens compose their own header row rather than calling <PageHeader>:
// mobile Getting Started (an avatar link where the actions go) and mobile
// Project Intelligence (a two-line title stack inside a fixed-height flex
// column). Before this, each re-declared the chrome by hand and all three
// drifted - different tint, different rule, different gutter, different title
// scale. The chrome now has one definition and they wear it.
//
// SHELL is the bar itself. It is `sticky top-0`, which only pins because
// PageLayout's content wrapper is `overflow-x-clip`: `overflow-x-hidden`
// computes `overflow-y: auto`, making that wrapper a scroll container that
// never scrolls, and a sticky child of a scrollport that does not move never
// sticks. Change that class and every header in the product silently unpins.
export const PAGE_HEADER_SHELL =
  'sticky top-0 z-40 bg-header-background/95 backdrop-blur-md border-b border-header-border';

// ROW is the app gutter (PageBody's clamp, term for term) plus the header's
// own vertical rhythm and the gap between back / title / actions.
export const PAGE_HEADER_ROW =
  'flex items-center gap-2 px-[clamp(0.75rem,4vw,1.125rem)] py-2.5 md:gap-4 md:px-8 md:py-3.5';

// TITLE is the one page-title scale: --fs-page-title on mobile (spec 2.2),
// the audit's 15px from `md` up.
export const PAGE_HEADER_TITLE =
  'text-[length:var(--fs-page-title)] md:text-[15px] font-semibold text-foreground leading-tight truncate';

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  rightContent?: React.ReactNode;
  onRefresh?: () => void;
  refreshLoading?: boolean;
  /**
   * Mobile-only back affordance (spec §4.1). Pass this only where the screen
   * genuinely has a parent to return to - it is not decoration, and it does
   * not render at all above `md`, where the sidebar carries the hierarchy.
   * The caller owns the navigation; PageHeader stays routing-free.
   */
  onBack?: () => void;
  backLabel?: string;
}

export function PageHeader({
  title,
  subtitle,
  rightContent,
  onRefresh,
  refreshLoading = false,
  onBack,
  backLabel = 'Back',
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        PAGE_HEADER_SHELL,
        'mb-4 md:mb-5',
        PAGE_GUTTER_BLEED,
      )}
    >
      {/* Inner padding mirrors the gutter on mobile and holds the audit's
          px-8 py-3.5 from `md` up (C3). */}
      <div className={PAGE_HEADER_ROW}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            title={backLabel}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border bg-card text-foreground md:hidden"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <h1 className={PAGE_HEADER_TITLE} title={title}>
            {title}
          </h1>
          {subtitle && (
            <div className="text-[12px] text-muted-foreground mt-0.5 truncate">
              {subtitle}
            </div>
          )}
        </div>

        {/* Right slot: 44px touch floor below `md` (spec §0.3 amendment 2),
            the audit's h-8 buttons / h-9 selects from `md` up (C3). The floor
            is min-height/min-width so it can never shrink a control that is
            already larger, and it is released at `md` rather than overridden.
            Inputs and selects are covered too — the admin search fields live
            here and a thumb has to hit them like anything else. */}
        <div
          className={cn(
            'flex items-center gap-1.5 shrink-0 md:gap-2',
            '[&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11 [&_select]:min-h-11',
            'md:[&_button]:min-h-0 md:[&_button]:min-w-0 md:[&_input]:min-h-0 md:[&_select]:min-h-0',
          )}
        >
          {onRefresh && (
            <Button
              onClick={onRefresh}
              disabled={refreshLoading}
              variant="outline"
              size="icon"
              className="h-11 w-11 md:h-8 md:w-8"
              aria-label="Refresh data"
              title="Refresh data"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshLoading ? 'animate-spin' : ''}`} />
            </Button>
          )}
          {rightContent}
        </div>
      </div>
    </div>
  );
}
