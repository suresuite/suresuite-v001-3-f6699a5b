import React from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import PasswordExpiryBanner from '@/components/PasswordExpiryBanner';
import {
  MobileTabBar,
  MobileNavDrawer,
  MOBILE_TABBAR_H,
  MOBILE_TABBAR_H_LANDSCAPE,
  MOBILE_TABBAR_BORDER,
} from '@/components/MobileNav';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useCompactChrome } from '@/hooks/useViewport';
import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: React.ReactNode;
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

// Bottom chrome on mobile: the tab bar and its border, then (for ordinary
// scrolling pages only) 16px of breathing room, then the device inset.
//
// It used to also carry the credit bar, whose height had to be measured live
// because it wrapped to three lines at 320-390px. That bar no longer renders
// below `md` (mobile skin spec §4 — see Footer.tsx), so the reservation is
// two constants again and the ResizeObserver that tracked it is gone.
//
// Two different values still come out of this, and they must not be
// conflated. `chromeOnlyPx` is the exact top edge of the tab bar and nothing
// more — what a surface that wants to fill the screen right up to the chrome
// asks for (`--pi-chrome`, MobileActionBar, MobileNavDrawer's
// `bottomInsetPx`). `chromePx` adds 16px of breathing room on top — what an
// ordinary scrolling page's `paddingBottom` wants, so its last line of content
// is not flush against the bar. Handing the breathing-inclusive value to a
// `--pi-chrome` consumer leaves a 16px gap of bare background above the bar on
// every render.
const MOBILE_BREATHING_PX = 16;
const MOBILE_CHROME_ONLY_BASE_PX = MOBILE_TABBAR_H + MOBILE_TABBAR_BORDER;
const MOBILE_CHROME_ONLY_LANDSCAPE_PX = MOBILE_TABBAR_H_LANDSCAPE + MOBILE_TABBAR_BORDER;

export function PageLayout({ children, isCollapsed, setIsCollapsed }: PageLayoutProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const isMobile = useIsMobile();
  // A phone on its side wears the compact band (v2 §5.2). The reservation is
  // derived from the same predicate the bar itself uses, so the two can never
  // disagree about where the chrome starts.
  const compactChrome = useCompactChrome();

  const chromeOnlyPx = compactChrome
    ? MOBILE_CHROME_ONLY_LANDSCAPE_PX
    : MOBILE_CHROME_ONLY_BASE_PX;
  const chromePx = chromeOnlyPx + MOBILE_BREATHING_PX;

  return (
    <div className="min-h-dvh bg-background">
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
          // The skin's 93% ground is the page canvas on every mobile screen
          // (mobile skin spec §2, v2 §2), so it is painted once here rather than by
          // each converted surface — a screen whose own content is shorter
          // than the viewport would otherwise show the desktop 92% below it.
          // Released at `md`, where the desktop canvas is unchanged.
          // `min-h-dvh`, not `min-h-screen`: `100vh` on a phone is the height
          // the window has once the URL bar has collapsed, so the shell was
          // taller than the viewport on first paint and the canvas resized
          // mid-scroll (v2 §5.2). The utility falls back vh -> svh -> dvh.
          'min-h-dvh overflow-x-clip bg-[hsl(var(--m-canvas))] md:bg-[hsl(var(--surface-sunken))]',
          'md:pb-10 md:transition-all md:duration-300',
          'ml-0',
          isCollapsed ? 'md:ml-14' : 'md:ml-48'
        )}
        style={
          isMobile
            ? ({
                paddingBottom:
                  `calc(${chromePx}px + env(safe-area-inset-bottom, 0px))`,
                // Published for the mobile surfaces that must land exactly on
                // the chrome boundary this reservation leaves: the skin's
                // pinned <MobileActionBar>, Project Intelligence's full-height
                // chat column, and the Simulation Lab's column. It is the
                // bottom reservation and nothing else — PI runs edge to edge,
                // and a reader that sits inside PAGE_GUTTER subtracts that
                // gutter itself. Deliberately `chromeOnlyPx`, not `chromePx`:
                // these surfaces want the exact chrome boundary, not the 16px
                // of breathing room a scrolling page's own `paddingBottom`
                // (below) adds on top.
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
