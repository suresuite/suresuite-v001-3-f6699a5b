// Mobile navigation: bottom tab bar + a fifth "More" root. Replaces the
// sidebar below `md`.
//
// Tabs are a deliberate reduction of the six NAV_SECTIONS groups to the five
// most-used destinations; Project Manager and the three network lenses move
// into More, which carries the full NAV_SECTIONS inventory unchanged.
//
// More is a root of the tab bar, not a dialog on top of it (demo:
// shots/26-more.png / spec G6). It is full-width, it stops above the tab bar
// rather than covering it, and the tab bar keeps showing "More" active while
// it is open — the same one-tap way back every other tab gets. There is
// nothing to dismiss by tapping outside, because there is no outside: closing
// happens by picking a destination, tapping another tab, or Escape.

import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, SlidersHorizontal, FlaskConical, Brain, Menu, LogOut, User } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS, filterVisibleSections } from '@/components/Navbar';
import { PAGE_HEADER_SHELL, PAGE_HEADER_ROW } from '@/components/shared/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useCompactChrome } from '@/hooks/useViewport';
import { MOBILE_TAB_ROUTES } from './mobileRootRoutes';

/** Bottom-chrome geometry, in px, published so PageLayout reserves space FROM
 *  these rather than from a hand-summed literal. Change a height here and the
 *  reservation follows; it cannot drift.
 *
 *  The landscape height is not a smaller design, it is the same design laid
 *  out along the axis that has room: a phone on its side has ~390px of
 *  height, and 58px of tab bar plus 64px of action bar is a third of it
 *  (v2 §5.2). The icon and the 10px label sit side by side instead of
 *  stacked, and no tab, label or destination changes. */
export const MOBILE_TABBAR_H = 58;      // min-h-[58px] on each tab
export const MOBILE_TABBAR_H_LANDSCAPE = 52;
export const MOBILE_TABBAR_BORDER = 1;  // border-t

// Route strings come from MOBILE_TAB_ROUTES (mobileRootRoutes.ts) — these are
// the four routes that get a highlighted tab. D3-a: many more routes than
// these four are "roots" and still show the bar (just with no item active) —
// see isMobileRootRoute, a separate, broader concern.
const TABS = [
  { to: MOBILE_TAB_ROUTES[0], label: 'Home', icon: Home },
  { to: MOBILE_TAB_ROUTES[1], label: 'Policies', icon: SlidersHorizontal },
  { to: MOBILE_TAB_ROUTES[2], label: 'Lab', icon: FlaskConical },
  // SC Intelligences handoff §0/T1: "AI" retired — 10px in a 78px column
  // won't hold "SC Intelligences", so the tab reads "SC Intel".
  { to: MOBILE_TAB_ROUTES[3], label: 'SC Intel', icon: Brain },
] as const;

/** Re-exported so `PageLayout` and `MobileSheet` import their root-route
 *  check from the same place they import the tab bar's own geometry. Lives in
 *  `mobileRootRoutes.ts` (a plain module, not a component file) so this
 *  re-export cannot trip `react-refresh` on a file that also exports
 *  components — the disable covers only the re-export itself. */
// eslint-disable-next-line react-refresh/only-export-components
export { isMobileRootRoute } from './mobileRootRoutes';

export function MobileTabBar({
  moreActive,
  onToggleMore,
}: {
  /** True while the More panel is open — the demo shows only More bold then,
   *  never a route tab underneath it (shots/26-more.png). */
  moreActive: boolean;
  onToggleMore: () => void;
}) {
  const { pathname } = useLocation();
  const compact = useCompactChrome();

  // The skin's tab bar (spec §4): 58px, white, a #d4d4d4 rule along the top,
  // a 19px icon over a 10px/600 label. Active is ink, inactive is the ink
  // ladder's floor (v2 §2) — colour and weight carry the state, which is why
  // the old top marker bar is gone. The tab inventory, its labels and its
  // routes are untouched, in either orientation.
  const tab = (active: boolean) =>
    cn(
      'flex min-w-0 items-center justify-center px-0.5',
      compact
        ? 'min-h-[52px] flex-row gap-1.5'
        : 'min-h-[58px] flex-col gap-1',
      active ? 'text-[#18181b]' : 'text-[#6b6b6b]',
      'transition-colors duration-200 motion-reduce:transition-none',
    );
  const tabLabel = 'max-w-full truncate text-[10px] font-semibold';

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 items-stretch
                 border-t border-[#d4d4d4] bg-white md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      {TABS.map(({ to, label, icon: Icon }) => {
        // D3-a: a root with no tab of its own (a network lens, Developer
        // API, Super Admin, …) shows this bar but matches none of the four
        // routes below — every item, More included, is simply inactive.
        // Nothing extra to do here; this is just the existing route match
        // returning false for all five, which is the whole of "no item
        // active, no marker bar" the contract asks for.
        const active = !moreActive && (pathname === to || pathname.startsWith(to + '/'));
        return (
          <Link key={to} to={to} aria-current={active ? 'page' : undefined} className={tab(active)}>
            <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.1 : 1.8} />
            <span className={tabLabel}>{label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        onClick={onToggleMore}
        aria-current={moreActive ? 'page' : undefined}
        className={tab(moreActive)}
      >
        <Menu className="h-[19px] w-[19px]" strokeWidth={moreActive ? 2.1 : 1.8} />
        <span className={tabLabel}>More</span>
      </button>
    </nav>
  );
}

export function MobileNavDrawer({
  open,
  onClose,
  bottomInsetPx,
}: {
  open: boolean;
  onClose: () => void;
  /** Where the tab bar starts, in px — the panel stops there instead of
   *  covering it. PageLayout already derives this for its own content
   *  padding; passed through rather than re-computed. */
  bottomInsetPx: number;
}) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const { canAccessPage } = useCapabilities();
  const visibleSections = React.useMemo(
    () => filterVisibleSections(NAV_SECTIONS, canAccessPage),
    [canAccessPage],
  );

  // Closes on its own route change too (a Link inside a row), not just on
  // the tab bar's toggle — so navigating away by any route always drops back
  // to the plain tab content underneath, the same way the demo's other four
  // roots behave.
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Stays mounted through the close animation (same duration as the
  // data-[state=closed]:duration-300 below) instead of the old hard
  // `if (!open) return null` cut, which is the "it used to slide in" the
  // user is asking for back. Same motion language as ui/sheet.tsx's
  // data-state-driven animate-in/out — driven by our own boolean since this
  // panel isn't Radix-backed, not a new vocabulary.
  const CLOSE_MS = 300;
  const [mounted, setMounted] = React.useState(open);
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const t = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  return (
    <div
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'fixed inset-x-0 top-0 z-40 flex flex-col bg-background md:hidden',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
        'data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        'data-[state=closed]:duration-300 data-[state=open]:duration-500',
      )}
      style={{ bottom: `calc(${bottomInsetPx}px + env(safe-area-inset-bottom, 0px))` }}
      role="region"
      aria-label="More"
    >
      {/* Same shell every other screen's header wears (spec — one header
          across the product); the logo sits where a page title would. */}
      <div className={cn(PAGE_HEADER_SHELL, 'shrink-0')}>
        <div className={PAGE_HEADER_ROW}>
          <img src="/logo-mark.png" alt="SuReSuite" className="h-5 w-auto object-contain" />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="More destinations">
        {visibleSections.map((section, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Separator className="my-3 bg-border/50" />}
            {section.items.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + '/');
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex min-h-[44px] items-center gap-2.5 rounded-md px-2.5',
                    'text-[13.5px]',
                    active
                      ? 'bg-muted/80 font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {active && (
                    <span className="absolute inset-y-2 left-0 w-[3px] rounded bg-foreground" />
                  )}
                  <Icon className="h-[15px] w-[15px] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </React.Fragment>
        ))}
      </nav>

      {/* Mirrors the sidebar's account row: 28px avatar, ring-1, 11px/10px
          stack. The EU/ACCURATE credit line is not repeated here — it lives
          in About & help, which this panel links to. */}
      <div className="shrink-0 border-t border-border bg-header-background p-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full
                           bg-foreground text-[11px] font-semibold text-background
                           ring-1 ring-border">
            {user?.name ? user.name.charAt(0).toUpperCase() : <User className="h-3 w-3" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-medium">
              {user?.display_name || user?.name || 'User'}
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {user?.role || 'user'}
            </span>
          </span>
          <button
            type="button"
            aria-label="Log out"
            onClick={() => logout()}
            className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground
                       hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
