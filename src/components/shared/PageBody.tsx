import React from 'react';
import { cn } from '@/lib/utils';

// The app-page gutter (audit C1, mobile UI spec §2.1).
//
// One breakpoint, 768px (`md`), matching `useIsMobile`. The desktop half is
// literally the audit's `px-12 py-6`; the mobile half is a fluid gutter that
// tracks the viewport instead of stepping:
//
//   320 -> 12px  ·  375 -> 15px  ·  414 -> 16.6px  ·  >=450 -> 18px
//
// PageHeader bleeds out of this wrapper, so PAGE_GUTTER_BLEED must mirror
// these values term for term at every width - change one, change both.
export const PAGE_GUTTER = 'px-[clamp(0.75rem,4vw,1.125rem)] py-4 md:px-12 md:py-6';
export const PAGE_GUTTER_BLEED = '-mx-[clamp(0.75rem,4vw,1.125rem)] -mt-4 md:-mx-12 md:-mt-6';

// The mobile skin's gutter (`docs/mobile-skin-spec.md` §4): a flat 16px below
// `md`, the same desktop half. The skin fixes the screen gutter rather than
// letting it track the viewport, so a panel's edge lands in the same place on
// every phone. Use it on a converted surface, alongside `<PageHeader skin>` —
// the two must agree, because the header bleeds out of this wrapper.
//
// Both scales exist only while the conversion is in flight. When the last
// surface converts, this becomes the gutter and the clamp above goes.
export const PAGE_GUTTER_SKIN = 'px-4 py-4 md:px-12 md:py-6';

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(PAGE_GUTTER, className)}>{children}</div>;
}
