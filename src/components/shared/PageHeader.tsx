import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAGE_GUTTER_BLEED, PAGE_GUTTER_SKIN_BLEED } from './PageBody';
import { HDR_ICON_BUTTON } from './headerControls';
import { useCompactChrome } from '@/hooks/useViewport';

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
//
// From `md` up the bar is the unified desktop header (handoff "Unified Desktop
// Page Header"): flat `--background`, no tint and no backdrop-blur, and one
// `--border` hairline underneath — nothing else. Below `md` the mobile chrome
// is byte-identical to what it was; every desktop value is added as an `md:`
// term rather than by replacing the mobile one.
export const PAGE_HEADER_SHELL =
  'sticky top-0 z-40 bg-header-background/95 backdrop-blur-md border-b border-header-border ' +
  'md:bg-background md:backdrop-blur-none md:border-border';

// ROW is the app gutter (PageBody's clamp, term for term) plus the header's
// own vertical rhythm and the gap between back / title / actions.
//
// The desktop terms are the handoff's bar: 52px min-height (fluid — it grows
// rather than clips when the right slot wraps), a 24px gutter, 8px of vertical
// padding so a 36px control clears the 52px bar, and 12px between the title and
// the slot.
export const PAGE_HEADER_ROW =
  'flex items-center gap-2 px-[clamp(0.75rem,4vw,1.125rem)] py-2.5 ' +
  'md:min-h-[52px] md:flex-wrap md:gap-3 md:px-6 md:py-2';

// TITLE is the one page-title scale: --fs-page-title on mobile (spec 2.2),
// the audit's 15px from `md` up.
export const PAGE_HEADER_TITLE =
  'text-[length:var(--fs-page-title)] md:text-[15px] md:tracking-[-0.019em] font-semibold text-foreground leading-tight truncate';

/**
 * The header's refresh control, published so a page can place it where the
 * handoff's slot order puts it: page-specific controls · refresh · project
 * select · primary action last.
 *
 * `<PageHeader onRefresh>` renders this first in the slot, which is the right
 * position on every page whose slot is refresh + project select. The five
 * surfaces that ship controls BEFORE refresh (the three network lenses, admin
 * Users, admin Projects) compose it themselves instead, so there is still one
 * refresh button in the product rather than six near-copies of one.
 *
 * 36 × 36 from `md` up, the 44px touch target below it, `animate-spin` and
 * `disabled` while the page's loading flag is true.
 */
export function HeaderRefreshButton({
  onClick,
  loading = false,
  label = 'Refresh data',
  className,
}: {
  onClick: () => void;
  loading?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={loading}
      variant="outline"
      size="icon"
      className={cn('h-11 w-11', HDR_ICON_BUTTON, className)}
      aria-label={label}
      title={label}
    >
      <RefreshCw className={cn('h-3.5 w-3.5 md:h-4 md:w-4', loading && 'animate-spin')} />
    </Button>
  );
}

interface PageHeaderProps {
  title: string;
  /**
   * Mobile-only from the desktop header handoff on. The desktop bar is title +
   * right slot and nothing else — no subtitle element, no meta line — so this
   * renders `md:hidden`. The prop survives because two surfaces (Profile,
   * Interactive Network Space) still render one tree at both widths and would
   * otherwise lose their phone context line; every desktop-only call site has
   * dropped it.
   */
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
  /**
   * Wear the mobile skin below `md` (`docs/mobile-skin-spec.md` §4): a
   * 17-21px title on the 93% canvas, the skin's fluid gutter, no rule, no
   * subtitle, and at most one right-hand element. Above `md` it is
   * byte-identical to the header every other page renders.
   *
   * This is a migration seam, not a permanent variant. It exists because the
   * skin lands one surface at a time and a converted screen's gutter must not
   * drag the unconverted screens' with it — the two clamps are close now but
   * not identical, and a header out of line with its own content reads as a
   * bug. It comes out, along with the flag, when the last surface converts.
   */
  skin?: boolean;
}

export function PageHeader({
  title,
  subtitle,
  rightContent,
  onRefresh,
  refreshLoading = false,
  onBack,
  backLabel = 'Back',
  skin = false,
}: PageHeaderProps) {
  const compactChrome = useCompactChrome();

  return (
    <div
      className={cn(
        PAGE_HEADER_SHELL,
        skin &&
          // The skin's header sits ON the canvas: no rule, no blur, no tint of
          // its own. Everything here is released at `md`, where the shell's
          // own values take back over untouched.
          'border-b-0 bg-[hsl(var(--m-canvas))] backdrop-blur-none ' +
            'md:border-b md:bg-header-background/95 md:backdrop-blur-md',
        'mb-4 md:mb-5',
        skin && 'mb-3 md:mb-5',
        skin ? PAGE_GUTTER_SKIN_BLEED : PAGE_GUTTER_BLEED,
      )}
    >
      {/* Inner padding mirrors the gutter on mobile and holds the audit's
          px-8 py-3.5 from `md` up (C3). */}
      <div
        className={cn(
          PAGE_HEADER_ROW,
          skin && 'min-h-[46px] px-[var(--m-gutter)] py-1.5 md:px-8 md:py-3.5',
          // A phone on its side has no band to spare for a 19px title, so the
          // title drops to the desktop 15px scale and the row to the 44px
          // touch floor — never below it, even here (v2 §5.2). The title does
          // not move out of the header and nothing else in the band changes.
          skin && compactChrome && 'min-h-11 py-1',
        )}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            title={backLabel}
            className={cn(
              'grid h-11 w-11 shrink-0 place-items-center rounded-md md:hidden',
              skin
                // `‹` and the title, nothing between them — the skin gives the
                // back affordance no box of its own (§4).
                ? '-ml-3 border-0 bg-transparent text-[#18181b]'
                : 'border border-border bg-card text-foreground',
            )}
          >
            <ChevronLeft className={skin ? 'h-[22px] w-[22px]' : 'h-4 w-4'} />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <h1
            className={cn(
              PAGE_HEADER_TITLE,
              skin &&
                'text-[length:var(--fs-title)] tracking-[-0.019em] text-[#171717] md:text-[15px]',
              skin && compactChrome && 'text-[15px]',
            )}
            title={title}
          >
            {title}
          </h1>
          {/* The desktop bar has no subtitle element at all (handoff: "Header =
              title + right slot, nothing else"), so this is `md:hidden`. The
              skin drops it below `md` too rather than shrinking it — a second
              line of chrome is a band the phone budget does not have (§4) —
              which leaves it rendering on exactly one surface: an unconverted
              page viewed on a phone. */}
          {subtitle && (
            <div
              className={cn(
                'mt-0.5 truncate text-[12px] text-muted-foreground md:hidden',
                skin && 'hidden',
              )}
            >
              {subtitle}
            </div>
          )}
        </div>

        {/* Right slot: 44px touch floor below `md` (spec §0.3 amendment 2), the
            handoff's one control height — 36px, 8px apart — from `md` up. The
            floor is min-height/min-width so it can never shrink a control that
            is already larger, and it is released at `md` rather than
            overridden. Inputs and selects are covered too — the admin search
            fields live here and a thumb has to hit them like anything else.

            `md:flex-wrap` is what makes the 52px bar fluid rather than
            clipping: a slot too wide for its row wraps and the bar grows,
            which is why the height is a `min-h` and not an `h`. */}
        <div
          className={cn(
            'flex items-center gap-1.5 shrink-0 md:gap-2 md:flex-wrap md:justify-end',
            '[&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11 [&_select]:min-h-11',
            'md:[&_button]:min-h-0 md:[&_button]:min-w-0 md:[&_input]:min-h-0 md:[&_select]:min-h-0',
          )}
        >
          {/* The bar's order is page controls · refresh · project select ·
              primary action. Refresh renders first here, which is correct for
              every page whose slot is refresh + project select. A page with
              controls BEFORE refresh composes `HeaderRefreshButton` inside
              `rightContent` instead of passing `onRefresh`. */}
          {onRefresh && <HeaderRefreshButton onClick={onRefresh} loading={refreshLoading} />}
          {rightContent}
        </div>
      </div>
    </div>
  );
}
