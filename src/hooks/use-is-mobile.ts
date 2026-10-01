// src/hooks/use-is-mobile.ts
//
// Single source of truth for the mobile branch. "Mobile" is two device classes:
// anything narrower than 768px (Tailwind's `md`), AND a touch phone held
// sideways — 844 × 390 is wider than `md`, but it is still a phone, and before
// this rule it rendered the desktop sidebar on a 390px-tall screen (mobile
// redesign handoff §0).
//
// The hook and every `md:` class still agree, because `md:` was taught the same
// exception at build time: `postcss/desktop-md.js` wraps each `md:` rule in
// `not all and ${PHONE_LANDSCAPE_MEDIA}`, so a landscape phone is below `md` in
// CSS as well as here. A mouse desktop at any width ≥ 768 matches neither half
// of MOBILE_QUERY and is untouched. Do not introduce a second breakpoint, and do
// not change either string without the other — `useIsMobile.test.ts` pins them.
//
// Prefer Tailwind classes wherever the change is purely visual. Use this hook only
// when the branch is structural — a different component tree (sidebar vs tab bar),
// or a different element (<table> vs card list).

import * as React from 'react';

export const MOBILE_BREAKPOINT = 768;

/** A touch phone on its side: a coarse primary pointer and no more than 500px of
 *  height. A tablet in landscape (768px+ tall) and a touch laptop (fine primary
 *  pointer) are both outside it. Mirrored in `postcss/desktop-md.js`. */
export const PHONE_LANDSCAPE_MEDIA = '(pointer: coarse) and (max-height: 500px)';

/** Below `md`, or a phone held sideways. */
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px), ${PHONE_LANDSCAPE_MEDIA}`;

/** The landscape-phone half alone, for the landscape layouts (handoff §4). */
export const LANDSCAPE_PHONE_QUERY = `${PHONE_LANDSCAPE_MEDIA} and (orientation: landscape)`;

function useMediaQuery(query: string, fallback: () => boolean): boolean {
  const [matches, setMatches] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia ? window.matchMedia(query).matches : fallback();
  });

  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY, () => window.innerWidth < MOBILE_BREAKPOINT);
}

/** True only for a phone held sideways — a subset of `useIsMobile()`. */
export function useIsLandscapePhone(): boolean {
  return useMediaQuery(LANDSCAPE_PHONE_QUERY, () => false);
}
