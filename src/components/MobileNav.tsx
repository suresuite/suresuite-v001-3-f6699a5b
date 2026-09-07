// Mobile navigation: bottom tab bar + drawer. Replaces the sidebar below `md`.
//
// Tabs are a deliberate reduction of the six NAV_SECTIONS groups to the five
// most-used destinations; Project Manager and the three network lenses move
// into the drawer, which carries the full NAV_SECTIONS inventory unchanged.

import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, SlidersHorizontal, FlaskConical, Brain, Menu, X, LogOut, User } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS, filterVisibleSections } from '@/components/Navbar';
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

export function MobileTabBar({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { pathname } = useLocation();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-border
                 bg-header-background md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      {TABS.map(({ to, label, icon: Icon }) => {
        const active = pathname === to || pathname.startsWith(to + '/');
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
        onClick={onOpenDrawer}
        className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1
                   text-muted-foreground"
      >
        <Menu className="h-[21px] w-[21px]" strokeWidth={1.8} />
        <span className="text-[10.5px] font-medium">More</span>
      </button>
    </nav>
  );
}

export function MobileNavDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const { canAccessPage } = useCapabilities();
  const visibleSections = React.useMemo(
    () => filterVisibleSections(NAV_SECTIONS, canAccessPage),
    [canAccessPage],
  );

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
    <div className="fixed inset-0 z-[60] flex md:hidden" role="dialog" aria-modal="true">
      <div className="flex w-[300px] flex-col border-r border-border bg-background">
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border pl-4 pr-2">
          <img src="/logo-mark.png" alt="SuReSuite" className="h-[17px] w-auto object-contain" />
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid h-11 w-11 place-items-center rounded-md text-foreground
                       hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visibleSections.map((section, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Separator className="my-3 bg-border/50" />}
              {section.items.map((item) => {
                const active =
                  pathname === item.to || pathname.startsWith(item.to + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
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
        </div>

        {/* Mirrors the sidebar's account row: 28px avatar, ring-1, 11px/10px stack. */}
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

      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="flex-1 bg-foreground/30"
      />
    </div>
  );
}
