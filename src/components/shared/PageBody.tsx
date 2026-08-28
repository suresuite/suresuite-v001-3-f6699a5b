import React from 'react';
import { cn } from '@/lib/utils';

// The app-page gutter (C1). PageHeader's negative margin MUST mirror these exact
// values at each breakpoint - see PAGE_GUTTER_BLEED below.
export const PAGE_GUTTER = 'px-4 py-4 sm:px-8 lg:px-12 lg:py-6';
export const PAGE_GUTTER_BLEED = '-mx-4 -mt-4 sm:-mx-8 lg:-mx-12 lg:-mt-6';

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(PAGE_GUTTER, className)}>{children}</div>;
}
