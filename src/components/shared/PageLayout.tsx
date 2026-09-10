import React from 'react';
import Navbar from '@/components/Navbar';
import Footer, { MOBILE_FOOTER_H } from '@/components/Footer';
import PasswordExpiryBanner from '@/components/PasswordExpiryBanner';
import {
  MobileTabBar,
  MobileNavDrawer,
  MOBILE_TABBAR_H,
  MOBILE_TABBAR_BORDER,
} from '@/components/MobileNav';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: React.ReactNode;
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

// Bottom chrome on mobile: tab bar + its border + the credit bar, then (for
// ordinary scrolling pages only) 16px of breathing room, then the device inset.
//
// The tab bar is a fixed height, but the credit bar WRAPS — measured, it is
// three lines (64px) at 320-390, two (48px) at 414-600, and the single line
// MOBILE_FOOTER_H describes only above ~700. So its height is read off the live
// element rather than assumed: a constant here leaves the last 16px of content
// underneath the bar at every common iPhone width, which is precisely what this
// reservation exists to prevent. MOBILE_FOOTER_H stays the first-paint floor.
//
// Two different values come out of this, and they must not be conflated:
// `chromeOnlyPx` is the exact top edge of the tab bar/credit bar and nothing
// more — what a surface that wants to fill the screen right up to the chrome
// asks for (`--pi-chrome`, `MobileNavDrawer`'s `bottomInsetPx`). `chromePx`
// adds 16px of breathing room on top — what an ordinary scrolling page's
// `paddingBottom` wants, so its last line of content isn't flush against the
// bar. Handing the breathing-inclusive value to a `--pi-chrome` consumer
// leaves a 16px gap of bare background above the bar on every render.
const MOBILE_BREATHING_PX = 16;
const MOBILE_CHROME_ONLY_BASE_PX = MOBILE_TABBAR_H + MOBILE_TABBAR_BORDER;

export function PageLayout({ children, isCollapsed, setIsCollapsed }: PageLayoutProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const isMobile = useIsMobile();

  // Purely visual: the measured height of the credit bar, which changes with
  // wrapping and drops to 0 once the bar is dismissed.
  const [footerH, setFooterH] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!isMobile || typeof ResizeObserver === 'undefined') return;
    const el = document.querySelector('footer');
    if (!el) return;
    const measure = () => setFooterH(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);

  const chromeOnlyPx = MOBILE_CHROME_ONLY_BASE_PX + (footerH ?? MOBILE_FOOTER_H);
  const chromePx = chromeOnlyPx + MOBILE_BREATHING_PX;

  return (
    <div className="min-h-screen bg-background">
      {/* sidebar is desktop-only now — the bottom tab bar + drawer replace it below md */}
      <div className="hidden md:block">
        <Navbar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      </div>
      <div
        className={cn(
          // `overflow-x-clip`, NOT `-hidden`. Per CSS Overflow 3, `overflow-x:
          // hidden` with a visible y computes `overflow-y: auto`, which makes
          // this wrapper a scroll container. It is `min-h-screen` with no fixed
          // height, so it never actually scrolls - the document does - and a
          // `position: sticky` child resolves against THIS scrollport and
          // therefore never sticks. That silently unpinned every <PageHeader>
          // in the product while the class said `sticky top-0`. `clip` does the
          // same clipping (measured: documentElement.scrollWidth stays at the
          // viewport width) without establishing a scrollport, and leaves
          // `position: fixed` descendants - MobileSheet is one - unclipped.
          'min-h-screen overflow-x-clip bg-[hsl(var(--surface-sunken))] md:pb-10 md:transition-all md:duration-300',
          'ml-0',
          isCollapsed ? 'md:ml-14' : 'md:ml-48'
        )}
        style={
          isMobile
            ? ({
                paddingBottom:
                  `calc(${chromePx}px + env(safe-area-inset-bottom, 0px))`,
                // Published for the mobile surfaces that must fill exactly
                // the space this reservation leaves: Project Intelligence's
                // full-height chat column and the Simulation Lab's column,
                // whose gate footer has to stay on screen. It is the bottom
                // reservation and nothing else — PI runs edge to edge, and a
                // reader that sits inside PAGE_GUTTER subtracts that gutter
                // itself. The composer and the Run button therefore land on
                // the credit bar however the bar wraps, and follow it when the
                // bar is dismissed. Every other page just scrolls. Deliberately
                // `chromeOnlyPx`, not `chromePx` — these surfaces want the exact
                // chrome boundary, not the 16px of breathing room a scrolling
                // page's own `paddingBottom` (below) adds on top.
                '--pi-chrome': `calc(${chromeOnlyPx}px + env(safe-area-inset-bottom, 0px))`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <PasswordExpiryBanner />
        {children}
      </div>
      <Footer isCollapsed={isCollapsed} hasNavBar />
      <MobileTabBar moreActive={drawerOpen} onToggleMore={() => setDrawerOpen((v) => !v)} />
      <MobileNavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        bottomInsetPx={chromeOnlyPx}
      />
    </div>
  );
}
