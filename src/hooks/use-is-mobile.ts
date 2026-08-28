// src/hooks/use-is-mobile.ts
//
// Single source of truth for the mobile branch. 768px = Tailwind's `md`, so the
// hook and every `md:` class agree; do not introduce a second breakpoint.
//
// Prefer Tailwind classes wherever the change is purely visual. Use this hook only
// when the branch is structural — a different component tree (sidebar vs tab bar),
// or a different element (<table> vs card list).

import * as React from 'react';

export const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT,
  );

  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
