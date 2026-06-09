import React from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import PasswordExpiryBanner from '@/components/PasswordExpiryBanner';

interface PageLayoutProps {
  children: React.ReactNode;
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

export function PageLayout({ children, isCollapsed, setIsCollapsed }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      <div className={`transition-all duration-300 ${isCollapsed ? 'ml-[50px]' : 'ml-56'}`}>
        <PasswordExpiryBanner />
        {children}
      </div>
      <Footer isCollapsed={isCollapsed} hasNavBar />
    </div>
  );
}
