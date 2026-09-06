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

// Bottom chrome on mobile, measured rather than guessed: tab bar + its border +
// the credit bar, then 16px of breathing room, then the device inset. Derived so
// a height change in either component cannot leave content underneath.
const MOBILE_CHROME_PX =
  MOBILE_TABBAR_H + MOBILE_TABBAR_BORDER + MOBILE_FOOTER_H + 16;

export function PageLayout({ children, isCollapsed, setIsCollapsed }: PageLayoutProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const isMobile = useIsMobile();

  return (
    <div className="min-h-screen bg-background">
      {/* sidebar is desktop-only now — the bottom tab bar + drawer replace it below md */}
      <div className="hidden md:block">
        <Navbar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      </div>
      <div
        className={cn(
          'min-h-screen overflow-x-hidden bg-[hsl(var(--surface-sunken))] md:pb-10 md:transition-all md:duration-300',
          'ml-0',
          isCollapsed ? 'md:ml-14' : 'md:ml-48'
        )}
        style={
          isMobile
            ? {
                paddingBottom:
                  `calc(${MOBILE_CHROME_PX}px + env(safe-area-inset-bottom, 0px))`,
              }
            : undefined
        }
      >
        <PasswordExpiryBanner />
        {children}
      </div>
      <Footer isCollapsed={isCollapsed} hasNavBar />
      <MobileTabBar onOpenDrawer={() => setDrawerOpen(true)} />
      <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
