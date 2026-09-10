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

/** Bottom-chrome geometry, in px, published so PageLayout reserves space FROM
 *  these rather than from a hand-summed literal. Change a height here and the
 *  reservation follows; it cannot drift. */
export const MOBILE_TABBAR_H = 56;      // min-h-[56px] on each tab
export const MOBILE_TABBAR_BORDER = 1;  // border-t

const TABS = [
  { to: '/app', label: 'Home', icon: Home },
  { to: '/policies', label: 'Policies', icon: SlidersHorizontal },
  { to: '/simulation-lab', label: 'Lab', icon: FlaskConical },
  { to: '/project-intelligence', label: 'AI', icon: Brain },
] as const;

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

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-border
                 bg-header-background md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      {TABS.map(({ to, label, icon: Icon }) => {
        const active = !moreActive && (pathname === to || pathname.startsWith(to + '/'));
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {active && (
              <span className="absolute top-0 h-0.5 w-[26px] rounded-b bg-foreground" />
            )}
            <Icon className="h-[21px] w-[21px]" strokeWidth={active ? 2.1 : 1.8} />
            <span className={cn('text-[10.5px]', active ? 'font-semibold' : 'font-medium')}>
              {label}
            </span>
          </Link>
        );
      })}

      <button
        type="button"
        onClick={onToggleMore}
        aria-current={moreActive ? 'page' : undefined}
        className={cn(
          'relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1',
          moreActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {moreActive && (
          <span className="absolute top-0 h-0.5 w-[26px] rounded-b bg-foreground" />
        )}
        <Menu className="h-[21px] w-[21px]" strokeWidth={moreActive ? 2.1 : 1.8} />
        <span className={cn('text-[10.5px]', moreActive ? 'font-semibold' : 'font-medium')}>
          More
        </span>
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
  /** Where the tab bar (plus the credit bar above it) starts, in px — the
   *  panel stops there instead of covering them. PageLayout already measures
   *  this for its own content padding; passed through rather than re-derived. */
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

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-40 flex flex-col bg-background md:hidden"
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

      <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="More destinations">
        {visibleSections.map((section, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Separator className="bg-border" />}
            {section.items.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + '/');
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex min-h-[48px] items-center gap-3',
                    'border-b border-border px-[clamp(0.75rem,4vw,1.125rem)] text-[14px]',
                    active ? 'font-medium text-foreground' : 'text-foreground',
                  )}
                >
                  {active && (
                    <span className="absolute inset-y-2 left-0 w-[3px] rounded bg-foreground" />
                  )}
                  <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </React.Fragment>
        ))}
      </nav>

      {/* Mirrors the sidebar's account row: 28px avatar, ring-1, 11px/10px
          stack. The EU/ACCURATE credit line is not repeated here — Footer's
          own credit bar already floats above the tab bar on every mobile
          screen, this one included. */}
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
