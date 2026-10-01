/**
 * ONE MOBILE RULE, TWO PLACES — the hook and `md:` must agree.
 *
 * `useIsMobile()` decides the structural branch (tab bar vs sidebar, sheet vs
 * dialog); Tailwind's `md:` decides every class-level reset. Since the mobile
 * redesign's §0 both treat a touch phone held sideways as mobile, and they say
 * so in two languages: a media query in `use-is-mobile.ts` and a PostCSS
 * rewrite in `postcss/desktop-md.js`. If either moves alone, a landscape phone
 * renders the mobile tab bar beside the desktop sidebar. This pins the strings
 * and the rewrite.
 */
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import desktopMd, {
  DESKTOP_MD_MEDIA,
  NOT_PHONE_LANDSCAPE_MEDIA,
  PHONE_LANDSCAPE_MEDIA as CSS_PHONE_LANDSCAPE,
} from '../../../postcss/desktop-md.js';
import {
  LANDSCAPE_PHONE_QUERY,
  MOBILE_BREAKPOINT,
  MOBILE_QUERY,
  PHONE_LANDSCAPE_MEDIA,
} from '../use-is-mobile';

const run = (css: string) => postcss([desktopMd()]).process(css, { from: undefined }).css;

describe('mobile detection (handoff §0)', () => {
  it('the hook uses the query the handoff specifies', () => {
    expect(MOBILE_QUERY).toBe('(max-width: 767px), (pointer: coarse) and (max-height: 500px)');
    expect(LANDSCAPE_PHONE_QUERY).toBe(
      '(pointer: coarse) and (max-height: 500px) and (orientation: landscape)',
    );
  });

  it('the CSS rewrite excludes exactly the landscape phone the hook includes', () => {
    expect(CSS_PHONE_LANDSCAPE).toBe(PHONE_LANDSCAPE_MEDIA);
    expect(DESKTOP_MD_MEDIA).toBe(`(min-width: ${MOBILE_BREAKPOINT}px)`);
  });
});

describe('postcss/desktop-md', () => {
  it('wraps every md rule, keeping its selectors and order', () => {
    const out = run('@media (min-width: 768px) { .md\\:block { display: block } .md\\:hidden { display: none } }');
    expect(out).toBe(
      `@media (min-width: 768px) { @media ${NOT_PHONE_LANDSCAPE_MEDIA} { .md\\:block { display: block } .md\\:hidden { display: none } } }`,
    );
  });

  it('leaves every other query alone', () => {
    const css =
      '@media (min-width: 1920px) { .a { color: red } } @media (prefers-reduced-motion: reduce) { .b { color: blue } } .c { color: green }';
    expect(run(css)).toBe(css);
  });

  it('is idempotent', () => {
    const once = run('@media (min-width: 768px) { .a { color: red } }');
    expect(run(once)).toBe(once);
  });
});
