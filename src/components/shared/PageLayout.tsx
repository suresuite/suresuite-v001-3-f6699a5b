import React from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import PasswordExpiryBanner from '@/components/PasswordExpiryBanner';
import { MobileTabBar, MobileNavDrawer } from '@/components/MobileNav';
import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: React.ReactNode;
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

export function PageLayout({ children, isCollapsed, setIsCollapsed }: PageLayoutProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* sidebar is desktop-only now — the bottom tab bar + drawer replace it below md */}
      <div className="hidden md:block">
        <Navbar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      </div>
      <div className={cn(
        'min-h-screen overflow-x-hidden bg-[hsl(var(--surface-sunken))] pb-24 md:pb-10 md:transition-all md:duration-300',
        'ml-0',
        isCollapsed ? 'md:ml-14' : 'md:ml-48'
      )}>
        <PasswordExpiryBanner />
        {children}
      </div>
      <Footer isCollapsed={isCollapsed} hasNavBar />
      <MobileTabBar onOpenDrawer={() => setDrawerOpen(true)} />
      <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
