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

// The mobile skin's gutter (`docs/mobile-skin-spec.md` §4, v2 §5.3): 14px at
// 320, 16px at 390, 18px from 440 up, and the same desktop half.
//
// It used to be a flat 16px. Fixing it was the right call while the skin was
// one prototype width; across a real fleet it is 5% of a 320px screen and 3.7%
// of a 430px one, which reads as a wide gutter on the small phone and a mean
// one on the large. The clamp is the same shape as PAGE_GUTTER's above, half a
// pixel apart at the floor, so the two scales no longer diverge at 320.
//
// Use it on a converted surface, alongside `<PageHeader skin>` — the two must
// agree, because the header bleeds out of this wrapper.
//
// Both scales exist only while the conversion is in flight. When the last
// surface converts, this becomes the gutter and the clamp above goes.
export const PAGE_GUTTER_SKIN = 'px-[var(--m-gutter)] py-4 md:px-12 md:py-6';

// The skin's bleed, mirroring PAGE_GUTTER_SKIN term for term. A header that
// bleeds by a different value than its content is padded by is a header that
// does not line up with the panel beneath it — 4px out at 320px was exactly
// that bug, and it is why the skin's header carried its own `-mx-4`.
export const PAGE_GUTTER_SKIN_BLEED = '-mx-[var(--m-gutter)] -mt-4 md:-mx-12 md:-mt-6';

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(PAGE_GUTTER, className)}>{children}</div>;
}
